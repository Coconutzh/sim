import {
  db,
  member,
  permissions,
  type permissionTypeEnum,
  type WorkspaceMode,
  workflow,
  workflowFolder,
  workflowPublicationScope,
  workgroupMember,
  workspace,
} from '@sim/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'

export type ActiveWorkflowRecord = typeof workflow.$inferSelect

export interface ActiveWorkflowContext {
  workflow: ActiveWorkflowRecord
  workspaceId: string
  workspaceOrganizationId: string | null
  workspaceWorkgroupId: string | null
  workspaceMode: WorkspaceMode
}

export async function getActiveWorkflowContext(
  workflowId: string,
  options: { includeArchived?: boolean } = {}
): Promise<ActiveWorkflowContext | null> {
  const conditions = [eq(workflow.id, workflowId), isNull(workspace.archivedAt)]
  if (!options.includeArchived) {
    conditions.push(isNull(workflow.archivedAt))
  }

  const rows = await db
    .select({
      workflow,
      workspaceId: workspace.id,
      workspaceOrganizationId: workspace.organizationId,
      workspaceWorkgroupId: workspace.workgroupId,
      workspaceMode: workspace.workspaceMode,
    })
    .from(workflow)
    .innerJoin(workspace, eq(workflow.workspaceId, workspace.id))
    .where(and(...conditions))
    .limit(1)

  if (rows.length === 0) {
    return null
  }

  return {
    workflow: rows[0].workflow,
    workspaceId: rows[0].workspaceId,
    workspaceOrganizationId: rows[0].workspaceOrganizationId,
    workspaceWorkgroupId: rows[0].workspaceWorkgroupId,
    workspaceMode: rows[0].workspaceMode,
  }
}

export async function getActiveWorkflowRecord(
  workflowId: string
): Promise<ActiveWorkflowRecord | null> {
  const context = await getActiveWorkflowContext(workflowId)
  return context?.workflow ?? null
}

export async function assertActiveWorkflowContext(
  workflowId: string
): Promise<ActiveWorkflowContext> {
  const context = await getActiveWorkflowContext(workflowId)
  if (!context) {
    throw new Error(`Active workflow not found: ${workflowId}`)
  }
  return context
}

export type PermissionType = (typeof permissionTypeEnum.enumValues)[number]
export type WorkflowAccessSource = 'workspace' | 'organization' | 'selected_workgroups'
export type CanvasScope = 'personal' | 'team' | 'showcase'
export type CanvasPermission = 'read' | 'write' | 'publish' | 'admin'
export type WorkflowWorkspaceAction = 'read' | 'write' | 'publish' | 'admin'

type WorkflowRecord = typeof workflow.$inferSelect

export function resolveCanvasScope(params: {
  workspaceMode?: WorkspaceMode | null
  workspaceWorkgroupId?: string | null
  accessSource?: WorkflowAccessSource | null
  workflowTrack?: WorkflowRecord['track'] | null
}): CanvasScope | null {
  if (params.workflowTrack === 'published') {
    return 'showcase'
  }

  if (params.accessSource === 'organization' || params.accessSource === 'selected_workgroups') {
    return 'showcase'
  }

  if (params.workspaceMode === 'personal') {
    return 'personal'
  }

  if (params.workspaceMode === 'organization' && params.workspaceWorkgroupId) {
    return 'team'
  }

  return null
}

export class WorkflowLockedError extends Error {
  readonly status = 423

  constructor(message = 'Workflow is locked') {
    super(message)
    this.name = 'WorkflowLockedError'
  }
}

export class FolderLockedError extends Error {
  readonly status = 423

  constructor(message = 'Folder is locked') {
    super(message)
    this.name = 'FolderLockedError'
  }
}

export interface LockStatus {
  locked: boolean
  directLocked: boolean
  inheritedLocked: boolean
  lockedBy: 'workflow' | 'folder' | 'published' | null
  lockedFolderId: string | null
}

