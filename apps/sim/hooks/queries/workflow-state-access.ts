import type { WorkflowState } from '@/stores/workflows/workflow/types'

export type WorkflowStateAccessScope = 'workspace' | 'published_summary'

export function getWorkflowStateAccessScope(
  workflowState: WorkflowState | null | undefined
): WorkflowStateAccessScope {
  return workflowState?.metadata?.accessScope === 'published_summary'
    ? 'published_summary'
    : 'workspace'
}

export function isPublishedSummaryWorkflowState(
  workflowState: WorkflowState | null | undefined
): boolean {
  return getWorkflowStateAccessScope(workflowState) === 'published_summary'
}
