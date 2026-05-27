/**
 * React Query hooks for managing workflow metadata and mutations.
 */

import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { revertToDeploymentVersionContract } from '@/lib/api/contracts/deployments'
import {
  createWorkflowContract,
  deleteWorkflowContract,
  duplicateWorkflowContract,
  getWorkflowPublicationContract,
  getWorkflowStateContract,
  type ImportWorkflowAsSuperuserBody,
  type ImportWorkflowAsSuperuserResponse,
  importWorkflowAsSuperuserContract,
  listPublishedWorkflowsForWorkgroupContract,
  listWorkflowTracksContract,
  type PublishedWorkflowCatalogItem,
  publishWorkflowContract,
  reorderWorkflowsContract,
  restoreWorkflowContract,
  updateWorkflowContract,
  updateWorkflowPublicationContract,
} from '@/lib/api/contracts/workflows'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
import { deploymentKeys } from '@/hooks/queries/deployments'
import { fetchDeploymentVersionState } from '@/hooks/queries/utils/fetch-deployment-version-state'
import { getFolderMap } from '@/hooks/queries/utils/folder-cache'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'
import { getTopInsertionSortOrder } from '@/hooks/queries/utils/top-insertion-sort-order'
import { getWorkflows } from '@/hooks/queries/utils/workflow-cache'
import { type WorkflowQueryScope, workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import {
  getWorkflowListQueryOptions,
  mapWorkflow,
  WORKFLOW_LIST_STALE_TIME,
} from '@/hooks/queries/utils/workflow-list-query'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { generateCreativeWorkflowName } from '@/stores/workflows/registry/utils'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowQueries')

export { type WorkflowQueryScope, workflowKeys } from '@/hooks/queries/utils/workflow-keys'

async function fetchWorkflowState(
  workflowId: string,
  signal?: AbortSignal
): Promise<WorkflowState | null> {
  const { data } = await requestJson(getWorkflowStateContract, {
    params: { id: workflowId },
    signal,
  })
  const wireState = data.state
  return {
    ...wireState,
    loops: wireState.loops ?? {},
    parallels: wireState.parallels ?? {},
    deployedAt: wireState.deployedAt ?? undefined,
  } as WorkflowState
}

/**
 * Fetches the full workflow state for a single workflow.
 * Used by workflow blocks to show a preview of the child workflow
 * and as a base query for input fields extraction.
 */
export function useWorkflowState(workflowId: string | undefined) {
  return useQuery({
    queryKey: workflowKeys.state(workflowId),
    queryFn: workflowId ? ({ signal }) => fetchWorkflowState(workflowId, signal) : skipToken,
    staleTime: 30 * 1000,
  })
}

/**
 * Batched workflow-state fetch for callers that need state for several
 * workflows at once (e.g. a table with multiple workflow groups). One
 * subscription per unique workflow id — duplicates in `workflowIds` are
 * collapsed before subscribing so N consumers of the same id don't each
 * register their own observer.
 */
export function useWorkflowStates(
  workflowIds: ReadonlyArray<string | undefined>
): Map<string, WorkflowState | null> {
  const uniqueIds = Array.from(new Set(workflowIds.filter((id): id is string => Boolean(id))))
  const results = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: workflowKeys.state(id),
      queryFn: ({ signal }: { signal?: AbortSignal }) => fetchWorkflowState(id, signal),
      staleTime: 30 * 1000,
    })),
  })
  const map = new Map<string, WorkflowState | null>()
  uniqueIds.forEach((id, i) => {
    map.set(id, (results[i].data as WorkflowState | null | undefined) ?? null)
  })
  return map
}

export function useWorkflows(
  workspaceId?: string,
  options?: { scope?: WorkflowQueryScope; enabled?: boolean }
) {
  const { scope = 'active', enabled = true } = options || {}

  return useQuery({
    queryKey: workflowKeys.list(workspaceId, scope),
    queryFn:
      workspaceId && enabled ? getWorkflowListQueryOptions(workspaceId, scope).queryFn : skipToken,
    placeholderData: keepPreviousData,
    staleTime: WORKFLOW_LIST_STALE_TIME,
  })
}

