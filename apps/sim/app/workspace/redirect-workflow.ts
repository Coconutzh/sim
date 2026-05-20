import type { GetWorkflowResponseData } from '@/lib/api/contracts/workflows'

interface GetWorkflowRedirectPathParams {
  workflowId: string
  fallbackWorkspaceId: string
  workflow: Pick<GetWorkflowResponseData, 'workspaceId' | 'state'>
}

/**
 * Resolves the safest workspace-local destination for a workflow redirect.
 */
export function getWorkflowRedirectPath({
  workflowId,
  fallbackWorkspaceId,
  workflow,
}: GetWorkflowRedirectPathParams): string {
  if (workflow.state.metadata?.accessScope === 'published_summary') {
    return `/workspace/${fallbackWorkspaceId}/published/${workflowId}`
  }

  if (workflow.workspaceId) {
    return `/workspace/${workflow.workspaceId}/w/${workflowId}`
  }

  return `/workspace/${fallbackWorkspaceId}/home`
}
