import { NextResponse } from 'next/server'
import { getWorkflowById } from '@/lib/workflows/utils'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export async function resolveAccessibleWorkflowWorkspace(params: {
  userId: string
  workflowId?: string
  workspaceId?: string
}): Promise<{ workspaceId: string } | { response: NextResponse }> {
  const { userId, workflowId, workspaceId } = params

  const workflow = workflowId ? await getWorkflowById(workflowId) : null
  const resolvedWorkspaceId = workflow?.workspaceId ?? workspaceId

  if (workflowId && (!workflow || !workflow.workspaceId)) {
    return { response: NextResponse.json({ error: 'Workflow not found' }, { status: 404 }) }
  }

  if (!resolvedWorkspaceId) {
    return {
      response: NextResponse.json({ error: 'Canvas context required' }, { status: 400 }),
    }
  }

  const access = await checkWorkspaceAccess(resolvedWorkspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    return { response: NextResponse.json({ error: 'Canvas not found' }, { status: 404 }) }
  }

  return { workspaceId: resolvedWorkspaceId }
}