const selectWorkflowMap = (data: WorkflowMetadata[]): Record<string, WorkflowMetadata> =>
  Object.fromEntries(data.map((w) => [w.id, w]))

/**
 * Returns workflows as a `Record<string, WorkflowMetadata>` keyed by ID.
 * Uses the `select` option so the transformation runs inside React Query
 * with structural sharing — components only re-render when the record changes.
 */
export function useWorkflowMap(
  workspaceId?: string,
  options?: { scope?: WorkflowQueryScope; enabled?: boolean }
) {
  const { scope = 'active', enabled = true } = options || {}

  return useQuery({
    queryKey: workflowKeys.list(workspaceId, scope),
    queryFn:
      workspaceId && enabled ? getWorkflowListQueryOptions(workspaceId, scope).queryFn : skipToken,
    placeholderData: keepPreviousData,
    staleTime: WORKFLOW_LIST_STALE_TIME,
    select: selectWorkflowMap,
  })
}

async function fetchWorkflowTracks(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkflowTracksData> {
  const response = await requestJson(listWorkflowTracksContract, {
    params: { id: workspaceId },
    signal,
  })

  return {
    drafts: response.drafts.map(mapWorkflow),
    published: response.published.map(mapWorkflow),
  }
}

export function useWorkflowTracks(workspaceId?: string) {
  return useQuery({
    queryKey: workflowKeys.trackList(workspaceId),
    queryFn: workspaceId ? ({ signal }) => fetchWorkflowTracks(workspaceId, signal) : skipToken,
    staleTime: WORKFLOW_LIST_STALE_TIME,
  })
}

async function fetchWorkflowPublication(
  workflowId: string,
  signal?: AbortSignal
): Promise<WorkflowPublicationData> {
  return requestJson(getWorkflowPublicationContract, {
    params: { id: workflowId },
    signal,
  })
}

export function useWorkflowPublication(workflowId?: string) {
  return useQuery({
    queryKey: workflowKeys.publication(workflowId),
    queryFn: workflowId ? ({ signal }) => fetchWorkflowPublication(workflowId, signal) : skipToken,
    staleTime: 30 * 1000,
  })
}

async function fetchPublishedWorkflowsForWorkgroup(
  workgroupId: string,
  signal?: AbortSignal
): Promise<PublishedWorkflowView[]> {
  const response = await requestJson(listPublishedWorkflowsForWorkgroupContract, {
    params: { workgroupId },
    signal,
  })

  return response.data.map(mapPublishedWorkflowCatalogItem)
}

export function usePublishedWorkflowsForWorkgroup(workgroupId?: string) {
  return useQuery({
    queryKey: workflowKeys.publishedWorkgroupList(workgroupId),
    queryFn: workgroupId
      ? ({ signal }) => fetchPublishedWorkflowsForWorkgroup(workgroupId, signal)
      : skipToken,
    staleTime: WORKFLOW_LIST_STALE_TIME,
  })
}

interface CreateWorkflowVariables {
  workspaceId: string
  name?: string
  description?: string
  color?: string
  folderId?: string | null
  sortOrder?: number
  id?: string
  deduplicate?: boolean
  track?: 'draft' | 'published'
  visibility?: 'workspace' | 'organization' | 'selected_workgroups'
  sourceWorkflowId?: string | null
}

interface CreateWorkflowMutationData {
  id: string
  name: string
  description?: string
  color: string
  workspaceId: string
  folderId?: string | null
  sortOrder: number
  track: 'draft' | 'published'
  visibility: 'workspace' | 'organization' | 'selected_workgroups'
  sourceWorkflowId?: string | null
  publishedAt?: Date | null
  subBlockValues?: Record<string, Record<string, unknown>>
}

interface WorkflowPublicationScope {
  workgroupId: string
}

export interface WorkflowPublicationData {
  workflowId: string
  track: 'draft' | 'published'
  visibility: 'workspace' | 'organization' | 'selected_workgroups'
  sourceWorkflowId: string | null
  publishedWorkflowId: string | null
  publishedAt: string | null
  publishedBy: string | null
  viewerScopes: WorkflowPublicationScope[]
}

export interface WorkflowTracksData {
  drafts: WorkflowMetadata[]
  published: WorkflowMetadata[]
}

export interface PublishedWorkflowView
  extends Omit<PublishedWorkflowCatalogItem, 'description' | 'publishedAt'> {
  description?: string
  publishedAt: Date | null
  workspaceName: string
}

export function mapPublishedWorkflowCatalogItem(
  workflow: PublishedWorkflowCatalogItem
): PublishedWorkflowView {
  return {
    ...workflow,
    description: workflow.description ?? undefined,
    publishedAt: workflow.publishedAt ? new Date(workflow.publishedAt) : null,
  }
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: CreateWorkflowVariables): Promise<CreateWorkflowMutationData> => {
      const {
        workspaceId,
        name,
        description,
        color,
        folderId,
        sortOrder,
        id,
        deduplicate,
        track,
        visibility,
        sourceWorkflowId,
      } = variables

      logger.info(`Creating new workflow in workspace: ${workspaceId}`)

      const createdWorkflow = await requestJson(createWorkflowContract, {
        body: {
          id,
          name: name || generateCreativeWorkflowName(),
          description: description || 'New workflow',
          color: color || getNextWorkflowColor(),
          workspaceId,
          folderId: folderId || null,
          sortOrder,
          deduplicate,
          track,
          visibility,
          sourceWorkflowId,
        },
      })
      const workflowId = createdWorkflow.id

      logger.info(`Successfully created workflow ${workflowId}`)

      return {
        id: workflowId,
        name: createdWorkflow.name,
        description: createdWorkflow.description,
        color: createdWorkflow.color,
        workspaceId,
        folderId: createdWorkflow.folderId,
        sortOrder: createdWorkflow.sortOrder ?? 0,
        track: createdWorkflow.track,
        visibility: createdWorkflow.visibility,
        sourceWorkflowId: createdWorkflow.sourceWorkflowId,
        publishedAt: createdWorkflow.publishedAt ? new Date(createdWorkflow.publishedAt) : null,
        subBlockValues: createdWorkflow.subBlockValues,
      }
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: workflowKeys.list(variables.workspaceId, 'active'),
      })

      const snapshot = queryClient.getQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active')
      )

      const tempId = variables.id ?? generateId()
      let sortOrder: number
      if (variables.sortOrder !== undefined) {
        sortOrder = variables.sortOrder
      } else {
        const currentWorkflows = Object.fromEntries(
          getWorkflows(variables.workspaceId).map((w) => [w.id, w])
        )
        sortOrder = getTopInsertionSortOrder(
          currentWorkflows,
          getFolderMap(variables.workspaceId),
          variables.workspaceId,
          variables.folderId
        )
      }

      const optimistic: WorkflowMetadata = {
        id: tempId,
        name: variables.name || generateCreativeWorkflowName(),
        lastModified: new Date(),
        createdAt: new Date(),
        description: variables.description || 'New workflow',
        color: variables.color || getNextWorkflowColor(),
        workspaceId: variables.workspaceId,
        folderId: variables.folderId || null,
        sortOrder,
        track: variables.track ?? 'draft',
        visibility: variables.visibility ?? 'workspace',
        sourceWorkflowId: variables.sourceWorkflowId ?? null,
        publishedAt: null,
        locked: false,
      }

      queryClient.setQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active'),
        (old) => [...(old ?? []), optimistic]
      )
      logger.info(`[CreateWorkflow] Added optimistic entry: ${tempId}`)

      return { snapshot, tempId }
    },
    onSuccess: (data, variables, context) => {
      if (!context) return
      const { tempId } = context

      queryClient.setQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active'),
        (old) =>
          (old ?? []).map((w) =>
            w.id === tempId
              ? {
                  id: data.id,
                  name: data.name,
                  lastModified: new Date(),
                  createdAt: new Date(),
                  description: data.description,
                  color: data.color,
                  workspaceId: data.workspaceId,
                  folderId: data.folderId,
                  sortOrder: data.sortOrder,
                  track: data.track,
                  visibility: data.visibility,
                  sourceWorkflowId: data.sourceWorkflowId ?? null,
                  publishedAt: data.publishedAt ?? null,
                }
              : w
          )
      )

      if (tempId !== data.id) {
        useFolderStore.setState((state) => {
          const selectedWorkflows = new Set(state.selectedWorkflows)
          if (selectedWorkflows.has(tempId)) {
            selectedWorkflows.delete(tempId)
            selectedWorkflows.add(data.id)
          }
          return { selectedWorkflows }
        })
      }

      if (data.subBlockValues) {
        useSubBlockStore.setState((state) => ({
          workflowValues: {
            ...state.workflowValues,
            [data.id]: data.subBlockValues!,
          },
        }))
      }

      logger.info(`[CreateWorkflow] Success, replaced temp entry ${tempId}`)

      useWorkflowRegistry.getState().markWorkflowCreated(data.id)
    },
    onError: (_error, variables, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(
          workflowKeys.list(variables.workspaceId, 'active'),
          context.snapshot
        )
        logger.info('[CreateWorkflow] Rolled back to previous state')
      }

      useWorkflowRegistry.getState().markWorkflowCreated(null)
    },
    onSettled: (_data, _error, variables) => {
      return invalidateWorkflowLists(queryClient, variables.workspaceId, ['active', 'archived'])
    },
  })
}

