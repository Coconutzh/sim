/**
 * @vitest-environment jsdom
 */
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const workflowStoreState = {
    currentWorkflowId: null as string | null,
    blocks: {} as Record<string, unknown>,
    edges: [] as unknown[],
    loops: {} as Record<string, unknown>,
    parallels: {} as Record<string, unknown>,
    lastSaved: 0,
    replaceWorkflowState: vi.fn(),
  }
  const subBlockStoreState = {
    workflowValues: {} as Record<string, Record<string, unknown>>,
    initializeFromWorkflow: vi.fn(),
  }
  const variablesState = {
    variables: {} as Record<string, unknown>,
  }
  const diffState = {
    hasActiveDiff: false,
    pendingExternalUpdates: {} as Record<string, number>,
    reconcilingWorkflows: {} as Record<string, boolean>,
    reconciliationErrors: {} as Record<string, string>,
    markExternalUpdatePending: vi.fn((workflowId: string) => {
      diffState.pendingExternalUpdates[workflowId] =
        (diffState.pendingExternalUpdates[workflowId] ?? 0) + 1
    }),
    clearExternalUpdatePending: vi.fn((workflowId: string) => {
      delete diffState.pendingExternalUpdates[workflowId]
    }),
    setWorkflowReconciliationInProgress: vi.fn((workflowId: string, isReconciling: boolean) => {
      if (isReconciling) diffState.reconcilingWorkflows[workflowId] = true
      else delete diffState.reconcilingWorkflows[workflowId]
    }),
    setWorkflowReconciliationError: vi.fn((workflowId: string, error: string | null) => {
      if (error) diffState.reconciliationErrors[workflowId] = error
      else delete diffState.reconciliationErrors[workflowId]
    }),
  }
  const operationQueueState = {
    pending: false,
    hasOperationError: false,
    waitPromise: Promise.resolve(true) as Promise<boolean>,
    hasPendingOperations: vi.fn(() => operationQueueState.pending),
    waitForWorkflowOperations: vi.fn(() => operationQueueState.waitPromise),
  }

  return {
    requestJson: vi.fn(),
    invalidateWorkflowLists: vi.fn(),
    queryClient: {
      setQueryData: vi.fn(),
      clear: vi.fn(),
    },
    applyWorkflowStateToStores: vi.fn(),
    pruneInvalidEntries: vi.fn(),
    workflowStoreState,
    subBlockStoreState,
    variablesState,
    diffState,
    operationQueueState,
  }
})

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mocks.requestJson,
}))

vi.mock('@/app/_shell/providers/get-query-client', () => ({
  getQueryClient: () => mocks.queryClient,
}))

vi.mock('@/hooks/queries/deployments', () => ({
  deploymentKeys: { info: (workflowId: string) => ['deployment', workflowId] },
}))

vi.mock('@/hooks/queries/utils/invalidate-workflow-lists', () => ({
  invalidateWorkflowLists: mocks.invalidateWorkflowLists,
}))

vi.mock('@/stores/operation-queue/store', () => ({
  useOperationQueueStore: {
    getState: () => mocks.operationQueueState,
  },
}))

vi.mock('@/stores/undo-redo', () => ({
  useUndoRedoStore: {
    getState: () => ({
      stacks: { 'workflow-1:user-1': { undo: [], redo: [] } },
      pruneInvalidEntries: mocks.pruneInvalidEntries,
    }),
  },
}))

vi.mock('@/stores/variables/store', () => ({
  useVariablesStore: {
    setState: (updater: unknown) => {
      const next = typeof updater === 'function' ? updater(mocks.variablesState) : updater
      Object.assign(mocks.variablesState, next)
    },
  },
}))

vi.mock('@/stores/workflow-diff/store', () => ({
  useWorkflowDiffStore: {
    getState: () => mocks.diffState,
  },
}))

vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: {
    getState: () => mocks.subBlockStoreState,
    setState: (next: Partial<typeof mocks.subBlockStoreState>) =>
      Object.assign(mocks.subBlockStoreState, next),
  },
}))

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: {
    getState: () => mocks.workflowStoreState,
    setState: (next: Partial<typeof mocks.workflowStoreState>) =>
      Object.assign(mocks.workflowStoreState, next),
  },
}))

vi.mock('@/stores/workflows/workflow-state-sync', () => ({
  applyWorkflowStateToStores: mocks.applyWorkflowStateToStores,
}))

import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

function createWorkflowResponse(blockName = 'Latest block') {
  return {
    data: {
      workspaceId: 'workspace-1',
      state: {
        blocks: {
          'block-1': {
            id: 'block-1',
            type: 'function',
            name: blockName,
            position: { x: 240, y: 160 },
            enabled: true,
            subBlocks: {
              code: { id: 'code', type: 'code', value: 'return 42' },
            },
          },
        },
        edges: [{ id: 'edge-1', source: 'block-1', target: 'block-2' }],
        loops: {},
        parallels: {},
      },
      variables: {
        'variable-1': {
          id: 'variable-1',
          workflowId: 'workflow-1',
          name: 'answer',
          type: 'number',
          value: 42,
        },
      },
      isDeployed: false,
      deployedAt: null,
      isPublicApi: false,
    },
  }
}

function setReadyWorkflow(workflowId = 'workflow-1', requestId = 'load-1') {
  useWorkflowRegistry.setState({
    activeWorkflowId: workflowId,
    error: null,
    hydration: {
      phase: 'ready',
      workspaceId: 'workspace-1',
      workflowId,
      requestId,
      error: null,
    },
  })
}

