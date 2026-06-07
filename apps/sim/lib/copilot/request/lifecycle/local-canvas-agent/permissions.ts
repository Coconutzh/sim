import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import type { LocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

export async function resolveLocalAgentPermissions(params: {
  userId: string
  workflowId: string
}): Promise<LocalAgentContext['permissions']> {
  const readAuthorization = await authorizeWorkflowByWorkspacePermission({
    workflowId: params.workflowId,
    userId: params.userId,
    action: 'read',
  })
  if (!readAuthorization.allowed || readAuthorization.accessSource !== 'workspace') {
    return {
      canRead: false,
      canWrite: false,
      canPublish: false,
      readonlyReason: readAuthorization.message ?? 'Canvas access denied',
    }
  }

  const writeAuthorization = await authorizeWorkflowByWorkspacePermission({
    workflowId: params.workflowId,
    userId: params.userId,
    action: 'write',
  })

  return {
    canRead: true,
    canWrite: writeAuthorization.allowed && writeAuthorization.accessSource === 'workspace',
    canPublish: false,
    readonlyReason:
      writeAuthorization.allowed && writeAuthorization.accessSource === 'workspace'
        ? undefined
        : (writeAuthorization.message ?? 'Canvas is read-only for this user'),
  }
}