interface PublishWorkflowVariables {
  workflowId: string
  workspaceId: string
  name?: string
  title?: string
  description?: string
  visibility?: 'workspace' | 'organization' | 'selected_workgroups'
  viewerWorkgroupIds?: string[]
  targetWorkgroupIds?: string[]
  parentVersionId?: string | null
}

export function usePublishWorkflow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: PublishWorkflowVariables): Promise<WorkflowMetadata> => {
      const response = await requestJson(publishWorkflowContract, {
        params: { id: variables.workflowId },
        body: {
          name: variables.name,
          title: variables.title,
          description: variables.description,
          visibility: variables.visibility ?? 'organization',
          viewerWorkgroupIds: variables.viewerWorkgroupIds ?? [],
          targetWorkgroupIds: variables.targetWorkgroupIds ?? [],
          parentVersionId: variables.parentVersionId ?? null,
        },
      })

      return mapWorkflow(response.publishedWorkflow)
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workflowKeys.list(variables.workspaceId, 'active'),
        }),
        queryClient.invalidateQueries({ queryKey: workflowKeys.trackList(variables.workspaceId) }),
        queryClient.invalidateQueries({ queryKey: workflowKeys.publication(variables.workflowId) }),
      ])
    },
  })
}

interface UpdateWorkflowPublicationVariables {
  workflowId: string
  visibility: 'workspace' | 'organization' | 'selected_workgroups'
  viewerWorkgroupIds?: string[]
}