describe('workflow registry silent refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workflowStoreState.currentWorkflowId = null
    mocks.workflowStoreState.blocks = {}
    mocks.workflowStoreState.edges = []
    mocks.workflowStoreState.loops = {}
    mocks.workflowStoreState.parallels = {}
    mocks.workflowStoreState.lastSaved = 0
    mocks.subBlockStoreState.workflowValues = {}
    mocks.variablesState.variables = {}
    mocks.diffState.hasActiveDiff = false
    mocks.diffState.pendingExternalUpdates = {}
    mocks.diffState.reconcilingWorkflows = {}
    mocks.diffState.reconciliationErrors = {}
    mocks.operationQueueState.pending = false
    mocks.operationQueueState.hasOperationError = false
    mocks.operationQueueState.waitPromise = Promise.resolve(true)
    mocks.requestJson.mockResolvedValue(createWorkflowResponse())
    setReadyWorkflow()
  })

  it('keeps hydration ready, avoids active-workflow-changed, and applies the latest state', async () => {
    const response = createDeferred<ReturnType<typeof createWorkflowResponse>>()
    mocks.requestJson.mockReturnValueOnce(response.promise)
    const activeWorkflowChanged = vi.fn()
    window.addEventListener('active-workflow-changed', activeWorkflowChanged)

    const refresh = useWorkflowRegistry
      .getState()
      .refreshWorkflowState('workflow-1', { reason: 'agent stream end' })

    expect(useWorkflowRegistry.getState().hydration.phase).toBe('ready')
    expect(useWorkflowRegistry.getState().activeWorkflowId).toBe('workflow-1')
    expect(activeWorkflowChanged).not.toHaveBeenCalled()

    response.resolve(createWorkflowResponse())
    await refresh

    expect(useWorkflowRegistry.getState().hydration).toEqual({
      phase: 'ready',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      requestId: 'load-1',
      error: null,
    })
    expect(activeWorkflowChanged).not.toHaveBeenCalled()
    expect(mocks.applyWorkflowStateToStores).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({
        currentWorkflowId: 'workflow-1',
        blocks: expect.objectContaining({
          'block-1': expect.objectContaining({ position: { x: 240, y: 160 } }),
        }),
        edges: [expect.objectContaining({ id: 'edge-1' })],
        variables: expect.objectContaining({
          'variable-1': expect.objectContaining({ value: 42 }),
        }),
      })
    )
    expect(mocks.pruneInvalidEntries).toHaveBeenCalled()

    window.removeEventListener('active-workflow-changed', activeWorkflowChanged)
  })

  it('keeps the ready canvas mounted and preserves its viewport during refresh', async () => {
    const response = createDeferred<ReturnType<typeof createWorkflowResponse>>()
    mocks.requestJson.mockReturnValueOnce(response.promise)
    const onInit = vi.fn()
    const viewport = JSON.stringify({ x: -180, y: 96, zoom: 0.72 })

    function Canvas() {
      useEffect(() => {
        onInit()
      }, [])
      return createElement('div', { 'data-testid': 'canvas', 'data-viewport': viewport })
    }

    function CanvasHarness() {
      const isReady = useWorkflowRegistry(
        (state) =>
          state.activeWorkflowId === 'workflow-1' &&
          state.hydration.phase === 'ready' &&
          state.hydration.workflowId === 'workflow-1'
      )
      return isReady ? createElement(Canvas) : createElement('div', { 'data-testid': 'loading' })
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(createElement(CanvasHarness)))
    const canvasBefore = container.querySelector('[data-testid="canvas"]')

    const refresh = useWorkflowRegistry.getState().refreshWorkflowState('workflow-1')

    expect(container.querySelector('[data-testid="loading"]')).toBeNull()
    expect(container.querySelector('[data-testid="canvas"]')).toBe(canvasBefore)
    expect(canvasBefore?.getAttribute('data-viewport')).toBe(viewport)
    expect(onInit).toHaveBeenCalledTimes(1)

    response.resolve(createWorkflowResponse())
    await act(async () => {
      await refresh
    })

    expect(container.querySelector('[data-testid="canvas"]')).toBe(canvasBefore)
    expect(canvasBefore?.getAttribute('data-viewport')).toBe(viewport)
    expect(onInit).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    container.remove()
  })

  it('preserves initial load hydration and active workflow behavior', async () => {
    const response = createDeferred<ReturnType<typeof createWorkflowResponse>>()
    mocks.requestJson.mockReturnValueOnce(response.promise)
    useWorkflowRegistry.setState({
      activeWorkflowId: null,
      hydration: {
        phase: 'idle',
        workspaceId: 'workspace-1',
        workflowId: null,
        requestId: null,
        error: null,
      },
    })
    const activeWorkflowChanged = vi.fn()
    window.addEventListener('active-workflow-changed', activeWorkflowChanged)

    const load = useWorkflowRegistry.getState().loadWorkflowState('workflow-1')

    expect(useWorkflowRegistry.getState().hydration.phase).toBe('state-loading')
    response.resolve(createWorkflowResponse())
    await load

    expect(useWorkflowRegistry.getState().hydration.phase).toBe('ready')
    expect(useWorkflowRegistry.getState().activeWorkflowId).toBe('workflow-1')
    expect(mocks.workflowStoreState.replaceWorkflowState).toHaveBeenCalled()
    expect(mocks.subBlockStoreState.initializeFromWorkflow).toHaveBeenCalled()
    expect(activeWorkflowChanged).toHaveBeenCalledTimes(1)

    window.removeEventListener('active-workflow-changed', activeWorkflowChanged)
  })

  it('defers without fetching while an active diff exists', async () => {
    mocks.diffState.hasActiveDiff = true

    await useWorkflowRegistry.getState().refreshWorkflowState('workflow-1')

    expect(mocks.requestJson).not.toHaveBeenCalled()
    expect(mocks.diffState.markExternalUpdatePending).toHaveBeenCalledWith('workflow-1')
    expect(mocks.applyWorkflowStateToStores).not.toHaveBeenCalled()
  })

  it('defers for pending operations and refreshes after they drain', async () => {
    const operationsDrained = createDeferred<boolean>()
    mocks.operationQueueState.pending = true
    mocks.operationQueueState.waitPromise = operationsDrained.promise

    await useWorkflowRegistry.getState().refreshWorkflowState('workflow-1')

    expect(mocks.requestJson).not.toHaveBeenCalled()
    expect(mocks.diffState.markExternalUpdatePending).toHaveBeenCalledWith('workflow-1')

    mocks.operationQueueState.pending = false
    operationsDrained.resolve(true)

    await vi.waitFor(() => expect(mocks.requestJson).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(mocks.applyWorkflowStateToStores).toHaveBeenCalledTimes(1))
  })

  it('discards a refresh result after the active workflow changes', async () => {
    const response = createDeferred<ReturnType<typeof createWorkflowResponse>>()
    mocks.requestJson.mockReturnValueOnce(response.promise)
    const refresh = useWorkflowRegistry.getState().refreshWorkflowState('workflow-1')

    setReadyWorkflow('workflow-2', 'load-2')
    response.resolve(createWorkflowResponse())
    await refresh

    expect(mocks.applyWorkflowStateToStores).not.toHaveBeenCalled()
  })

  it('coalesces concurrent refreshes and runs one queued follow-up', async () => {
    const firstResponse = createDeferred<ReturnType<typeof createWorkflowResponse>>()
    const secondResponse = createDeferred<ReturnType<typeof createWorkflowResponse>>()
    mocks.requestJson
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise)

    const first = useWorkflowRegistry.getState().refreshWorkflowState('workflow-1')
    const second = useWorkflowRegistry.getState().refreshWorkflowState('workflow-1')
    const third = useWorkflowRegistry.getState().refreshWorkflowState('workflow-1')

    expect(mocks.requestJson).toHaveBeenCalledTimes(1)

    firstResponse.resolve(createWorkflowResponse('First response'))
    await vi.waitFor(() => expect(mocks.requestJson).toHaveBeenCalledTimes(2))

    secondResponse.resolve(createWorkflowResponse('Queued response'))
    await Promise.all([first, second, third])

    expect(mocks.requestJson).toHaveBeenCalledTimes(2)
    expect(mocks.applyWorkflowStateToStores).toHaveBeenCalledTimes(2)
    expect(mocks.applyWorkflowStateToStores).toHaveBeenLastCalledWith(
      'workflow-1',
      expect.objectContaining({
        blocks: expect.objectContaining({
          'block-1': expect.objectContaining({ name: 'Queued response' }),
        }),
      })
    )
  })

  it('does not apply a response when a diff becomes active during the request', async () => {
    const response = createDeferred<ReturnType<typeof createWorkflowResponse>>()
    mocks.requestJson.mockReturnValueOnce(response.promise)
    const refresh = useWorkflowRegistry.getState().refreshWorkflowState('workflow-1')

    mocks.diffState.hasActiveDiff = true
    response.resolve(createWorkflowResponse())
    await refresh

    expect(mocks.applyWorkflowStateToStores).not.toHaveBeenCalled()
    expect(mocks.diffState.markExternalUpdatePending).toHaveBeenCalledWith('workflow-1')
  })

  it('does not overwrite pending local operations that appear during the request', async () => {
    const response = createDeferred<ReturnType<typeof createWorkflowResponse>>()
    const operationsDrained = createDeferred<boolean>()
    mocks.requestJson.mockReturnValueOnce(response.promise)
    const refresh = useWorkflowRegistry.getState().refreshWorkflowState('workflow-1')

    mocks.operationQueueState.pending = true
    mocks.operationQueueState.waitPromise = operationsDrained.promise
    response.resolve(createWorkflowResponse('Deferred response'))
    await refresh

    expect(mocks.applyWorkflowStateToStores).not.toHaveBeenCalled()
    expect(mocks.diffState.markExternalUpdatePending).toHaveBeenCalledWith('workflow-1')

    mocks.operationQueueState.pending = false
    operationsDrained.resolve(true)

    await vi.waitFor(() => expect(mocks.requestJson).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(mocks.applyWorkflowStateToStores).toHaveBeenCalledTimes(1))
  })
})
