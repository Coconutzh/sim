import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  agentSkillBinding,
  auditLog,
  discipline,
  member,
  organization,
  organizationAgentTemplate,
  permissions,
  personalCanvasWorkspace,
  productionTask,
  settings,
  skill,
  user,
  workflow,
  workflowPublicationScope,
  workflowPublicationVersion,
  workgroup,
  workgroupJoinRequest,
  workgroupMember,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId, generateShortId } from '@sim/utils/id'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  max,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import type { PublicationSummary } from '@/lib/api/contracts/collaboration'
import { ORGANIZATION_BILLING_LIFECYCLE_EVENTS } from '@/lib/billing/billing-lifecycle-audit'
import { canPublishTeamCanvas, canReadPublication } from '@/lib/collaboration/authz'
import {
  AGENT_PROFILES,
  DISCIPLINES,
  getAgentProfile,
  isAgentCode,
  workspacePermissionForWorkgroupRole,
} from '@/lib/collaboration/definitions'
import { enqueuePublicationNotificationDelivery } from '@/lib/collaboration/notification-outbox'
import {
  buildPublicationDependencyConflictAlerts,
  buildPublicationNotificationDeliveryDrafts,
  buildPublicationReviewNotifications,
  buildPublicationStateGroups,
} from '@/lib/collaboration/publication-state-tree'
import { sanitizeWorkflowSnapshot } from '@/lib/collaboration/snapshot-sanitizer'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import {
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/persistence/utils'

const logger = createLogger('Collaboration')

export type OrganizationRole = 'owner' | 'admin' | 'member' | null
export type WorkgroupRole = 'admin' | 'member'
export type PublicationStatus = 'draft' | 'published' | 'superseded' | 'archived' | 'retracted'
export type PublicationReviewState =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'changes_requested'
  | 'rejected'
export type PublicationRiskLevel = 'low' | 'medium' | 'high' | 'critical'

function formatPublicationReviewer(publication: {
  reviewerUserId: string | null
  reviewerAssignedBy: string | null
  reviewerAssignedAt: Date | null
}) {
  if (!publication.reviewerUserId) return null
  return {
    userId: publication.reviewerUserId,
    assignedBy: publication.reviewerAssignedBy,
    assignedAt: publication.reviewerAssignedAt?.toISOString() ?? null,
  }
}

type PublicationVisibility = 'organization' | 'selected_workgroups'
type PublicationNotificationChannel = 'in_app' | 'email' | 'webhook'
type PublicationNotificationDeliveryStatus = 'queued' | 'skipped'
const PUBLICATION_REVIEW_NOTIFICATION_EVENT = 'publication.review_notifications.digest'
type WorkgroupMemberTarget = {
  userId?: string
  email?: string
}
type PublicationAuditAction =
  | typeof AuditAction.PUBLICATION_CREATED
  | typeof AuditAction.PUBLICATION_UPDATED
  | typeof AuditAction.PUBLICATION_ARCHIVED
  | typeof AuditAction.PUBLICATION_RETRACTED
  | typeof AuditAction.PUBLICATION_RESTORED
const PUBLICATION_GOVERNANCE_AUDIT_ACTIONS = [
  AuditAction.PUBLICATION_CREATED,
  AuditAction.PUBLICATION_UPDATED,
  AuditAction.PUBLICATION_ARCHIVED,
  AuditAction.PUBLICATION_RETRACTED,
  AuditAction.PUBLICATION_RESTORED,
] as const
type ProductionTaskAuditAction =
  | typeof AuditAction.PRODUCTION_TASK_CREATED
  | typeof AuditAction.PRODUCTION_TASK_UPDATED
  | typeof AuditAction.PRODUCTION_TASK_SUBMITTED
  | typeof AuditAction.PRODUCTION_TASK_APPROVED
  | typeof AuditAction.PRODUCTION_TASK_CHANGES_REQUESTED
  | typeof AuditAction.PRODUCTION_TASK_MESSAGE_CREATED
  | typeof AuditAction.PRODUCTION_TASK_DDL_REMINDER

type ProductionProjectStatus = 'active' | 'completed'
type ProductionProjectPhaseStatus = 'active' | 'completed'

interface ProductionProjectPhase {
  id: string
  name: string
  dueAt: string | null
  status: ProductionProjectPhaseStatus
}

interface ProductionProjectPhaseInput {
  id?: string | null
  name: string
  dueAt?: string | null
  status?: ProductionProjectPhaseStatus
}

interface ProductionProjectMetadata {
  estimatedDueAt: string | null
  phases: ProductionProjectPhase[]
  productionProject: boolean
  projectStatus: ProductionProjectStatus
}

interface ProductionProjectTaskStats {
  completed: number
  total: number
  unfinished: number
}

const COMPLETED_PRODUCTION_TASK_STATUSES = new Set(['approved', 'archived'])
const DEFAULT_PRODUCTION_PROJECT_METADATA: ProductionProjectMetadata = {
  estimatedDueAt: null,
  phases: [],
  productionProject: false,
  projectStatus: 'active',
}
const PRODUCTION_TASK_AUDIT_ACTIONS = [
  AuditAction.PRODUCTION_TASK_CREATED,
  AuditAction.PRODUCTION_TASK_UPDATED,
  AuditAction.PRODUCTION_TASK_SUBMITTED,
  AuditAction.PRODUCTION_TASK_APPROVED,
  AuditAction.PRODUCTION_TASK_CHANGES_REQUESTED,
  AuditAction.PRODUCTION_TASK_MESSAGE_CREATED,
  AuditAction.PRODUCTION_TASK_DDL_REMINDER,
] as const
type MemberManagementAuditAction =
  | typeof AuditAction.MEMBER_INVITED
  | typeof AuditAction.MEMBER_BATCH_ASSIGNED
  | typeof AuditAction.MEMBER_ROLE_CHANGED
  | typeof AuditAction.MEMBER_REMOVED
const MEMBER_MANAGEMENT_AUDIT_ACTIONS = [
  AuditAction.MEMBER_INVITED,
  AuditAction.MEMBER_BATCH_ASSIGNED,
  AuditAction.MEMBER_ROLE_CHANGED,
  AuditAction.MEMBER_REMOVED,
] as const
type DataDrainAuditAction =
  | typeof AuditAction.DATA_DRAIN_CREATED
  | typeof AuditAction.DATA_DRAIN_UPDATED
  | typeof AuditAction.DATA_DRAIN_DELETED
  | typeof AuditAction.DATA_DRAIN_RAN
  | typeof AuditAction.DATA_DRAIN_TESTED
const DATA_DRAIN_AUDIT_ACTIONS = [
  AuditAction.DATA_DRAIN_CREATED,
  AuditAction.DATA_DRAIN_UPDATED,
  AuditAction.DATA_DRAIN_DELETED,
  AuditAction.DATA_DRAIN_RAN,
  AuditAction.DATA_DRAIN_TESTED,
] as const
type OrganizationManagementAuditAction =
  | typeof AuditAction.ORG_MEMBER_ADDED
  | typeof AuditAction.ORG_MEMBER_REMOVED
  | typeof AuditAction.ORG_MEMBER_ROLE_CHANGED
  | typeof AuditAction.ORG_INVITATION_CREATED
  | typeof AuditAction.ORG_INVITATION_UPDATED
  | typeof AuditAction.ORG_INVITATION_ACCEPTED
  | typeof AuditAction.ORG_INVITATION_REJECTED
  | typeof AuditAction.ORG_INVITATION_CANCELLED
  | typeof AuditAction.ORG_INVITATION_REVOKED
  | typeof AuditAction.ORG_INVITATION_RESENT
const ORGANIZATION_MANAGEMENT_AUDIT_ACTIONS = [
  AuditAction.ORG_MEMBER_ADDED,
  AuditAction.ORG_MEMBER_REMOVED,
  AuditAction.ORG_MEMBER_ROLE_CHANGED,
  AuditAction.ORG_INVITATION_CREATED,
  AuditAction.ORG_INVITATION_UPDATED,
  AuditAction.ORG_INVITATION_ACCEPTED,
  AuditAction.ORG_INVITATION_REJECTED,
  AuditAction.ORG_INVITATION_CANCELLED,
  AuditAction.ORG_INVITATION_REVOKED,
  AuditAction.ORG_INVITATION_RESENT,
] as const
const DATA_RETENTION_AUDIT_EVENT = 'data_retention.settings_updated'
const ORGANIZATION_SETTINGS_EVENTS = [
  'organization.settings_updated',
  'organization.whitelabel_updated',
  'organization.security_sso_configured',
] as const
const BILLING_MANAGEMENT_EVENTS = [
  'organization.seats_updated',
  'organization.plan_switched',
  'organization.credits_purchased',
  ...ORGANIZATION_BILLING_LIFECYCLE_EVENTS,
] as const
const CLEANUP_EXECUTION_AUDIT_EVENT = 'cleanup.execution_completed'
const PROJECT_ADMIN_FAILURE_RETENTION_CLEANUP_JOB_TYPE = 'project_admin_failure_audit_retention'
type OrganizationSettingsEvent = (typeof ORGANIZATION_SETTINGS_EVENTS)[number]
type BillingManagementEvent = (typeof BILLING_MANAGEMENT_EVENTS)[number]

interface PublicationBroadcastParams {
  actorUserId: string
  action: PublicationAuditAction
  event:
    | 'published'
    | 'content_synced'
    | 'details_updated'
    | 'visibility_updated'
    | 'archived'
    | 'retracted'
    | 'restored'
  publicationVersionId: string
  title: string
  organizationId: string
  sourceWorkgroupId: string
  sourceWorkflowId: string
  publishedWorkflowId: string | null
  visibility: PublicationVisibility
  targetWorkgroupIds?: string[]
}

export interface PublicationNotificationDeliveryResult {
  channel: PublicationNotificationChannel
  status: PublicationNotificationDeliveryStatus
  title: string
  detail: string
  body: string
  notificationCount: number
  dangerCount: number
  warningCount: number
  publicationIds: string[]
  outboxEventId: string | null
}

export interface PublicationNotificationInboxEntry {
  id: string
  channel: PublicationNotificationChannel
  title: string
  detail: string
  body: string
  notificationCount: number
  dangerCount: number
  warningCount: number
  publicationIds: string[]
  outboxEventId: string | null
  actorName: string | null
  actorEmail: string | null
  createdAt: string
  readAt: string | null
}

type ProjectNotificationCenterKind =
  | 'publication_review'
  | 'project_admin_failure'
  | 'publication_governance'
  | 'member_management'
  | 'team_management'
  | 'agent_policy'
  | 'retention_policy'
  | 'data_drain'
  | 'organization_management'
  | 'organization_settings'
  | 'billing_management'
  | 'cleanup_execution'
  | 'production_task'

export interface ProjectNotificationCenterEntry {
  id: string
  kind: ProjectNotificationCenterKind
  severity: 'info' | 'warning' | 'danger'
  title: string
  detail: string
  channel: PublicationNotificationChannel | null
  body: string | null
  notificationCount: number
  actorName: string | null
  actorEmail: string | null
  createdAt: string
  readAt: string | null
}

export interface ProjectAdminFailureAuditResult {
  id: string
  scope: ProjectAdminFailureScope
  operation: string
  target: string
  message: string
  recordedAt: string
}

export interface ProjectAdminFailureCleanupResult {
  retentionHours: number
  cutoff: string
  dryRun: boolean
  matchedCount: number
  deletedCount: number
}

type ProjectAdminFailureScope =
  | 'team'
  | 'agent'
  | 'publication'
  | 'member'
  | 'activity'
  | 'notification'

function toSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || `team-${generateShortId(8)}`
}

function getObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function normalizeProductionProjectPhases(value: unknown): ProductionProjectPhase[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, 24)
    .map((item, index) => {
      const phase = getObjectRecord(item)
      const name = typeof phase.name === 'string' ? phase.name.trim() : ''
      if (!name) return null
      const id =
        typeof phase.id === 'string' && phase.id.trim() ? phase.id.trim() : `phase-${index}`
      const dueAt = typeof phase.dueAt === 'string' && phase.dueAt.trim() ? phase.dueAt : null
      const status = phase.status === 'completed' ? 'completed' : 'active'
      return { id, name, dueAt, status }
    })
    .filter((phase): phase is ProductionProjectPhase => Boolean(phase))
}

function normalizeProductionProjectPhaseUpdates(
  phases: ProductionProjectPhaseInput[]
): ProductionProjectPhase[] {
  return phases
    .slice(0, 24)
    .map((phase) => {
      const name = phase.name.trim()
      if (!name) return null
      return {
        id: phase.id?.trim() || generateShortId(10),
        name,
        dueAt: phase.dueAt ?? null,
        status: phase.status === 'completed' ? 'completed' : 'active',
      }
    })
    .filter((phase): phase is ProductionProjectPhase => Boolean(phase))
}

function readProductionProjectMetadata(value: unknown): ProductionProjectMetadata {
  const metadata = getObjectRecord(value)
  const projectStatus = metadata.projectStatus === 'completed' ? 'completed' : 'active'
  const estimatedDueAt =
    typeof metadata.estimatedDueAt === 'string' && metadata.estimatedDueAt.trim()
      ? metadata.estimatedDueAt
      : null
  return {
    estimatedDueAt,
    phases: normalizeProductionProjectPhases(metadata.phases),
    productionProject: metadata.productionProject === true,
    projectStatus,
  }
}

function writeProductionProjectMetadata(
  current: unknown,
  updates: Partial<Omit<ProductionProjectMetadata, 'phases'>> & {
    phases?: ProductionProjectPhaseInput[]
  }
) {
  const next = { ...getObjectRecord(current) }
  next.productionProject = updates.productionProject ?? true
  if (updates.projectStatus) next.projectStatus = updates.projectStatus
  if (updates.estimatedDueAt !== undefined) next.estimatedDueAt = updates.estimatedDueAt
  if (updates.phases !== undefined) {
    next.phases = normalizeProductionProjectPhaseUpdates(updates.phases)
  }
  return next
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

async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId)).limit(1)
  return row?.role === 'admin'
}

async function hasProjectAdminWorkgroupMembership(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: workgroupMember.id })
    .from(workgroupMember)
    .innerJoin(workgroup, eq(workgroupMember.workgroupId, workgroup.id))
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(
      and(
        eq(workgroupMember.userId, userId),
        eq(workgroupMember.organizationId, organizationId),
        eq(workgroupMember.role, 'admin'),
        isNull(workgroup.archivedAt),
        or(
          eq(discipline.agentCode, 'chief_director'),
          eq(discipline.agentCode, 'show_director'),
          eq(discipline.code, 'pmo')
        )
      )
    )
    .limit(1)

  return Boolean(row)
}

async function canOverrideWorkgroupAdmin(userId: string, organizationId: string): Promise<boolean> {
  if (await isPlatformAdmin(userId)) return true
  const orgRole = await getOrganizationRole(userId, organizationId)
  return orgRole === 'owner' || orgRole === 'admin'
}

async function canCreateProductionProject(actorUserId: string): Promise<boolean> {
  if (await isPlatformAdmin(actorUserId)) return true

  const [organizationAdminRow] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, actorUserId), inArray(member.role, ['owner', 'admin'])))
    .limit(1)
  if (organizationAdminRow) return true

  const [projectAdminRow] = await db
    .select({ id: workgroupMember.id })
    .from(workgroupMember)
    .innerJoin(workgroup, eq(workgroupMember.workgroupId, workgroup.id))
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(
      and(
        eq(workgroupMember.userId, actorUserId),
        eq(workgroupMember.role, 'admin'),
        isNull(workgroup.archivedAt),
        or(
          eq(discipline.agentCode, 'chief_director'),
          eq(discipline.agentCode, 'show_director'),
          eq(discipline.code, 'pmo')
        )
      )
    )
    .limit(1)

  return Boolean(projectAdminRow)
}

export async function assertOrganizationAdmin(
  userId: string,
  organizationId: string
): Promise<void> {
  const role = await getOrganizationRole(userId, organizationId)
  if (role === 'owner' || role === 'admin') return
  if (await isPlatformAdmin(userId)) return
  if (await hasProjectAdminWorkgroupMembership(userId, organizationId)) return
  throw new Error('Organization admin access required')
}

async function hasOrganizationWorkgroupMembership(userId: string, organizationId: string) {
  const [row] = await db
    .select({ id: workgroupMember.id })
    .from(workgroupMember)
    .innerJoin(workgroup, eq(workgroupMember.workgroupId, workgroup.id))
    .where(
      and(
        eq(workgroupMember.userId, userId),
        eq(workgroupMember.organizationId, organizationId),
        isNull(workgroup.archivedAt)
      )
    )
    .limit(1)

  return Boolean(row)
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
    .innerJoin(workgroup, eq(workgroupMember.workgroupId, workgroup.id))
    .where(
      and(
        eq(workgroupMember.userId, userId),
        eq(workgroupMember.workgroupId, workgroupId),
        isNull(workgroup.archivedAt)
      )
    )
    .limit(1)

  return row ?? null
}

async function getWorkgroupOrganizationId(workgroupId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: workgroup.organizationId })
    .from(workgroup)
    .where(and(eq(workgroup.id, workgroupId), isNull(workgroup.archivedAt)))
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