export function useUpdateWorkflowPublication() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      variables: UpdateWorkflowPublicationVariables
    ): Promise<WorkflowPublicationData> => {
      return requestJson(updateWorkflowPublicationContract, {
        params: { id: variables.workflowId },
        body: {
          visibility: variables.visibility,
          viewerWorkgroupIds: variables.viewerWorkgroupIds ?? [],
        },
      })
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: workflowKeys.publication(variables.workflowId),
      })
    },
  })
}

interface DuplicateWorkflowVariables {
  workspaceId: string
  sourceId: string
  name: string
  description?: string
  color: string
  folderId?: string | null
  newId?: string
}

interface DuplicateWorkflowMutationData {
  id: string
  name: string
  description?: string
  color: string
  workspaceId: string
  folderId?: string | null
  sortOrder: number
  locked: boolean
  blocksCount: number
  edgesCount: number
  subflowsCount: number
}

export function useDuplicateWorkflowMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      variables: DuplicateWorkflowVariables
    ): Promise<DuplicateWorkflowMutationData> => {
      const { workspaceId, sourceId, name, description, color, folderId, newId } = variables

      logger.info(`Duplicating workflow ${sourceId} in workspace: ${workspaceId}`)

      const duplicatedWorkflow = await requestJson(duplicateWorkflowContract, {
        params: { id: sourceId },
        body: {
          name,
          description,
          color,
          workspaceId,
          folderId: folderId ?? null,
          newId,
        },
      })

      logger.info(`Successfully duplicated workflow ${sourceId} to ${duplicatedWorkflow.id}`, {
        blocksCount: duplicatedWorkflow.blocksCount,
        edgesCount: duplicatedWorkflow.edgesCount,
        subflowsCount: duplicatedWorkflow.subflowsCount,
      })

      return {
        id: duplicatedWorkflow.id,
        name: duplicatedWorkflow.name || name,
        description: duplicatedWorkflow.description || description,
        color: duplicatedWorkflow.color || color,
        workspaceId,
        folderId: duplicatedWorkflow.folderId ?? folderId,
        sortOrder: duplicatedWorkflow.sortOrder ?? 0,
        locked: duplicatedWorkflow.locked,
        blocksCount: duplicatedWorkflow.blocksCount || 0,
        edgesCount: duplicatedWorkflow.edgesCount || 0,
        subflowsCount: duplicatedWorkflow.subflowsCount || 0,
      }
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: workflowKeys.list(variables.workspaceId, 'active'),
      })

      const snapshot = queryClient.getQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active')
      )
      const tempId = variables.newId ?? generateId()

      const currentWorkflows = Object.fromEntries(
        getWorkflows(variables.workspaceId).map((w) => [w.id, w])
      )
      const targetFolderId = variables.folderId ?? null

      const optimistic: WorkflowMetadata = {
        id: tempId,
        name: variables.name,
        lastModified: new Date(),
        createdAt: new Date(),
        description: variables.description,
        color: variables.color,
        workspaceId: variables.workspaceId,
        folderId: targetFolderId,
        sortOrder: getTopInsertionSortOrder(
          currentWorkflows,
          getFolderMap(variables.workspaceId),
          variables.workspaceId,
          targetFolderId
        ),
        locked: false,
      }

      queryClient.setQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active'),
        (old) => [...(old ?? []), optimistic]
      )
      logger.info(`[DuplicateWorkflow] Added optimistic entry: ${tempId}`)

      return { snapshot, tempId }
    },
    onSuccess: (data, variables, context) => {
      if (!context) return
      const { tempId } = context

      queryClient.setQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active'),
        (old) =>
          (old ?? []).map((w) =>
            w.id === tempId
              ? {
                  id: data.id,
                  name: data.name,
                  lastModified: new Date(),
                  createdAt: new Date(),
                  description: data.description,
                  color: data.color,
                  workspaceId: data.workspaceId,
                  folderId: data.folderId,
                  sortOrder: data.sortOrder,
                  locked: data.locked,
                }
              : w
          )
      )

      if (tempId !== data.id) {
        useFolderStore.setState((state) => {
          const selectedWorkflows = new Set(state.selectedWorkflows)
          if (selectedWorkflows.has(tempId)) {
            selectedWorkflows.delete(tempId)
            selectedWorkflows.add(data.id)
          }
          return { selectedWorkflows }
        })
      }

      logger.info(`[DuplicateWorkflow] Success, replaced temp entry ${tempId}`)
    },
    onError: (_error, variables, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(
          workflowKeys.list(variables.workspaceId, 'active'),
          context.snapshot
        )
        logger.info('[DuplicateWorkflow] Rolled back to previous state')
      }
    },
    onSettled: (_data, _error, variables) => {
      return invalidateWorkflowLists(queryClient, variables.workspaceId)
    },
  })
}

