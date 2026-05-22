import { db } from '@sim/db'
import {
  member,
  permissions,
  type permissionTypeEnum,
  user,
  type WorkspaceMode,
  workgroupMember,
  workspace,
} from '@sim/db/schema'
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'

export type PermissionType = (typeof permissionTypeEnum.enumValues)[number]
export interface WorkspaceBasic {
  id: string
}

export interface WorkspaceWithOwner {
  id: string
  name: string
  ownerId: string
  organizationId: string | null
  workgroupId?: string | null
  workspaceMode: WorkspaceMode
  billedAccountUserId: string
  archivedAt?: Date | null
}

export interface WorkspaceAccess {
  exists: boolean
  hasAccess: boolean
  canWrite: boolean
  workspace: WorkspaceWithOwner | null
}

export class ActiveWorkspaceAccessError extends Error {
  constructor(public readonly workspaceId: string) {
    super(`Active workspace access denied: ${workspaceId}`)
    this.name = 'ActiveWorkspaceAccessError'
  }
}

function isCanvasBoundaryWorkspace(workspaceRecord: WorkspaceWithOwner): boolean {
  return workspaceRecord.workspaceMode === 'personal' || Boolean(workspaceRecord.workgroupId)
}

async function getWorkspacePermissionFromCanvasBoundary(
  workspaceRecord: WorkspaceWithOwner,
  userId: string
): Promise<PermissionType | null> {
  if (workspaceRecord.workspaceMode === 'personal') {
    return workspaceRecord.ownerId === userId ? 'admin' : null
  }

  if (workspaceRecord.workspaceMode === 'organization' && workspaceRecord.workgroupId) {
    const [membership] = await db
      .select({ role: workgroupMember.role })
      .from(workgroupMember)
      .where(
        and(
          eq(workgroupMember.userId, userId),
          eq(workgroupMember.workgroupId, workspaceRecord.workgroupId)
        )
      )
      .limit(1)

    if (!membership) return null
    return membership.role === 'admin' ? 'admin' : 'write'
  }

  if (workspaceRecord.ownerId === userId) {
    return 'admin'
  }

  return null
}

/**
 * Check if a workspace exists
 *
 * @param workspaceId - The workspace ID to check
 * @returns True if the workspace exists, false otherwise
 */
export async function workspaceExists(
  workspaceId: string,
  options?: { includeArchived?: boolean }
): Promise<boolean> {
  const { includeArchived = false } = options ?? {}
  const [ws] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(
      includeArchived
        ? eq(workspace.id, workspaceId)
        : and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt))
    )
    .limit(1)

  return !!ws
}

/**
 * Get a workspace by ID for existence check
 *
 * @param workspaceId - The workspace ID to look up
 * @returns The workspace if found, null otherwise
 */
export async function getWorkspaceById(
  workspaceId: string,
  options?: { includeArchived?: boolean }
): Promise<WorkspaceBasic | null> {
  const exists = await workspaceExists(workspaceId, options)
  return exists ? { id: workspaceId } : null
}

/**
 * Get a workspace with owner info by ID
 *
 * @param workspaceId - The workspace ID to look up
 * @returns The workspace with owner info if found, null otherwise
 */
export async function getWorkspaceWithOwner(
  workspaceId: string,
  options?: { includeArchived?: boolean }
): Promise<WorkspaceWithOwner | null> {
  const { includeArchived = false } = options ?? {}
  const [ws] = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
      organizationId: workspace.organizationId,
      workgroupId: workspace.workgroupId,
      workspaceMode: workspace.workspaceMode,
      billedAccountUserId: workspace.billedAccountUserId,
      archivedAt: workspace.archivedAt,
    })
    .from(workspace)
    .where(
      includeArchived
        ? eq(workspace.id, workspaceId)
        : and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt))
    )
    .limit(1)

  return ws || null
}

