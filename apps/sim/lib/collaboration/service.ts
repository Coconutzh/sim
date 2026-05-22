import { db } from '@sim/db'
import {
  agentSkillBinding,
  discipline,
  member,
  permissions,
  personalCanvasWorkspace,
  settings,
  skill,
  user,
  workflow,
  workflowPublicationScope,
  workflowPublicationVersion,
  workgroup,
  workgroupMember,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, asc, desc, eq, inArray, isNull, max, or, sql } from 'drizzle-orm'
import { canPublishTeamCanvas, canReadPublication } from '@/lib/collaboration/authz'
import {
  AGENT_PROFILES,
  DISCIPLINES,
  getAgentProfile,
  workspacePermissionForWorkgroupRole,
} from '@/lib/collaboration/definitions'
import { sanitizeWorkflowSnapshot } from '@/lib/collaboration/snapshot-sanitizer'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import {
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/persistence/utils'

const logger = createLogger('Collaboration')

export type OrganizationRole = 'owner' | 'admin' | 'member' | null
export type WorkgroupRole = 'admin' | 'member'

function toSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || `team-${generateShortId(8)}`
}

function workspaceDto(row: typeof workspace.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    logoUrl: row.logoUrl,
    ownerId: row.ownerId,
    organizationId: row.organizationId,
    workgroupId: row.workgroupId,
    workspaceMode: row.workspaceMode,
    billedAccountUserId: row.billedAccountUserId,
    allowPersonalApiKeys: row.allowPersonalApiKeys,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function getOrganizationRole(
  userId: string,
  organizationId: string
): Promise<OrganizationRole> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1)

  return (row?.role as OrganizationRole | undefined) ?? null
}

export async function assertOrganizationAdmin(
  userId: string,
  organizationId: string
): Promise<void> {
  const role = await getOrganizationRole(userId, organizationId)
  if (role !== 'owner' && role !== 'admin') {
    throw new Error('Organization admin access required')
  }
}

export async function getWorkgroupMembership(userId: string, workgroupId: string) {
  const [row] = await db
    .select({
      id: workgroupMember.id,
      role: workgroupMember.role,
      organizationId: workgroupMember.organizationId,
      workgroupId: workgroupMember.workgroupId,
    })
    .from(workgroupMember)
    .where(and(eq(workgroupMember.userId, userId), eq(workgroupMember.workgroupId, workgroupId)))
    .limit(1)

  return row ?? null
}

async function getWorkgroupOrganizationId(workgroupId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: workgroup.organizationId })
    .from(workgroup)
    .where(eq(workgroup.id, workgroupId))
    .limit(1)

  return row?.organizationId ?? null
}

export async function assertWorkgroupMember(userId: string, workgroupId: string) {
  const membership = await getWorkgroupMembership(userId, workgroupId)
  if (!membership) {
    throw new Error('Workgroup membership required')
  }
  return membership
}

export async function assertWorkgroupAdmin(userId: string, workgroupId: string) {
  const membership = await getWorkgroupMembership(userId, workgroupId)
  if (membership?.role === 'admin') return membership
  const organizationId =
    membership?.organizationId ?? (await getWorkgroupOrganizationId(workgroupId))
  if (!organizationId) {
    throw new Error('Workgroup membership required')
  }
  const orgRole = await getOrganizationRole(userId, organizationId)
  if (orgRole === 'owner' || orgRole === 'admin') return membership
  if (!membership) {
    throw new Error('Workgroup membership required')
  }
  throw new Error('Workgroup admin access required')
}

export async function listDisciplines() {
  const rows = await db.select().from(discipline).orderBy(asc(discipline.sortOrder))
  if (rows.length > 0) return rows
  return DISCIPLINES.map((item) => ({
    ...item,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }))
}

export async function listAgentProfiles() {
  const profiles = Object.values(AGENT_PROFILES)
  const disciplineRows = await listDisciplines()
  return profiles.map((profile) => ({
    ...profile,
    disciplineCodes: disciplineRows
      .filter((item) => item.agentCode === profile.code)
      .map((item) => item.code),
  }))
}