export async function getFolderLockStatus(folderId: string | null): Promise<LockStatus> {
  if (!folderId) {
    return {
      locked: false,
      directLocked: false,
      inheritedLocked: false,
      lockedBy: null,
      lockedFolderId: null,
    }
  }

  let currentFolderId: string | null = folderId
  let isDirect = true
  const visited = new Set<string>()

  while (currentFolderId && !visited.has(currentFolderId)) {
    visited.add(currentFolderId)
    const [folder] = await db
      .select({
        id: workflowFolder.id,
        parentId: workflowFolder.parentId,
        locked: workflowFolder.locked,
      })
      .from(workflowFolder)
      .where(and(eq(workflowFolder.id, currentFolderId), isNull(workflowFolder.archivedAt)))
      .limit(1)

    if (!folder) break
    if (folder.locked) {
      return {
        locked: true,
        directLocked: isDirect,
        inheritedLocked: !isDirect,
        lockedBy: 'folder',
        lockedFolderId: folder.id,
      }
    }

    currentFolderId = folder.parentId
    isDirect = false
  }

  return {
    locked: false,
    directLocked: false,
    inheritedLocked: false,
    lockedBy: null,
    lockedFolderId: null,
  }
}

export async function getWorkflowLockStatus(workflowId: string): Promise<LockStatus> {
  const [wf] = await db
    .select({
      locked: workflow.locked,
      folderId: workflow.folderId,
      track: workflow.track,
    })
    .from(workflow)
    .where(and(eq(workflow.id, workflowId), isNull(workflow.archivedAt)))
    .limit(1)

  if (!wf) {
    return {
      locked: false,
      directLocked: false,
      inheritedLocked: false,
      lockedBy: null,
      lockedFolderId: null,
    }
  }

  if (wf.locked) {
    return {
      locked: true,
      directLocked: true,
      inheritedLocked: false,
      lockedBy: 'workflow',
      lockedFolderId: null,
    }
  }

  if (wf.track === 'published') {
    return {
      locked: true,
      directLocked: true,
      inheritedLocked: false,
      lockedBy: 'published',
      lockedFolderId: null,
    }
  }

  return getFolderLockStatus(wf.folderId)
}

export async function assertWorkflowMutable(workflowId: string): Promise<void> {
  const status = await getWorkflowLockStatus(workflowId)
  if (status.locked) {
    throw new WorkflowLockedError(
      status.lockedBy === 'published'
        ? 'Published workflows are read-only'
        : status.lockedBy === 'folder'
          ? 'Workflow is locked by its containing folder'
          : 'Workflow is locked'
    )
  }
}

export async function assertFolderMutable(folderId: string | null): Promise<void> {
  const status = await getFolderLockStatus(folderId)
  if (status.locked) {
    throw new FolderLockedError(
      status.inheritedLocked ? 'Folder is locked by an ancestor folder' : 'Folder is locked'
    )
  }
}

export interface WorkflowWorkspaceAuthorizationResult {
  allowed: boolean
  status: number
  message?: string
  workflow: WorkflowRecord | null
  workspacePermission: PermissionType | null
  accessSource: WorkflowAccessSource | null
  workspaceWorkgroupId?: string | null
  workspaceMode?: WorkspaceMode | null
}

function isPermissionSatisfied(
  permission: PermissionType | null,
  action: WorkflowWorkspaceAction
): boolean {
  if (permission === null) {
    return false
  }

  if (action === 'read') {
    return true
  }

  if (action === 'write') {
    return permission === 'write' || permission === 'admin'
  }

  if (action === 'publish') {
    return permission === 'admin'
  }

  return permission === 'admin'
}