interface UpdateWorkflowVariables {
  workspaceId: string
  workflowId: string
  metadata: Partial<WorkflowMetadata>
}

export function useUpdateWorkflow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: UpdateWorkflowVariables) => {
      const { workflow: updatedWorkflow } = await requestJson(updateWorkflowContract, {
        params: { id: variables.workflowId },
        body: variables.metadata,
      })

      return mapWorkflow(updatedWorkflow)
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: workflowKeys.list(variables.workspaceId, 'active'),
      })

      const snapshot = queryClient.getQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active')
      )

      queryClient.setQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active'),
        (old) =>
          (old ?? []).map((w) =>
            w.id === variables.workflowId
              ? { ...w, ...variables.metadata, lastModified: new Date() }
              : w
          )
      )

      return { snapshot }
    },
    onError: (_error, variables, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(
          workflowKeys.list(variables.workspaceId, 'active'),
          context.snapshot
        )
      }
    },
    onSettled: (_data, _error, variables) => {
      return invalidateWorkflowLists(queryClient, variables.workspaceId)
    },
  })
}

interface DeleteWorkflowVariables {
  workspaceId: string
  workflowId: string
}

export function useDeleteWorkflowMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: DeleteWorkflowVariables) => {
      await requestJson(deleteWorkflowContract, {
        params: { id: variables.workflowId },
      })

      logger.info(`Successfully deleted workflow ${variables.workflowId} from database`)
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: workflowKeys.list(variables.workspaceId, 'active'),
      })

      const snapshot = queryClient.getQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active')
      )

      queryClient.setQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active'),
        (old) => (old ?? []).filter((w) => w.id !== variables.workflowId)
      )

      return { snapshot }
    },
    onError: (_error, variables, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(
          workflowKeys.list(variables.workspaceId, 'active'),
          context.snapshot
        )
      }
    },
    onSettled: (_data, _error, variables) => {
      return invalidateWorkflowLists(queryClient, variables.workspaceId, ['active', 'archived'])
    },
  })
}