async function getDisciplineById(disciplineId: string) {
  const [row] = await db.select().from(discipline).where(eq(discipline.id, disciplineId)).limit(1)
  if (row) return row
  return DISCIPLINES.find((item) => item.id === disciplineId) ?? null
}

export async function listUserWorkgroups(userId: string) {
  const rows = await db
    .select({
      workgroupId: workgroup.id,
      workgroupName: workgroup.name,
      organizationId: workgroup.organizationId,
      disciplineId: discipline.id,
      disciplineCode: discipline.code,
      disciplineName: discipline.name,
      agentCode: discipline.agentCode,
      role: workgroupMember.role,
      teamWorkspaceId: workgroup.teamWorkspaceId,
    })
    .from(workgroupMember)
    .innerJoin(workgroup, eq(workgroupMember.workgroupId, workgroup.id))
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(eq(workgroupMember.userId, userId))
    .orderBy(asc(workgroup.name))

  const countRows = rows.length
    ? await db
        .select({ workgroupId: workgroupMember.workgroupId, count: sql<number>`count(*)::int` })
        .from(workgroupMember)
        .where(
          inArray(
            workgroupMember.workgroupId,
            rows.map((row) => row.workgroupId)
          )
        )
        .groupBy(workgroupMember.workgroupId)
    : []
  const counts = new Map(countRows.map((row) => [row.workgroupId, row.count]))

  return rows.map((row) => ({
    id: row.workgroupId,
    name: row.workgroupName,
    organizationId: row.organizationId,
    discipline: {
      id: row.disciplineId ?? '',
      code: row.disciplineCode ?? 'chief_director',
      name: row.disciplineName ?? '总导演',
      agentCode: row.agentCode ?? 'chief_director',
    },
    role: row.role,
    teamWorkspaceId: row.teamWorkspaceId ?? '',
    memberCount: counts.get(row.workgroupId) ?? 0,
  }))
}

export async function getDefaultActiveWorkgroupId(userId: string): Promise<string | null> {
  const [userSettings] = await db
    .select({ activeWorkgroupId: settings.activeWorkgroupId })
    .from(settings)
    .where(eq(settings.userId, userId))
    .limit(1)
  const workgroups = await listUserWorkgroups(userId)
  if (workgroups.length === 0) return null
  if (userSettings?.activeWorkgroupId) {
    const stillAllowed = workgroups.some((row) => row.id === userSettings.activeWorkgroupId)
    if (stillAllowed) return userSettings.activeWorkgroupId
  }
  return workgroups[0].id
}

export async function setActiveWorkgroup(userId: string, workgroupId: string): Promise<void> {
  await assertWorkgroupMember(userId, workgroupId)
  await db
    .insert(settings)
    .values({ id: userId, userId, activeWorkgroupId: workgroupId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.userId,
      set: { activeWorkgroupId: workgroupId, updatedAt: new Date() },
    })
}

async function insertWorkspace(params: {
  name: string
  ownerId: string
  organizationId: string
  workgroupId: string
  mode: 'personal' | 'organization'
}) {
  const now = new Date()
  const id = generateId()
  await db.insert(workspace).values({
    id,
    name: params.name,
    color: '#33C482',
    ownerId: params.ownerId,
    organizationId: params.organizationId,
    workgroupId: params.workgroupId,
    workspaceMode: params.mode,
    billedAccountUserId: params.ownerId,
    allowPersonalApiKeys: true,
    createdAt: now,
    updatedAt: now,
  })
  await upsertWorkspacePermission({
    userId: params.ownerId,
    workspaceId: id,
    permissionType: 'admin',
  })
  const [row] = await db.select().from(workspace).where(eq(workspace.id, id)).limit(1)
  return row
}

async function upsertWorkspacePermission(params: {
  userId: string
  workspaceId: string
  permissionType: 'admin' | 'write' | 'read'
}) {
  const now = new Date()
  await db
    .insert(permissions)
    .values({
      id: generateId(),
      userId: params.userId,
      entityType: 'workspace',
      entityId: params.workspaceId,
      permissionType: params.permissionType,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [permissions.userId, permissions.entityType, permissions.entityId],
      set: { permissionType: params.permissionType, updatedAt: now },
    })
}

