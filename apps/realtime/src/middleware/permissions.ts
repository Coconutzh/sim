import { createLogger } from '@sim/logger'
import {
  BLOCK_OPERATIONS,
  BLOCKS_OPERATIONS,
  EDGE_OPERATIONS,
  EDGES_OPERATIONS,
  SUBBLOCK_OPERATIONS,
  SUBFLOW_OPERATIONS,
  VARIABLE_OPERATIONS,
  WORKFLOW_OPERATIONS,
} from '@sim/realtime-protocol/constants'
import { isAuthDisabled } from '@/env'

const logger = createLogger('SocketPermissions')

// Admin-only operations (require admin role)
const ADMIN_ONLY_OPERATIONS: string[] = [BLOCKS_OPERATIONS.BATCH_TOGGLE_LOCKED]

// Write operations (admin and write roles both have these permissions)
const WRITE_OPERATIONS: string[] = [
  // Block operations
  BLOCK_OPERATIONS.UPDATE_POSITION,
  BLOCK_OPERATIONS.UPDATE_NAME,
  BLOCK_OPERATIONS.TOGGLE_ENABLED,
  BLOCK_OPERATIONS.UPDATE_PARENT,
  BLOCK_OPERATIONS.UPDATE_ADVANCED_MODE,
  BLOCK_OPERATIONS.UPDATE_CANONICAL_MODE,
  BLOCK_OPERATIONS.TOGGLE_HANDLES,
  // Batch block operations
  BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS,
  BLOCKS_OPERATIONS.BATCH_ADD_BLOCKS,
  BLOCKS_OPERATIONS.BATCH_REMOVE_BLOCKS,
  BLOCKS_OPERATIONS.BATCH_TOGGLE_ENABLED,
  BLOCKS_OPERATIONS.BATCH_TOGGLE_HANDLES,
  BLOCKS_OPERATIONS.BATCH_UPDATE_PARENT,
  // Edge operations
  EDGE_OPERATIONS.ADD,
  EDGE_OPERATIONS.REMOVE,
  // Batch edge operations
  EDGES_OPERATIONS.BATCH_ADD_EDGES,
  EDGES_OPERATIONS.BATCH_REMOVE_EDGES,
  // Subflow operations
  SUBFLOW_OPERATIONS.UPDATE,
  // Subblock operations
  SUBBLOCK_OPERATIONS.UPDATE,
  SUBBLOCK_OPERATIONS.BATCH_UPDATE,
  // Variable operations
  VARIABLE_OPERATIONS.UPDATE,
  // Workflow operations
  WORKFLOW_OPERATIONS.REPLACE_STATE,
]

const READ_OPERATIONS: string[] = []

// Define operation permissions based on role
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [...ADMIN_ONLY_OPERATIONS, ...WRITE_OPERATIONS],
  write: WRITE_OPERATIONS,
  read: READ_OPERATIONS,
}

// Check if a role allows a specific operation (no DB query, pure logic)
export function checkRolePermission(
  role: string,
  operation: string
): { allowed: boolean; reason?: string } {
  const allowedOperations = ROLE_PERMISSIONS[role] || []

  if (!allowedOperations.includes(operation)) {
    return {
      allowed: false,
      reason: `Role '${role}' not permitted to perform '${operation}'`,
    }
  }

  return { allowed: true }
}

export async function verifyWorkflowAccess(
  userId: string,
  workflowId: string
): Promise<{ hasAccess: boolean; role?: string; workspaceId?: string; canvasScope?: string }> {
  try {
    const [
      { db },
      { workflow },
      { authorizeWorkflowByWorkspacePermission, resolveCanvasScope },
      { and, eq, isNull },
    ] = await Promise.all([
      import('@sim/db'),
      import('@sim/db/schema'),
      import('@sim/workflow-authz'),
      import('drizzle-orm'),
    ])

    const workflowData = await db
      .select({
        workspaceId: workflow.workspaceId,
        name: workflow.name,
        track: workflow.track,
      })
      .from(workflow)
      .where(and(eq(workflow.id, workflowId), isNull(workflow.archivedAt)))
      .limit(1)

    if (!workflowData.length) {
      logger.warn(`Workflow ${workflowId} not found`)
      return { hasAccess: false }
    }

    const { workspaceId, name: workflowName, track } = workflowData[0]

    if (isAuthDisabled) {
      logger.info(`Bypassing workflow access check for ${workflowId} because auth is disabled`, {
        userId,
        workspaceId,
      })
      return {
        hasAccess: true,
        role: 'admin',
        workspaceId: workspaceId || undefined,
        canvasScope: 'team',
      }
    }

    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId,
      action: 'read',
    })

    if (!authorization.allowed || !authorization.workspacePermission) {
      logger.warn(
        `User ${userId} is not permitted to access workflow ${workflowId}: ${authorization.message}`
      )
      return { hasAccess: false }
    }

    const canvasScope = resolveCanvasScope({
      accessSource: authorization.accessSource,
      workspaceMode: authorization.workspaceMode,
      workspaceWorkgroupId: authorization.workspaceWorkgroupId,
      workflowTrack: track,
    })
    const role =
      authorization.accessSource === 'workspace' && track !== 'published'
        ? (authorization.workspacePermission ?? 'read')
        : 'read'

    logger.debug(
      `User ${userId} has ${role} access to workflow ${workflowId} (${workflowName}) via ${canvasScope ?? 'unknown'} canvas`
    )
    return {
      hasAccess: true,
      role,
      workspaceId: workspaceId || undefined,
      canvasScope: canvasScope ?? undefined,
    }
  } catch (error) {
    logger.error(
      `Error verifying workflow access for user ${userId}, workflow ${workflowId}:`,
      error
    )
    return { hasAccess: false }
  }
}