/**
 * Check workspace access for a user
 *
 * Verifies the workspace exists and the user has access to it.
 * Returns access level (read/write) based on ownership and permissions.
 *
 * @param workspaceId - The workspace ID to check
 * @param userId - The user ID to check access for
 * @returns WorkspaceAccess object with exists, hasAccess, canWrite, and workspace data
 */
export async function checkWorkspaceAccess(
  workspaceId: string,
  userId: string
): Promise<WorkspaceAccess> {
  const ws = await getWorkspaceWithOwner(workspaceId)

  if (!ws) {
    return { exists: false, hasAccess: false, canWrite: false, workspace: null }
  }

  const canvasPermission = await getWorkspacePermissionFromCanvasBoundary(ws, userId)
  if (canvasPermission) {
    return {
      exists: true,
      hasAccess: true,
      canWrite: canvasPermission === 'write' || canvasPermission === 'admin',
      workspace: ws,
    }
  }

  if (isCanvasBoundaryWorkspace(ws)) {
    return { exists: true, hasAccess: false, canWrite: false, workspace: ws }
  }

  const [permissionRow] = await db
    .select({ permissionType: permissions.permissionType })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId)
      )
    )
    .limit(1)

  if (!permissionRow) {
    return { exists: true, hasAccess: false, canWrite: false, workspace: ws }
  }

  const canWrite =
    permissionRow.permissionType === 'write' || permissionRow.permissionType === 'admin'

  return { exists: true, hasAccess: true, canWrite, workspace: ws }
}

export async function assertActiveWorkspaceAccess(
  workspaceId: string,
  userId: string
): Promise<WorkspaceAccess> {
  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    throw new ActiveWorkspaceAccessError(workspaceId)
  }
  return access
}

export function isActiveWorkspaceAccessError(error: unknown): error is ActiveWorkspaceAccessError {
  return error instanceof ActiveWorkspaceAccessError
}

/**
 * Get the highest permission level a user has for a specific entity
 *
 * @param userId - The ID of the user to check permissions for
 * @param entityType - The type of entity (e.g., 'workspace', 'workflow', etc.)
 * @param entityId - The ID of the specific entity
 * @returns Promise<PermissionType | null> - The highest permission the user has for the entity, or null if none
 */
export async function getUserEntityPermissions(
  userId: string,
  entityType: string,
  entityId: string
): Promise<PermissionType | null> {
  if (entityType === 'workspace') {
    const ws = await getWorkspaceWithOwner(entityId)
    if (!ws) {
      return null
    }

    const canvasPermission = await getWorkspacePermissionFromCanvasBoundary(ws, userId)
    if (canvasPermission || ws.workspaceMode === 'personal' || ws.workgroupId) {
      return canvasPermission
    }
  }

  const result = await db
    .select({ permissionType: permissions.permissionType })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, entityType),
        eq(permissions.entityId, entityId)
      )
    )

  if (result.length === 0) {
    return null
  }

  const permissionOrder: Record<PermissionType, number> = { admin: 3, write: 2, read: 1 }
  const highestPermission = result.reduce((highest, current) => {
    return permissionOrder[current.permissionType] > permissionOrder[highest.permissionType]
      ? current
      : highest
  })

  return highestPermission.permissionType
}

/**
 * Returns the active workspace IDs a user can access, including owned workspaces.
 */
export async function listAccessibleWorkspaceIds(userId: string): Promise<string[]> {
  const directRows = await db
    .select({
      id: workspace.id,
      ownerId: workspace.ownerId,
      workspaceMode: workspace.workspaceMode,
      workgroupId: workspace.workgroupId,
      permissionId: permissions.id,
    })
    .from(workspace)
    .leftJoin(
      permissions,
      and(
        eq(permissions.entityId, workspace.id),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.userId, userId)
      )
    )
    .where(
      and(
        isNull(workspace.archivedAt),
        or(eq(workspace.ownerId, userId), isNotNull(permissions.id))
      )
    )

  const teamRows = await db
    .select({ id: workspace.id })
    .from(workspace)
    .innerJoin(workgroupMember, eq(workspace.workgroupId, workgroupMember.workgroupId))
    .where(
      and(
        isNull(workspace.archivedAt),
        eq(workspace.workspaceMode, 'organization'),
        eq(workgroupMember.userId, userId)
      )
    )

  return [
    ...new Set([
      ...directRows
        .filter(
          (row) =>
            (row.ownerId === userId && (row.workspaceMode === 'personal' || !row.workgroupId)) ||
            (row.workspaceMode !== 'personal' && !row.workgroupId && row.permissionId)
        )
        .map((row) => row.id),
      ...teamRows.map((row) => row.id),
    ]),
  ]
}

