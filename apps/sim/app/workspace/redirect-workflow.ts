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

interface GetWorkflowEditorRedirectPathParams {
  workflowId: string
  fallbackWorkspaceId: string
  workflow: Pick<GetWorkflowResponseData, 'workspaceId' | 'state'> | null
  workspaceWorkflowIds: string[]
}

/**
 * Resolves the safest redirect target when a workflow editor route points at a
 * workflow that is not part of the current workspace list.
 */
export function getWorkflowEditorRedirectPath({
  workflowId,
  fallbackWorkspaceId,
  workflow,
  workspaceWorkflowIds,
}: GetWorkflowEditorRedirectPathParams): string {
  if (workflow) {
    return getWorkflowRedirectPath({
      workflowId,
      fallbackWorkspaceId,
      workflow,
    })
  }

  if (workspaceWorkflowIds.length > 0) {
    return `/workspace/${fallbackWorkspaceId}/w/${workspaceWorkflowIds[0]}`
  }

  return `/workspace/${fallbackWorkspaceId}/w`
}