async function getWorkspacePermission(
  userId: string,
  workspaceId: string
): Promise<PermissionType | null> {
  const [workspaceRow] = await db
    .select({
      ownerId: workspace.ownerId,
      workspaceMode: workspace.workspaceMode,
      workgroupId: workspace.workgroupId,
    })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)

  if (!workspaceRow) {
    return null
  }

  if (workspaceRow.workspaceMode === 'personal') {
    if (workspaceRow.ownerId !== userId) return null
    return 'admin'
  }

  if (workspaceRow.workspaceMode === 'organization' && workspaceRow.workgroupId) {
    const [membership] = await db
      .select({ role: workgroupMember.role })
      .from(workgroupMember)
      .where(
        and(
          eq(workgroupMember.userId, userId),
          eq(workgroupMember.workgroupId, workspaceRow.workgroupId)
        )
      )
      .limit(1)

    if (!membership) return null
    return membership.role === 'admin' ? 'admin' : 'write'
  }

  if (workspaceRow.ownerId === userId) {
    return 'admin'
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

  return (permissionRow?.permissionType as PermissionType | undefined) ?? null
}

async function hasOrganizationReadAccess(userId: string, organizationId: string): Promise<boolean> {
  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1)

  return Boolean(membership)
}

async function hasOrganizationAdminAccess(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1)

  return membership?.role === 'owner' || membership?.role === 'admin'
}

async function getUserAccessibleWorkgroupIds(
  userId: string,
  organizationId: string | null
): Promise<string[]> {
  const rows = await db
    .select({ workgroupId: workgroupMember.workgroupId })
    .from(workgroupMember)
    .where(
      and(
        organizationId
          ? eq(workgroupMember.organizationId, organizationId)
          : isNull(workgroupMember.organizationId),
        eq(workgroupMember.userId, userId)
      )
    )

  return [...new Set(rows.map((row) => row.workgroupId).filter((id): id is string => Boolean(id)))]
}

async function hasSelectedWorkgroupReadAccess(params: {
  workflowId: string
  userId: string
  organizationId: string | null
}): Promise<boolean> {
  const viewerWorkgroupIds = await getUserAccessibleWorkgroupIds(
    params.userId,
    params.organizationId
  )
  if (viewerWorkgroupIds.length === 0) {
    return false
  }

  const [scopeRow] = await db
    .select({ id: workflowPublicationScope.id })
    .from(workflowPublicationScope)
    .where(
      and(
        eq(workflowPublicationScope.workflowId, params.workflowId),
        inArray(workflowPublicationScope.viewerWorkgroupId, viewerWorkgroupIds)
      )
    )
    .limit(1)

  return Boolean(scopeRow)
}

