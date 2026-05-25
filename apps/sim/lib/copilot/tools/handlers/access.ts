import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { and, desc, inArray, isNull } from 'drizzle-orm'
import type { getWorkflowById } from '@/lib/workflows/utils'
import {
  checkWorkspaceAccess,
  getUserEntityPermissions,
  listAccessibleWorkspaceIds,
} from '@/lib/workspaces/permissions/utils'

type WorkflowRecord = NonNullable<Awaited<ReturnType<typeof getWorkflowById>>>

export async function ensureWorkflowAccess(
  workflowId: string,
  userId: string,
  action: 'read' | 'write' | 'admin' = 'read'
): Promise<{
  workflow: WorkflowRecord
  workspaceId?: string | null
}> {
  const result = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId,
    action,
  })

  if (!result.workflow) {
    throw new Error(`Workflow ${workflowId} not found`)
  }

  if (!result.allowed) {
    throw new Error(result.message || 'Unauthorized workflow access')
  }
  if (result.accessSource !== 'workspace') {
    throw new Error('Canvas access required for workflow tools')
  }

  return { workflow: result.workflow, workspaceId: result.workflow.workspaceId }
}

export async function getDefaultWorkspaceId(userId: string): Promise<string> {
  const accessibleWorkspaceIds = await listAccessibleWorkspaceIds(userId)
  if (accessibleWorkspaceIds.length === 0) {
    throw new Error('No canvas found for user')
  }

  const workspaces = await db
    .select({ workspaceId: workspace.id })
    .from(workspace)
    .where(and(inArray(workspace.id, accessibleWorkspaceIds), isNull(workspace.archivedAt)))
    .orderBy(desc(workspace.createdAt))
    .limit(1)

  const workspaceId = workspaces[0]?.workspaceId
  if (!workspaceId) {
    throw new Error('No canvas found for user')
  }

  return workspaceId
}

export async function ensureWorkspaceAccess(
  workspaceId: string,
  userId: string,
  level: 'read' | 'write' | 'admin' = 'read'
): Promise<void> {
  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    throw new Error(`Canvas ${workspaceId} not found`)
  }

  if (level === 'read') return

  if (level === 'admin') {
    if (access.workspace?.ownerId === userId) return
    const perm = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (perm !== 'admin') {
      throw new Error('Admin access required for this canvas')
    }
    return
  }

  if (!access.canWrite) {
    throw new Error('Write or admin access required for this canvas')
  }
}