function formatOrganizationAgentTemplate(
  profile: (typeof AGENT_PROFILES)[keyof typeof AGENT_PROFILES],
  disciplineCodes: string[],
  template?: { projectInstructions: string; updatedAt: Date } | null
) {
  return {
    ...profile,
    disciplineCodes,
    projectInstructions: template?.projectInstructions ?? '',
    updatedAt: template?.updatedAt.toISOString() ?? null,
  }
}

export async function listOrganizationAgentTemplates(params: {
  userId: string
  organizationId: string
}) {
  await assertOrganizationAdmin(params.userId, params.organizationId)
  const [disciplineRows, templateRows] = await Promise.all([
    listDisciplines(),
    db
      .select({
        agentCode: organizationAgentTemplate.agentCode,
        projectInstructions: organizationAgentTemplate.projectInstructions,
        updatedAt: organizationAgentTemplate.updatedAt,
      })
      .from(organizationAgentTemplate)
      .where(eq(organizationAgentTemplate.organizationId, params.organizationId)),
  ])
  const templateByAgent = new Map(templateRows.map((row) => [row.agentCode, row]))

  return Object.values(AGENT_PROFILES).map((profile) =>
    formatOrganizationAgentTemplate(
      profile,
      disciplineRows.filter((item) => item.agentCode === profile.code).map((item) => item.code),
      templateByAgent.get(profile.code)
    )
  )
}

export async function updateOrganizationAgentTemplate(params: {
  actorUserId: string
  organizationId: string
  agentCode: string
  projectInstructions: string
}) {
  await assertOrganizationAdmin(params.actorUserId, params.organizationId)
  if (!isAgentCode(params.agentCode)) throw new Error('Agent template not found')

  const now = new Date()
  const templateId = generateId()
  const projectInstructions = params.projectInstructions.trim()
  await db
    .insert(organizationAgentTemplate)
    .values({
      id: templateId,
      organizationId: params.organizationId,
      agentCode: params.agentCode,
      projectInstructions,
      updatedBy: params.actorUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [organizationAgentTemplate.organizationId, organizationAgentTemplate.agentCode],
      set: { projectInstructions, updatedBy: params.actorUserId, updatedAt: now },
    })

  recordAudit({
    actorId: params.actorUserId,
    action: AuditAction.AGENT_TEMPLATE_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: params.organizationId,
    resourceName: getAgentProfile(params.agentCode).name,
    description: projectInstructions
      ? `Updated project instructions for ${getAgentProfile(params.agentCode).name}`
      : `Cleared project instructions for ${getAgentProfile(params.agentCode).name}`,
    metadata: {
      organizationId: params.organizationId,
      agentCode: params.agentCode,
      hasProjectInstructions: Boolean(projectInstructions),
    },
  })

  return formatOrganizationAgentTemplate(
    getAgentProfile(params.agentCode),
    (await listDisciplines())
      .filter((item) => item.agentCode === params.agentCode)
      .map((item) => item.code),
    { projectInstructions, updatedAt: now }
  )
}

export async function listOrganizationAgentSkillPolicies(params: {
  userId: string
  organizationId: string
  agentCode?: string
}) {
  await assertOrganizationAdmin(params.userId, params.organizationId)
  if (params.agentCode && !isAgentCode(params.agentCode)) throw new Error('Agent not found')

  const rows = await db
    .select({
      workgroupId: workgroup.id,
      workgroupName: workgroup.name,
      teamWorkspaceId: workgroup.teamWorkspaceId,
      disciplineAgentCode: discipline.agentCode,
      skillId: skill.id,
      name: skill.name,
      description: skill.description,
    })
    .from(workgroup)
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .innerJoin(skill, eq(skill.workspaceId, workgroup.teamWorkspaceId))
    .where(and(eq(workgroup.organizationId, params.organizationId), isNull(workgroup.archivedAt)))
    .orderBy(asc(workgroup.name), asc(skill.name))

  const filteredRows = rows.filter(
    (row) => !params.agentCode || (row.disciplineAgentCode ?? 'chief_director') === params.agentCode
  )
  const skillIds = Array.from(new Set(filteredRows.map((row) => row.skillId)))
  const agentCodes = Array.from(
    new Set(filteredRows.map((row) => row.disciplineAgentCode ?? 'chief_director'))
  )
  const bindingRows =
    skillIds.length > 0 && agentCodes.length > 0
      ? await db
          .select({
            id: agentSkillBinding.id,
            agentCode: agentSkillBinding.agentCode,
            skillId: agentSkillBinding.skillId,
            enabled: agentSkillBinding.enabled,
          })
          .from(agentSkillBinding)
          .where(
            and(
              eq(agentSkillBinding.organizationId, params.organizationId),
              eq(agentSkillBinding.scope, 'agent_template'),
              isNull(agentSkillBinding.workgroupId),
              inArray(agentSkillBinding.skillId, skillIds),
              inArray(agentSkillBinding.agentCode, agentCodes)
            )
          )
      : []
  const bindingByAgentSkill = new Map(
    bindingRows.map((row) => [`${row.agentCode}:${row.skillId}`, row])
  )

  return filteredRows.map((row) => {
    const agentCode = row.disciplineAgentCode ?? 'chief_director'
    const binding = bindingByAgentSkill.get(`${agentCode}:${row.skillId}`)
    return {
      id: binding?.id ?? null,
      agentCode,
      skillId: row.skillId,
      name: row.name,
      description: row.description,
      enabled: binding?.enabled ?? true,
      scope: 'agent_template' as const,
      sourceWorkgroup: { id: row.workgroupId, name: row.workgroupName },
      teamWorkspaceId: row.teamWorkspaceId ?? '',
    }
  })
}

export async function updateOrganizationAgentSkillPolicy(params: {
  actorUserId: string
  organizationId: string
  agentCode: string
  skillId: string
  enabled: boolean
}) {
  await assertOrganizationAdmin(params.actorUserId, params.organizationId)
  if (!isAgentCode(params.agentCode)) throw new Error('Agent not found')

  const [skillRow] = await db
    .select({
      workgroupId: workgroup.id,
      workgroupName: workgroup.name,
      teamWorkspaceId: workgroup.teamWorkspaceId,
      disciplineAgentCode: discipline.agentCode,
      skillId: skill.id,
      name: skill.name,
      description: skill.description,
    })
    .from(workgroup)
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .innerJoin(skill, eq(skill.workspaceId, workgroup.teamWorkspaceId))
    .where(
      and(
        eq(workgroup.organizationId, params.organizationId),
        isNull(workgroup.archivedAt),
        eq(skill.id, params.skillId)
      )
    )
    .limit(1)
  if (!skillRow) throw new Error('Skill not found')
  const skillAgentCode = skillRow.disciplineAgentCode ?? 'chief_director'
  if (skillAgentCode !== params.agentCode) throw new Error('Skill does not belong to this Agent')

  const now = new Date()
  const [existingBinding] = await db
    .select({ id: agentSkillBinding.id })
    .from(agentSkillBinding)
    .where(
      and(
        eq(agentSkillBinding.organizationId, params.organizationId),
        eq(agentSkillBinding.agentCode, params.agentCode),
        eq(agentSkillBinding.skillId, params.skillId),
        eq(agentSkillBinding.scope, 'agent_template'),
        isNull(agentSkillBinding.workgroupId)
      )
    )
    .limit(1)
  const bindingId = existingBinding?.id ?? generateId()

  if (existingBinding) {
    await db
      .update(agentSkillBinding)
      .set({ enabled: params.enabled, updatedAt: now })
      .where(
        and(
          eq(agentSkillBinding.organizationId, params.organizationId),
          eq(agentSkillBinding.agentCode, params.agentCode),
          eq(agentSkillBinding.skillId, params.skillId),
          eq(agentSkillBinding.scope, 'agent_template'),
          isNull(agentSkillBinding.workgroupId)
        )
      )
  } else {
    await db.insert(agentSkillBinding).values({
      id: bindingId,
      organizationId: params.organizationId,
      agentCode: params.agentCode,
      workgroupId: null,
      skillId: params.skillId,
      enabled: params.enabled,
      scope: 'agent_template',
      createdAt: now,
      updatedAt: now,
    })
  }

  recordAudit({
    actorId: params.actorUserId,
    action: AuditAction.SKILL_UPDATED,
    resourceType: AuditResourceType.SKILL,
    resourceId: params.skillId,
    resourceName: skillRow.name,
    description: params.enabled
      ? `Enabled by default for ${getAgentProfile(params.agentCode).name}`
      : `Disabled by default for ${getAgentProfile(params.agentCode).name}`,
    metadata: {
      organizationId: params.organizationId,
      agentCode: params.agentCode,
      sourceWorkgroupId: skillRow.workgroupId,
      scope: 'agent_template',
      enabled: params.enabled,
    },
  })

  return {
    id: bindingId,
    agentCode: params.agentCode,
    skillId: skillRow.skillId,
    name: skillRow.name,
    description: skillRow.description,
    enabled: params.enabled,
    scope: 'agent_template' as const,
    sourceWorkgroup: { id: skillRow.workgroupId, name: skillRow.workgroupName },
    teamWorkspaceId: skillRow.teamWorkspaceId ?? '',
  }
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
      organizationName: organization.name,
      organizationLogo: organization.logo,
      organizationMetadata: organization.metadata,
      disciplineId: discipline.id,
      disciplineCode: discipline.code,
      disciplineName: discipline.name,
      agentCode: discipline.agentCode,
      role: workgroupMember.role,
      teamWorkspaceId: workgroup.teamWorkspaceId,
    })
    .from(workgroupMember)
    .innerJoin(workgroup, eq(workgroupMember.workgroupId, workgroup.id))
    .innerJoin(organization, eq(workgroup.organizationId, organization.id))
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(and(eq(workgroupMember.userId, userId), isNull(workgroup.archivedAt)))
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
  const organizationIds = [...new Set(rows.map((row) => row.organizationId))]
  const [actorIsPlatformAdmin, organizationRoleRows, taskStatRows] = await Promise.all([
    isPlatformAdmin(userId),
    organizationIds.length
      ? db
          .select({ organizationId: member.organizationId, role: member.role })
          .from(member)
          .where(and(eq(member.userId, userId), inArray(member.organizationId, organizationIds)))
      : [],
    organizationIds.length
      ? db
          .select({
            organizationId: productionTask.organizationId,
            status: productionTask.status,
            count: sql<number>`count(*)::int`,
          })
          .from(productionTask)
          .where(inArray(productionTask.organizationId, organizationIds))
          .groupBy(productionTask.organizationId, productionTask.status)
      : [],
  ])
  const organizationRoles = new Map(
    organizationRoleRows.map((row) => [row.organizationId, row.role])
  )
  const projectAdminOrganizationIds = new Set(
    rows
      .filter(
        (row) =>
          row.role === 'admin' &&
          (['chief_director', 'show_director'].includes(row.agentCode ?? 'chief_director') ||
            row.disciplineCode === 'pmo')
      )
      .map((row) => row.organizationId)
  )
  const taskStatsByOrganization = new Map<string, ProductionProjectTaskStats>()
  for (const row of taskStatRows) {
    const current = taskStatsByOrganization.get(row.organizationId) ?? {
      completed: 0,
      total: 0,
      unfinished: 0,
    }
    current.total += row.count
    if (COMPLETED_PRODUCTION_TASK_STATUSES.has(row.status)) {
      current.completed += row.count
    } else {
      current.unfinished += row.count
    }
    taskStatsByOrganization.set(row.organizationId, current)
  }

  return rows.map((row) => {
    const projectMetadata = readProductionProjectMetadata(row.organizationMetadata)
    return {
      id: row.workgroupId,
      name: row.workgroupName,
      organizationId: row.organizationId,
      organization: {
        id: row.organizationId,
        name: row.organizationName,
        logo: row.organizationLogo,
        projectStatus: projectMetadata.projectStatus,
        estimatedDueAt: projectMetadata.estimatedDueAt,
        phases: projectMetadata.phases,
        canManageProject:
          actorIsPlatformAdmin ||
          ['owner', 'admin'].includes(organizationRoles.get(row.organizationId) ?? '') ||
          projectAdminOrganizationIds.has(row.organizationId),
        taskStats: taskStatsByOrganization.get(row.organizationId) ?? {
          completed: 0,
          total: 0,
          unfinished: 0,
        },
      },
      discipline: {
        id: row.disciplineId ?? '',
        code: row.disciplineCode ?? 'chief_director',
        name: row.disciplineName ?? '总导演',
        agentCode: row.agentCode ?? 'chief_director',
      },
      role: row.role,
      teamWorkspaceId: row.teamWorkspaceId ?? '',
      memberCount: counts.get(row.workgroupId) ?? 0,
    }
  })
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
  teamCanvasName?: string
  actorUserId: string
}) {
  await assertOrganizationAdmin(params.actorUserId, params.organizationId)
  const disciplineRow = await getDisciplineById(params.disciplineId)
  if (!disciplineRow) throw new Error('Discipline not found')

  const now = new Date()
  const workgroupId = generateId()
  const slug = `${toSlug(params.name)}-${generateShortId(6)}`
  const teamWorkspaceId = generateId()
  const requestedCanvasName = params.teamCanvasName?.trim()
  const teamCanvasName = requestedCanvasName || `${params.name} 团队画布`
  const defaultWorkflowName = requestedCanvasName || 'Team canvas'

  await db.transaction(async (tx) => {
    await tx.insert(workgroup).values({
      id: workgroupId,
      organizationId: params.organizationId,
      name: params.name,
      slug,
      disciplineId: params.disciplineId,
      createdAt: now,
      updatedAt: now,
    })

    await tx.insert(workspace).values({
      id: teamWorkspaceId,
      name: teamCanvasName,
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

    await tx
      .update(workgroup)
      .set({ teamWorkspaceId, updatedAt: now })
      .where(eq(workgroup.id, workgroupId))

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
  await createDefaultWorkflowForWorkspace({
    userId: params.actorUserId,
    workspaceId: teamWorkspaceId,
    name: defaultWorkflowName,
    description: `Default node graph for ${params.name}`,
  })

  return { id: workgroupId, name: params.name, disciplineId: params.disciplineId, teamWorkspaceId }
}

export async function createProductionProject(params: {
  actorUserId: string
  estimatedDueAt?: string | null
  phases?: ProductionProjectPhaseInput[]
  name: string
}) {
  if (!(await canCreateProductionProject(params.actorUserId))) {
    throw new Error('Project creation admin access required')
  }

  const now = new Date()
  const organizationId = generateId()
  const workgroupId = generateId()
  const teamWorkspaceId = generateId()
  const directorDiscipline =
    (await getDisciplineById('discipline_chief_director')) ??
    DISCIPLINES.find((item) => item.code === 'chief_director')
  const workgroupName = '导演组'
  const projectMetadata = writeProductionProjectMetadata(DEFAULT_PRODUCTION_PROJECT_METADATA, {
    estimatedDueAt: params.estimatedDueAt ?? null,
    phases: params.phases ?? [],
    productionProject: true,
    projectStatus: 'active',
  })
  const readableProjectMetadata = readProductionProjectMetadata(projectMetadata)

  if (!directorDiscipline) throw new Error('Director discipline not found')

  await db.transaction(async (tx) => {
    await tx.insert(organization).values({
      id: organizationId,
      name: params.name,
      slug: `${toSlug(params.name)}-${generateShortId(6)}`,
      metadata: projectMetadata,
      createdAt: now,
      updatedAt: now,
    })

    await tx.insert(workgroup).values({
      id: workgroupId,
      organizationId,
      name: workgroupName,
      slug: `${toSlug(workgroupName)}-${generateShortId(6)}`,
      disciplineId: directorDiscipline.id,
      createdAt: now,
      updatedAt: now,
    })

    await tx.insert(workspace).values({
      id: teamWorkspaceId,
      name: `${params.name} / ${workgroupName} 团队画布`,
      color: '#33C482',
      ownerId: params.actorUserId,
      organizationId,
      workgroupId,
      workspaceMode: 'organization',
      billedAccountUserId: params.actorUserId,
      allowPersonalApiKeys: true,
      createdAt: now,
      updatedAt: now,
    })

    await tx
      .update(workgroup)
      .set({ teamWorkspaceId, updatedAt: now })
      .where(eq(workgroup.id, workgroupId))

    await tx.insert(workgroupMember).values({
      id: generateId(),
      organizationId,
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

  await createDefaultWorkflowForWorkspace({
    userId: params.actorUserId,
    workspaceId: teamWorkspaceId,
    name: '团队画布',
    description: `${params.name} 的默认团队画布`,
  })

  recordAudit({
    workspaceId: teamWorkspaceId,
    actorId: params.actorUserId,
    action: AuditAction.ORGANIZATION_CREATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: organizationId,
    resourceName: params.name,
    description: `Created production project "${params.name}"`,
    metadata: {
      organizationId,
      workgroupId,
      teamWorkspaceId,
      estimatedDueAt: readableProjectMetadata.estimatedDueAt,
      phaseCount: readableProjectMetadata.phases.length,
    },
  })

  return {
    organizationId,
    name: params.name,
    status: 'active' as const,
    estimatedDueAt: readableProjectMetadata.estimatedDueAt,
    phases: readableProjectMetadata.phases,
    primaryWorkgroupId: workgroupId,
    teamWorkspaceId,
  }
}

export async function updateProductionProject(params: {
  actorUserId: string
  estimatedDueAt?: string | null
  organizationId: string
  phases?: ProductionProjectPhaseInput[]
  status?: ProductionProjectStatus
}) {
  await assertOrganizationAdmin(params.actorUserId, params.organizationId)
  const [row] = await db
    .select({
      id: organization.id,
      name: organization.name,
      metadata: organization.metadata,
    })
    .from(organization)
    .where(eq(organization.id, params.organizationId))
    .limit(1)

  if (!row) throw new Error('Project not found')

  const nextMetadata = writeProductionProjectMetadata(row.metadata, {
    estimatedDueAt: params.estimatedDueAt,
    phases: params.phases,
    projectStatus: params.status,
  })

  await db
    .update(organization)
    .set({ metadata: nextMetadata, updatedAt: new Date() })
    .where(eq(organization.id, params.organizationId))

  const [primaryWorkgroup] = await db
    .select({
      id: workgroup.id,
      teamWorkspaceId: workgroup.teamWorkspaceId,
    })
    .from(workgroup)
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(
      and(
        eq(workgroup.organizationId, params.organizationId),
        isNull(workgroup.archivedAt),
        or(eq(discipline.agentCode, 'chief_director'), eq(discipline.code, 'pmo'))
      )
    )
    .orderBy(asc(workgroup.createdAt))
    .limit(1)

  const metadata = readProductionProjectMetadata(nextMetadata)
  return {
    organizationId: row.id,
    name: row.name,
    status: metadata.projectStatus,
    estimatedDueAt: metadata.estimatedDueAt,
    phases: metadata.phases,
    primaryWorkgroupId: primaryWorkgroup?.id ?? null,
    teamWorkspaceId: primaryWorkgroup?.teamWorkspaceId ?? null,
  }
}

export async function listOrganizationWorkgroups(params: {
  userId: string
  organizationId: string
}) {
  const orgRole = await getOrganizationRole(params.userId, params.organizationId)
  const isOrgAdmin = orgRole === 'owner' || orgRole === 'admin'
  const isProjectAdmin =
    isOrgAdmin ||
    (await isPlatformAdmin(params.userId)) ||
    (await hasProjectAdminWorkgroupMembership(params.userId, params.organizationId))
  const hasProjectAccess =
    isProjectAdmin ||
    Boolean(orgRole) ||
    (await hasOrganizationWorkgroupMembership(params.userId, params.organizationId))

  if (!hasProjectAccess) {
    throw new Error('Organization membership required')
  }

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
    .where(and(eq(workgroup.organizationId, params.organizationId), isNull(workgroup.archivedAt)))
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
    currentUserRole: isOrgAdmin ? 'org_admin' : isProjectAdmin ? 'project_admin' : row.memberRole,
  }))
}

export async function archiveWorkgroup(params: { actorUserId: string; workgroupId: string }) {
  const [row] = await db
    .select({
      id: workgroup.id,
      name: workgroup.name,
      organizationId: workgroup.organizationId,
      teamWorkspaceId: workgroup.teamWorkspaceId,
      archivedAt: workgroup.archivedAt,
    })
    .from(workgroup)
    .where(eq(workgroup.id, params.workgroupId))
    .limit(1)
  if (!row) throw new Error('Workgroup not found')

  await assertOrganizationAdmin(params.actorUserId, row.organizationId)
  const archivedAt = row.archivedAt ?? new Date()

  if (!row.archivedAt) {
    await db.transaction(async (tx) => {
      await tx
        .update(workgroup)
        .set({ archivedAt, updatedAt: archivedAt })
        .where(eq(workgroup.id, row.id))

      if (row.teamWorkspaceId) {
        await tx
          .update(workspace)
          .set({ archivedAt, updatedAt: archivedAt })
          .where(eq(workspace.id, row.teamWorkspaceId))
      }
    })

    recordAudit({
      workspaceId: row.teamWorkspaceId,
      actorId: params.actorUserId,
      action: AuditAction.WORKGROUP_ARCHIVED,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: row.id,
      resourceName: row.name,
      description: `Archived team ${row.name}`,
      metadata: {
        organizationId: row.organizationId,
        workgroupId: row.id,
        teamWorkspaceId: row.teamWorkspaceId,
        archivedAt: archivedAt.toISOString(),
      },
    })
  }

  return { id: row.id, name: row.name, archivedAt: archivedAt.toISOString() }
}

export async function getWorkgroupMembers(params: { userId: string; workgroupId: string }) {
  await assertWorkgroupAdmin(params.userId, params.workgroupId)
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.image,
      accountRole: user.role,
      role: workgroupMember.role,
      joinedAt: workgroupMember.createdAt,
    })
    .from(workgroupMember)
    .innerJoin(user, eq(workgroupMember.userId, user.id))
    .where(eq(workgroupMember.workgroupId, params.workgroupId))
    .orderBy(asc(user.name))

  return rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() }))
}