export async function authorizeWorkflowByWorkspacePermission(params: {
  workflowId: string
  userId: string
  action?: WorkflowWorkspaceAction
  includeArchived?: boolean
}): Promise<WorkflowWorkspaceAuthorizationResult> {
  const { workflowId, userId, action = 'read', includeArchived = false } = params

  const activeContext = await getActiveWorkflowContext(workflowId, { includeArchived })
  if (!activeContext) {
    return {
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: null,
      workspacePermission: null,
      accessSource: null,
    }
  }

  const wf = activeContext.workflow

  if (!wf.workspaceId) {
    return {
      allowed: false,
      status: 403,
      message:
        'This workflow is not attached to a canvas. Legacy personal workflows are deprecated and cannot be accessed.',
      workflow: wf,
      workspacePermission: null,
      accessSource: null,
    }
  }

  const workspacePermission = await getWorkspacePermission(userId, wf.workspaceId)
  if (activeContext.workspaceMode === 'personal' && workspacePermission === null) {
    return {
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: wf,
      workspacePermission,
      accessSource: null,
      workspaceWorkgroupId: activeContext.workspaceWorkgroupId,
      workspaceMode: activeContext.workspaceMode,
    }
  }

  if (action === 'publish' && activeContext.workspaceMode === 'personal') {
    return {
      allowed: false,
      status: 403,
      message: 'Personal canvases cannot be published directly',
      workflow: wf,
      workspacePermission,
      accessSource: null,
      workspaceWorkgroupId: activeContext.workspaceWorkgroupId,
      workspaceMode: activeContext.workspaceMode,
    }
  }

  if ((action === 'write' || action === 'admin') && wf.track === 'published') {
    return {
      allowed: false,
      status: 403,
      message: 'Published workflows are read-only',
      workflow: wf,
      workspacePermission,
      accessSource: null,
      workspaceWorkgroupId: activeContext.workspaceWorkgroupId,
      workspaceMode: activeContext.workspaceMode,
    }
  }

  if (isPermissionSatisfied(workspacePermission, action)) {
    return {
      allowed: true,
      status: 200,
      workflow: wf,
      workspacePermission,
      accessSource: 'workspace',
      workspaceWorkgroupId: activeContext.workspaceWorkgroupId,
      workspaceMode: activeContext.workspaceMode,
    }
  }

  if (
    action === 'publish' &&
    activeContext.workspaceMode === 'organization' &&
    activeContext.workspaceWorkgroupId &&
    activeContext.workspaceOrganizationId
  ) {
    const organizationAdminAllowed = await hasOrganizationAdminAccess(
      userId,
      activeContext.workspaceOrganizationId
    )
    if (organizationAdminAllowed) {
      return {
        allowed: true,
        status: 200,
        workflow: wf,
        workspacePermission: 'admin',
        accessSource: 'workspace',
        workspaceWorkgroupId: activeContext.workspaceWorkgroupId,
        workspaceMode: activeContext.workspaceMode,
      }
    }
  }

  if (action !== 'read' || wf.track !== 'published') {
    return {
      allowed: false,
      status: 403,
      message: `Unauthorized: Access denied to ${action} this workflow`,
      workflow: wf,
      workspacePermission,
      accessSource: null,
      workspaceWorkgroupId: activeContext.workspaceWorkgroupId,
      workspaceMode: activeContext.workspaceMode,
    }
  }

  // Cross-team publication visibility only applies to organization team canvases.
  if (activeContext.workspaceMode !== 'organization' || !activeContext.workspaceWorkgroupId) {
    return {
      allowed: false,
      status: 403,
      message: `Unauthorized: Access denied to ${action} this workflow`,
      workflow: wf,
      workspacePermission,
      accessSource: null,
      workspaceWorkgroupId: activeContext.workspaceWorkgroupId,
      workspaceMode: activeContext.workspaceMode,
    }
  }

  if (wf.visibility === 'organization' && activeContext.workspaceOrganizationId) {
    const organizationAllowed = await hasOrganizationReadAccess(
      userId,
      activeContext.workspaceOrganizationId
    )
    if (organizationAllowed) {
      return {
        allowed: true,
        status: 200,
        workflow: wf,
        workspacePermission: 'read',
        accessSource: 'organization',
        workspaceWorkgroupId: activeContext.workspaceWorkgroupId,
        workspaceMode: activeContext.workspaceMode,
      }
    }
  }

  if (wf.visibility === 'selected_workgroups') {
    const selectedWorkgroupsAllowed = await hasSelectedWorkgroupReadAccess({
      workflowId,
      userId,
      organizationId: activeContext.workspaceOrganizationId,
    })
    if (selectedWorkgroupsAllowed) {
      return {
        allowed: true,
        status: 200,
        workflow: wf,
        workspacePermission: 'read',
        accessSource: 'selected_workgroups',
        workspaceWorkgroupId: activeContext.workspaceWorkgroupId,
        workspaceMode: activeContext.workspaceMode,
      }
    }
  }

  return {
    allowed: false,
    status: 403,
    message: `Unauthorized: Access denied to ${action} this workflow`,
    workflow: wf,
    workspacePermission,
    accessSource: null,
    workspaceWorkgroupId: activeContext.workspaceWorkgroupId,
    workspaceMode: activeContext.workspaceMode,
  }
}