/**
 * Check if a user has admin permission for a specific workspace
 *
 * @param userId - The ID of the user to check
 * @param workspaceId - The ID of the workspace to check
 * @returns Promise<boolean> - True if the user has admin permission for the workspace, false otherwise
 */
export async function hasAdminPermission(userId: string, workspaceId: string): Promise<boolean> {
  const ws = await getWorkspaceWithOwner(workspaceId)
  if (!ws) return false

  if (ws.workspaceMode === 'personal') {
    return ws.ownerId === userId
  }

  if (ws.workspaceMode === 'organization' && ws.workgroupId) {
    const [membership] = await db
      .select({ role: workgroupMember.role })
      .from(workgroupMember)
      .where(
        and(eq(workgroupMember.userId, userId), eq(workgroupMember.workgroupId, ws.workgroupId))
      )
      .limit(1)
    return membership?.role === 'admin'
  }

  if (ws.ownerId === userId) return true

  const [result] = await db
    .select({
      id: permissions.id,
      workspaceMode: workspace.workspaceMode,
      workspaceOwnerId: workspace.ownerId,
    })
    .from(permissions)
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId),
        eq(permissions.permissionType, 'admin'),
        isNull(workspace.archivedAt)
      )
    )
    .limit(1)

  if (!result) {
    return false
  }

  if (result.workspaceMode === 'personal' && result.workspaceOwnerId !== userId) {
    return false
  }

  return true
}

/**
 * Retrieves a list of users with their associated permissions for a given workspace.
 *
 * @param workspaceId - The ID of the workspace to retrieve user permissions for.
 * @returns A promise that resolves to an array of user objects, each containing user details and their permission type.
 */
export async function getUsersWithPermissions(workspaceId: string): Promise<
  Array<{
    userId: string
    email: string
    name: string
    image: string | null
    permissionType: PermissionType
    isExternal: boolean
  }>
