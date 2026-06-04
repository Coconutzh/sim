import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { copilotSkillCard, discipline, workgroup, workgroupMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm'
import type {
  CopilotSkillCard,
  CopilotSkillCardActionKind,
  CopilotSkillCardTaskDraft,
} from '@/lib/api/contracts/copilot-skill-cards'
import { isAgentCode, type AgentCode } from '@/lib/collaboration/definitions'
import { getOrganizationRole, resolveAgentForWorkspace } from '@/lib/collaboration/service'

const logger = createLogger('CopilotSkillCards')

type OrganizationRole = 'owner' | 'admin' | 'member' | null
type CopilotSkillCardRow = typeof copilotSkillCard.$inferSelect

export class CopilotSkillCardServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'CopilotSkillCardServiceError'
  }
}

interface ActorCardContext {
  userId: string
  organizationId: string
  organizationRole: OrganizationRole
  directorLike: boolean
  adminWorkgroupIds: Set<string>
}

interface CardInput {
  agentCode: AgentCode
  workgroupId?: string | null
  title: string
  description: string
  prompt: string
  actionKind: CopilotSkillCardActionKind
  taskDraft?: CopilotSkillCardTaskDraft | null
  enabled: boolean
  sortOrder: number
}

interface CardUpdateInput {
  title?: string
  description?: string
  prompt?: string
  actionKind?: CopilotSkillCardActionKind
  taskDraft?: CopilotSkillCardTaskDraft | null
  enabled?: boolean
  sortOrder?: number
}

function isOrganizationAdmin(role: OrganizationRole): boolean {
  return role === 'owner' || role === 'admin'
}

function isDirectorLikeDiscipline(code: string | null, agentCode: string | null): boolean {
  return (
    code === 'chief_director' ||
    code === 'pmo' ||
    agentCode === 'chief_director' ||
    agentCode === 'show_director'
  )
}

function assertFound<T>(value: T | null | undefined, message: string): T {
  if (!value) {
    throw new CopilotSkillCardServiceError(message, 404)
  }
  return value
}

function assertAllowed(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new CopilotSkillCardServiceError(message, 403)
  }
}

async function getActorCardContext(params: {
  userId: string
  organizationId: string
}): Promise<ActorCardContext> {
  const organizationRole = await getOrganizationRole(params.userId, params.organizationId)
  assertAllowed(Boolean(organizationRole), 'Organization membership required')

  const rows = await db
    .select({
      workgroupId: workgroupMember.workgroupId,
      role: workgroupMember.role,
      disciplineCode: discipline.code,
      agentCode: discipline.agentCode,
    })
    .from(workgroupMember)
    .innerJoin(workgroup, eq(workgroupMember.workgroupId, workgroup.id))
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(
      and(
        eq(workgroupMember.userId, params.userId),
        eq(workgroupMember.organizationId, params.organizationId),
        isNull(workgroup.archivedAt)
      )
    )

  return {
    userId: params.userId,
    organizationId: params.organizationId,
    organizationRole,
    directorLike: rows.some((row) => isDirectorLikeDiscipline(row.disciplineCode, row.agentCode)),
    adminWorkgroupIds: new Set(
      rows.filter((row) => row.role === 'admin').map((row) => row.workgroupId)
    ),
  }
}

async function assertWorkgroupInOrganization(params: {
  organizationId: string
  workgroupId: string
}) {
  const [row] = await db
    .select({ id: workgroup.id, name: workgroup.name, organizationId: workgroup.organizationId })
    .from(workgroup)
    .where(and(eq(workgroup.id, params.workgroupId), isNull(workgroup.archivedAt)))
    .limit(1)

  assertFound(row, 'Workgroup not found')
  assertAllowed(row.organizationId === params.organizationId, 'Workgroup must belong to organization')
  return row
}

function canManageCards(context: ActorCardContext, workgroupId: string | null): boolean {
  if (isOrganizationAdmin(context.organizationRole) || context.directorLike) return true
  return Boolean(workgroupId && context.adminWorkgroupIds.has(workgroupId))
}