async function resolveWorkgroupMemberTargetUserId(params: {
  userId?: string
  email?: string
}): Promise<string> {
  if (params.userId) return params.userId
  const normalizedEmail = params.email?.trim().toLowerCase()
  if (!normalizedEmail) throw new Error('User ID or email is required')
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${normalizedEmail}`)
    .limit(1)
  if (!row?.id) throw new Error('User not found')
  return row.id
}

function getWorkgroupMemberTargetLabel(target: WorkgroupMemberTarget) {
  return target.email?.trim() || target.userId || ''
}

export async function addWorkgroupMember(params: {
  actorUserId: string
  workgroupId: string
  userId?: string
  email?: string
  role: WorkgroupRole
}) {
  await assertWorkgroupAdmin(params.actorUserId, params.workgroupId)
  const [wg] = await db
    .select()
    .from(workgroup)
    .where(eq(workgroup.id, params.workgroupId))
    .limit(1)
  if (!wg) throw new Error('Workgroup not found')
  const targetUserId = await resolveWorkgroupMemberTargetUserId(params)
  const now = new Date()
  await db
    .insert(workgroupMember)
    .values({
      id: generateId(),
      organizationId: wg.organizationId,
      workgroupId: wg.id,
      userId: targetUserId,
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
      userId: targetUserId,
      workspaceId: wg.teamWorkspaceId,
      permissionType: workspacePermissionForWorkgroupRole(params.role),
    })
  }
  recordAudit({
    workspaceId: wg.teamWorkspaceId,
    actorId: params.actorUserId,
    action: AuditAction.MEMBER_INVITED,
    resourceType: AuditResourceType.WORKSPACE,
    resourceId: wg.id,
    resourceName: wg.name,
    description: `Added team member as ${params.role}`,
    metadata: {
      organizationId: wg.organizationId,
      workgroupId: wg.id,
      targetUserId,
      role: params.role,
    },
  })
}

export async function addWorkgroupMembersBatch(params: {
  actorUserId: string
  workgroupId: string
  role: WorkgroupRole
  targets: WorkgroupMemberTarget[]
}) {
  await assertWorkgroupAdmin(params.actorUserId, params.workgroupId)
  const [wg] = await db
    .select()
    .from(workgroup)
    .where(eq(workgroup.id, params.workgroupId))
    .limit(1)
  if (!wg) throw new Error('Workgroup not found')

  const resolvedTargets = new Map<string, { target: string; userId: string; role: WorkgroupRole }>()
  for (const target of params.targets) {
    const targetUserId = await resolveWorkgroupMemberTargetUserId(target)
    if (!resolvedTargets.has(targetUserId)) {
      resolvedTargets.set(targetUserId, {
        target: getWorkgroupMemberTargetLabel(target),
        userId: targetUserId,
        role: params.role,
      })
    }
  }
  const assigned = Array.from(resolvedTargets.values())
  const now = new Date()
  const batchOperationId = generateShortId(12)

  await db.transaction(async (tx) => {
    for (const target of assigned) {
      await tx
        .insert(workgroupMember)
        .values({
          id: generateId(),
          organizationId: wg.organizationId,
          workgroupId: wg.id,
          userId: target.userId,
          role: params.role,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [workgroupMember.workgroupId, workgroupMember.userId],
          set: { role: params.role, updatedAt: now },
        })

      if (wg.teamWorkspaceId) {
        await tx
          .insert(permissions)
          .values({
            id: generateId(),
            userId: target.userId,
            entityType: 'workspace',
            entityId: wg.teamWorkspaceId,
            permissionType: workspacePermissionForWorkgroupRole(params.role),
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [permissions.userId, permissions.entityType, permissions.entityId],
            set: {
              permissionType: workspacePermissionForWorkgroupRole(params.role),
              updatedAt: now,
            },
          })
      }
    }
  })

  recordAudit({
    workspaceId: wg.teamWorkspaceId,
    actorId: params.actorUserId,
    action: AuditAction.MEMBER_BATCH_ASSIGNED,
    resourceType: AuditResourceType.WORKSPACE,
    resourceId: wg.id,
    resourceName: wg.name,
    description: `Batch assigned ${assigned.length} team member${assigned.length === 1 ? '' : 's'} as ${params.role}`,
    metadata: {
      organizationId: wg.organizationId,
      workgroupId: wg.id,
      role: params.role,
      targetCount: assigned.length,
      targetUserIds: assigned.map((target) => target.userId),
      batchOperationId,
    },
  })

  for (const target of assigned) {
    recordAudit({
      workspaceId: wg.teamWorkspaceId,
      actorId: params.actorUserId,
      action: AuditAction.MEMBER_INVITED,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: wg.id,
      resourceName: wg.name,
      description: `Batch added team member as ${params.role}`,
      metadata: {
        organizationId: wg.organizationId,
        workgroupId: wg.id,
        targetUserId: target.userId,
        role: params.role,
        batchOperationId,
      },
    })
  }

  return assigned
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
  const [targetMembership] = await db
    .select({ accountRole: user.role, role: workgroupMember.role })
    .from(workgroupMember)
    .innerJoin(user, eq(workgroupMember.userId, user.id))
    .where(
      and(
        eq(workgroupMember.workgroupId, params.workgroupId),
        eq(workgroupMember.userId, params.userId)
      )
    )
    .limit(1)
  if (!targetMembership) throw new Error('Workgroup member not found')
  if (
    targetMembership.role === 'admin' &&
    targetMembership.accountRole === 'admin' &&
    params.role !== 'admin'
  ) {
    throw new Error('Cannot demote a platform admin from team admin')
  }
  if (
    targetMembership.role === 'admin' &&
    params.role !== 'admin' &&
    !(await canOverrideWorkgroupAdmin(params.actorUserId, wg.organizationId))
  ) {
    throw new Error('Only project administrators can demote a team admin')
  }
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
  recordAudit({
    workspaceId: wg.teamWorkspaceId,
    actorId: params.actorUserId,
    action: AuditAction.MEMBER_ROLE_CHANGED,
    resourceType: AuditResourceType.WORKSPACE,
    resourceId: wg.id,
    resourceName: wg.name,
    description: `Changed team member role to ${params.role}`,
    metadata: {
      organizationId: wg.organizationId,
      workgroupId: wg.id,
      targetUserId: params.userId,
      role: params.role,
    },
  })
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
  if (params.actorUserId === params.userId) {
    throw new Error('Cannot remove yourself from a workgroup')
  }
  const [targetMembership] = await db
    .select({ accountRole: user.role, role: workgroupMember.role })
    .from(workgroupMember)
    .innerJoin(user, eq(workgroupMember.userId, user.id))
    .where(
      and(
        eq(workgroupMember.workgroupId, params.workgroupId),
        eq(workgroupMember.userId, params.userId)
      )
    )
    .limit(1)
  if (!targetMembership) throw new Error('Workgroup member not found')
  if (targetMembership.role === 'admin' && targetMembership.accountRole === 'admin') {
    throw new Error('Cannot remove a platform admin from team admin')
  }
  if (
    targetMembership.role === 'admin' &&
    !(await canOverrideWorkgroupAdmin(params.actorUserId, wg.organizationId))
  ) {
    throw new Error('Only project administrators can remove a team admin')
  }
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
  recordAudit({
    workspaceId: wg.teamWorkspaceId,
    actorId: params.actorUserId,
    action: AuditAction.MEMBER_REMOVED,
    resourceType: AuditResourceType.WORKSPACE,
    resourceId: wg.id,
    resourceName: wg.name,
    description: 'Removed team member',
    metadata: {
      organizationId: wg.organizationId,
      workgroupId: wg.id,
      targetUserId: params.userId,
    },
  })
}

type WorkgroupJoinRequestRow = typeof workgroupJoinRequest.$inferSelect

function formatWorkgroupJoinRequest(
  row: WorkgroupJoinRequestRow,
  requester: {
    id: string
    name: string | null
    email: string | null
    avatarUrl: string | null
  }
) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workgroupId: row.workgroupId,
    requesterUserId: row.requesterUserId,
    requester,
    role: row.role,
    message: row.message,
    status: row.status,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewNote: row.reviewNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function getJoinRequestRequester(userId: string) {
  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.image,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)

  return (
    row ?? {
      id: userId,
      name: null,
      email: null,
      avatarUrl: null,
    }
  )
}

async function getWorkgroupForJoinRequest(workgroupId: string) {
  const [row] = await db
    .select({
      id: workgroup.id,
      name: workgroup.name,
      organizationId: workgroup.organizationId,
      teamWorkspaceId: workgroup.teamWorkspaceId,
    })
    .from(workgroup)
    .where(and(eq(workgroup.id, workgroupId), isNull(workgroup.archivedAt)))
    .limit(1)

  if (!row) throw new Error('Workgroup not found')
  return row
}

export async function listWorkgroupJoinRequests(params: {
  actorUserId: string
  workgroupId: string
}) {
  await assertWorkgroupAdmin(params.actorUserId, params.workgroupId)
  const rows = await db
    .select({
      request: workgroupJoinRequest,
      requester: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.image,
      },
    })
    .from(workgroupJoinRequest)
    .innerJoin(user, eq(workgroupJoinRequest.requesterUserId, user.id))
    .where(
      and(
        eq(workgroupJoinRequest.workgroupId, params.workgroupId),
        eq(workgroupJoinRequest.status, 'pending')
      )
    )
    .orderBy(asc(workgroupJoinRequest.createdAt))

  return rows.map((row) => formatWorkgroupJoinRequest(row.request, row.requester))
}

export async function createWorkgroupJoinRequest(params: {
  actorUserId: string
  workgroupId: string
  message?: string
}) {
  const wg = await getWorkgroupForJoinRequest(params.workgroupId)
  const hasProjectAccess =
    Boolean(await getOrganizationRole(params.actorUserId, wg.organizationId)) ||
    (await hasOrganizationWorkgroupMembership(params.actorUserId, wg.organizationId))
  if (!hasProjectAccess) {
    throw new Error('Project membership required')
  }

  const existingMembership = await getWorkgroupMembership(params.actorUserId, params.workgroupId)
  if (existingMembership) {
    throw new Error('You are already a member of this team')
  }

  const now = new Date()
  const message = params.message?.trim() || null
  const [row] = await db
    .insert(workgroupJoinRequest)
    .values({
      id: generateId(),
      organizationId: wg.organizationId,
      workgroupId: wg.id,
      requesterUserId: params.actorUserId,
      role: 'member',
      message,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [workgroupJoinRequest.workgroupId, workgroupJoinRequest.requesterUserId],
      targetWhere: sql`${workgroupJoinRequest.status} = 'pending'`,
      set: {
        message,
        updatedAt: now,
      },
    })
    .returning()

  const requester = await getJoinRequestRequester(params.actorUserId)
  return formatWorkgroupJoinRequest(row, requester)
}

export async function reviewWorkgroupJoinRequest(params: {
  actorUserId: string
  workgroupId: string
  requestId: string
  action: 'approve' | 'reject'
  role: WorkgroupRole
  reviewNote?: string
}) {
  await assertWorkgroupAdmin(params.actorUserId, params.workgroupId)
  const wg = await getWorkgroupForJoinRequest(params.workgroupId)
  const [existing] = await db
    .select()
    .from(workgroupJoinRequest)
    .where(
      and(
        eq(workgroupJoinRequest.id, params.requestId),
        eq(workgroupJoinRequest.workgroupId, params.workgroupId)
      )
    )
    .limit(1)

  if (!existing) throw new Error('Join request not found')
  if (existing.status !== 'pending') throw new Error('Join request has already been reviewed')

  const now = new Date()
  const nextStatus = params.action === 'approve' ? 'approved' : 'rejected'

  await db.transaction(async (tx) => {
    if (params.action === 'approve') {
      await tx
        .insert(workgroupMember)
        .values({
          id: generateId(),
          organizationId: wg.organizationId,
          workgroupId: wg.id,
          userId: existing.requesterUserId,
          role: params.role,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [workgroupMember.workgroupId, workgroupMember.userId],
          set: { role: params.role, updatedAt: now },
        })

      if (wg.teamWorkspaceId) {
        await tx
          .insert(permissions)
          .values({
            id: generateId(),
            userId: existing.requesterUserId,
            entityType: 'workspace',
            entityId: wg.teamWorkspaceId,
            permissionType: workspacePermissionForWorkgroupRole(params.role),
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [permissions.userId, permissions.entityType, permissions.entityId],
            set: {
              permissionType: workspacePermissionForWorkgroupRole(params.role),
              updatedAt: now,
            },
          })
      }
    }

    await tx
      .update(workgroupJoinRequest)
      .set({
        status: nextStatus,
        role: params.role,
        reviewedBy: params.actorUserId,
        reviewedAt: now,
        reviewNote: params.reviewNote?.trim() || null,
        updatedAt: now,
      })
      .where(eq(workgroupJoinRequest.id, existing.id))
  })

  recordAudit({
    workspaceId: wg.teamWorkspaceId,
    actorId: params.actorUserId,
    action:
      params.action === 'approve' ? AuditAction.MEMBER_INVITED : AuditAction.INVITATION_REJECTED,
    resourceType: AuditResourceType.WORKSPACE,
    resourceId: wg.id,
    resourceName: wg.name,
    description:
      params.action === 'approve' ? 'Approved team join request' : 'Rejected team join request',
    metadata: {
      organizationId: wg.organizationId,
      workgroupId: wg.id,
      requestId: existing.id,
      requesterUserId: existing.requesterUserId,
      role: params.role,
      reviewNote: params.reviewNote?.trim() || null,
    },
  })

  const [updated] = await db
    .select()
    .from(workgroupJoinRequest)
    .where(eq(workgroupJoinRequest.id, existing.id))
    .limit(1)
  const requester = await getJoinRequestRequester(existing.requesterUserId)
  return formatWorkgroupJoinRequest(updated, requester)
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
  throw new Error('Team workspace not initialized')
}

export async function createTeamWorkspace(params: { userId: string; workgroupId: string }) {
  await assertWorkgroupAdmin(params.userId, params.workgroupId)
  const [wg] = await db
    .select()
    .from(workgroup)
    .where(eq(workgroup.id, params.workgroupId))
    .limit(1)
  if (!wg) throw new Error('Workgroup not found')
  if (wg.teamWorkspaceId) {
    const [existingWorkspace] = await db
      .select()
      .from(workspace)
      .where(eq(workspace.id, wg.teamWorkspaceId))
      .limit(1)
    if (existingWorkspace)
      return { workspace: workspaceDto(existingWorkspace), defaultWorkflowId: null }
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
  const defaultWorkflowId = await createDefaultWorkflowForWorkspace({
    userId: params.userId,
    workspaceId: ws.id,
    name: 'Team canvas',
    description: `Default node graph for ${wg.name}`,
  })
  recordAudit({
    workspaceId: ws.id,
    actorId: params.userId,
    action: AuditAction.WORKSPACE_CREATED,
    resourceType: AuditResourceType.WORKSPACE,
    resourceId: ws.id,
    resourceName: ws.name,
    description: 'Initialized team canvas',
    metadata: { organizationId: wg.organizationId, workgroupId: wg.id, canvasScope: 'team' },
  })
  return { workspace: workspaceDto(ws), defaultWorkflowId }
}

export async function listWorkgroupActivity(params: {
  userId: string
  workgroupId: string
  limit?: number
}) {
  await assertWorkgroupAdmin(params.userId, params.workgroupId)
  const [wg] = await db
    .select({ teamWorkspaceId: workgroup.teamWorkspaceId })
    .from(workgroup)
    .where(eq(workgroup.id, params.workgroupId))
    .limit(1)
  if (!wg) throw new Error('Workgroup not found')

  const scopeConditions = [
    sql`${auditLog.metadata}->>'workgroupId' = ${params.workgroupId}`,
    sql`${auditLog.metadata}->>'sourceWorkgroupId' = ${params.workgroupId}`,
  ]
  if (wg.teamWorkspaceId) {
    scopeConditions.push(eq(auditLog.workspaceId, wg.teamWorkspaceId))
  }

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      resourceName: auditLog.resourceName,
      description: auditLog.description,
      actorName: auditLog.actorName,
      actorEmail: auditLog.actorEmail,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(or(...scopeConditions))
    .orderBy(desc(auditLog.createdAt))
    .limit(params.limit ?? 10)

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }))
}

function parseActivityDateBoundary(value: string, boundary: 'start' | 'end') {
  const [year, month, day] = value.split('-').map(Number)
  if (boundary === 'start') return new Date(Date.UTC(year, month - 1, day))
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
}

function getAuditMetadataValue(metadata: unknown, keys: string[]) {
  if (!metadata || typeof metadata !== 'object') return null
  const record = metadata as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function getProjectAdminFailureMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') return null
  const record = metadata as Record<string, unknown>
  const scope = record.scope
  return {
    failureId: typeof record.failureId === 'string' ? record.failureId : null,
    scope:
      scope === 'team' ||
      scope === 'agent' ||
      scope === 'publication' ||
      scope === 'member' ||
      scope === 'activity' ||
      scope === 'notification'
        ? scope
        : null,
    operation: typeof record.operation === 'string' ? record.operation : null,
    target: typeof record.target === 'string' ? record.target : null,
    message: typeof record.message === 'string' ? record.message : null,
    recordedAt: typeof record.recordedAt === 'string' ? record.recordedAt : null,
  }
}

function isPublicationNotificationChannel(value: unknown): value is PublicationNotificationChannel {
  return value === 'in_app' || value === 'email' || value === 'webhook'
}

function normalizeEmailRecipients(recipients: string[] | undefined): string[] {
  const seen = new Set<string>()
  return (recipients ?? [])
    .map((recipient) => recipient.trim())
    .filter((recipient) => {
      const key = recipient.toLowerCase()
      if (!recipient || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function getMetadataString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function getMetadataNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function getMetadataStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function getPublicationNotificationReadAt(
  record: Record<string, unknown>,
  userId: string
): string | null {
  const readAtByUserId = record.readAtByUserId
  if (!readAtByUserId || typeof readAtByUserId !== 'object') return null
  const readAt = (readAtByUserId as Record<string, unknown>)[userId]
  return typeof readAt === 'string' && readAt.trim() ? readAt : null
}

function getPublicationNotificationInboxMetadata(metadata: unknown, userId: string) {
  if (!metadata || typeof metadata !== 'object') return null
  const record = metadata as Record<string, unknown>
  if (record.notificationEvent !== PUBLICATION_REVIEW_NOTIFICATION_EVENT) return null
  if (!isPublicationNotificationChannel(record.channel)) return null

  return {
    channel: record.channel,
    title: getMetadataString(record, 'title'),
    detail: getMetadataString(record, 'detail'),
    body: getMetadataString(record, 'body'),
    notificationCount: getMetadataNumber(record, 'notificationCount'),
    dangerCount: getMetadataNumber(record, 'dangerCount'),
    warningCount: getMetadataNumber(record, 'warningCount'),
    publicationIds: getMetadataStringArray(record, 'publicationIds'),
    outboxEventId: getMetadataString(record, 'outboxEventId'),
    readAt: getPublicationNotificationReadAt(record, userId),
  }
}

function projectNotificationCenterScopeCondition(kind?: ProjectNotificationCenterKind) {
  const publicationReviewCondition = and(
    eq(auditLog.action, AuditAction.NOTIFICATION_CREATED),
    sql`${auditLog.metadata}->>'notificationEvent' = ${PUBLICATION_REVIEW_NOTIFICATION_EVENT}`
  )
  const failureCondition = eq(auditLog.action, AuditAction.PROJECT_ADMIN_FAILURE_RECORDED)
  const publicationGovernanceCondition = inArray(
    auditLog.action,
    PUBLICATION_GOVERNANCE_AUDIT_ACTIONS
  )
  const productionTaskCondition = inArray(auditLog.action, PRODUCTION_TASK_AUDIT_ACTIONS)
  const memberManagementCondition = inArray(auditLog.action, MEMBER_MANAGEMENT_AUDIT_ACTIONS)
  const teamManagementCondition = or(
    eq(auditLog.action, AuditAction.WORKGROUP_ARCHIVED),
    and(
      eq(auditLog.action, AuditAction.WORKSPACE_CREATED),
      sql`${auditLog.metadata}->>'canvasScope' = 'team'`
    )
  )
  const agentPolicyCondition = or(
    eq(auditLog.action, AuditAction.AGENT_TEMPLATE_UPDATED),
    and(
      eq(auditLog.action, AuditAction.SKILL_UPDATED),
      sql`${auditLog.metadata}->>'scope' = 'agent_template'`
    )
  )
  const retentionPolicyCondition = and(
    eq(auditLog.action, AuditAction.ORGANIZATION_UPDATED),
    sql`${auditLog.metadata}->>'retentionEvent' = ${DATA_RETENTION_AUDIT_EVENT}`
  )
  const dataDrainCondition = inArray(auditLog.action, DATA_DRAIN_AUDIT_ACTIONS)
  const organizationManagementCondition = inArray(
    auditLog.action,
    ORGANIZATION_MANAGEMENT_AUDIT_ACTIONS
  )
  const organizationSettingsCondition = and(
    eq(auditLog.action, AuditAction.ORGANIZATION_UPDATED),
    or(
      ...ORGANIZATION_SETTINGS_EVENTS.map(
        (event) => sql`${auditLog.metadata}->>'organizationEvent' = ${event}`
      )
    )
  )
  const billingManagementCondition = and(
    or(
      eq(auditLog.action, AuditAction.ORGANIZATION_UPDATED),
      eq(auditLog.action, AuditAction.CREDIT_PURCHASED)
    ),
    or(
      ...BILLING_MANAGEMENT_EVENTS.map(
        (event) => sql`${auditLog.metadata}->>'billingEvent' = ${event}`
      )
    )
  )
  const cleanupExecutionCondition = and(
    eq(auditLog.action, AuditAction.ORGANIZATION_UPDATED),
    sql`${auditLog.metadata}->>'cleanupEvent' = ${CLEANUP_EXECUTION_AUDIT_EVENT}`
  )
  if (kind === 'publication_review') return publicationReviewCondition
  if (kind === 'project_admin_failure') return failureCondition
  if (kind === 'publication_governance') return publicationGovernanceCondition
  if (kind === 'production_task') return productionTaskCondition
  if (kind === 'member_management') return memberManagementCondition
  if (kind === 'team_management') return teamManagementCondition
  if (kind === 'agent_policy') return agentPolicyCondition
  if (kind === 'retention_policy') return retentionPolicyCondition
  if (kind === 'data_drain') return dataDrainCondition
  if (kind === 'organization_management') return organizationManagementCondition
  if (kind === 'organization_settings') return organizationSettingsCondition
  if (kind === 'billing_management') return billingManagementCondition
  if (kind === 'cleanup_execution') return cleanupExecutionCondition
  return or(
    publicationReviewCondition,
    failureCondition,
    publicationGovernanceCondition,
    productionTaskCondition,
    memberManagementCondition,
    teamManagementCondition,
    agentPolicyCondition,
    retentionPolicyCondition,
    dataDrainCondition,
    organizationManagementCondition,
    organizationSettingsCondition,
    billingManagementCondition,
    cleanupExecutionCondition
  )
}

function isPublicationGovernanceAction(action: string): action is PublicationAuditAction {
  return PUBLICATION_GOVERNANCE_AUDIT_ACTIONS.some(
    (publicationAction) => publicationAction === action
  )
}

function getPublicationGovernanceTitle(
  action: PublicationAuditAction,
  resourceName: string | null
) {
  const name = resourceName?.trim()
  switch (action) {
    case AuditAction.PUBLICATION_CREATED:
      return name ? `Publication created: ${name}` : 'Publication created'
    case AuditAction.PUBLICATION_UPDATED:
      return name ? `Publication updated: ${name}` : 'Publication updated'
    case AuditAction.PUBLICATION_ARCHIVED:
      return name ? `Publication archived: ${name}` : 'Publication archived'
    case AuditAction.PUBLICATION_RETRACTED:
      return name ? `Publication retracted: ${name}` : 'Publication retracted'
    case AuditAction.PUBLICATION_RESTORED:
      return name ? `Publication restored: ${name}` : 'Publication restored'
  }
}

function getPublicationGovernanceSeverity(action: PublicationAuditAction) {
  return action === AuditAction.PUBLICATION_ARCHIVED || action === AuditAction.PUBLICATION_RETRACTED
    ? 'warning'
    : 'info'
}

function isProductionTaskAction(action: string): action is ProductionTaskAuditAction {
  return PRODUCTION_TASK_AUDIT_ACTIONS.some((taskAction) => taskAction === action)
}

function getProductionTaskTitle(action: ProductionTaskAuditAction, resourceName: string | null) {
  const name = resourceName?.trim()
  switch (action) {
    case AuditAction.PRODUCTION_TASK_CREATED:
      return name ? `生产任务已创建：${name}` : '生产任务已创建'
    case AuditAction.PRODUCTION_TASK_UPDATED:
      return name ? `生产任务已更新：${name}` : '生产任务已更新'
    case AuditAction.PRODUCTION_TASK_SUBMITTED:
      return name ? `任务已提交审核：${name}` : '任务已提交审核'
    case AuditAction.PRODUCTION_TASK_APPROVED:
      return name ? `任务审核通过：${name}` : '任务审核通过'
    case AuditAction.PRODUCTION_TASK_CHANGES_REQUESTED:
      return name ? `任务需要修改：${name}` : '任务需要修改'
    case AuditAction.PRODUCTION_TASK_MESSAGE_CREATED:
      return name ? `任务有新消息：${name}` : '任务有新消息'
    case AuditAction.PRODUCTION_TASK_DDL_REMINDER:
      return name ? `DDL 即将到期：${name}` : 'DDL 即将到期'
  }
}

function getProductionTaskSeverity(
  action: ProductionTaskAuditAction
): ProjectNotificationCenterEntry['severity'] {
  return action === AuditAction.PRODUCTION_TASK_CHANGES_REQUESTED ||
    action === AuditAction.PRODUCTION_TASK_DDL_REMINDER
    ? 'warning'
    : 'info'
}

function isMemberManagementAction(action: string): action is MemberManagementAuditAction {
  return MEMBER_MANAGEMENT_AUDIT_ACTIONS.some((memberAction) => memberAction === action)
}

function getMemberManagementTitle(
  action: MemberManagementAuditAction,
  resourceName: string | null
) {
  const teamName = resourceName?.trim()
  switch (action) {
    case AuditAction.MEMBER_INVITED:
      return teamName ? `Team member added: ${teamName}` : 'Team member added'
    case AuditAction.MEMBER_BATCH_ASSIGNED:
      return teamName ? `Batch assigned members: ${teamName}` : 'Batch assigned members'
    case AuditAction.MEMBER_ROLE_CHANGED:
      return teamName ? `Team member role changed: ${teamName}` : 'Team member role changed'
    case AuditAction.MEMBER_REMOVED:
      return teamName ? `Team member removed: ${teamName}` : 'Team member removed'
  }
}

function getMemberManagementSeverity(
  action: MemberManagementAuditAction
): ProjectNotificationCenterEntry['severity'] {
  return action === AuditAction.MEMBER_REMOVED ? 'warning' : 'info'
}

function isTeamManagementAction(action: string, metadata: unknown) {
  if (action === AuditAction.WORKGROUP_ARCHIVED) return true
  if (action !== AuditAction.WORKSPACE_CREATED) return false
  return Boolean(
    metadata &&
      typeof metadata === 'object' &&
      (metadata as Record<string, unknown>).canvasScope === 'team'
  )
}

function getTeamManagementTitle(action: string, resourceName: string | null) {
  const teamName = resourceName?.trim()
  if (action === AuditAction.WORKGROUP_ARCHIVED) {
    return teamName ? `Team archived: ${teamName}` : 'Team archived'
  }
  return teamName ? `Team canvas initialized: ${teamName}` : 'Team canvas initialized'
}

function getTeamManagementSeverity(action: string): ProjectNotificationCenterEntry['severity'] {
  return action === AuditAction.WORKGROUP_ARCHIVED ? 'warning' : 'info'
}

function isAgentPolicyAction(action: string, metadata: unknown) {
  if (action === AuditAction.AGENT_TEMPLATE_UPDATED) return true
  if (action !== AuditAction.SKILL_UPDATED) return false
  return Boolean(
    metadata &&
      typeof metadata === 'object' &&
      (metadata as Record<string, unknown>).scope === 'agent_template'
  )
}

function getAgentPolicyTitle(action: string, resourceName: string | null) {
  const name = resourceName?.trim()
  if (action === AuditAction.AGENT_TEMPLATE_UPDATED) {
    return name ? `Agent template updated: ${name}` : 'Agent template updated'
  }
  return name ? `Agent skill policy updated: ${name}` : 'Agent skill policy updated'
}

function isRetentionPolicyAction(action: string, metadata: unknown) {
  return Boolean(
    action === AuditAction.ORGANIZATION_UPDATED &&
      metadata &&
      typeof metadata === 'object' &&
      (metadata as Record<string, unknown>).retentionEvent === DATA_RETENTION_AUDIT_EVENT
  )
}

function isDataDrainAction(action: string): action is DataDrainAuditAction {
  return DATA_DRAIN_AUDIT_ACTIONS.some((dataDrainAction) => dataDrainAction === action)
}

function getDataDrainTitle(action: DataDrainAuditAction, resourceName: string | null) {
  const name = resourceName?.trim()
  switch (action) {
    case AuditAction.DATA_DRAIN_CREATED:
      return name ? `Data drain created: ${name}` : 'Data drain created'
    case AuditAction.DATA_DRAIN_UPDATED:
      return name ? `Data drain updated: ${name}` : 'Data drain updated'
    case AuditAction.DATA_DRAIN_DELETED:
      return name ? `Data drain deleted: ${name}` : 'Data drain deleted'
    case AuditAction.DATA_DRAIN_RAN:
      return name ? `Data drain run triggered: ${name}` : 'Data drain run triggered'
    case AuditAction.DATA_DRAIN_TESTED:
      return name ? `Data drain connection tested: ${name}` : 'Data drain connection tested'
  }
}

function getDataDrainSeverity(
  action: DataDrainAuditAction,
  metadata: unknown
): ProjectNotificationCenterEntry['severity'] {
  if (action === AuditAction.DATA_DRAIN_DELETED) return 'warning'
  if (
    action === AuditAction.DATA_DRAIN_TESTED &&
    metadata &&
    typeof metadata === 'object' &&
    (metadata as Record<string, unknown>).outcome === 'failed'
  ) {
    return 'warning'
  }
  return 'info'
}

function isOrganizationManagementAction(
  action: string
): action is OrganizationManagementAuditAction {
  return ORGANIZATION_MANAGEMENT_AUDIT_ACTIONS.some((orgAction) => orgAction === action)
}

function getOrganizationManagementTitle(
  action: OrganizationManagementAuditAction,
  resourceName: string | null
) {
  const name = resourceName?.trim()
  switch (action) {
    case AuditAction.ORG_MEMBER_ADDED:
      return name ? `Organization member added: ${name}` : 'Organization member added'
    case AuditAction.ORG_MEMBER_REMOVED:
      return name ? `Organization member removed: ${name}` : 'Organization member removed'
    case AuditAction.ORG_MEMBER_ROLE_CHANGED:
      return name ? `Organization member role changed: ${name}` : 'Organization member role changed'
    case AuditAction.ORG_INVITATION_CREATED:
      return name ? `Organization invitation created: ${name}` : 'Organization invitation created'
    case AuditAction.ORG_INVITATION_UPDATED:
      return name ? `Organization invitation updated: ${name}` : 'Organization invitation updated'
    case AuditAction.ORG_INVITATION_ACCEPTED:
      return name ? `Organization invitation accepted: ${name}` : 'Organization invitation accepted'
    case AuditAction.ORG_INVITATION_REJECTED:
      return name ? `Organization invitation rejected: ${name}` : 'Organization invitation rejected'
    case AuditAction.ORG_INVITATION_CANCELLED:
      return name
        ? `Organization invitation cancelled: ${name}`
        : 'Organization invitation cancelled'
    case AuditAction.ORG_INVITATION_REVOKED:
      return name ? `Organization invitation revoked: ${name}` : 'Organization invitation revoked'
    case AuditAction.ORG_INVITATION_RESENT:
      return name ? `Organization invitation resent: ${name}` : 'Organization invitation resent'
  }
}

function getOrganizationManagementSeverity(
  action: OrganizationManagementAuditAction
): ProjectNotificationCenterEntry['severity'] {
  return action === AuditAction.ORG_MEMBER_REMOVED ||
    action === AuditAction.ORG_INVITATION_REJECTED ||
    action === AuditAction.ORG_INVITATION_CANCELLED ||
    action === AuditAction.ORG_INVITATION_REVOKED
    ? 'warning'
    : 'info'
}

function getMetadataRecord(metadata: unknown): Record<string, unknown> | null {
  return metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : null
}

function getOrganizationSettingsEvent(metadata: unknown): OrganizationSettingsEvent | null {
  const event = getMetadataRecord(metadata)?.organizationEvent
  return ORGANIZATION_SETTINGS_EVENTS.find((knownEvent) => knownEvent === event) ?? null
}

function getOrganizationSettingsTitle(
  event: OrganizationSettingsEvent,
  resourceName: string | null
) {
  const name = resourceName?.trim()
  if (event === 'organization.whitelabel_updated') {
    return name ? `Organization branding updated: ${name}` : 'Organization branding updated'
  }
  if (event === 'organization.security_sso_configured') {
    return name ? `Organization SSO settings updated: ${name}` : 'Organization SSO settings updated'
  }
  return name ? `Organization settings updated: ${name}` : 'Organization settings updated'
}

function getBillingManagementEvent(metadata: unknown): BillingManagementEvent | null {
  const event = getMetadataRecord(metadata)?.billingEvent
  return BILLING_MANAGEMENT_EVENTS.find((knownEvent) => knownEvent === event) ?? null
}

function getBillingManagementTitle(event: BillingManagementEvent, resourceName: string | null) {
  const name = resourceName?.trim()
  if (event === 'organization.seats_updated') {
    return name ? `Organization seats updated: ${name}` : 'Organization seats updated'
  }
  if (event === 'organization.plan_switched') {
    return name ? `Organization plan switched: ${name}` : 'Organization plan switched'
  }
  if (event === 'organization.credits_purchased') {
    return name ? `Organization credits purchased: ${name}` : 'Organization credits purchased'
  }
  if (event === 'organization.invoice_payment_failed') {
    return name
      ? `Organization invoice payment failed: ${name}`
      : 'Organization invoice payment failed'
  }
  if (event === 'organization.invoice_payment_recovered') {
    return name
      ? `Organization invoice payment recovered: ${name}`
      : 'Organization invoice payment recovered'
  }
  if (event === 'organization.subscription_cancelled') {
    return name
      ? `Organization subscription cancelled: ${name}`
      : 'Organization subscription cancelled'
  }
  return name ? `Billing updated: ${name}` : 'Billing updated'
}

function getBillingManagementSeverity(
  metadata: unknown
): ProjectNotificationCenterEntry['severity'] {
  const record = getMetadataRecord(metadata)
  if (record?.billingEvent === 'organization.invoice_payment_failed') {
    return 'warning'
  }
  if (record?.billingEvent === 'organization.subscription_cancelled') {
    return 'warning'
  }
  const previousSeats = record?.previousSeats
  const seats = record?.seats
  return typeof previousSeats === 'number' && typeof seats === 'number' && seats < previousSeats
    ? 'warning'
    : 'info'
}

function isCleanupExecutionAction(action: string, metadata: unknown) {
  return Boolean(
    action === AuditAction.ORGANIZATION_UPDATED &&
      getMetadataRecord(metadata)?.cleanupEvent === CLEANUP_EXECUTION_AUDIT_EVENT
  )
}

function getCleanupExecutionTitle(metadata: unknown, resourceName: string | null) {
  const record = getMetadataRecord(metadata)
  const jobType = typeof record?.jobType === 'string' ? record.jobType : 'cleanup job'
  const name = resourceName?.trim()
  if (record?.dryRun === true) {
    return name ? `Cleanup previewed: ${name} (${jobType})` : `Cleanup previewed: ${jobType}`
  }
  return name ? `Cleanup completed: ${name} (${jobType})` : `Cleanup completed: ${jobType}`
}

function getCleanupExecutionSeverity(
  metadata: unknown
): ProjectNotificationCenterEntry['severity'] {
  const record = getMetadataRecord(metadata)
  const rowsFailed = record?.rowsFailed
  const filesFailed = record?.filesFailed
  return (typeof rowsFailed === 'number' && rowsFailed > 0) ||
    (typeof filesFailed === 'number' && filesFailed > 0)
    ? 'warning'
    : 'info'
}

function getProjectNotificationCenterEntry(
  row: {
    id: string
    action: string
    resourceName: string | null
    description: string | null
    actorName: string | null
    actorEmail: string | null
    metadata: unknown
    createdAt: Date
  },
  userId: string
): ProjectNotificationCenterEntry | null {
  if (row.action === AuditAction.NOTIFICATION_CREATED) {
    const metadata = getPublicationNotificationInboxMetadata(row.metadata, userId)
    if (!metadata) return null
    return {
      id: row.id,
      kind: 'publication_review',
      severity:
        metadata.dangerCount > 0 ? 'danger' : metadata.warningCount > 0 ? 'warning' : 'info',
      title: metadata.title ?? row.resourceName ?? 'Publication review digest',
      detail: metadata.detail ?? row.description ?? '',
      channel: metadata.channel,
      body: metadata.body ?? null,
      notificationCount: metadata.notificationCount,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      createdAt: row.createdAt.toISOString(),
      readAt: metadata.readAt,
    }
  }

  if (row.action === AuditAction.PROJECT_ADMIN_FAILURE_RECORDED) {
    const metadata = getProjectAdminFailureMetadata(row.metadata)
    if (!metadata) return null
    const readAt =
      row.metadata && typeof row.metadata === 'object'
        ? getPublicationNotificationReadAt(row.metadata as Record<string, unknown>, userId)
        : null
    return {
      id: row.id,
      kind: 'project_admin_failure',
      severity: 'danger',
      title: metadata.operation ? `Failed: ${metadata.operation}` : 'Project admin failure',
      detail: metadata.message ?? row.description ?? '',
      channel: null,
      body: metadata.target ?? row.resourceName,
      notificationCount: 1,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      createdAt: row.createdAt.toISOString(),
      readAt,
    }
  }

  if (isPublicationGovernanceAction(row.action)) {
    const readAt =
      row.metadata && typeof row.metadata === 'object'
        ? getPublicationNotificationReadAt(row.metadata as Record<string, unknown>, userId)
        : null
    return {
      id: row.id,
      kind: 'publication_governance',
      severity: getPublicationGovernanceSeverity(row.action),
      title: getPublicationGovernanceTitle(row.action, row.resourceName),
      detail: row.description ?? '',
      channel: null,
      body: row.resourceName,
      notificationCount: 1,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      createdAt: row.createdAt.toISOString(),
      readAt,
    }
  }

  if (isProductionTaskAction(row.action)) {
    const readAt =
      row.metadata && typeof row.metadata === 'object'
        ? getPublicationNotificationReadAt(row.metadata as Record<string, unknown>, userId)
        : null
    return {
      id: row.id,
      kind: 'production_task',
      severity: getProductionTaskSeverity(row.action),
      title: getProductionTaskTitle(row.action, row.resourceName),
      detail: row.description ?? '',
      channel: null,
      body: row.resourceName,
      notificationCount: 1,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      createdAt: row.createdAt.toISOString(),
      readAt,
    }
  }

  if (isMemberManagementAction(row.action)) {
    const readAt =
      row.metadata && typeof row.metadata === 'object'
        ? getPublicationNotificationReadAt(row.metadata as Record<string, unknown>, userId)
        : null
    return {
      id: row.id,
      kind: 'member_management',
      severity: getMemberManagementSeverity(row.action),
      title: getMemberManagementTitle(row.action, row.resourceName),
      detail: row.description ?? '',
      channel: null,
      body: row.resourceName,
      notificationCount: 1,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      createdAt: row.createdAt.toISOString(),
      readAt,
    }
  }

  if (isTeamManagementAction(row.action, row.metadata)) {
    const readAt =
      row.metadata && typeof row.metadata === 'object'
        ? getPublicationNotificationReadAt(row.metadata as Record<string, unknown>, userId)
        : null
    return {
      id: row.id,
      kind: 'team_management',
      severity: getTeamManagementSeverity(row.action),
      title: getTeamManagementTitle(row.action, row.resourceName),
      detail: row.description ?? '',
      channel: null,
      body: row.resourceName,
      notificationCount: 1,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      createdAt: row.createdAt.toISOString(),
      readAt,
    }
  }

  if (isAgentPolicyAction(row.action, row.metadata)) {
    const readAt =
      row.metadata && typeof row.metadata === 'object'
        ? getPublicationNotificationReadAt(row.metadata as Record<string, unknown>, userId)
        : null
    return {
      id: row.id,
      kind: 'agent_policy',
      severity: 'info',
      title: getAgentPolicyTitle(row.action, row.resourceName),
      detail: row.description ?? '',
      channel: null,
      body: row.resourceName,
      notificationCount: 1,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      createdAt: row.createdAt.toISOString(),
      readAt,
    }
  }

  if (isRetentionPolicyAction(row.action, row.metadata)) {
    const readAt =
      row.metadata && typeof row.metadata === 'object'
        ? getPublicationNotificationReadAt(row.metadata as Record<string, unknown>, userId)
        : null
    return {
      id: row.id,
      kind: 'retention_policy',
      severity: 'info',
      title: row.resourceName
        ? `Retention policy updated: ${row.resourceName}`
        : 'Retention policy updated',
      detail: row.description ?? '',
      channel: null,
      body: row.resourceName,
      notificationCount: 1,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      createdAt: row.createdAt.toISOString(),
      readAt,
    }
  }

  if (isDataDrainAction(row.action)) {
    const readAt =
      row.metadata && typeof row.metadata === 'object'
        ? getPublicationNotificationReadAt(row.metadata as Record<string, unknown>, userId)
        : null
    return {
      id: row.id,
      kind: 'data_drain',
      severity: getDataDrainSeverity(row.action, row.metadata),
      title: getDataDrainTitle(row.action, row.resourceName),
      detail: row.description ?? '',
      channel: null,
      body: row.resourceName,
      notificationCount: 1,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      createdAt: row.createdAt.toISOString(),
      readAt,
    }
  }

  if (isOrganizationManagementAction(row.action)) {
    const readAt =
      row.metadata && typeof row.metadata === 'object'
        ? getPublicationNotificationReadAt(row.metadata as Record<string, unknown>, userId)
        : null
    return {
      id: row.id,
      kind: 'organization_management',
      severity: getOrganizationManagementSeverity(row.action),
      title: getOrganizationManagementTitle(row.action, row.resourceName),
      detail: row.description ?? '',
      channel: null,
      body: row.resourceName,
      notificationCount: 1,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      createdAt: row.createdAt.toISOString(),
      readAt,
    }
  }

  const organizationSettingsEvent =
    row.action === AuditAction.ORGANIZATION_UPDATED
      ? getOrganizationSettingsEvent(row.metadata)
      : null
  if (organizationSettingsEvent) {
    const readAt =
      row.metadata && typeof row.metadata === 'object'
        ? getPublicationNotificationReadAt(row.metadata as Record<string, unknown>, userId)
        : null
    return {
      id: row.id,
      kind: 'organization_settings',
      severity: 'info',
      title: getOrganizationSettingsTitle(organizationSettingsEvent, row.resourceName),
      detail: row.description ?? '',
      channel: null,
      body: row.resourceName,
      notificationCount: 1,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      createdAt: row.createdAt.toISOString(),
      readAt,
    }
  }

  const billingManagementEvent =
    row.action === AuditAction.ORGANIZATION_UPDATED || row.action === AuditAction.CREDIT_PURCHASED
      ? getBillingManagementEvent(row.metadata)
      : null
  if (billingManagementEvent) {
    const readAt =
      row.metadata && typeof row.metadata === 'object'
        ? getPublicationNotificationReadAt(row.metadata as Record<string, unknown>, userId)
        : null
    return {
      id: row.id,
      kind: 'billing_management',
      severity: getBillingManagementSeverity(row.metadata),
      title: getBillingManagementTitle(billingManagementEvent, row.resourceName),
      detail: row.description ?? '',
      channel: null,
      body: row.resourceName,
      notificationCount: 1,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      createdAt: row.createdAt.toISOString(),
      readAt,
    }
  }

  if (isCleanupExecutionAction(row.action, row.metadata)) {
    const readAt =
      row.metadata && typeof row.metadata === 'object'
        ? getPublicationNotificationReadAt(row.metadata as Record<string, unknown>, userId)
        : null
    return {
      id: row.id,
      kind: 'cleanup_execution',
      severity: getCleanupExecutionSeverity(row.metadata),
      title: getCleanupExecutionTitle(row.metadata, row.resourceName),
      detail: row.description ?? '',
      channel: null,
      body: row.resourceName,
      notificationCount: 1,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      createdAt: row.createdAt.toISOString(),
      readAt,
    }
  }

  return null
}

export async function listOrganizationWorkgroupActivity(params: {
  userId: string
  organizationId: string
  workgroupId?: string
  disciplineId?: string
  action?: string
  failureScope?: ProjectAdminFailureScope
  search?: string
  actor?: string
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}) {
  await assertOrganizationAdmin(params.userId, params.organizationId)
  const orgWorkgroups = await db
    .select({
      id: workgroup.id,
      name: workgroup.name,
      disciplineId: workgroup.disciplineId,
      disciplineName: discipline.name,
      teamWorkspaceId: workgroup.teamWorkspaceId,
    })
    .from(workgroup)
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(eq(workgroup.organizationId, params.organizationId))

  let scopedWorkgroups = orgWorkgroups
  if (params.workgroupId) {
    scopedWorkgroups = scopedWorkgroups.filter((entry) => entry.id === params.workgroupId)
    if (scopedWorkgroups.length === 0) throw new Error('Workgroup not found')
  } else if (params.disciplineId) {
    scopedWorkgroups = scopedWorkgroups.filter(
      (entry) => entry.disciplineId === params.disciplineId
    )
  }
  if (scopedWorkgroups.length === 0) return { activity: [], nextOffset: null }

  const pageSize = params.limit ?? 20
  const offset = params.offset ?? 0

  const workgroupIds = scopedWorkgroups.map((entry) => entry.id)
  const workspaceIds = scopedWorkgroups
    .map((entry) => entry.teamWorkspaceId)
    .filter((workspaceId): workspaceId is string => Boolean(workspaceId))
  const includeProjectActivity = !params.workgroupId && !params.disciplineId
  const scopeConditions = [
    ...(includeProjectActivity
      ? [sql`${auditLog.metadata}->>'organizationId' = ${params.organizationId}`]
      : []),
    ...workgroupIds.map(
      (workgroupId) => sql`${auditLog.metadata}->>'workgroupId' = ${workgroupId}`
    ),
    ...workgroupIds.map(
      (workgroupId) => sql`${auditLog.metadata}->>'sourceWorkgroupId' = ${workgroupId}`
    ),
  ]
  if (workspaceIds.length > 0) {
    scopeConditions.push(inArray(auditLog.workspaceId, workspaceIds))
  }

  const filters = [or(...scopeConditions)!]
  if (params.action) filters.push(eq(auditLog.action, params.action))
  if (params.failureScope) {
    filters.push(sql`${auditLog.metadata}->>'scope' = ${params.failureScope}`)
  }
  if (params.actor) {
    filters.push(or(eq(auditLog.actorEmail, params.actor), eq(auditLog.actorName, params.actor))!)
  }
  if (params.startDate) {
    filters.push(gte(auditLog.createdAt, parseActivityDateBoundary(params.startDate, 'start')))
  }
  if (params.endDate) {
    filters.push(lte(auditLog.createdAt, parseActivityDateBoundary(params.endDate, 'end')))
  }
  if (params.search) {
    const escapedSearch = params.search.replace(/[%_\\]/g, '\\$&')
    const searchTerm = `%${escapedSearch}%`
    filters.push(
      or(
        ilike(auditLog.action, searchTerm),
        ilike(auditLog.actorEmail, searchTerm),
        ilike(auditLog.actorName, searchTerm),
        ilike(auditLog.resourceName, searchTerm),
        ilike(auditLog.description, searchTerm)
      )!
    )
  }

  const rows = await db
    .select({
      id: auditLog.id,
      workspaceId: auditLog.workspaceId,
      action: auditLog.action,
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      resourceName: auditLog.resourceName,
      description: auditLog.description,
      actorName: auditLog.actorName,
      actorEmail: auditLog.actorEmail,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(and(...filters))
    .orderBy(desc(auditLog.createdAt))
    .limit(pageSize + 1)
    .offset(offset)

  const pageRows = rows.slice(0, pageSize)
  const nextOffset = rows.length > pageSize ? offset + pageSize : null

  const workgroupById = new Map(scopedWorkgroups.map((entry) => [entry.id, entry]))
  const workgroupByWorkspaceId = new Map(
    scopedWorkgroups
      .filter((entry) => entry.teamWorkspaceId)
      .map((entry) => [entry.teamWorkspaceId as string, entry])
  )

  const activity = pageRows.map((row) => {
    const metadataWorkgroupId = getAuditMetadataValue(row.metadata, [
      'workgroupId',
      'sourceWorkgroupId',
    ])
    const rowWorkgroup =
      (metadataWorkgroupId ? workgroupById.get(metadataWorkgroupId) : undefined) ??
      (row.workspaceId ? workgroupByWorkspaceId.get(row.workspaceId) : undefined)
    return {
      id: row.id,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      resourceName: row.resourceName,
      description: row.description,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      workgroupId: rowWorkgroup?.id ?? null,
      workgroupName: rowWorkgroup?.name ?? null,
      disciplineName: rowWorkgroup?.disciplineName ?? null,
      projectAdminFailure:
        row.action === AuditAction.PROJECT_ADMIN_FAILURE_RECORDED
          ? getProjectAdminFailureMetadata(row.metadata)
          : null,
      createdAt: row.createdAt.toISOString(),
    }
  })

  return { activity, nextOffset }
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
      workspaceId: workspace.id,
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
      status: 'published',
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
  await db
    .update(workflowPublicationVersion)
    .set({
      status: 'superseded',
      lifecycleUpdatedBy: params.publishedBy,
      lifecycleUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workflowPublicationVersion.sourceWorkflowId, params.sourceWorkflowId),
        eq(workflowPublicationVersion.status, 'published'),
        ne(workflowPublicationVersion.id, inserted.id)
      )
    )
  recordAudit({
    workspaceId: source.workspaceId,
    actorId: params.publishedBy,
    action: AuditAction.PUBLICATION_CREATED,
    resourceType: AuditResourceType.PUBLICATION,
    resourceId: inserted.id,
    resourceName: inserted.title,
    metadata: {
      organizationId: source.organizationId,
      sourceWorkflowId: params.sourceWorkflowId,
      sourceWorkgroupId: source.workgroupId,
      visibility: params.visibility,
      versionNumber: inserted.versionNumber,
    },
  })
  await recordPublicationBroadcastEvents({
    actorUserId: params.publishedBy,
    action: AuditAction.PUBLICATION_CREATED,
    event: 'published',
    publicationVersionId: inserted.id,
    title: inserted.title,
    organizationId: source.organizationId,
    sourceWorkgroupId: source.workgroupId,
    sourceWorkflowId: params.sourceWorkflowId,
    publishedWorkflowId: params.publishedWorkflowId,
    visibility: params.visibility,
  })
  return inserted
}

export async function syncCurrentPublicationVersionSnapshot(params: {
  sourceWorkflowId: string
  publishedWorkflowId: string
  publishedBy: string
}) {
  const [source] = await db
    .select({
      workflow,
      workspaceId: workspace.id,
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

  const [currentPublication] = await db
    .select()
    .from(workflowPublicationVersion)
    .where(
      and(
        eq(workflowPublicationVersion.sourceWorkflowId, params.sourceWorkflowId),
        eq(workflowPublicationVersion.publishedWorkflowId, params.publishedWorkflowId),
        eq(workflowPublicationVersion.status, 'published')
      )
    )
    .orderBy(desc(workflowPublicationVersion.publishedAt))
    .limit(1)
  if (!currentPublication) throw new Error('Current mainline publication not found')

  const state = await loadWorkflowFromNormalizedTables(params.sourceWorkflowId)
  const now = new Date()
  const [updated] = await db
    .update(workflowPublicationVersion)
    .set({
      snapshotState: sanitizeWorkflowSnapshot(
        state ?? { blocks: {}, edges: [], loops: {}, parallels: {} }
      ),
      snapshotMetadata: {
        sourceWorkflowName: source.workflow.name,
        sourceWorkflowDescription: source.workflow.description,
      },
      publishedBy: params.publishedBy,
      publishedAt: now,
      updatedAt: now,
    })
    .where(eq(workflowPublicationVersion.id, currentPublication.id))
    .returning()
  if (!updated) throw new Error('Current mainline publication not found after sync')

  recordAudit({
    workspaceId: source.workspaceId,
    actorId: params.publishedBy,
    action: AuditAction.PUBLICATION_UPDATED,
    resourceType: AuditResourceType.PUBLICATION,
    resourceId: updated.id,
    resourceName: updated.title,
    metadata: {
      organizationId: source.organizationId,
      sourceWorkflowId: params.sourceWorkflowId,
      sourceWorkgroupId: source.workgroupId,
      publishedWorkflowId: params.publishedWorkflowId,
      visibility: updated.visibility,
      versionNumber: updated.versionNumber,
      contentSync: true,
    },
  })
  await recordPublicationBroadcastEvents({
    actorUserId: params.publishedBy,
    action: AuditAction.PUBLICATION_UPDATED,
    event: 'content_synced',
    publicationVersionId: updated.id,
    title: updated.title,
    organizationId: source.organizationId,
    sourceWorkgroupId: source.workgroupId,
    sourceWorkflowId: params.sourceWorkflowId,
    publishedWorkflowId: params.publishedWorkflowId,
    visibility: updated.visibility,
  })

  return updated
}

async function replacePublicationScopes(params: {
  publishedWorkflowId: string | null
  visibility: PublicationVisibility
  targetWorkgroupIds: string[]
  userId: string
  organizationId: string
}) {
  if (!params.publishedWorkflowId) return []

  await db
    .delete(workflowPublicationScope)
    .where(eq(workflowPublicationScope.workflowId, params.publishedWorkflowId))

  if (params.visibility !== 'selected_workgroups') return []

  const uniqueTargetIds = [...new Set(params.targetWorkgroupIds)]
  if (uniqueTargetIds.length === 0) return []

  const validTargets = await db
    .select({ id: workgroup.id })
    .from(workgroup)
    .where(
      and(
        inArray(workgroup.id, uniqueTargetIds),
        eq(workgroup.organizationId, params.organizationId)
      )
    )
  const validTargetIds = validTargets.map((row) => row.id)
  if (validTargetIds.length === 0) return []

  await db.insert(workflowPublicationScope).values(
    validTargetIds.map((viewerWorkgroupId) => ({
      id: generateId(),
      workflowId: params.publishedWorkflowId as string,
      viewerWorkgroupId,
      createdBy: params.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )

  return validTargetIds
}

async function listPublicationScopeTargets(publishedWorkflowIds: string[]) {
  const uniqueIds = [...new Set(publishedWorkflowIds.filter(Boolean))]
  if (uniqueIds.length === 0) return new Map<string, string[]>()
  const rows = await db
    .select({
      workflowId: workflowPublicationScope.workflowId,
      viewerWorkgroupId: workflowPublicationScope.viewerWorkgroupId,
    })
    .from(workflowPublicationScope)
    .innerJoin(workgroup, eq(workflowPublicationScope.viewerWorkgroupId, workgroup.id))
    .where(
      and(inArray(workflowPublicationScope.workflowId, uniqueIds), isNull(workgroup.archivedAt))
    )

  const result = new Map<string, string[]>()
  for (const row of rows) {
    const existing = result.get(row.workflowId) ?? []
    existing.push(row.viewerWorkgroupId)
    result.set(row.workflowId, existing)
  }
  return result
}

async function listPublicationBroadcastTargets(params: {
  organizationId: string
  sourceWorkgroupId: string
  publishedWorkflowId: string | null
  visibility: PublicationVisibility
  targetWorkgroupIds?: string[]
}) {
  const conditions = [
    eq(workgroup.organizationId, params.organizationId),
    isNull(workgroup.archivedAt),
  ]

  if (params.visibility === 'selected_workgroups') {
    const targetIds =
      params.targetWorkgroupIds ??
      (params.publishedWorkflowId
        ? ((await listPublicationScopeTargets([params.publishedWorkflowId])).get(
            params.publishedWorkflowId
          ) ?? [])
        : [])
    const viewerIds = [...new Set(targetIds.filter((id) => id !== params.sourceWorkgroupId))]
    if (viewerIds.length === 0) return []
    conditions.push(inArray(workgroup.id, viewerIds))
  } else {
    conditions.push(ne(workgroup.id, params.sourceWorkgroupId))
  }

  return db
    .select({
      id: workgroup.id,
      name: workgroup.name,
      teamWorkspaceId: workgroup.teamWorkspaceId,
    })
    .from(workgroup)
    .where(and(...conditions))
}

function getPublicationBroadcastDescription(event: PublicationBroadcastParams['event']) {
  switch (event) {
    case 'published':
      return 'Showcase publication is now visible to this team'
    case 'content_synced':
      return 'Showcase publication content was updated'
    case 'details_updated':
      return 'Publication details changed for this team'
    case 'visibility_updated':
      return 'Publication visibility changed for this team'
    case 'archived':
      return 'Showcase publication was archived'
    case 'retracted':
      return 'Showcase publication was retracted'
    case 'restored':
      return 'Showcase publication was restored as current'
  }
}

async function recordPublicationBroadcastEvents(params: PublicationBroadcastParams) {
  try {
    const targets = await listPublicationBroadcastTargets(params)
    for (const target of targets) {
      recordAudit({
        workspaceId: target.teamWorkspaceId,
        actorId: params.actorUserId,
        action: params.action,
        resourceType: AuditResourceType.PUBLICATION,
        resourceId: params.publicationVersionId,
        resourceName: params.title,
        description: getPublicationBroadcastDescription(params.event),
        metadata: {
          workgroupId: target.id,
          workgroupName: target.name,
          sourceWorkgroupId: params.sourceWorkgroupId,
          sourceWorkflowId: params.sourceWorkflowId,
          publishedWorkflowId: params.publishedWorkflowId,
          publicationEvent: params.event,
          publicationBroadcast: true,
          visibility: params.visibility,
          targetWorkgroupIds: params.targetWorkgroupIds ?? [],
        },
      })
    }
  } catch (error) {
    logger.warn('Failed to record publication broadcast events', {
      error,
      publicationVersionId: params.publicationVersionId,
    })
  }
}

export async function listVisiblePublications(params: {
  userId: string
  workgroupId: string
  disciplineCode?: string
  sourceWorkgroupId?: string
  agentCode?: string
  status?: PublicationStatus
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
  if (params.status) {
    conditions.push(eq(workflowPublicationVersion.status, params.status))
  } else {
    conditions.push(
      inArray(workflowPublicationVersion.status, [
        'published',
        'superseded',
        'archived',
        'retracted',
      ])
    )
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
    .where(and(...conditions, visibilityCondition, isNull(workgroup.archivedAt)))
    .orderBy(desc(workflowPublicationVersion.publishedAt))
    .limit(params.limit ?? 50)

  const scopeTargets = await listPublicationScopeTargets(
    rows.flatMap((row) =>
      row.publication.publishedWorkflowId ? [row.publication.publishedWorkflowId] : []
    )
  )
  const visibleVersionIds = new Set(rows.map((row) => row.publication.id))

  return rows.map((row) => ({
    id: row.publication.id,
    publishedWorkflowId: row.publication.publishedWorkflowId,
    title: row.publication.title,
    description: row.publication.description,
    sourceWorkgroup: { id: row.publication.sourceWorkgroupId, name: row.sourceWorkgroupName },
    sourceDiscipline: {
      code: row.sourceDisciplineCode ?? 'chief_director',
      name: row.sourceDisciplineName ?? '总导演',
    },
    agentCode: row.publication.agentCode,
    versionNumber: row.publication.versionNumber,
    parentVersionId:
      row.publication.parentVersionId && visibleVersionIds.has(row.publication.parentVersionId)
        ? row.publication.parentVersionId
        : null,
    status: row.publication.status,
    visibility: row.publication.visibility,
    reviewState: row.publication.reviewState as PublicationReviewState | null,
    riskLevel: row.publication.riskLevel as PublicationRiskLevel | null,
    reviewer: formatPublicationReviewer(row.publication),
    dependsOnPublicationIds:
      row.publication.parentVersionId && visibleVersionIds.has(row.publication.parentVersionId)
        ? [row.publication.parentVersionId]
        : [],
    targetWorkgroupIds: row.publication.publishedWorkflowId
      ? (scopeTargets.get(row.publication.publishedWorkflowId) ?? [])
      : [],
    publishedBy: {
      id: row.publisherId ?? '',
      name: row.publisherName ?? 'Unknown',
      avatarUrl: row.publisherAvatarUrl,
    },
    publishedAt: row.publication.publishedAt.toISOString(),
  }))
}

export async function listOrganizationPublications(params: {
  userId: string
  organizationId: string
  disciplineCode?: string
  sourceWorkgroupId?: string
  agentCode?: string
  status?: PublicationStatus
  limit?: number
}): Promise<PublicationSummary[]> {
  await assertOrganizationAdmin(params.userId, params.organizationId)

  const conditions = [eq(workflowPublicationVersion.organizationId, params.organizationId)]
  if (params.sourceWorkgroupId) {
    conditions.push(eq(workflowPublicationVersion.sourceWorkgroupId, params.sourceWorkgroupId))
  }
  if (params.agentCode) {
    conditions.push(eq(workflowPublicationVersion.agentCode, params.agentCode))
  }
  if (params.disciplineCode) {
    conditions.push(eq(discipline.code, params.disciplineCode))
  }
  if (params.status) {
    conditions.push(eq(workflowPublicationVersion.status, params.status))
  } else {
    conditions.push(inArray(workflowPublicationVersion.status, ['published', 'superseded']))
  }

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
    .where(and(...conditions, isNull(workgroup.archivedAt)))
    .orderBy(desc(workflowPublicationVersion.publishedAt))
    .limit(params.limit ?? 100)

  const scopeTargets = await listPublicationScopeTargets(
    rows.flatMap((row) =>
      row.publication.publishedWorkflowId ? [row.publication.publishedWorkflowId] : []
    )
  )
  const visibleVersionIds = new Set(rows.map((row) => row.publication.id))

  return rows.map((row) => ({
    id: row.publication.id,
    publishedWorkflowId: row.publication.publishedWorkflowId,
    title: row.publication.title,
    description: row.publication.description,
    sourceWorkgroup: { id: row.publication.sourceWorkgroupId, name: row.sourceWorkgroupName },
    sourceDiscipline: {
      code: row.sourceDisciplineCode ?? 'chief_director',
      name: row.sourceDisciplineName ?? '总导演',
    },
    agentCode: isAgentCode(row.publication.agentCode)
      ? row.publication.agentCode
      : 'chief_director',
    versionNumber: row.publication.versionNumber,
    parentVersionId:
      row.publication.parentVersionId && visibleVersionIds.has(row.publication.parentVersionId)
        ? row.publication.parentVersionId
        : null,
    status: row.publication.status,
    visibility: row.publication.visibility,
    reviewState: row.publication.reviewState as PublicationReviewState | null,
    riskLevel: row.publication.riskLevel as PublicationRiskLevel | null,
    reviewer: formatPublicationReviewer(row.publication),
    dependsOnPublicationIds:
      row.publication.parentVersionId && visibleVersionIds.has(row.publication.parentVersionId)
        ? [row.publication.parentVersionId]
        : [],
    targetWorkgroupIds: row.publication.publishedWorkflowId
      ? (scopeTargets.get(row.publication.publishedWorkflowId) ?? [])
      : [],
    publishedBy: {
      id: row.publisherId ?? '',
      name: row.publisherName ?? 'Unknown',
      avatarUrl: row.publisherAvatarUrl,
    },
    publishedAt: row.publication.publishedAt.toISOString(),
  }))
}

export async function listOrganizationPublicationNotificationInbox(params: {
  userId: string
  organizationId: string
  limit?: number
  offset?: number
}): Promise<{ inbox: PublicationNotificationInboxEntry[]; nextOffset: number | null }> {
  await assertOrganizationAdmin(params.userId, params.organizationId)

  const pageSize = params.limit ?? 10
  const offset = params.offset ?? 0
  const rows = await db
    .select({
      id: auditLog.id,
      resourceId: auditLog.resourceId,
      resourceName: auditLog.resourceName,
      description: auditLog.description,
      actorName: auditLog.actorName,
      actorEmail: auditLog.actorEmail,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, AuditAction.NOTIFICATION_CREATED),
        sql`${auditLog.metadata}->>'organizationId' = ${params.organizationId}`,
        sql`${auditLog.metadata}->>'notificationEvent' = ${PUBLICATION_REVIEW_NOTIFICATION_EVENT}`
      )
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(pageSize + 1)
    .offset(offset)

  const pageRows = rows.slice(0, pageSize)
  const inbox = pageRows.flatMap((row): PublicationNotificationInboxEntry[] => {
    const metadata = getPublicationNotificationInboxMetadata(row.metadata, params.userId)
    if (!metadata) return []

    return [
      {
        id: row.id,
        channel: metadata.channel,
        title: metadata.title ?? row.resourceName ?? 'Publication review digest',
        detail: metadata.detail ?? row.description ?? '',
        body: metadata.body ?? '',
        notificationCount: metadata.notificationCount,
        dangerCount: metadata.dangerCount,
        warningCount: metadata.warningCount,
        publicationIds: metadata.publicationIds,
        outboxEventId: metadata.outboxEventId ?? row.resourceId,
        actorName: row.actorName,
        actorEmail: row.actorEmail,
        createdAt: row.createdAt.toISOString(),
        readAt: metadata.readAt,
      },
    ]
  })

  return {
    inbox,
    nextOffset: rows.length > pageSize ? offset + pageSize : null,
  }
}

export async function markOrganizationPublicationNotificationInboxRead(params: {
  userId: string
  organizationId: string
  notificationId?: string
  markAll?: boolean
}): Promise<{ readAt: string }> {
  await assertOrganizationAdmin(params.userId, params.organizationId)

  const readAt = new Date().toISOString()
  const conditions = [
    eq(auditLog.action, AuditAction.NOTIFICATION_CREATED),
    sql`${auditLog.metadata}->>'organizationId' = ${params.organizationId}`,
    sql`${auditLog.metadata}->>'notificationEvent' = ${PUBLICATION_REVIEW_NOTIFICATION_EVENT}`,
  ]
  if (!params.markAll && params.notificationId) {
    conditions.push(eq(auditLog.id, params.notificationId))
  }

  await db
    .update(auditLog)
    .set({
      metadata: sql`jsonb_set(coalesce(${auditLog.metadata}, '{}'::jsonb), array['readAtByUserId', ${params.userId}]::text[], to_jsonb(${readAt}::text), true)`,
    })
    .where(and(...conditions))

  return { readAt }
}

export async function listOrganizationProjectNotificationCenter(params: {
  userId: string
  organizationId: string
  limit?: number
  offset?: number
  kind?: ProjectNotificationCenterKind
}): Promise<{ notifications: ProjectNotificationCenterEntry[]; nextOffset: number | null }> {
  await assertOrganizationAdmin(params.userId, params.organizationId)

  const pageSize = params.limit ?? 10
  const offset = params.offset ?? 0
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      resourceName: auditLog.resourceName,
      description: auditLog.description,
      actorName: auditLog.actorName,
      actorEmail: auditLog.actorEmail,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(
      and(
        projectNotificationCenterScopeCondition(params.kind),
        sql`${auditLog.metadata}->>'organizationId' = ${params.organizationId}`
      )
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(pageSize + 1)
    .offset(offset)

  return {
    notifications: rows.slice(0, pageSize).flatMap((row) => {
      const entry = getProjectNotificationCenterEntry(row, params.userId)
      return entry ? [entry] : []
    }),
    nextOffset: rows.length > pageSize ? offset + pageSize : null,
  }
}

export async function markOrganizationProjectNotificationCenterRead(params: {
  userId: string
  organizationId: string
  notificationId?: string
  markAll?: boolean
  kind?: ProjectNotificationCenterKind
}): Promise<{ readAt: string }> {
  await assertOrganizationAdmin(params.userId, params.organizationId)

  const readAt = new Date().toISOString()
  const conditions = [
    projectNotificationCenterScopeCondition(params.kind),
    sql`${auditLog.metadata}->>'organizationId' = ${params.organizationId}`,
  ]
  if (!params.markAll && params.notificationId) {
    conditions.push(eq(auditLog.id, params.notificationId))
  }

  await db
    .update(auditLog)
    .set({
      metadata: sql`jsonb_set(coalesce(${auditLog.metadata}, '{}'::jsonb), array['readAtByUserId', ${params.userId}]::text[], to_jsonb(${readAt}::text), true)`,
    })
    .where(and(...conditions))

  return { readAt }
}

export async function deliverOrganizationPublicationNotifications(params: {
  userId: string
  organizationId: string
  channel: PublicationNotificationChannel
  projectName?: string
  emailRecipients?: string[]
  webhookUrl?: string
}): Promise<PublicationNotificationDeliveryResult> {
  const publications = await listOrganizationPublications({
    userId: params.userId,
    organizationId: params.organizationId,
  })
  const groups = buildPublicationStateGroups(publications)
  const dependencyAlerts = buildPublicationDependencyConflictAlerts(publications, groups)
  const notifications = buildPublicationReviewNotifications(publications, groups, dependencyAlerts)
  const [draft] = buildPublicationNotificationDeliveryDrafts(notifications, {
    projectName: params.projectName,
  }).filter((item) => item.channel === params.channel)
  const webhookUrl = params.webhookUrl?.trim()
  const emailRecipients = normalizeEmailRecipients(params.emailRecipients)

  if (!draft) {
    return {
      channel: params.channel,
      status: 'skipped',
      title: 'Publication review digest',
      detail: 'No publication review notifications require delivery.',
      body: '',
      notificationCount: 0,
      dangerCount: 0,
      warningCount: 0,
      publicationIds: [],
      outboxEventId: null,
    }
  }

  if (draft.channel === 'webhook' && !webhookUrl) {
    throw new Error('Webhook URL is required for webhook delivery')
  }

  if (draft.channel === 'email' && emailRecipients.length === 0) {
    throw new Error('Email recipients are required for email delivery')
  }

  const publicationIds = [
    ...new Set(draft.payload.notifications.map((notification) => notification.publicationId)),
  ]
  const outboxEventId = await enqueuePublicationNotificationDelivery(db, {
    id: draft.id,
    organizationId: params.organizationId,
    actorUserId: params.userId,
    channel: draft.channel,
    event: draft.payload.event,
    projectName: draft.payload.projectName,
    title: draft.title,
    detail: draft.detail,
    body: draft.body,
    notificationCount: draft.payload.notificationCount,
    dangerCount: draft.payload.dangerCount,
    warningCount: draft.payload.warningCount,
    publicationIds,
    notifications: draft.payload.notifications,
    emailRecipients: draft.channel === 'email' ? emailRecipients : undefined,
    webhookUrl: draft.channel === 'webhook' ? webhookUrl : null,
    enqueuedAt: new Date().toISOString(),
  })

  recordAudit({
    actorId: params.userId,
    action: AuditAction.NOTIFICATION_CREATED,
    resourceType: AuditResourceType.NOTIFICATION,
    resourceId: outboxEventId,
    resourceName: draft.title,
    description: `Queued ${draft.title} for publication review notifications`,
    metadata: {
      organizationId: params.organizationId,
      channel: draft.channel,
      deliveryDraftId: draft.id,
      outboxEventId,
      notificationEvent: draft.payload.event,
      title: draft.title,
      detail: draft.detail,
      body: draft.body,
      notificationCount: draft.payload.notificationCount,
      dangerCount: draft.payload.dangerCount,
      warningCount: draft.payload.warningCount,
      publicationIds,
      emailRecipientCount: draft.channel === 'email' ? emailRecipients.length : 0,
    },
  })

  return {
    channel: draft.channel,
    status: 'queued',
    title: draft.title,
    detail: draft.detail,
    body: draft.body,
    notificationCount: draft.payload.notificationCount,
    dangerCount: draft.payload.dangerCount,
    warningCount: draft.payload.warningCount,
    publicationIds,
    outboxEventId,
  }
}

export async function recordProjectAdminFailureAudit(params: {
  userId: string
  organizationId: string
  scope: ProjectAdminFailureScope
  operation: string
  target: string
  message: string
}): Promise<ProjectAdminFailureAuditResult> {
  await assertOrganizationAdmin(params.userId, params.organizationId)

  const recordedAt = new Date().toISOString()
  const failureId = generateShortId()
  const operation = params.operation.trim() || 'Unknown operation'
  const target = params.target.trim() || 'Unknown target'
  const message = params.message.trim() || 'Unknown error'

  recordAudit({
    actorId: params.userId,
    action: AuditAction.PROJECT_ADMIN_FAILURE_RECORDED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: params.organizationId,
    resourceName: target,
    description: `${operation} failed for ${target}`,
    metadata: {
      organizationId: params.organizationId,
      failureId,
      scope: params.scope,
      operation,
      target,
      message,
      recordedAt,
    },
  })

  return {
    id: failureId,
    scope: params.scope,
    operation,
    target,
    message,
    recordedAt,
  }
}

export async function cleanupProjectAdminFailureAudit(params: {
  userId: string
  organizationId: string
  retentionHours: number
  dryRun?: boolean
}): Promise<ProjectAdminFailureCleanupResult> {
  await assertOrganizationAdmin(params.userId, params.organizationId)

  const retentionHours = Math.trunc(params.retentionHours)
  const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000)
  const condition = and(
    eq(auditLog.action, AuditAction.PROJECT_ADMIN_FAILURE_RECORDED),
    sql`${auditLog.metadata}->>'organizationId' = ${params.organizationId}`,
    lt(auditLog.createdAt, cutoff)
  )
  const matchedRows = await db.select({ id: auditLog.id }).from(auditLog).where(condition)
  const dryRun = params.dryRun === true
  const deletedRows = dryRun
    ? []
    : await db.delete(auditLog).where(condition).returning({ id: auditLog.id })
  const result = {
    retentionHours,
    cutoff: cutoff.toISOString(),
    dryRun,
    matchedCount: matchedRows.length,
    deletedCount: deletedRows.length,
  }

  recordAudit({
    actorId: params.userId,
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: params.organizationId,
    resourceName: 'Project admin failure audit retention',
    description: dryRun
      ? `Previewed project-admin failure audit retention for ${retentionHours}h: ${result.matchedCount} row(s) matched`
      : `Cleaned project-admin failure audit older than ${retentionHours}h: ${result.deletedCount} row(s) deleted`,
    metadata: {
      organizationId: params.organizationId,
      cleanupEvent: CLEANUP_EXECUTION_AUDIT_EVENT,
      jobType: PROJECT_ADMIN_FAILURE_RETENTION_CLEANUP_JOB_TYPE,
      retentionHours,
      cutoff: result.cutoff,
      dryRun,
      matchedCount: result.matchedCount,
      deletedCount: result.deletedCount,
      rowsDeleted: result.deletedCount,
      rowsFailed: 0,
      filesDeleted: 0,
      filesFailed: 0,
    },
  })

  return result
}

export async function updatePublicationVisibility(params: {
  actorUserId: string
  publicationVersionId: string
  visibility: PublicationVisibility
  targetWorkgroupIds: string[]
  reason?: string
}) {
  const [row] = await db
    .select({
      id: workflowPublicationVersion.id,
      title: workflowPublicationVersion.title,
      organizationId: workflowPublicationVersion.organizationId,
      sourceWorkgroupId: workflowPublicationVersion.sourceWorkgroupId,
      sourceWorkflowId: workflowPublicationVersion.sourceWorkflowId,
      publishedWorkflowId: workflowPublicationVersion.publishedWorkflowId,
      visibility: workflowPublicationVersion.visibility,
    })
    .from(workflowPublicationVersion)
    .where(eq(workflowPublicationVersion.id, params.publicationVersionId))
    .limit(1)
  if (!row) throw new Error('Publication not found')
  await assertWorkgroupAdmin(params.actorUserId, row.sourceWorkgroupId)

  const now = new Date()
  const targetWorkgroupIds = await replacePublicationScopes({
    publishedWorkflowId: row.publishedWorkflowId,
    visibility: params.visibility,
    targetWorkgroupIds: params.targetWorkgroupIds,
    userId: params.actorUserId,
    organizationId: row.organizationId,
  })

  await db
    .update(workflowPublicationVersion)
    .set({
      visibility: params.visibility,
      lifecycleUpdatedBy: params.actorUserId,
      lifecycleUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(workflowPublicationVersion.id, params.publicationVersionId))

  if (row.publishedWorkflowId) {
    await db
      .update(workflow)
      .set({ visibility: params.visibility, updatedAt: now })
      .where(eq(workflow.id, row.publishedWorkflowId))
  }

  recordAudit({
    actorId: params.actorUserId,
    action: AuditAction.PUBLICATION_UPDATED,
    resourceType: AuditResourceType.PUBLICATION,
    resourceId: row.id,
    resourceName: row.title,
    description: params.reason,
    metadata: {
      organizationId: row.organizationId,
      previousVisibility: row.visibility,
      visibility: params.visibility,
      targetWorkgroupIds,
      sourceWorkflowId: row.sourceWorkflowId,
      sourceWorkgroupId: row.sourceWorkgroupId,
      publishedWorkflowId: row.publishedWorkflowId,
    },
  })
  await recordPublicationBroadcastEvents({
    actorUserId: params.actorUserId,
    action: AuditAction.PUBLICATION_UPDATED,
    event: 'visibility_updated',
    publicationVersionId: row.id,
    title: row.title,
    organizationId: row.organizationId,
    sourceWorkgroupId: row.sourceWorkgroupId,
    sourceWorkflowId: row.sourceWorkflowId,
    publishedWorkflowId: row.publishedWorkflowId,
    visibility: params.visibility,
    targetWorkgroupIds,
  })

  return {
    id: row.id,
    title: row.title,
    visibility: params.visibility,
    targetWorkgroupIds,
    updatedAt: now.toISOString(),
  }
}

export async function updatePublicationDetails(params: {
  actorUserId: string
  publicationVersionId: string
  title: string
  description: string | null
  reason?: string
}) {
  const title = params.title.trim()
  const description = params.description?.trim() || null
  const [row] = await db
    .select({
      id: workflowPublicationVersion.id,
      title: workflowPublicationVersion.title,
      description: workflowPublicationVersion.description,
      organizationId: workflowPublicationVersion.organizationId,
      sourceWorkgroupId: workflowPublicationVersion.sourceWorkgroupId,
      sourceWorkflowId: workflowPublicationVersion.sourceWorkflowId,
      publishedWorkflowId: workflowPublicationVersion.publishedWorkflowId,
      visibility: workflowPublicationVersion.visibility,
    })
    .from(workflowPublicationVersion)
    .where(eq(workflowPublicationVersion.id, params.publicationVersionId))
    .limit(1)
  if (!row) throw new Error('Publication not found')
  await assertWorkgroupAdmin(params.actorUserId, row.sourceWorkgroupId)

  const now = new Date()
  await db
    .update(workflowPublicationVersion)
    .set({
      title,
      description,
      lifecycleUpdatedBy: params.actorUserId,
      lifecycleUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(workflowPublicationVersion.id, params.publicationVersionId))

  if (row.publishedWorkflowId) {
    await db
      .update(workflow)
      .set({ name: title, description, updatedAt: now })
      .where(eq(workflow.id, row.publishedWorkflowId))
  }

  recordAudit({
    actorId: params.actorUserId,
    action: AuditAction.PUBLICATION_UPDATED,
    resourceType: AuditResourceType.PUBLICATION,
    resourceId: row.id,
    resourceName: title,
    description: params.reason,
    metadata: {
      organizationId: row.organizationId,
      previousTitle: row.title,
      title,
      previousDescription: row.description,
      description,
      sourceWorkflowId: row.sourceWorkflowId,
      sourceWorkgroupId: row.sourceWorkgroupId,
      publishedWorkflowId: row.publishedWorkflowId,
      publicationEvent: 'details_updated',
    },
  })
  await recordPublicationBroadcastEvents({
    actorUserId: params.actorUserId,
    action: AuditAction.PUBLICATION_UPDATED,
    event: 'details_updated',
    publicationVersionId: row.id,
    title,
    organizationId: row.organizationId,
    sourceWorkgroupId: row.sourceWorkgroupId,
    sourceWorkflowId: row.sourceWorkflowId,
    publishedWorkflowId: row.publishedWorkflowId,
    visibility: row.visibility,
  })

  return {
    id: row.id,
    title,
    description,
    updatedAt: now.toISOString(),
  }
}

export async function updatePublicationReview(params: {
  actorUserId: string
  publicationVersionId: string
  reviewState: PublicationReviewState | null
  riskLevel: PublicationRiskLevel | null
  reviewerUserId?: string | null
  reason?: string
}) {
  const [row] = await db
    .select({
      id: workflowPublicationVersion.id,
      title: workflowPublicationVersion.title,
      organizationId: workflowPublicationVersion.organizationId,
      sourceWorkgroupId: workflowPublicationVersion.sourceWorkgroupId,
      sourceWorkflowId: workflowPublicationVersion.sourceWorkflowId,
      publishedWorkflowId: workflowPublicationVersion.publishedWorkflowId,
      reviewState: workflowPublicationVersion.reviewState,
      riskLevel: workflowPublicationVersion.riskLevel,
      reviewerUserId: workflowPublicationVersion.reviewerUserId,
      reviewerAssignedBy: workflowPublicationVersion.reviewerAssignedBy,
      reviewerAssignedAt: workflowPublicationVersion.reviewerAssignedAt,
    })
    .from(workflowPublicationVersion)
    .where(eq(workflowPublicationVersion.id, params.publicationVersionId))
    .limit(1)
  if (!row) throw new Error('Publication not found')
  await assertWorkgroupAdmin(params.actorUserId, row.sourceWorkgroupId)

  const now = new Date()
  const reviewerUpdate =
    params.reviewerUserId === undefined
      ? {}
      : {
          reviewerUserId: params.reviewerUserId,
          reviewerAssignedBy: params.reviewerUserId ? params.actorUserId : null,
          reviewerAssignedAt: params.reviewerUserId ? now : null,
        }

  if (params.reviewerUserId) {
    const [reviewerMembership] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(eq(member.userId, params.reviewerUserId), eq(member.organizationId, row.organizationId))
      )
      .limit(1)
    if (!reviewerMembership) throw new Error('Reviewer must be an organization member')
  }

  await db
    .update(workflowPublicationVersion)
    .set({
      reviewState: params.reviewState,
      riskLevel: params.riskLevel,
      ...reviewerUpdate,
      lifecycleUpdatedBy: params.actorUserId,
      lifecycleUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(workflowPublicationVersion.id, params.publicationVersionId))

  recordAudit({
    actorId: params.actorUserId,
    action: AuditAction.PUBLICATION_UPDATED,
    resourceType: AuditResourceType.PUBLICATION,
    resourceId: row.id,
    resourceName: row.title,
    description: params.reason,
    metadata: {
      organizationId: row.organizationId,
      previousReviewState: row.reviewState,
      reviewState: params.reviewState,
      previousRiskLevel: row.riskLevel,
      riskLevel: params.riskLevel,
      previousReviewerUserId: row.reviewerUserId,
      reviewerUserId:
        params.reviewerUserId === undefined ? row.reviewerUserId : params.reviewerUserId,
      sourceWorkflowId: row.sourceWorkflowId,
      sourceWorkgroupId: row.sourceWorkgroupId,
      publishedWorkflowId: row.publishedWorkflowId,
      publicationEvent: 'review_updated',
    },
  })

  return {
    id: row.id,
    title: row.title,
    reviewState: params.reviewState,
    riskLevel: params.riskLevel,
    reviewer:
      params.reviewerUserId === undefined
        ? formatPublicationReviewer(row)
        : params.reviewerUserId
          ? {
              userId: params.reviewerUserId,
              assignedBy: params.actorUserId,
              assignedAt: now.toISOString(),
            }
          : null,
    updatedAt: now.toISOString(),
  }
}

async function resolveReadablePublicationVersionId(
  userId: string,
  publicationVersionIdOrWorkflowId: string
): Promise<string | null> {
  if (await canReadPublication(userId, publicationVersionIdOrWorkflowId)) {
    return publicationVersionIdOrWorkflowId
  }

  const candidateRows = await db
    .select({ id: workflowPublicationVersion.id })
    .from(workflowPublicationVersion)
    .where(
      and(
        eq(workflowPublicationVersion.publishedWorkflowId, publicationVersionIdOrWorkflowId),
        ne(workflowPublicationVersion.status, 'retracted')
      )
    )
    .orderBy(desc(workflowPublicationVersion.publishedAt))
    .limit(10)

  for (const candidate of candidateRows) {
    if (await canReadPublication(userId, candidate.id)) {
      return candidate.id
    }
  }

  return null
}

export async function getPublication(params: { userId: string; publicationVersionId: string }) {
  const publicationVersionId = await resolveReadablePublicationVersionId(
    params.userId,
    params.publicationVersionId
  )
  if (!publicationVersionId) throw new Error('Publication access denied')

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
    .where(eq(workflowPublicationVersion.id, publicationVersionId))
    .limit(1)
  if (!row) throw new Error('Publication not found')
  if (row.publication.status === 'retracted') throw new Error('Publication not found')
  const parentVersionId =
    row.publication.parentVersionId &&
    (await canReadPublication(params.userId, row.publication.parentVersionId))
      ? row.publication.parentVersionId
      : null

  return {
    id: row.publication.id,
    publishedWorkflowId: row.publication.publishedWorkflowId,
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
    status: row.publication.status,
    visibility: row.publication.visibility,
    reviewState: row.publication.reviewState as PublicationReviewState | null,
    riskLevel: row.publication.riskLevel as PublicationRiskLevel | null,
    reviewer: formatPublicationReviewer(row.publication),
    dependsOnPublicationIds: parentVersionId ? [parentVersionId] : [],
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
      sourceDisciplineCode: discipline.code,
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
    .filter((row) => row.publication.status !== 'retracted')
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
      description: row.publication.description,
      versionNumber: row.publication.versionNumber,
      status: row.publication.status,
      visibility: row.publication.visibility,
      reviewState: row.publication.reviewState as PublicationReviewState | null,
      riskLevel: row.publication.riskLevel as PublicationRiskLevel | null,
      reviewer: formatPublicationReviewer(row.publication),
      sourceWorkgroup: {
        id: row.publication.sourceWorkgroupId,
        name: row.sourceWorkgroupName,
      },
      sourceDiscipline: {
        code: row.sourceDisciplineCode ?? 'chief_director',
        name: row.sourceDisciplineName ?? '总导演',
      },
      agentCode: row.publication.agentCode,
      dependsOnPublicationIds: row.publication.parentVersionId
        ? [row.publication.parentVersionId]
        : [],
      sourceWorkgroupName: row.sourceWorkgroupName,
      sourceDisciplineName: row.sourceDisciplineName ?? '总导演',
      publishedAt: row.publication.publishedAt.toISOString(),
    })),
  }
}

export async function updatePublicationLifecycleStatus(params: {
  actorUserId: string
  publicationVersionId: string
  action: 'archive' | 'retract' | 'restore'
  reason?: string
}) {
  const [row] = await db
    .select({
      id: workflowPublicationVersion.id,
      title: workflowPublicationVersion.title,
      organizationId: workflowPublicationVersion.organizationId,
      sourceWorkgroupId: workflowPublicationVersion.sourceWorkgroupId,
      sourceWorkflowId: workflowPublicationVersion.sourceWorkflowId,
      publishedWorkflowId: workflowPublicationVersion.publishedWorkflowId,
      visibility: workflowPublicationVersion.visibility,
      status: workflowPublicationVersion.status,
      archivedAt: workflowPublicationVersion.archivedAt,
      retractedAt: workflowPublicationVersion.retractedAt,
      publishedAt: workflowPublicationVersion.publishedAt,
      snapshotState: workflowPublicationVersion.snapshotState,
      description: workflowPublicationVersion.description,
    })
    .from(workflowPublicationVersion)
    .where(eq(workflowPublicationVersion.id, params.publicationVersionId))
    .limit(1)
  if (!row) throw new Error('Publication not found')
  await assertWorkgroupAdmin(params.actorUserId, row.sourceWorkgroupId)

  const now = new Date()
  if (params.action === 'restore') {
    if (row.status === 'retracted') {
      throw new Error('Retracted publications cannot be restored')
    }
    if (!row.publishedWorkflowId) {
      throw new Error('Published workflow not found')
    }

    const saveResult = await saveWorkflowToNormalizedTables(
      row.publishedWorkflowId,
      row.snapshotState as WorkflowState
    )
    if (saveResult?.success === false) {
      throw new Error(saveResult.error ?? 'Failed to restore publication snapshot')
    }

    await db
      .update(workflowPublicationVersion)
      .set({
        status: 'superseded',
        lifecycleUpdatedBy: params.actorUserId,
        lifecycleUpdatedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowPublicationVersion.sourceWorkflowId, row.sourceWorkflowId),
          eq(workflowPublicationVersion.status, 'published'),
          ne(workflowPublicationVersion.id, row.id)
        )
      )

    await db
      .update(workflowPublicationVersion)
      .set({
        status: 'published',
        archivedAt: null,
        retractedAt: null,
        lifecycleUpdatedBy: params.actorUserId,
        lifecycleUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(workflowPublicationVersion.id, params.publicationVersionId))

    await db
      .update(workflow)
      .set({
        name: row.title,
        description: row.description,
        visibility: row.visibility,
        publishedAt: now,
        publishedBy: params.actorUserId,
        lastSynced: now,
        updatedAt: now,
      })
      .where(eq(workflow.id, row.publishedWorkflowId))

    recordAudit({
      actorId: params.actorUserId,
      action: AuditAction.PUBLICATION_RESTORED,
      resourceType: AuditResourceType.PUBLICATION,
      resourceId: row.id,
      resourceName: row.title,
      description: params.reason,
      metadata: {
        organizationId: row.organizationId,
        previousStatus: row.status,
        status: 'published',
        sourceWorkflowId: row.sourceWorkflowId,
        sourceWorkgroupId: row.sourceWorkgroupId,
        publishedWorkflowId: row.publishedWorkflowId,
      },
    })
    await recordPublicationBroadcastEvents({
      actorUserId: params.actorUserId,
      action: AuditAction.PUBLICATION_RESTORED,
      event: 'restored',
      publicationVersionId: row.id,
      title: row.title,
      organizationId: row.organizationId,
      sourceWorkgroupId: row.sourceWorkgroupId,
      sourceWorkflowId: row.sourceWorkflowId,
      publishedWorkflowId: row.publishedWorkflowId,
      visibility: row.visibility,
    })

    return {
      id: row.id,
      title: row.title,
      status: 'published' as const,
      archivedAt: null,
      retractedAt: null,
      lifecycleUpdatedAt: now.toISOString(),
      publishedAt: row.publishedAt.toISOString(),
    }
  }

  const status = params.action === 'archive' ? 'archived' : 'retracted'
  const archivedAt = params.action === 'archive' ? (row.archivedAt ?? now) : row.archivedAt
  const retractedAt = params.action === 'retract' ? (row.retractedAt ?? now) : row.retractedAt

  await db
    .update(workflowPublicationVersion)
    .set({
      status,
      archivedAt,
      retractedAt,
      lifecycleUpdatedBy: params.actorUserId,
      lifecycleUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(workflowPublicationVersion.id, params.publicationVersionId))

  recordAudit({
    actorId: params.actorUserId,
    action:
      params.action === 'archive'
        ? AuditAction.PUBLICATION_ARCHIVED
        : AuditAction.PUBLICATION_RETRACTED,
    resourceType: AuditResourceType.PUBLICATION,
    resourceId: row.id,
    resourceName: row.title,
    description: params.reason,
    metadata: {
      organizationId: row.organizationId,
      previousStatus: row.status,
      status,
      sourceWorkflowId: row.sourceWorkflowId,
      sourceWorkgroupId: row.sourceWorkgroupId,
      publishedWorkflowId: row.publishedWorkflowId,
    },
  })
  await recordPublicationBroadcastEvents({
    actorUserId: params.actorUserId,
    action:
      params.action === 'archive'
        ? AuditAction.PUBLICATION_ARCHIVED
        : AuditAction.PUBLICATION_RETRACTED,
    event: params.action === 'archive' ? 'archived' : 'retracted',
    publicationVersionId: row.id,
    title: row.title,
    organizationId: row.organizationId,
    sourceWorkgroupId: row.sourceWorkgroupId,
    sourceWorkflowId: row.sourceWorkflowId,
    publishedWorkflowId: row.publishedWorkflowId,
    visibility: row.visibility,
  })

  return {
    id: row.id,
    title: row.title,
    status,
    archivedAt: archivedAt?.toISOString() ?? null,
    retractedAt: retractedAt?.toISOString() ?? null,
    lifecycleUpdatedAt: now.toISOString(),
    publishedAt: row.publishedAt.toISOString(),
  }
}

async function getAgentSkillWorkgroupContext(userId: string, workgroupId: string) {
  await assertWorkgroupAdmin(userId, workgroupId)

  const [row] = await db
    .select({
      workgroupId: workgroup.id,
      organizationId: workgroup.organizationId,
      teamWorkspaceId: workgroup.teamWorkspaceId,
      disciplineAgentCode: discipline.agentCode,
    })
    .from(workgroup)
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(eq(workgroup.id, workgroupId))
    .limit(1)

  if (!row) throw new Error('Workgroup not found')

  const agent = getAgentProfile(row.disciplineAgentCode ?? 'chief_director')
  return {
    workgroupId: row.workgroupId,
    organizationId: row.organizationId,
    teamWorkspaceId: row.teamWorkspaceId,
    agent,
  }
}

export async function listWorkgroupAgentSkills(params: { userId: string; workgroupId: string }) {
  const context = await getAgentSkillWorkgroupContext(params.userId, params.workgroupId)
  if (!context.teamWorkspaceId) {
    return { agent: context.agent, skills: [] }
  }

  const rows = await db
    .select({
      bindingId: agentSkillBinding.id,
      skillId: skill.id,
      name: skill.name,
      description: skill.description,
      enabled: agentSkillBinding.enabled,
    })
    .from(skill)
    .leftJoin(
      agentSkillBinding,
      and(
        eq(agentSkillBinding.organizationId, context.organizationId),
        eq(agentSkillBinding.agentCode, context.agent.code),
        eq(agentSkillBinding.workgroupId, context.workgroupId),
        eq(agentSkillBinding.skillId, skill.id),
        eq(agentSkillBinding.scope, 'team_override')
      )
    )
    .where(eq(skill.workspaceId, context.teamWorkspaceId))
    .orderBy(asc(skill.name))

  return {
    agent: context.agent,
    skills: rows.map((row) => ({
      id: row.bindingId ?? null,
      skillId: row.skillId,
      name: row.name,
      description: row.description,
      enabled: row.enabled ?? true,
      scope: 'team_override' as const,
    })),
  }
}

export async function updateWorkgroupAgentSkill(params: {
  actorUserId: string
  workgroupId: string
  skillId: string
  enabled: boolean
}) {
  const context = await getAgentSkillWorkgroupContext(params.actorUserId, params.workgroupId)
  if (!context.teamWorkspaceId) throw new Error('Team workspace is not initialized')

  const [skillRow] = await db
    .select({ id: skill.id, name: skill.name, description: skill.description })
    .from(skill)
    .where(and(eq(skill.id, params.skillId), eq(skill.workspaceId, context.teamWorkspaceId)))
    .limit(1)

  if (!skillRow) throw new Error('Skill not found')

  const now = new Date()
  const bindingId = generateId()
  await db
    .insert(agentSkillBinding)
    .values({
      id: bindingId,
      organizationId: context.organizationId,
      agentCode: context.agent.code,
      workgroupId: context.workgroupId,
      skillId: params.skillId,
      enabled: params.enabled,
      scope: 'team_override',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        agentSkillBinding.organizationId,
        agentSkillBinding.agentCode,
        agentSkillBinding.workgroupId,
        agentSkillBinding.skillId,
        agentSkillBinding.scope,
      ],
      set: { enabled: params.enabled, updatedAt: now },
    })

  const [bindingRow] = await db
    .select({ id: agentSkillBinding.id })
    .from(agentSkillBinding)
    .where(
      and(
        eq(agentSkillBinding.organizationId, context.organizationId),
        eq(agentSkillBinding.agentCode, context.agent.code),
        eq(agentSkillBinding.workgroupId, context.workgroupId),
        eq(agentSkillBinding.skillId, params.skillId),
        eq(agentSkillBinding.scope, 'team_override')
      )
    )
    .limit(1)

  recordAudit({
    actorId: params.actorUserId,
    action: AuditAction.SKILL_UPDATED,
    resourceType: AuditResourceType.SKILL,
    resourceId: params.skillId,
    resourceName: skillRow.name,
    description: params.enabled
      ? `Enabled for ${context.agent.name} team agent`
      : `Disabled for ${context.agent.name} team agent`,
    metadata: {
      workgroupId: context.workgroupId,
      agentCode: context.agent.code,
      scope: 'team_override',
      enabled: params.enabled,
    },
  })

  return {
    id: bindingRow?.id ?? bindingId,
    skillId: skillRow.id,
    name: skillRow.name,
    description: skillRow.description,
    enabled: params.enabled,
    scope: 'team_override' as const,
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
  const baseAgent = getAgentProfile(row.agentCode ?? 'chief_director')
  const [templateRow] = await db
    .select({ projectInstructions: organizationAgentTemplate.projectInstructions })
    .from(organizationAgentTemplate)
    .where(
      and(
        eq(organizationAgentTemplate.organizationId, row.organizationId),
        eq(organizationAgentTemplate.agentCode, baseAgent.code)
      )
    )
    .limit(1)
  const projectInstructions = templateRow?.projectInstructions.trim()
  const agent = projectInstructions
    ? {
        ...baseAgent,
        defaultSystemPrompt: `${baseAgent.defaultSystemPrompt}\n\n项目级补充说明：\n${projectInstructions}`,
      }
    : baseAgent
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
    workgroup: { id: row.workgroupId, name: row.workgroupName, organizationId: row.organizationId },
    skills: skillRows.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      enabled: item.enabled ?? true,
    })),
  }
}
