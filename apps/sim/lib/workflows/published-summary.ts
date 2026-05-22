import type { WorkflowState } from '@/stores/workflows/workflow/types'

type WorkflowRecord = {
  id: string
  userId: string
  workspaceId: string | null
  folderId: string | null
  sortOrder: number
  name: string
  description: string | null
  color: string
  track: 'draft' | 'published'
  visibility: 'workspace' | 'organization' | 'selected_workgroups'
  sourceWorkflowId: string | null
  publishedAt: Date | null
  publishedBy: string | null
  lastSynced: Date
  createdAt: Date
  updatedAt: Date
  isDeployed: boolean
  deployedAt: Date | null
  isPublicApi: boolean
  locked: boolean
  runCount: number
  lastRunAt: Date | null
  archivedAt: Date | null
  variables?: unknown
}

type NormalizedWorkflowState = {
  blocks: WorkflowState['blocks']
  edges: WorkflowState['edges']
  loops: WorkflowState['loops']
  parallels: WorkflowState['parallels']
}

export function buildPublishedWorkflowStateSummary(
  workflowState: NormalizedWorkflowState,
  workflowId: string,
  metadata?: {
    name?: string | null
    description?: string | null
    publishedAt?: Date | null
  }
) {
  const summarizedBlocks = Object.values(workflowState.blocks).reduce<
    Record<string, WorkflowState['blocks'][string]>
  >((acc, block, index) => {
    const summaryId = `published-block-${index + 1}`
    acc[summaryId] = {
      id: summaryId,
      type: block.type,
      name: block.name,
      position: block.position,
      subBlocks: {},
      outputs: {},
      enabled: block.enabled,
    }
    return acc
  }, {})

  const summarizedEdges = workflowState.edges.map((_, index) => ({
    id: `published-edge-${index + 1}`,
    source: 'published',
    target: workflowId,
  }))

  const summarizedLoops = Object.keys(workflowState.loops || {}).reduce<
    NonNullable<WorkflowState['loops']>
  >((acc, _loopId, index) => {
    const summaryId = `published-loop-${index + 1}`
    acc[summaryId] = {
      id: summaryId,
      nodes: [],
      iterations: 0,
      loopType: 'for',
      enabled: true,
    }
    return acc
  }, {})

  const summarizedParallels = Object.keys(workflowState.parallels || {}).reduce<
    NonNullable<WorkflowState['parallels']>
  >((acc, _parallelId, index) => {
    const summaryId = `published-parallel-${index + 1}`
    acc[summaryId] = {
      id: summaryId,
      nodes: [],
      count: 0,
      parallelType: 'count',
      enabled: true,
    }
    return acc
  }, {})

  return {
    blocks: summarizedBlocks,
    edges: summarizedEdges,
    loops: summarizedLoops,
    parallels: summarizedParallels,
    variables: {},
    lastSaved: metadata?.publishedAt?.getTime(),
    isDeployed: false,
    deployedAt: undefined,
    metadata: {
      name: metadata?.name ?? undefined,
      description: metadata?.description ?? undefined,
      accessScope: 'published_summary' as const,
    },
  }
}

export function buildPublishedWorkflowReadSummary(
  workflow: WorkflowRecord,
  workflowState: NormalizedWorkflowState
) {
  const publishedAt = workflow.publishedAt ?? workflow.updatedAt

  return {
    ...workflow,
    userId: '',
    workspaceId: null,
    folderId: null,
    sortOrder: 0,
    sourceWorkflowId: null,
    publishedAt,
    publishedBy: null,
    lastSynced: publishedAt,
    createdAt: publishedAt,
    updatedAt: publishedAt,
    isDeployed: false,
    deployedAt: null,
    isPublicApi: false,
    locked: true,
    runCount: 0,
    lastRunAt: null,
    archivedAt: null,
    state: buildPublishedWorkflowStateSummary(workflowState, workflow.id, {
      name: workflow.name,
      description: workflow.description,
      publishedAt,
    }),
    variables: {},
  }
}
