import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { requestJson } from '@/lib/api/client/request'
import { getWorkflowStateContract } from '@/lib/api/contracts/workflows'
import { DEFAULT_DUPLICATE_OFFSET } from '@/lib/workflows/autolayout/constants'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import type { WorkflowDeploymentInfo } from '@/hooks/queries/deployments'
import { deploymentKeys } from '@/hooks/queries/deployments'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'
import { useOperationQueueStore } from '@/stores/operation-queue/store'
import { useUndoRedoStore } from '@/stores/undo-redo'
import { useVariablesStore } from '@/stores/variables/store'
import type { Variable } from '@/stores/variables/types'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import type { HydrationState, WorkflowRegistry } from '@/stores/workflows/registry/types'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getUniqueBlockName, regenerateBlockIds } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState, Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'
import { applyWorkflowStateToStores } from '@/stores/workflows/workflow-state-sync'
import { canHydrateWorkflowInWorkspace, getWorkflowWorkspaceScopeError } from './workspace-scope'

const logger = createLogger('WorkflowRegistry')
const initialHydration: HydrationState = {
  phase: 'idle',
  workspaceId: null,
  workflowId: null,
  requestId: null,
  error: null,
}

const createRequestId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

interface WorkflowRefreshFlight {
  promise: Promise<void>
  queued: boolean
}

const workflowRefreshFlights = new Map<string, WorkflowRefreshFlight>()
const deferredOperationRefreshes = new Map<string, Promise<void>>()

function pruneWorkflowUndoRedo(workflowId: string, workflowState: WorkflowState) {
  const graph = {
    blocksById: workflowState.blocks || {},
    edgesById: Object.fromEntries((workflowState.edges || []).map((edge) => [edge.id, edge])),
  }
  const undoRedoStore = useUndoRedoStore.getState()
  Object.keys(undoRedoStore.stacks).forEach((key) => {
    const [stackWorkflowId, userId] = key.split(':')
    if (stackWorkflowId === workflowId) {
      undoRedoStore.pruneInvalidEntries(stackWorkflowId, userId, graph)
    }
  })
}

function updateDeploymentCache(
  workflowId: string,
  workflowData: {
    isDeployed: boolean
    deployedAt: Date | null
    isPublicApi: boolean
  }
) {
  const deployedAt = workflowData.deployedAt ? workflowData.deployedAt.toISOString() : null
  getQueryClient().setQueryData<WorkflowDeploymentInfo>(
    deploymentKeys.info(workflowId),
    (prev) => ({
      isDeployed: workflowData.isDeployed,
      deployedAt,
      apiKey: prev?.apiKey ?? null,
      needsRedeployment: prev?.needsRedeployment ?? false,
      isPublicApi: workflowData.isPublicApi,
    })
  )
}

function resetWorkflowStores() {
  useWorkflowStore.setState({
    currentWorkflowId: null,
    blocks: {},
    edges: [],
    loops: {},
    parallels: {},
    lastSaved: Date.now(),
  })

  useSubBlockStore.setState({
    workflowValues: {},
  })
}

