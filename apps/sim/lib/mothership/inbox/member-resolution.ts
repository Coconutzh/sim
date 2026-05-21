import { db, permissions, user, workspace } from '@sim/db'
import { and, eq, isNull, sql } from 'drizzle-orm'

/**
 * Resolves a workspace user by email while enforcing personal-workspace owner-only visibility.
 */
export async function findWorkspaceUserIdByEmail(
  workspaceId: string,
  email: string
): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase()

  const [ownerRow] = await db
    .select({ userId: workspace.ownerId })
    .from(workspace)
    .innerJoin(user, eq(workspace.ownerId, user.id))
    .where(
      and(
        eq(workspace.id, workspaceId),
        isNull(workspace.archivedAt),
        sql`lower(${user.email}) = ${normalizedEmail}`
      )
    )
    .limit(1)

  if (ownerRow?.userId) {
    return ownerRow.userId
  }

  const [memberRow] = await db
    .select({
      userId: permissions.userId,
      workspaceMode: workspace.workspaceMode,
      workspaceOwnerId: workspace.ownerId,
    })
    .from(permissions)
    .innerJoin(user, eq(permissions.userId, user.id))
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId),
        isNull(workspace.archivedAt),
        sql`lower(${user.email}) = ${normalizedEmail}`
      )
    )
    .limit(1)

  if (!memberRow) {
    return null
  }

  if (memberRow.workspaceMode === 'personal' && memberRow.workspaceOwnerId !== memberRow.userId) {
    return null
  }

  return memberRow.userId
}