export function useDeploymentVersionState(workflowId: string | null, version: number | null) {
  return useQuery({
    queryKey: workflowKeys.deploymentVersion(workflowId ?? undefined, version ?? undefined),
    queryFn:
      workflowId && version !== null
        ? ({ signal }) => fetchDeploymentVersionState(workflowId, version, signal)
        : skipToken,
    staleTime: 5 * 60 * 1000,
  })
}

interface RevertToVersionVariables {
  workflowId: string
  version: number
}

export function useRevertToVersion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workflowId, version }: RevertToVersionVariables): Promise<void> => {
      await requestJson(revertToDeploymentVersionContract, {
        params: { id: workflowId, version },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workflowKeys.state(variables.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.info(variables.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.deployedState(variables.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.versions(variables.workflowId),
      })
    },
  })
}

interface ReorderWorkflowsVariables {
  workspaceId: string
  updates: Array<{
    id: string
    sortOrder: number
    folderId?: string | null
  }>
}

export function useReorderWorkflows() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: ReorderWorkflowsVariables): Promise<void> => {
      await requestJson(reorderWorkflowsContract, { body: variables })
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: workflowKeys.list(variables.workspaceId, 'active'),
      })

      const snapshot = queryClient.getQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active')
      )

      const updateMap = new Map(variables.updates.map((u) => [u.id, u]))
      queryClient.setQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active'),
        (old) =>
          (old ?? []).map((w) => {
            const update = updateMap.get(w.id)
            if (!update) return w
            return {
              ...w,
              sortOrder: update.sortOrder,
              folderId: update.folderId !== undefined ? update.folderId : w.folderId,
            }
          })
      )

      return { snapshot }
    },
    onError: (_error, variables, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(
          workflowKeys.list(variables.workspaceId, 'active'),
          context.snapshot
        )
      }
    },
    onSettled: (_data, _error, variables) => {
      return invalidateWorkflowLists(queryClient, variables.workspaceId)
    },
  })
}

export function useImportWorkflow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workflowId,
      targetWorkspaceId,
    }: ImportWorkflowAsSuperuserBody): Promise<ImportWorkflowAsSuperuserResponse> => {
      return requestJson(importWorkflowAsSuperuserContract, {
        body: { workflowId, targetWorkspaceId },
      })
    },
    onSettled: (_data, _error, variables) => {
      return invalidateWorkflowLists(queryClient, variables.targetWorkspaceId)
    },
  })
}

export function useRestoreWorkflow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workflowId }: { workflowId: string; workspaceId: string }) => {
      return requestJson(restoreWorkflowContract, { params: { id: workflowId } })
    },
    onSettled: (_data, _error, variables) => {
      return invalidateWorkflowLists(queryClient, variables.workspaceId, ['active', 'archived'])
    },
  })
}