function formatCard(row: CopilotSkillCardRow, workgroupById: Map<string, string>): CopilotSkillCard {
  const taskDraft =
    row.taskTitle || row.taskDescription || row.dueAtOffsetHours
      ? {
          title: row.taskTitle ?? row.title,
          description: row.taskDescription,
          dueAtOffsetHours: row.dueAtOffsetHours,
        }
      : null

  return {
    id: row.id,
    organizationId: row.organizationId,
    agentCode: isAgentCode(row.agentCode) ? row.agentCode : 'chief_director',
    workgroupId: row.workgroupId,
    workgroup: row.workgroupId
      ? { id: row.workgroupId, name: workgroupById.get(row.workgroupId) ?? 'Unknown team' }
      : null,
    title: row.title,
    description: row.description ?? '',
    prompt: row.prompt,
    actionKind: row.actionKind,
    taskDraft,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function formatCards(rows: CopilotSkillCardRow[]): Promise<CopilotSkillCard[]> {
  const workgroupIds = [...new Set(rows.map((row) => row.workgroupId).filter(Boolean) as string[])]
  const workgroupRows =
    workgroupIds.length > 0
      ? await db
          .select({ id: workgroup.id, name: workgroup.name })
          .from(workgroup)
          .where(inArray(workgroup.id, workgroupIds))
      : []
  const workgroupById = new Map(workgroupRows.map((row) => [row.id, row.name]))
  return rows.map((row) => formatCard(row, workgroupById))
}

function recordSkillCardAudit(params: {
  action:
    | typeof AuditAction.SKILL_CREATED
    | typeof AuditAction.SKILL_UPDATED
    | typeof AuditAction.SKILL_DELETED
  actorUserId: string
  card: Pick<
    CopilotSkillCardRow,
    'id' | 'organizationId' | 'agentCode' | 'workgroupId' | 'title' | 'actionKind' | 'enabled'
  >
}) {
  recordAudit({
    actorId: params.actorUserId,
    action: params.action,
    resourceType: AuditResourceType.SKILL,
    resourceId: params.card.id,
    resourceName: params.card.title,
    description: `Copilot skill card "${params.card.title}" was ${params.action.split('.')[1]}`,
    metadata: {
      organizationId: params.card.organizationId,
      agentCode: params.card.agentCode,
      workgroupId: params.card.workgroupId,
      actionKind: params.card.actionKind,
      enabled: params.card.enabled,
      skillCardCms: true,
    },
  })
}

export async function listRuntimeCopilotSkillCards(params: {
  userId: string
  workspaceId: string
}): Promise<CopilotSkillCard[]> {
  const profile = await resolveAgentForWorkspace({
    userId: params.userId,
    workspaceId: params.workspaceId,
  })

  const rows = await db
    .select()
    .from(copilotSkillCard)
    .where(
      and(
        eq(copilotSkillCard.organizationId, profile.workgroup.organizationId),
        eq(copilotSkillCard.agentCode, profile.agent.code),
        eq(copilotSkillCard.enabled, true),
        or(
          isNull(copilotSkillCard.workgroupId),
          eq(copilotSkillCard.workgroupId, profile.workgroup.id)
        )
      )
    )
    .orderBy(asc(copilotSkillCard.sortOrder), desc(copilotSkillCard.updatedAt))

  return formatCards(rows)
}

export async function listOrganizationCopilotSkillCards(params: {
  userId: string
  organizationId: string
  agentCode?: AgentCode
  workgroupId?: string
}): Promise<CopilotSkillCard[]> {
  await getActorCardContext({ userId: params.userId, organizationId: params.organizationId })

  const conditions: SQL[] = [eq(copilotSkillCard.organizationId, params.organizationId)]
  if (params.agentCode) conditions.push(eq(copilotSkillCard.agentCode, params.agentCode))
  if (params.workgroupId) conditions.push(eq(copilotSkillCard.workgroupId, params.workgroupId))

  const rows = await db
    .select()
    .from(copilotSkillCard)
    .where(and(...conditions))
    .orderBy(asc(copilotSkillCard.agentCode), asc(copilotSkillCard.sortOrder), desc(copilotSkillCard.updatedAt))

  return formatCards(rows)
}

export async function createCopilotSkillCard(params: {
  userId: string
  organizationId: string
  input: CardInput
}): Promise<CopilotSkillCard> {
  const context = await getActorCardContext({
    userId: params.userId,
    organizationId: params.organizationId,
  })
  if (params.input.workgroupId) {
    await assertWorkgroupInOrganization({
      organizationId: params.organizationId,
      workgroupId: params.input.workgroupId,
    })
  }
  assertAllowed(
    canManageCards(context, params.input.workgroupId ?? null),
    'Copilot skill card management access required'
  )

  const now = new Date()
  const [row] = await db
    .insert(copilotSkillCard)
    .values({
      id: generateId(),
      organizationId: params.organizationId,
      agentCode: params.input.agentCode,
      workgroupId: params.input.workgroupId ?? null,
      title: params.input.title,
      description: params.input.description,
      prompt: params.input.prompt,
      actionKind: params.input.actionKind,
      taskTitle: params.input.taskDraft?.title ?? null,
      taskDescription: params.input.taskDraft?.description ?? null,
      dueAtOffsetHours: params.input.taskDraft?.dueAtOffsetHours ?? null,
      enabled: params.input.enabled,
      sortOrder: params.input.sortOrder,
      createdBy: params.userId,
      updatedBy: params.userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  recordSkillCardAudit({ action: AuditAction.SKILL_CREATED, actorUserId: params.userId, card: row })
  const [card] = await formatCards([row])
  return card
}

export async function updateCopilotSkillCard(params: {
  userId: string
  cardId: string
  input: CardUpdateInput
}): Promise<CopilotSkillCard> {
  const existing = assertFound(
    (await db.select().from(copilotSkillCard).where(eq(copilotSkillCard.id, params.cardId)).limit(1))[0],
    'Copilot skill card not found'
  )
  const context = await getActorCardContext({
    userId: params.userId,
    organizationId: existing.organizationId,
  })
  assertAllowed(
    canManageCards(context, existing.workgroupId),
    'Copilot skill card management access required'
  )

  const now = new Date()
  const taskDraftWasProvided = params.input.taskDraft !== undefined
  const [row] = await db
    .update(copilotSkillCard)
    .set({
      ...(params.input.title !== undefined ? { title: params.input.title } : {}),
      ...(params.input.description !== undefined ? { description: params.input.description } : {}),
      ...(params.input.prompt !== undefined ? { prompt: params.input.prompt } : {}),
      ...(params.input.actionKind !== undefined ? { actionKind: params.input.actionKind } : {}),
      ...(params.input.enabled !== undefined ? { enabled: params.input.enabled } : {}),
      ...(params.input.sortOrder !== undefined ? { sortOrder: params.input.sortOrder } : {}),
      ...(taskDraftWasProvided
        ? {
            taskTitle: params.input.taskDraft?.title ?? null,
            taskDescription: params.input.taskDraft?.description ?? null,
            dueAtOffsetHours: params.input.taskDraft?.dueAtOffsetHours ?? null,
          }
        : {}),
      updatedBy: params.userId,
      updatedAt: now,
    })
    .where(eq(copilotSkillCard.id, params.cardId))
    .returning()

  recordSkillCardAudit({ action: AuditAction.SKILL_UPDATED, actorUserId: params.userId, card: row })
  const [card] = await formatCards([row])
  return card
}

export async function deleteCopilotSkillCard(params: {
  userId: string
  cardId: string
}): Promise<void> {
  const existing = assertFound(
    (await db.select().from(copilotSkillCard).where(eq(copilotSkillCard.id, params.cardId)).limit(1))[0],
    'Copilot skill card not found'
  )
  const context = await getActorCardContext({
    userId: params.userId,
    organizationId: existing.organizationId,
  })
  assertAllowed(
    canManageCards(context, existing.workgroupId),
    'Copilot skill card management access required'
  )

  await db.delete(copilotSkillCard).where(eq(copilotSkillCard.id, params.cardId))
  recordSkillCardAudit({
    action: AuditAction.SKILL_DELETED,
    actorUserId: params.userId,
    card: existing,
  })
  logger.info('Deleted Copilot skill card', { cardId: params.cardId })
}