async function createDefaultWorkflowForWorkspace(params: {
  userId: string
  workspaceId: string
  name: string
  description: string
}) {
  const workflowId = generateId()
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(workflow).values({
      id: workflowId,
      userId: params.userId,
      workspaceId: params.workspaceId,
      folderId: null,
      name: params.name,
      description: params.description,
      color: '#3972F6',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      runCount: 0,
      variables: {},
    })

    const { workflowState } = buildDefaultWorkflowArtifacts()
    await saveWorkflowToNormalizedTables(workflowId, workflowState, tx)
  })
  return workflowId
}

export async function createWorkgroup(params: {
  organizationId: string
  disciplineId: string
  name: string
  actorUserId: string
}) {
  await assertOrganizationAdmin(params.actorUserId, params.organizationId)
  const disciplineRow = await getDisciplineById(params.disciplineId)
  if (!disciplineRow) throw new Error('Discipline not found')

  const now = new Date()
  const workgroupId = generateId()
  const slug = `${toSlug(params.name)}-${generateShortId(6)}`
  const teamWorkspaceId = generateId()

  await db.transaction(async (tx) => {
    await tx.insert(workgroup).values({
      id: workgroupId,
      organizationId: params.organizationId,
      name: params.name,
      slug,
      disciplineId: params.disciplineId,
      teamWorkspaceId,
      createdAt: now,
      updatedAt: now,
    })

    await tx.insert(workspace).values({
      id: teamWorkspaceId,
      name: `${params.name} 团队画布`,
      color: '#33C482',
      ownerId: params.actorUserId,
      organizationId: params.organizationId,
      workgroupId,
      workspaceMode: 'organization',
      billedAccountUserId: params.actorUserId,
      allowPersonalApiKeys: true,
      createdAt: now,
      updatedAt: now,
    })

    await tx.insert(workgroupMember).values({
      id: generateId(),
      organizationId: params.organizationId,
      workgroupId,
      userId: params.actorUserId,
      role: 'admin',
      createdAt: now,
      updatedAt: now,
    })

    await tx.insert(permissions).values({
      id: generateId(),
      userId: params.actorUserId,
      entityType: 'workspace',
      entityId: teamWorkspaceId,
      permissionType: 'admin',
      createdAt: now,
      updatedAt: now,
    })
  })

  return { id: workgroupId, name: params.name, disciplineId: params.disciplineId, teamWorkspaceId }
}

export async function listOrganizationWorkgroups(params: {
  userId: string
  organizationId: string
}) {
  const orgRole = await getOrganizationRole(params.userId, params.organizationId)
  const isOrgAdmin = orgRole === 'owner' || orgRole === 'admin'

  const baseRows = await db
    .select({
      id: workgroup.id,
      name: workgroup.name,
      disciplineId: workgroup.disciplineId,
      disciplineName: discipline.name,
      agentCode: discipline.agentCode,
      teamWorkspaceId: workgroup.teamWorkspaceId,
      memberRole: workgroupMember.role,
    })
    .from(workgroup)
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .leftJoin(
      workgroupMember,
      and(eq(workgroupMember.workgroupId, workgroup.id), eq(workgroupMember.userId, params.userId))
    )
    .where(
      isOrgAdmin
        ? eq(workgroup.organizationId, params.organizationId)
        : and(
            eq(workgroup.organizationId, params.organizationId),
            eq(workgroupMember.userId, params.userId)
          )
    )
    .orderBy(asc(workgroup.name))

  const memberCounts = baseRows.length
    ? await db
        .select({ workgroupId: workgroupMember.workgroupId, count: sql<number>`count(*)::int` })
        .from(workgroupMember)
        .where(
          inArray(
            workgroupMember.workgroupId,
            baseRows.map((row) => row.id)
          )
        )
        .groupBy(workgroupMember.workgroupId)
    : []
  const countMap = new Map(memberCounts.map((row) => [row.workgroupId, row.count]))

  return baseRows.map((row) => ({
    id: row.id,
    name: row.name,
    disciplineId: row.disciplineId ?? '',
    disciplineName: row.disciplineName ?? '未分配工种',
    agentCode: row.agentCode ?? 'chief_director',
    teamWorkspaceId: row.teamWorkspaceId ?? '',
    memberCount: countMap.get(row.id) ?? 0,
    currentUserRole: isOrgAdmin ? 'org_admin' : row.memberRole,
  }))
}