export const useWorkflowRegistry = create<WorkflowRegistry>()(
  devtools(
    (set, get) => ({
      activeWorkflowId: null,
      error: null,
      hydration: initialHydration,
      clipboard: null,
      pendingSelection: null,

      switchToWorkspace: (workspaceId: string) => {
        logger.info(`Switching to workspace: ${workspaceId}`)

        resetWorkflowStores()
        void invalidateWorkflowLists(getQueryClient(), workspaceId)

        set({
          activeWorkflowId: null,
          error: null,
          hydration: {
            phase: 'idle',
            workspaceId,
            workflowId: null,
            requestId: null,
            error: null,
          },
        })
      },

      loadWorkflowState: async (workflowId: string) => {
        const workspaceId = get().hydration.workspaceId
        if (!workspaceId) {
          const message = `Cannot load workflow ${workflowId} without a workspace scope`
          logger.error(message)
          set({ error: message })
          throw new Error(message)
        }

        const requestId = createRequestId()

        set((state) => ({
          error: null,
          hydration: {
            phase: 'state-loading',
            workspaceId: workspaceId ?? state.hydration.workspaceId,
            workflowId,
            requestId,
            error: null,
          },
        }))

        try {
          const { data: workflowData } = await requestJson(getWorkflowStateContract, {
            params: { id: workflowId },
          })

          if (!canHydrateWorkflowInWorkspace(workflowData.workspaceId, workspaceId)) {
            throw new Error(
              getWorkflowWorkspaceScopeError(workflowId, workflowData.workspaceId, workspaceId)
            )
          }

          updateDeploymentCache(workflowId, workflowData)

          let workflowState: WorkflowState

          if (workflowData?.state) {
            const wireState = workflowData.state as Pick<
              WorkflowState,
              'blocks' | 'edges' | 'loops' | 'parallels'
            >
            workflowState = {
              currentWorkflowId: workflowId,
              blocks: wireState.blocks || {},
              edges: wireState.edges || [],
              loops: wireState.loops || {},
              parallels: wireState.parallels || {},
              lastSaved: Date.now(),
            }
          } else {
            workflowState = {
              currentWorkflowId: workflowId,
              blocks: {},
              edges: [],
              loops: {},
              parallels: {},
              lastSaved: Date.now(),
            }

            logger.info(
              `Workflow ${workflowId} has no state yet - will load from DB or show empty canvas`
            )
          }

          const currentHydration = get().hydration
          if (
            currentHydration.requestId !== requestId ||
            currentHydration.workflowId !== workflowId
          ) {
            logger.info('Discarding stale workflow hydration result', {
              workflowId,
              requestId,
            })
            return
          }

          useWorkflowStore.getState().replaceWorkflowState(workflowState)
          useSubBlockStore.getState().initializeFromWorkflow(workflowId, workflowState.blocks || {})

          const wireVariables = workflowData.variables
          if (wireVariables) {
            useVariablesStore.setState((state) => {
              const withoutWorkflow = Object.fromEntries(
                Object.entries(state.variables).filter(
                  (entry): entry is [string, Variable] => entry[1].workflowId !== workflowId
                )
              )
              return {
                variables: {
                  ...withoutWorkflow,
                  ...(wireVariables as Record<string, Variable>),
                },
              }
            })
          }

          window.dispatchEvent(
            new CustomEvent('active-workflow-changed', {
              detail: { workflowId },
            })
          )

          set((state) => ({
            activeWorkflowId: workflowId,
            error: null,
            hydration: {
              phase: 'ready',
              workspaceId: state.hydration.workspaceId,
              workflowId,
              requestId,
              error: null,
            },
          }))

          logger.info(`Switched to workflow ${workflowId}`)
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : `Failed to load workflow ${workflowId}: Unknown error`
          logger.error(message)

          const currentHydration = get().hydration
          if (
            currentHydration.requestId !== requestId ||
            currentHydration.workflowId !== workflowId
          ) {
            logger.info('Discarding stale workflow error', { workflowId, requestId })
            return
          }

          set((state) => ({
            error: message,
            hydration: {
              phase: 'error',
              workspaceId: state.hydration.workspaceId,
              workflowId,
              requestId: null,
              error: message,
            },
          }))
          throw error
        }
      },

      refreshWorkflowState: async (workflowId, options) => {
        const existingFlight = workflowRefreshFlights.get(workflowId)
        if (existingFlight) {
          existingFlight.queued = true
          logger.debug('Coalesced workflow refresh into queued follow-up', {
            workflowId,
            reason: options?.reason,
          })
          return existingFlight.promise
        }

        const flight: WorkflowRefreshFlight = {
          promise: Promise.resolve(),
          queued: false,
        }

        const runRefresh = async () => {
          const registryAtStart = get()
          const hydrationAtStart = registryAtStart.hydration
          if (
            registryAtStart.activeWorkflowId !== workflowId ||
            hydrationAtStart.phase !== 'ready' ||
            hydrationAtStart.workflowId !== workflowId ||
            !hydrationAtStart.workspaceId
          ) {
            logger.debug('Skipping silent workflow refresh because workflow is not ready', {
              workflowId,
              reason: options?.reason,
            })
            return
          }

          const diffStoreAtStart = useWorkflowDiffStore.getState()
          if (diffStoreAtStart.hasActiveDiff) {
            logger.info('Deferring silent workflow refresh while a diff is active', { workflowId })
            diffStoreAtStart.markExternalUpdatePending(workflowId)
            return
          }

          const operationQueueAtStart = useOperationQueueStore.getState()
          if (operationQueueAtStart.hasPendingOperations(workflowId)) {
            logger.info('Deferring silent workflow refresh while local operations are pending', {
              workflowId,
            })
            diffStoreAtStart.markExternalUpdatePending(workflowId)
            if (!deferredOperationRefreshes.has(workflowId)) {
              const deferredRefresh = operationQueueAtStart
                .waitForWorkflowOperations(workflowId)
                .then(async (ready) => {
                  if (ready) {
                    await get().refreshWorkflowState(workflowId, {
                      reason: 'deferred refresh after local operations',
                    })
                    return
                  }

                  const latestQueue = useOperationQueueStore.getState()
                  if (
                    latestQueue.hasPendingOperations(workflowId) &&
                    !latestQueue.hasOperationError
                  ) {
                    return
                  }
                  const latestDiffStore = useWorkflowDiffStore.getState()
                  latestDiffStore.clearExternalUpdatePending(workflowId)
                  latestDiffStore.setWorkflowReconciliationError(
                    workflowId,
                    'Failed to save local workflow changes before syncing external updates.'
                  )
                })
                .finally(() => {
                  deferredOperationRefreshes.delete(workflowId)
                })
              deferredOperationRefreshes.set(workflowId, deferredRefresh)
            }
            return
          }

          const workspaceId = hydrationAtStart.workspaceId
          const hydrationRequestId = hydrationAtStart.requestId
          const pendingExternalUpdateAtStart =
            diffStoreAtStart.pendingExternalUpdates[workflowId] ?? 0
          diffStoreAtStart.setWorkflowReconciliationInProgress(workflowId, true)
          let replayAfterCurrent = false

          try {
            const { data: workflowData } = await requestJson(getWorkflowStateContract, {
              params: { id: workflowId },
            })

            const currentRegistry = get()
            const currentHydration = currentRegistry.hydration
            if (
              currentRegistry.activeWorkflowId !== workflowId ||
              currentHydration.phase !== 'ready' ||
              currentHydration.workflowId !== workflowId ||
              currentHydration.workspaceId !== workspaceId ||
              currentHydration.requestId !== hydrationRequestId
            ) {
              logger.info('Discarding stale silent workflow refresh result', { workflowId })
              return
            }

            if (!canHydrateWorkflowInWorkspace(workflowData.workspaceId, workspaceId)) {
              throw new Error(
                getWorkflowWorkspaceScopeError(workflowId, workflowData.workspaceId, workspaceId)
              )
            }

            const diffStoreBeforeApply = useWorkflowDiffStore.getState()
            const pendingExternalUpdateBeforeApply =
              diffStoreBeforeApply.pendingExternalUpdates[workflowId] ?? 0
            const hasPendingOperations = useOperationQueueStore
              .getState()
              .hasPendingOperations(workflowId)
            if (
              diffStoreBeforeApply.hasActiveDiff ||
              pendingExternalUpdateBeforeApply > pendingExternalUpdateAtStart ||
              hasPendingOperations
            ) {
              logger.info('Deferring silent workflow refresh apply due to newer local state', {
                workflowId,
              })
              diffStoreBeforeApply.markExternalUpdatePending(workflowId)
              replayAfterCurrent = !diffStoreBeforeApply.hasActiveDiff && !hasPendingOperations
              if (hasPendingOperations && !deferredOperationRefreshes.has(workflowId)) {
                const deferredRefresh = useOperationQueueStore
                  .getState()
                  .waitForWorkflowOperations(workflowId)
                  .then((ready) => {
                    if (!ready) return
                    return get().refreshWorkflowState(workflowId, {
                      reason: 'deferred refresh after local operations during fetch',
                    })
                  })
                  .finally(() => {
                    deferredOperationRefreshes.delete(workflowId)
                  })
                deferredOperationRefreshes.set(workflowId, deferredRefresh)
              }
              return
            }

            const wireState = workflowData.state as Pick<
              WorkflowState,
              'blocks' | 'edges' | 'loops' | 'parallels'
            >
            const workflowState: WorkflowState = {
              currentWorkflowId: workflowId,
              blocks: wireState.blocks || {},
              edges: wireState.edges || [],
              loops: wireState.loops || {},
              parallels: wireState.parallels || {},
              lastSaved: Date.now(),
            }
            if (Object.hasOwn(workflowData, 'variables')) {
              workflowState.variables = workflowData.variables || {}
            }

            applyWorkflowStateToStores(workflowId, workflowState)
            pruneWorkflowUndoRedo(workflowId, workflowState)
            updateDeploymentCache(workflowId, workflowData)

            const diffStoreAfterApply = useWorkflowDiffStore.getState()
            if (
              (diffStoreAfterApply.pendingExternalUpdates[workflowId] ?? 0) <=
              pendingExternalUpdateAtStart
            ) {
              diffStoreAfterApply.clearExternalUpdatePending(workflowId)
            }
            diffStoreAfterApply.setWorkflowReconciliationError(workflowId, null)
            logger.info('Silently refreshed workflow state', {
              workflowId,
              reason: options?.reason,
            })
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : `Failed to silently refresh workflow ${workflowId}`
            logger.error('Failed to silently refresh workflow state', {
              error: message,
              workflowId,
              reason: options?.reason,
            })
            const latestDiffStore = useWorkflowDiffStore.getState()
            if (
              (latestDiffStore.pendingExternalUpdates[workflowId] ?? 0) <=
              pendingExternalUpdateAtStart
            ) {
              latestDiffStore.clearExternalUpdatePending(workflowId)
            }
            latestDiffStore.setWorkflowReconciliationError(
              workflowId,
              'Failed to sync the latest workflow changes. Refresh and try again.'
            )
            throw error
          } finally {
            useWorkflowDiffStore.getState().setWorkflowReconciliationInProgress(workflowId, false)
            if (replayAfterCurrent && get().activeWorkflowId === workflowId) {
              void get().refreshWorkflowState(workflowId, {
                reason: 'queued newer external update',
              })
            }
          }
        }

        flight.promise = runRefresh().finally(async () => {
          if (workflowRefreshFlights.get(workflowId) !== flight) return
          workflowRefreshFlights.delete(workflowId)
          if (flight.queued && get().activeWorkflowId === workflowId) {
            await get().refreshWorkflowState(workflowId, {
              reason: 'coalesced queued refresh',
            })
          }
        })
        workflowRefreshFlights.set(workflowId, flight)
        return flight.promise
      },

      setActiveWorkflow: async (id: string) => {
        const { activeWorkflowId, hydration } = get()

        const workflowStoreState = useWorkflowStore.getState()
        const hasWorkflowData = Object.keys(workflowStoreState.blocks).length > 0

        const isFullyHydrated =
          activeWorkflowId === id &&
          hasWorkflowData &&
          hydration.phase === 'ready' &&
          hydration.workflowId === id

        if (isFullyHydrated) {
          logger.info(`Already active workflow ${id} with data loaded, skipping switch`)
          return
        }

        await get().loadWorkflowState(id)
      },

      markWorkflowCreating: (workflowId: string) => {
        set((state) => ({
          error: null,
          hydration: {
            phase: 'creating' as const,
            workspaceId: state.hydration.workspaceId,
            workflowId,
            requestId: null,
            error: null,
          },
        }))
        logger.info(`Marked workflow ${workflowId} as creating`)
      },

      markWorkflowCreated: (workflowId: string | null) => {
        const { hydration } = get()

        if (!workflowId) {
          if (hydration.phase === 'creating') {
            set((state) => ({
              hydration: {
                ...state.hydration,
                phase: 'idle' as const,
                workflowId: null,
                error: null,
              },
            }))
          }
          return
        }

        if (hydration.phase !== 'creating' || hydration.workflowId !== workflowId) {
          logger.info(
            `Ignoring markWorkflowCreated for ${workflowId} — hydration is ${hydration.phase}/${hydration.workflowId}`
          )
          return
        }

        logger.info(`Workflow ${workflowId} created, loading state`)
        get()
          .loadWorkflowState(workflowId)
          .catch((error) => {
            logger.error(`Failed to load newly created workflow ${workflowId}:`, error)
          })
      },

      logout: () => {
        logger.info('Logging out - clearing all workflow data')

        resetWorkflowStores()

        // Clear the React Query cache to remove all server state
        getQueryClient().clear()

        set({
          activeWorkflowId: null,
          error: null,
          hydration: initialHydration,
          clipboard: null,
        })

        logger.info('Logout complete - all workflow data cleared')
      },

      copyBlocks: (blockIds: string[]) => {
        if (blockIds.length === 0) return

        const workflowStore = useWorkflowStore.getState()
        const activeWorkflowId = get().activeWorkflowId
        const subBlockStore = useSubBlockStore.getState()

        const copiedBlocks: Record<string, BlockState> = {}
        const copiedSubBlockValues: Record<string, Record<string, unknown>> = {}
        const blockIdSet = new Set(blockIds)

        blockIds.forEach((blockId) => {
          const loop = workflowStore.loops[blockId]
          if (loop?.nodes) loop.nodes.forEach((n) => blockIdSet.add(n))
          const parallel = workflowStore.parallels[blockId]
          if (parallel?.nodes) parallel.nodes.forEach((n) => blockIdSet.add(n))
        })

        blockIdSet.forEach((blockId) => {
          const block = workflowStore.blocks[blockId]
          if (block) {
            copiedBlocks[blockId] = JSON.parse(JSON.stringify(block))
            if (activeWorkflowId) {
              const blockValues = subBlockStore.workflowValues[activeWorkflowId]?.[blockId]
              if (blockValues) {
                copiedSubBlockValues[blockId] = JSON.parse(JSON.stringify(blockValues))
              }
            }
          }
        })

        const copiedEdges = workflowStore.edges.filter(
          (edge) => blockIdSet.has(edge.source) && blockIdSet.has(edge.target)
        )

        const copiedLoops: Record<string, Loop> = {}
        Object.entries(workflowStore.loops).forEach(([loopId, loop]) => {
          if (blockIdSet.has(loopId)) {
            copiedLoops[loopId] = JSON.parse(JSON.stringify(loop))
          }
        })

        const copiedParallels: Record<string, Parallel> = {}
        Object.entries(workflowStore.parallels).forEach(([parallelId, parallel]) => {
          if (blockIdSet.has(parallelId)) {
            copiedParallels[parallelId] = JSON.parse(JSON.stringify(parallel))
          }
        })

        set({
          clipboard: {
            blocks: copiedBlocks,
            edges: copiedEdges,
            subBlockValues: copiedSubBlockValues,
            loops: copiedLoops,
            parallels: copiedParallels,
            timestamp: Date.now(),
          },
        })

        logger.info('Copied blocks to clipboard', { count: Object.keys(copiedBlocks).length })
      },

      preparePasteData: (positionOffset = DEFAULT_DUPLICATE_OFFSET) => {
        const { clipboard, activeWorkflowId } = get()
        if (!clipboard || Object.keys(clipboard.blocks).length === 0) return null
        if (!activeWorkflowId) return null

        const workflowStore = useWorkflowStore.getState()
        const { blocks, edges, loops, parallels, subBlockValues } = regenerateBlockIds(
          clipboard.blocks,
          clipboard.edges,
          clipboard.loops,
          clipboard.parallels,
          clipboard.subBlockValues,
          positionOffset,
          workflowStore.blocks,
          getUniqueBlockName
        )

        return { blocks, edges, loops, parallels, subBlockValues }
      },

      hasClipboard: () => {
        const { clipboard } = get()
        return clipboard !== null && Object.keys(clipboard.blocks).length > 0
      },

      clearClipboard: () => {
        set({ clipboard: null })
      },

      setPendingSelection: (blockIds: string[]) => {
        set((state) => ({
          pendingSelection: [...(state.pendingSelection ?? []), ...blockIds],
        }))
      },

      clearPendingSelection: () => {
        set({ pendingSelection: null })
      },
    }),
    { name: 'workflow-registry' }
  )
)