> {
  const ownerRows = await db
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      permissionType: sql<PermissionType>`'admin'`,
      source: sql<'owner'>`'owner'`,
      workspaceMode: workspace.workspaceMode,
      workspaceOrganizationId: workspace.organizationId,
      workspaceOwnerId: workspace.ownerId,
      workspaceWorkgroupId: workspace.workgroupId,
      organizationMemberId: member.id,
    })
    .from(workspace)
    .innerJoin(user, eq(workspace.ownerId, user.id))
    .leftJoin(
      member,
      and(eq(member.userId, user.id), eq(member.organizationId, workspace.organizationId))
    )
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))

  const permissionRows = await db
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      permissionType: permissions.permissionType,
      source: sql<'permission'>`'permission'`,
      workspaceMode: workspace.workspaceMode,
      workspaceOrganizationId: workspace.organizationId,
      workspaceOwnerId: workspace.ownerId,
      workspaceWorkgroupId: workspace.workgroupId,
      organizationMemberId: member.id,
    })
    .from(permissions)
    .innerJoin(user, eq(permissions.userId, user.id))
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .leftJoin(
      member,
      and(eq(member.userId, user.id), eq(member.organizationId, workspace.organizationId))
    )
    .where(
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId),
        isNull(workspace.archivedAt)
      )
    )
    .orderBy(user.email)

  const hasTeamWorkspace = [...ownerRows, ...permissionRows].some((row) => row.workspaceWorkgroupId)
  const workgroupRows = hasTeamWorkspace
    ? await db
        .select({
          userId: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          permissionType: sql<PermissionType>`case when ${workgroupMember.role} = 'admin' then 'admin' else 'write' end`,
          source: sql<'workgroup'>`'workgroup'`,
          workspaceMode: workspace.workspaceMode,
          workspaceOrganizationId: workspace.organizationId,
          workspaceOwnerId: workspace.ownerId,
          workspaceWorkgroupId: workspace.workgroupId,
          organizationMemberId: member.id,
        })
        .from(workspace)
        .innerJoin(workgroupMember, eq(workspace.workgroupId, workgroupMember.workgroupId))
        .innerJoin(user, eq(workgroupMember.userId, user.id))
        .leftJoin(
          member,
          and(eq(member.userId, user.id), eq(member.organizationId, workspace.organizationId))
        )
        .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
        .orderBy(user.email)
    : []

  const usersById = new Map<
    string,
    {
      userId: string
      email: string
      name: string
      image: string | null
      permissionType: PermissionType
      isExternal: boolean
    }
  >()
  const permissionOrder: Record<PermissionType, number> = { admin: 3, write: 2, read: 1 }

  for (const row of [...ownerRows, ...permissionRows, ...workgroupRows]) {
    if (row.workspaceWorkgroupId && row.source !== 'workgroup') {
      continue
    }

    if (row.workspaceMode === 'personal' && row.workspaceOwnerId !== row.userId) {
      continue
    }

    const nextUser = {
      userId: row.userId,
      email: row.email,
      name: row.name,
      image: row.image ?? null,
      permissionType: row.permissionType,
      isExternal: Boolean(row.workspaceOrganizationId && !row.organizationMemberId),
    }

    const existing = usersById.get(row.userId)
    if (
      !existing ||
      permissionOrder[nextUser.permissionType] > permissionOrder[existing.permissionType]
    ) {
      usersById.set(row.userId, nextUser)
    }
  }

  return [...usersById.values()].sort((a, b) => a.email.localeCompare(b.email))
}

/** Lightweight profile data for workspace member display (avatars, owner cells). */
export interface WorkspaceMemberProfile {
  userId: string
  name: string
  image: string | null
}

/**
 * Fetches minimal profile data (id, name, image) for all members of a workspace.
 * Use this instead of getUsersWithPermissions when you only need display info.
 */
export async function getWorkspaceMemberProfiles(
  workspaceId: string
): Promise<WorkspaceMemberProfile[]> {
  const ownerRows = await db
    .select({
      userId: user.id,
      name: user.name,
      image: user.image,
      source: sql<'owner'>`'owner'`,
      workspaceMode: workspace.workspaceMode,
      workspaceOwnerId: workspace.ownerId,
      workspaceWorkgroupId: workspace.workgroupId,
    })
    .from(workspace)
    .innerJoin(user, eq(workspace.ownerId, user.id))
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))

  const permissionRows = await db
    .select({
      userId: user.id,
      name: user.name,
      image: user.image,
      source: sql<'permission'>`'permission'`,
      workspaceMode: workspace.workspaceMode,
      workspaceOwnerId: workspace.ownerId,
      workspaceWorkgroupId: workspace.workgroupId,
    })
    .from(permissions)
    .innerJoin(user, eq(permissions.userId, user.id))
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId),
        isNull(workspace.archivedAt)
      )
    )

  const hasTeamWorkspace = [...ownerRows, ...permissionRows].some((row) => row.workspaceWorkgroupId)
  const workgroupRows = hasTeamWorkspace
    ? await db
        .select({
          userId: user.id,
          name: user.name,
          image: user.image,
          source: sql<'workgroup'>`'workgroup'`,
          workspaceMode: workspace.workspaceMode,
          workspaceOwnerId: workspace.ownerId,
          workspaceWorkgroupId: workspace.workgroupId,
        })
        .from(workspace)
        .innerJoin(workgroupMember, eq(workspace.workgroupId, workgroupMember.workgroupId))
        .innerJoin(user, eq(workgroupMember.userId, user.id))
        .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    : []

  const profilesByUserId = new Map<string, WorkspaceMemberProfile>()

  for (const row of [...ownerRows, ...permissionRows, ...workgroupRows]) {
    if (row.workspaceWorkgroupId && row.source !== 'workgroup') {
      continue
    }

    if (row.workspaceMode === 'personal' && row.workspaceOwnerId !== row.userId) {
      continue
    }

    profilesByUserId.set(row.userId, {
      userId: row.userId,
      name: row.name,
      image: row.image ?? null,
    })
  }

  return [...profilesByUserId.values()]
}