export async function getWorkgroupMembers(params: { userId: string; workgroupId: string }) {
  await assertWorkgroupAdmin(params.userId, params.workgroupId)
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.image,
      role: workgroupMember.role,
      joinedAt: workgroupMember.createdAt,
    })
    .from(workgroupMember)
    .innerJoin(user, eq(workgroupMember.userId, user.id))
    .where(eq(workgroupMember.workgroupId, params.workgroupId))
    .orderBy(asc(user.name))

  return rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() }))
}

export async function addWorkgroupMember(params: {
  actorUserId: string
  workgroupId: string
  userId: string
  role: WorkgroupRole
}) {
  await assertWorkgroupAdmin(params.actorUserId, params.workgroupId)
  const [wg] = await db
    .select()
    .from(workgroup)
    .where(eq(workgroup.id, params.workgroupId))
    .limit(1)
  if (!wg) throw new Error('Workgroup not found')
  const now = new Date()
  await db
    .insert(workgroupMember)
    .values({
      id: generateId(),
      organizationId: wg.organizationId,
      workgroupId: wg.id,
      userId: params.userId,
      role: params.role,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [workgroupMember.workgroupId, workgroupMember.userId],
      set: { role: params.role, updatedAt: now },
    })
  if (wg.teamWorkspaceId) {
    await upsertWorkspacePermission({
      userId: params.userId,
      workspaceId: wg.teamWorkspaceId,
      permissionType: workspacePermissionForWorkgroupRole(params.role),
    })
  }
}

export async function updateWorkgroupMemberRole(params: {
  actorUserId: string
  workgroupId: string
  userId: string
  role: WorkgroupRole
}) {
  await assertWorkgroupAdmin(params.actorUserId, params.workgroupId)
  const [wg] = await db
    .select()
    .from(workgroup)
    .where(eq(workgroup.id, params.workgroupId))
    .limit(1)
  if (!wg) throw new Error('Workgroup not found')
  if (params.role !== 'admin') {
    const adminRows = await db
      .select({ userId: workgroupMember.userId })
      .from(workgroupMember)
      .where(
        and(eq(workgroupMember.workgroupId, params.workgroupId), eq(workgroupMember.role, 'admin'))
      )
    if (adminRows.length === 1 && adminRows[0].userId === params.userId) {
      throw new Error('Cannot demote the last workgroup admin')
    }
  }
  await db
    .update(workgroupMember)
    .set({ role: params.role, updatedAt: new Date() })
    .where(
      and(
        eq(workgroupMember.workgroupId, params.workgroupId),
        eq(workgroupMember.userId, params.userId)
      )
    )
  if (wg.teamWorkspaceId) {
    await upsertWorkspacePermission({
      userId: params.userId,
      workspaceId: wg.teamWorkspaceId,
      permissionType: workspacePermissionForWorkgroupRole(params.role),
    })
  }
}

export async function removeWorkgroupMember(params: {
  actorUserId: string
  workgroupId: string
  userId: string
}) {
  await assertWorkgroupAdmin(params.actorUserId, params.workgroupId)
  const [wg] = await db
    .select()
    .from(workgroup)
    .where(eq(workgroup.id, params.workgroupId))
    .limit(1)
  if (!wg) throw new Error('Workgroup not found')
  const adminRows = await db
    .select({ userId: workgroupMember.userId })
    .from(workgroupMember)
    .where(
      and(eq(workgroupMember.workgroupId, params.workgroupId), eq(workgroupMember.role, 'admin'))
    )
  if (adminRows.length === 1 && adminRows[0].userId === params.userId) {
    throw new Error('Cannot remove the last workgroup admin')
  }
  await db
    .delete(workgroupMember)
    .where(
      and(
        eq(workgroupMember.workgroupId, params.workgroupId),
        eq(workgroupMember.userId, params.userId)
      )
    )
  if (wg.teamWorkspaceId) {
    await db
      .delete(permissions)
      .where(
        and(
          eq(permissions.userId, params.userId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, wg.teamWorkspaceId)
        )
      )
  }
}

