export function canHydrateWorkflowInWorkspace(
  workflowWorkspaceId: string | null | undefined,
  currentWorkspaceId: string
): boolean {
  return Boolean(workflowWorkspaceId) && workflowWorkspaceId === currentWorkspaceId
}

export function getWorkflowWorkspaceScopeError(
  workflowId: string,
  workflowWorkspaceId: string | null | undefined,
  currentWorkspaceId: string
): string {
  if (!workflowWorkspaceId) {
    return `Workflow ${workflowId} is not editable in workspace ${currentWorkspaceId}`
  }

  return `Workflow ${workflowId} belongs to workspace ${workflowWorkspaceId}, not ${currentWorkspaceId}`
}