/**
 * Check if a user has admin access to a specific workspace
 *
 * @param userId - The ID of the user to check
 * @param workspaceId - The ID of the workspace to check
 * @returns Promise<boolean> - True if the user has admin access to the workspace, false otherwise
 */
export async function hasWorkspaceAdminAccess(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const ws = await getWorkspaceWithOwner(workspaceId)

  if (!ws) {
    return false
  }

  const canvasPermission = await getWorkspacePermissionFromCanvasBoundary(ws, userId)
  if (canvasPermission || isCanvasBoundaryWorkspace(ws)) {
    return canvasPermission === 'admin'
  }

  if (ws.ownerId === userId || (await hasAdminPermission(userId, workspaceId))) {
    return true
  }

  return await isOrganizationAdminOrOwnerOfWorkspace(userId, ws)
}

export async function isOrganizationAdminOrOwnerOfWorkspace(
  userId: string,
  ws: Pick<WorkspaceWithOwner, 'organizationId'>
): Promise<boolean> {
  if (!ws.organizationId) return false
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, ws.organizationId)))
    .limit(1)
  return row?.role === 'owner' || row?.role === 'admin'
}

/**
 * Get a list of workspaces that the user has access to
 *
 * @param userId - The ID of the user to check
 * @returns Promise<Array<{
 *   id: string
 *   name: string
 *   ownerId: string
 *   accessType: 'direct' | 'owner'
 * }>> - A list of workspaces that the user has access to
 */
export async function getManageableWorkspaces(userId: string): Promise<
  Array<{
    id: string
    name: string
    ownerId: string
    accessType: 'direct' | 'owner'
  }>
> {
  const ownedWorkspaces = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
      workgroupId: workspace.workgroupId,
    })
    .from(workspace)
    .where(and(eq(workspace.ownerId, userId), isNull(workspace.archivedAt)))

  const adminWorkspaces = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
      workspaceMode: workspace.workspaceMode,
      workgroupId: workspace.workgroupId,
    })
    .from(workspace)
    .innerJoin(permissions, eq(permissions.entityId, workspace.id))
    .where(
      and(
        isNull(workspace.archivedAt),
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.permissionType, 'admin')
      )
    )

  const teamAdminWorkspaces = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
    })
    .from(workspace)
    .innerJoin(workgroupMember, eq(workspace.workgroupId, workgroupMember.workgroupId))
    .where(
      and(
        isNull(workspace.archivedAt),
        eq(workgroupMember.userId, userId),
        eq(workgroupMember.role, 'admin')
      )
    )

  const ownedNonTeamWorkspaces = ownedWorkspaces.filter((ws) => !ws.workgroupId)
  const ownedSet = new Set(ownedNonTeamWorkspaces.map((w) => w.id))
  const combined = [
    ...ownedNonTeamWorkspaces.map(({ id, name, ownerId }) => ({
      id,
      name,
      ownerId,
      accessType: 'owner' as const,
    })),
    ...teamAdminWorkspaces
      .filter((ws) => !ownedSet.has(ws.id))
      .map(({ id, name, ownerId }) => ({ id, name, ownerId, accessType: 'direct' as const })),
    ...adminWorkspaces
      .filter((ws) => ws.workspaceMode !== 'personal' && !ws.workgroupId)
      .filter((ws) => !ownedSet.has(ws.id))
      .map(({ id, name, ownerId }) => ({ id, name, ownerId, accessType: 'direct' as const })),
  ]

  return combined
}