export async function getOrCreatePersonalWorkspace(params: {
  userId: string
  workgroupId: string
}) {
  const membership = await assertWorkgroupMember(params.userId, params.workgroupId)
  const existing = await db
    .select({ workspace })
    .from(personalCanvasWorkspace)
    .innerJoin(workspace, eq(personalCanvasWorkspace.workspaceId, workspace.id))
    .where(
      and(
        eq(personalCanvasWorkspace.userId, params.userId),
        eq(personalCanvasWorkspace.workgroupId, params.workgroupId),
        isNull(workspace.archivedAt)
      )
    )
    .orderBy(desc(personalCanvasWorkspace.createdAt))
    .limit(1)
  if (existing[0]?.workspace) return workspaceDto(existing[0].workspace)

  const [wg] = await db
    .select()
    .from(workgroup)
    .where(eq(workgroup.id, params.workgroupId))
    .limit(1)
  if (!wg) throw new Error('Workgroup not found')
  try {
    const ws = await insertWorkspace({
      name: `个人草稿 - ${wg.name}`,
      ownerId: params.userId,
      organizationId: membership.organizationId,
      workgroupId: params.workgroupId,
      mode: 'personal',
    })
    await db.insert(personalCanvasWorkspace).values({
      id: generateId(),
      userId: params.userId,
      organizationId: membership.organizationId,
      workgroupId: params.workgroupId,
      workspaceId: ws.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await createDefaultWorkflowForWorkspace({
      userId: params.userId,
      workspaceId: ws.id,
      name: 'Personal draft',
      description: `Default node graph for ${ws.name}`,
    })
    return workspaceDto(ws)
  } catch (error) {
    logger.warn('Personal canvas workspace lazy creation raced or failed; reloading', { error })
    const [fallback] = await db
      .select({ workspace })
      .from(personalCanvasWorkspace)
      .innerJoin(workspace, eq(personalCanvasWorkspace.workspaceId, workspace.id))
      .where(
        and(
          eq(personalCanvasWorkspace.userId, params.userId),
          eq(personalCanvasWorkspace.workgroupId, params.workgroupId)
        )
      )
      .limit(1)
    if (fallback?.workspace) return workspaceDto(fallback.workspace)
    throw error
  }
}

export async function createPersonalWorkspace(params: {
  userId: string
  workgroupId: string
  name: string
}) {
  const membership = await assertWorkgroupMember(params.userId, params.workgroupId)
  const [wg] = await db
    .select()
    .from(workgroup)
    .where(eq(workgroup.id, params.workgroupId))
    .limit(1)
  if (!wg) throw new Error('Workgroup not found')

  const ws = await insertWorkspace({
    name: params.name,
    ownerId: params.userId,
    organizationId: membership.organizationId,
    workgroupId: params.workgroupId,
    mode: 'personal',
  })
  await db.insert(personalCanvasWorkspace).values({
    id: generateId(),
    userId: params.userId,
    organizationId: membership.organizationId,
    workgroupId: params.workgroupId,
    workspaceId: ws.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const defaultWorkflowId = await createDefaultWorkflowForWorkspace({
    userId: params.userId,
    workspaceId: ws.id,
    name: 'Personal draft',
    description: `Default node graph for ${params.name}`,
  })
  return { workspace: workspaceDto(ws), defaultWorkflowId }
}

export async function getTeamWorkspace(params: { userId: string; workgroupId: string }) {
  await assertWorkgroupMember(params.userId, params.workgroupId)
  const [wg] = await db
    .select()
    .from(workgroup)
    .where(eq(workgroup.id, params.workgroupId))
    .limit(1)
  if (!wg) throw new Error('Workgroup not found')
  if (wg.teamWorkspaceId) {
    const [ws] = await db
      .select()
      .from(workspace)
      .where(eq(workspace.id, wg.teamWorkspaceId))
      .limit(1)
    if (ws) return workspaceDto(ws)
  }
  const ws = await insertWorkspace({
    name: `${wg.name} 团队画布`,
    ownerId: params.userId,
    organizationId: wg.organizationId,
    workgroupId: wg.id,
    mode: 'organization',
  })
  await db
    .update(workgroup)
    .set({ teamWorkspaceId: ws.id, updatedAt: new Date() })
    .where(eq(workgroup.id, wg.id))
  const members = await db
    .select()
    .from(workgroupMember)
    .where(eq(workgroupMember.workgroupId, wg.id))
  await Promise.all(
    members.map((row) =>
      upsertWorkspacePermission({
        userId: row.userId,
        workspaceId: ws.id,
        permissionType: workspacePermissionForWorkgroupRole(row.role),
      })
    )
  )
  return workspaceDto(ws)
}

export async function getNextPublicationVersionNumber(sourceWorkflowId: string): Promise<number> {
  const [row] = await db
    .select({ value: max(workflowPublicationVersion.versionNumber) })
    .from(workflowPublicationVersion)
    .where(eq(workflowPublicationVersion.sourceWorkflowId, sourceWorkflowId))
  return (row?.value ?? 0) + 1
}

export async function createPublicationVersion(params: {
  sourceWorkflowId: string
  publishedWorkflowId: string | null
  title: string
  description: string | null
  visibility: 'organization' | 'selected_workgroups'
  parentVersionId: string | null
  publishedBy: string
}) {
  const [source] = await db
    .select({
      workflow,
      organizationId: workspace.organizationId,
      workgroupId: workspace.workgroupId,
      disciplineId: workgroup.disciplineId,
      agentCode: discipline.agentCode,
    })
    .from(workflow)
    .innerJoin(workspace, eq(workflow.workspaceId, workspace.id))
    .innerJoin(workgroup, eq(workspace.workgroupId, workgroup.id))
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(eq(workflow.id, params.sourceWorkflowId))
    .limit(1)
  if (!source?.organizationId || !source.workgroupId) throw new Error('Team workflow required')
  const canPublish = await canPublishTeamCanvas(params.publishedBy, source.workgroupId)
  if (!canPublish) throw new Error('Publication access denied')
  const state = await loadWorkflowFromNormalizedTables(params.sourceWorkflowId)
  const versionNumber = await getNextPublicationVersionNumber(params.sourceWorkflowId)
  const [inserted] = await db
    .insert(workflowPublicationVersion)
    .values({
      id: generateId(),
      organizationId: source.organizationId,
      sourceWorkgroupId: source.workgroupId,
      sourceDisciplineId: source.disciplineId,
      agentCode: source.agentCode ?? 'chief_director',
      sourceWorkflowId: params.sourceWorkflowId,
      publishedWorkflowId: params.publishedWorkflowId,
      parentVersionId: params.parentVersionId,
      versionNumber,
      title: params.title,
      description: params.description,
      visibility: params.visibility,
      snapshotState: sanitizeWorkflowSnapshot(
        state ?? { blocks: {}, edges: [], loops: {}, parallels: {} }
      ),
      snapshotMetadata: {
        sourceWorkflowName: source.workflow.name,
        sourceWorkflowDescription: source.workflow.description,
      },
      publishedBy: params.publishedBy,
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
  return inserted
}

export async function listVisiblePublications(params: {
  userId: string
  workgroupId: string
  disciplineCode?: string
  sourceWorkgroupId?: string
  agentCode?: string
  limit?: number
}) {
  await assertWorkgroupMember(params.userId, params.workgroupId)
  const membership = await getWorkgroupMembership(params.userId, params.workgroupId)
  if (!membership) throw new Error('Workgroup membership required')
  const visibleWorkgroupRows = await db
    .select({ workflowId: workflowPublicationScope.workflowId })
    .from(workflowPublicationScope)
    .where(eq(workflowPublicationScope.viewerWorkgroupId, params.workgroupId))
  const scopedPublishedWorkflowIds = visibleWorkgroupRows.map((row) => row.workflowId)

  const conditions = [eq(workflowPublicationVersion.organizationId, membership.organizationId)]
  if (params.sourceWorkgroupId) {
    conditions.push(eq(workflowPublicationVersion.sourceWorkgroupId, params.sourceWorkgroupId))
  }
  if (params.agentCode) {
    conditions.push(eq(workflowPublicationVersion.agentCode, params.agentCode))
  }
  if (params.disciplineCode) {
    conditions.push(eq(discipline.code, params.disciplineCode))
  }

  const visibilityCondition = or(
    eq(workflowPublicationVersion.visibility, 'organization'),
    eq(workflowPublicationVersion.sourceWorkgroupId, params.workgroupId),
    scopedPublishedWorkflowIds.length > 0
      ? inArray(workflowPublicationVersion.publishedWorkflowId, scopedPublishedWorkflowIds)
      : sql`false`
  )

  const rows = await db
    .select({
      publication: workflowPublicationVersion,
      sourceWorkgroupName: workgroup.name,
      sourceDisciplineCode: discipline.code,
      sourceDisciplineName: discipline.name,
      publisherId: user.id,
      publisherName: user.name,
      publisherAvatarUrl: user.image,
    })
    .from(workflowPublicationVersion)
    .innerJoin(workgroup, eq(workflowPublicationVersion.sourceWorkgroupId, workgroup.id))
    .leftJoin(discipline, eq(workflowPublicationVersion.sourceDisciplineId, discipline.id))
    .leftJoin(user, eq(workflowPublicationVersion.publishedBy, user.id))
    .where(and(...conditions, visibilityCondition))
    .orderBy(desc(workflowPublicationVersion.publishedAt))
    .limit(params.limit ?? 50)

  return rows.map((row) => ({
    id: row.publication.id,
    title: row.publication.title,
    description: row.publication.description,
    sourceWorkgroup: { id: row.publication.sourceWorkgroupId, name: row.sourceWorkgroupName },
    sourceDiscipline: {
      code: row.sourceDisciplineCode ?? 'chief_director',
      name: row.sourceDisciplineName ?? '总导演',
    },
    agentCode: row.publication.agentCode,
    versionNumber: row.publication.versionNumber,
    publishedBy: {
      id: row.publisherId ?? '',
      name: row.publisherName ?? 'Unknown',
      avatarUrl: row.publisherAvatarUrl,
    },
    publishedAt: row.publication.publishedAt.toISOString(),
  }))
}

export async function getPublication(params: { userId: string; publicationVersionId: string }) {
  const canRead = await canReadPublication(params.userId, params.publicationVersionId)
  if (!canRead) throw new Error('Publication access denied')

  const [row] = await db
    .select({
      publication: workflowPublicationVersion,
      sourceWorkgroupName: workgroup.name,
      sourceDisciplineCode: discipline.code,
      sourceDisciplineName: discipline.name,
    })
    .from(workflowPublicationVersion)
    .innerJoin(workgroup, eq(workflowPublicationVersion.sourceWorkgroupId, workgroup.id))
    .leftJoin(discipline, eq(workflowPublicationVersion.sourceDisciplineId, discipline.id))
    .where(eq(workflowPublicationVersion.id, params.publicationVersionId))
    .limit(1)
  if (!row) throw new Error('Publication not found')
  const parentVersionId =
    row.publication.parentVersionId &&
    (await canReadPublication(params.userId, row.publication.parentVersionId))
      ? row.publication.parentVersionId
      : null

  return {
    id: row.publication.id,
    title: row.publication.title,
    description: row.publication.description,
    versionNumber: row.publication.versionNumber,
    parentVersionId,
    sourceWorkgroup: { id: row.publication.sourceWorkgroupId, name: row.sourceWorkgroupName },
    sourceDiscipline: {
      code: row.sourceDisciplineCode ?? 'chief_director',
      name: row.sourceDisciplineName ?? '总导演',
    },
    agentCode: row.publication.agentCode,
    snapshotState: row.publication.snapshotState,
    snapshotMetadata: row.publication.snapshotMetadata,
    publishedAt: row.publication.publishedAt.toISOString(),
  }
}

export async function getPublicationTree(params: { userId: string; publicationVersionId: string }) {
  const publication = await getPublication(params)
  const [root] = await db
    .select({ sourceWorkflowId: workflowPublicationVersion.sourceWorkflowId })
    .from(workflowPublicationVersion)
    .where(eq(workflowPublicationVersion.id, params.publicationVersionId))
    .limit(1)
  if (!root) throw new Error('Publication not found')
  const rows = await db
    .select({
      publication: workflowPublicationVersion,
      sourceWorkgroupName: workgroup.name,
      sourceDisciplineName: discipline.name,
    })
    .from(workflowPublicationVersion)
    .innerJoin(workgroup, eq(workflowPublicationVersion.sourceWorkgroupId, workgroup.id))
    .leftJoin(discipline, eq(workflowPublicationVersion.sourceDisciplineId, discipline.id))
    .where(eq(workflowPublicationVersion.sourceWorkflowId, root.sourceWorkflowId))
    .orderBy(asc(workflowPublicationVersion.versionNumber))

  const visibleRows = (
    await Promise.all(
      rows.map(async (row) => ({
        row,
        canRead: await canReadPublication(params.userId, row.publication.id),
      }))
    )
  )
    .filter(({ canRead }) => canRead)
    .map(({ row }) => row)
  const visibleVersionIds = new Set(visibleRows.map((row) => row.publication.id))

  return {
    rootVersionId: visibleRows[0]?.publication.id ?? publication.id,
    versions: visibleRows.map((row) => ({
      id: row.publication.id,
      parentVersionId:
        row.publication.parentVersionId && visibleVersionIds.has(row.publication.parentVersionId)
          ? row.publication.parentVersionId
          : null,
      title: row.publication.title,
      versionNumber: row.publication.versionNumber,
      sourceWorkgroupName: row.sourceWorkgroupName,
      sourceDisciplineName: row.sourceDisciplineName ?? '总导演',
      publishedAt: row.publication.publishedAt.toISOString(),
    })),
  }
}

export async function resolveAgentForWorkspace(params: { userId: string; workspaceId: string }) {
  const [personalRow] = await db
    .select({ workgroupId: personalCanvasWorkspace.workgroupId })
    .from(personalCanvasWorkspace)
    .where(
      and(
        eq(personalCanvasWorkspace.workspaceId, params.workspaceId),
        eq(personalCanvasWorkspace.userId, params.userId)
      )
    )
    .limit(1)

  const [workspaceRow] = await db
    .select({ workgroupId: workspace.workgroupId, workspaceId: workspace.id })
    .from(workspace)
    .where(eq(workspace.id, params.workspaceId))
    .limit(1)

  const workgroupId = personalRow?.workgroupId ?? workspaceRow?.workgroupId
  if (!workgroupId) throw new Error('Workspace is not attached to a team')
  await assertWorkgroupMember(params.userId, workgroupId)

  const [row] = await db
    .select({
      workgroupId: workgroup.id,
      workgroupName: workgroup.name,
      disciplineId: discipline.id,
      disciplineCode: discipline.code,
      disciplineName: discipline.name,
      agentCode: discipline.agentCode,
      organizationId: workgroup.organizationId,
    })
    .from(workgroup)
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(eq(workgroup.id, workgroupId))
    .limit(1)
  if (!row) throw new Error('Workgroup not found')
  const agent = getAgentProfile(row.agentCode ?? 'chief_director')
  const skillRows = await db
    .select({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      enabled: agentSkillBinding.enabled,
    })
    .from(skill)
    .leftJoin(agentSkillBinding, eq(agentSkillBinding.skillId, skill.id))
    .where(
      or(
        eq(skill.workspaceId, params.workspaceId),
        and(
          eq(agentSkillBinding.organizationId, row.organizationId),
          eq(agentSkillBinding.agentCode, agent.code),
          or(eq(agentSkillBinding.workgroupId, workgroupId), isNull(agentSkillBinding.workgroupId))
        )
      )
    )

  return {
    agent,
    discipline: {
      id: row.disciplineId ?? '',
      code: row.disciplineCode ?? 'chief_director',
      name: row.disciplineName ?? '总导演',
    },
    workgroup: { id: row.workgroupId, name: row.workgroupName },
    skills: skillRows.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      enabled: item.enabled ?? true,
    })),
  }
}
