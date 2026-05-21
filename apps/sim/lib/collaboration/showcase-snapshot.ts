import { workflowStateSchema } from '@/lib/api/contracts/workflows'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

export interface WorkflowCanvasMode {
  mode: 'edit' | 'read-only'
  reason?: string
}

export const SHOWCASE_READ_ONLY_CANVAS_MODE = {
  mode: 'read-only',
  reason: 'Published showcase snapshots are immutable and never join editing rooms.',
} as const satisfies WorkflowCanvasMode

export interface ReadOnlyShowcaseCanvasModel {
  workflowState: WorkflowState | null
  blockCount: number
  edgeCount: number
  isRenderable: boolean
}

export function createReadOnlyShowcaseCanvasModel(
  snapshotState: unknown
): ReadOnlyShowcaseCanvasModel {
  const parsed = workflowStateSchema.safeParse(snapshotState)

  if (!parsed.success) {
    return {
      workflowState: null,
      blockCount: countRecordItems(snapshotState, 'blocks'),
      edgeCount: countArrayItems(snapshotState, 'edges'),
      isRenderable: false,
    }
  }

  const workflowState = {
    ...parsed.data,
    loops: parsed.data.loops ?? {},
    parallels: parsed.data.parallels ?? {},
  } as WorkflowState

  return {
    workflowState,
    blockCount: Object.keys(workflowState.blocks).length,
    edgeCount: workflowState.edges.length,
    isRenderable: true,
  }
}

function countRecordItems(value: unknown, key: string): number {
  if (!value || typeof value !== 'object' || !(key in value)) return 0
  const candidate = (value as Record<string, unknown>)[key]
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return 0
  return Object.keys(candidate).length
}

function countArrayItems(value: unknown, key: string): number {
  if (!value || typeof value !== 'object' || !(key in value)) return 0
  const candidate = (value as Record<string, unknown>)[key]
  return Array.isArray(candidate) ? candidate.length : 0
}
