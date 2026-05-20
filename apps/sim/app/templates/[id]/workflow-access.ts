interface WorkflowProbePayload {
  data?: {
    workspaceId?: string | null
  }
}

export function getWorkflowProbeWorkspaceId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as WorkflowProbePayload
  return typeof record.data?.workspaceId === 'string' ? record.data.workspaceId : null
}

export function hasWorkflowWorkspaceAccess(payload: unknown): boolean {
  return Boolean(getWorkflowProbeWorkspaceId(payload))
}

export function canOpenWorkflowInWorkspace(payload: unknown, workspaceId: string): boolean {
  return getWorkflowProbeWorkspaceId(payload) === workspaceId
}
