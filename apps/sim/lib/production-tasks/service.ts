import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  discipline,
  member,
  organization,
  personalCanvasWorkspace,
  productionShowcaseAttachment,
  productionShowcaseItem,
  productionTask,
  productionTaskAttachment,
  productionTaskDependency,
  productionTaskMessage,
  productionTaskReadReceipt,
  productionTaskSubmission,
  productionTaskSubmissionAttachment,
  user,
  workflow,
  workflowBlocks,
  workgroup,
  workgroupMember,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import type { SQL } from 'drizzle-orm'
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  not,
  or,
  sql,
} from 'drizzle-orm'
import type {
  MobileAssignableWorkgroup,
  MobileProjectDetailResponse,
  MobileProjectMetrics,
  MobileProjectSummary,
  MobileTaskFilter,
  MobileTaskSummary,
} from '@/lib/api/contracts/mobile-production'
import type {
  ProductionShowcaseCategory,
  ProductionShowcaseItem,
  ProductionShowcaseSourceNodeVariant,
} from '@/lib/api/contracts/production-showcase-items'
import type {
  ProductionTask,
  ProductionTaskAttachment,
  ProductionTaskAttachmentKind,
  ProductionTaskMessage,
  ProductionTaskScope,
  ProductionTaskStatus,
  ProductionTaskSubmission,
} from '@/lib/api/contracts/production-tasks'
import { type AgentCode, isAgentCode } from '@/lib/collaboration/definitions'
import { canCreateProductionTask } from '@/lib/production-tasks/permissions'
import { notifyProductionTaskRealtime } from '@/lib/production-tasks/realtime'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { downloadFile } from '@/lib/uploads/core/storage-service'

const logger = createLogger('ProductionTasks')

type OrganizationRole = 'owner' | 'admin' | 'member' | null
type WorkgroupRole = 'admin' | 'member'
type ProductionTaskRow = typeof productionTask.$inferSelect
type ProductionTaskAttachmentRow = typeof productionTaskAttachment.$inferSelect
type ProductionTaskMessageRow = typeof productionTaskMessage.$inferSelect
type ProductionTaskSubmissionRow = typeof productionTaskSubmission.$inferSelect
type ProductionTaskSubmissionAttachmentRow = typeof productionTaskSubmissionAttachment.$inferSelect
type ProductionShowcaseItemRow = typeof productionShowcaseItem.$inferSelect
type ProductionShowcaseAttachmentRow = typeof productionShowcaseAttachment.$inferSelect

interface ProductionTaskAttachmentInput {
  name: string
  source?: 'url' | 'workspace_file'
  url?: string
  workspaceFileId?: string
  key?: string
  contentType?: string
  size?: number
}

interface ResolvedProductionTaskAttachmentInput {
  name: string
  url: string
  source: 'url' | 'workspace_file'
  workspaceFileId: string | null
  key: string | null
  contentType: string | null
  size: number | null
}

const DONE_STATUSES = ['approved', 'archived'] as const satisfies readonly ProductionTaskStatus[]
const MUTABLE_SUBMISSION_STATUSES = [
  'todo',
  'in_progress',
  'changes_requested',
] as const satisfies readonly ProductionTaskStatus[]
const COMPLETED_TASK_STATUSES = new Set<ProductionTaskStatus>(['approved', 'archived'])
const MOBILE_PROJECT_DETAIL_LIMIT = 30

interface MobileMetricTask {
  dueAt: Date | null
  status: ProductionTaskStatus
  unreadMessageCount: number
  adopted: boolean
}

export function computeMobileProjectMetrics(
  tasks: readonly MobileMetricTask[],
  now = new Date()
): MobileProjectMetrics {
  const dueSoonBoundary = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const metrics: MobileProjectMetrics = {
    total: tasks.length,
    completed: 0,
    overdue: 0,
    dueSoon: 0,
    pendingReview: 0,
    unreadMessages: 0,
    adoptedResults: 0,
  }

  for (const task of tasks) {
    const completed = COMPLETED_TASK_STATUSES.has(task.status)
    if (completed) metrics.completed += 1
    if (!completed && task.dueAt && task.dueAt < now) metrics.overdue += 1
    if (!completed && task.dueAt && task.dueAt >= now && task.dueAt <= dueSoonBoundary) {
      metrics.dueSoon += 1
    }
    if (task.status === 'submitted') metrics.pendingReview += 1
    metrics.unreadMessages += task.unreadMessageCount
    if (task.adopted) metrics.adoptedResults += 1
  }

  return metrics
}

function readMobileProjectMetadata(value: unknown): {
  estimatedDueAt: string | null
  productionProject: boolean
  status: 'active' | 'completed'
} {
  const metadata =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  return {
    estimatedDueAt:
      typeof metadata.estimatedDueAt === 'string' && metadata.estimatedDueAt.trim()
        ? metadata.estimatedDueAt
        : null,
    productionProject: metadata.productionProject === true,
    status: metadata.projectStatus === 'completed' ? 'completed' : 'active',
  }
}

export class ProductionTaskServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'ProductionTaskServiceError'
  }
}

interface WorkgroupSummary {
  id: string
  name: string
  organizationId: string
  discipline: {
    id: string | null
    code: string | null
    name: string | null
    agentCode: AgentCode | null
  }
}

interface UserSummary {
  id: string
  name: string | null
  email: string | null
  avatarUrl: string | null
}

interface ActorMembership {
  workgroupId: string
  role: WorkgroupRole
  disciplineCode: string | null
  agentCode: AgentCode | null
}

interface ActorTaskContext {
  userId: string
  organizationId: string
  organizationRole: OrganizationRole
  memberships: ActorMembership[]
}

interface WorkspaceTaskContext extends ActorTaskContext {
  workspaceId: string
  workgroupId: string
  workgroup: WorkgroupSummary
  sourceMembershipRole: WorkgroupRole | null
}

interface TaskPermissions {
  canEdit: boolean
  canSubmit: boolean
  canReview: boolean
  canMessage: boolean
}

function assertAllowed(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new ProductionTaskServiceError(message, 403)
  }
}

function assertFound<T>(value: T | null | undefined, message: string): T {
  if (!value) {
    throw new ProductionTaskServiceError(message, 404)
  }
  return value
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function isOrganizationAdmin(role: OrganizationRole): boolean {
  return role === 'owner' || role === 'admin'
}

function isDirectorLikeMembership(membership: ActorMembership): boolean {
  return canCreateProductionTask([membership])
}

function isDirectorLikeContext(context: ActorTaskContext): boolean {
  return context.memberships.some(isDirectorLikeMembership)
}

function normalizeAgentCode(value: string | null): AgentCode | null {
  return value && isAgentCode(value) ? value : null
}

function normalizeShowcaseCategory(value: string): ProductionShowcaseCategory {
  if (
    value === 'copywriting' ||
    value === 'lighting' ||
    value === 'sound' ||
    value === 'stage_design' ||
    value === 'visual' ||
    value === 'video' ||
    value === 'image' ||
    value === 'document' ||
    value === 'parameter' ||
    value === 'other'
  ) {
    return value
  }
  return 'other'
}

function normalizeShowcaseSourceNodeVariant(
  value: string | null
): ProductionShowcaseSourceNodeVariant | null {
  if (
    value === 'text' ||
    value === 'image' ||
    value === 'video' ||
    value === 'audio' ||
    value === 'document' ||
    value === 'file' ||
    value === 'other'
  ) {
    return value
  }
  return null
}

function getMembershipRole(context: ActorTaskContext, workgroupId: string): WorkgroupRole | null {
  return (
    context.memberships.find((membership) => membership.workgroupId === workgroupId)?.role ?? null
  )
}

function computeTaskPermissions(
  task: ProductionTaskRow,
  context: ActorTaskContext
): TaskPermissions {
  const sourceRole = getMembershipRole(context, task.sourceWorkgroupId)
  const assigneeRole = getMembershipRole(context, task.assigneeWorkgroupId)
  const orgAdmin = isOrganizationAdmin(context.organizationRole)
  const directorLike = isDirectorLikeContext(context)
  const sourceAdmin = sourceRole === 'admin'
  const canOversee = orgAdmin || directorLike || sourceAdmin
  const canView = canOversee || Boolean(sourceRole) || Boolean(assigneeRole)

  return {
    canEdit: canOversee,
    canSubmit: Boolean(assigneeRole),
    canReview: canOversee,
    canMessage: canView,
  }
}

function assertValidUpdateStatusTransition(
  currentStatus: ProductionTaskStatus,
  nextStatus: ProductionTaskStatus
) {
  if (nextStatus === currentStatus) return
  if (nextStatus === 'archived') return
  if (
    nextStatus === 'in_progress' &&
    (currentStatus === 'todo' || currentStatus === 'changes_requested')
  ) {
    return
  }

  throw new ProductionTaskServiceError(
    'Use submit or review endpoints for this production task status transition',
    400
  )
}

function getVisibleWorkgroupIds(context: ActorTaskContext): string[] {
  return [...new Set(context.memberships.map((membership) => membership.workgroupId))]
}

async function getOrganizationRole(
  userId: string,
  organizationId: string
): Promise<OrganizationRole> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1)

  const role = row?.role
  if (role === 'owner' || role === 'admin' || role === 'member') return role
  return null
}

async function getActorTaskContext(
  userId: string,
  organizationId: string
): Promise<ActorTaskContext> {
  const [organizationRole, rows] = await Promise.all([
    getOrganizationRole(userId, organizationId),
    db
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
          eq(workgroupMember.userId, userId),
          eq(workgroupMember.organizationId, organizationId),
          isNull(workgroup.archivedAt)
        )
      ),
  ])

  if (!organizationRole && rows.length === 0) {
    throw new ProductionTaskServiceError('Organization membership required', 403)
  }

  return {
    userId,
    organizationId,
    organizationRole: organizationRole ?? 'member',
    memberships: rows.map((row) => ({
      workgroupId: row.workgroupId,
      role: row.role,
      disciplineCode: row.disciplineCode,
      agentCode: normalizeAgentCode(row.agentCode),
    })),
  }
}

async function getActiveWorkgroup(workgroupId: string): Promise<WorkgroupSummary | null> {
  const [row] = await db
    .select({
      id: workgroup.id,
      name: workgroup.name,
      organizationId: workgroup.organizationId,
      disciplineId: discipline.id,
      disciplineCode: discipline.code,
      disciplineName: discipline.name,
      agentCode: discipline.agentCode,
    })
    .from(workgroup)
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(and(eq(workgroup.id, workgroupId), isNull(workgroup.archivedAt)))
    .limit(1)

  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    organizationId: row.organizationId,
    discipline: {
      id: row.disciplineId,
      code: row.disciplineCode,
      name: row.disciplineName,
      agentCode: normalizeAgentCode(row.agentCode),
    },
  }
}

async function getWorkgroupSummaries(
  workgroupIds: string[]
): Promise<Map<string, WorkgroupSummary>> {
  const uniqueIds = [...new Set(workgroupIds.filter(Boolean))]
  if (uniqueIds.length === 0) return new Map()

  const rows = await db
    .select({
      id: workgroup.id,
      name: workgroup.name,
      organizationId: workgroup.organizationId,
      disciplineId: discipline.id,
      disciplineCode: discipline.code,
      disciplineName: discipline.name,
      agentCode: discipline.agentCode,
    })
    .from(workgroup)
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(inArray(workgroup.id, uniqueIds))

  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        organizationId: row.organizationId,
        discipline: {
          id: row.disciplineId,
          code: row.disciplineCode,
          name: row.disciplineName,
          agentCode: normalizeAgentCode(row.agentCode),
        },
      },
    ])
  )
}

async function getUserSummaries(userIds: string[]): Promise<Map<string, UserSummary>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))]
  if (uniqueIds.length === 0) return new Map()

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(user)
    .where(inArray(user.id, uniqueIds))

  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        email: row.email,
        avatarUrl: row.image,
      },
    ])
  )
}

async function resolveWorkspaceTaskContext(
  userId: string,
  workspaceId: string
): Promise<WorkspaceTaskContext> {
  const [personalRow] = await db
    .select({
      organizationId: personalCanvasWorkspace.organizationId,
      workgroupId: personalCanvasWorkspace.workgroupId,
    })
    .from(personalCanvasWorkspace)
    .where(
      and(
        eq(personalCanvasWorkspace.workspaceId, workspaceId),
        eq(personalCanvasWorkspace.userId, userId)
      )
    )
    .limit(1)

  const [workspaceRow] = await db
    .select({
      id: workspace.id,
      organizationId: workspace.organizationId,
      workgroupId: workspace.workgroupId,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)

  assertFound(workspaceRow, 'Workspace not found')

  const workgroupId = personalRow?.workgroupId ?? workspaceRow.workgroupId
  if (!workgroupId) {
    throw new ProductionTaskServiceError('Workspace is not attached to a production team', 403)
  }

  const workgroupSummary = assertFound(await getActiveWorkgroup(workgroupId), 'Workgroup not found')
  const organizationId =
    personalRow?.organizationId ?? workspaceRow.organizationId ?? workgroupSummary.organizationId

  const context = await getActorTaskContext(userId, organizationId)
  const sourceMembershipRole = getMembershipRole(context, workgroupId)
  assertAllowed(
    Boolean(sourceMembershipRole) || isOrganizationAdmin(context.organizationRole),
    'Workgroup membership required'
  )

  return {
    ...context,
    workspaceId,
    workgroupId,
    workgroup: workgroupSummary,
    sourceMembershipRole,
  }
}

async function getTaskRow(taskId: string): Promise<ProductionTaskRow> {
  const [row] = await db.select().from(productionTask).where(eq(productionTask.id, taskId)).limit(1)

  return assertFound(row, 'Production task not found')
}

async function getNextSubmissionVersion(taskId: string): Promise<number> {
  const [row] = await db
    .select({
      maxVersion: sql<number>`coalesce(max(${productionTaskSubmission.versionNumber}), 0)`,
    })
    .from(productionTaskSubmission)
    .where(eq(productionTaskSubmission.taskId, taskId))
    .limit(1)

  return Number(row?.maxVersion ?? 0) + 1
}

async function getLatestSubmittedSubmission(taskId: string): Promise<ProductionTaskSubmissionRow> {
  const [row] = await db
    .select()
    .from(productionTaskSubmission)
    .where(
      and(
        eq(productionTaskSubmission.taskId, taskId),
        eq(productionTaskSubmission.status, 'submitted')
      )
    )
    .orderBy(desc(productionTaskSubmission.versionNumber))
    .limit(1)

  return assertFound(row, 'Submitted task version not found')
}

async function assertWorkflowBelongsToWorkspace(workflowId: string, workspaceId: string) {
  const [row] = await db
    .select({ id: workflow.id, workspaceId: workflow.workspaceId })
    .from(workflow)
    .where(and(eq(workflow.id, workflowId), isNull(workflow.archivedAt)))
    .limit(1)

  assertAllowed(Boolean(row && row.workspaceId === workspaceId), 'Workflow access denied')
}

async function assertWorkflowBlockBelongsToWorkflow(blockId: string, workflowId: string) {
  const [row] = await db
    .select({ id: workflowBlocks.id })
    .from(workflowBlocks)
    .where(and(eq(workflowBlocks.id, blockId), eq(workflowBlocks.workflowId, workflowId)))
    .limit(1)

  assertAllowed(Boolean(row), 'Workflow node access denied')
}

async function assertDependencyTasks(params: {
  organizationId: string
  taskId?: string
  dependencyTaskIds?: string[]
}): Promise<string[]> {
  const dependencyTaskIds = [...new Set(params.dependencyTaskIds ?? [])]
  if (dependencyTaskIds.length === 0) return []

  if (params.taskId && dependencyTaskIds.includes(params.taskId)) {
    throw new ProductionTaskServiceError('A production task cannot depend on itself', 400)
  }

  const rows = await db
    .select({ id: productionTask.id })
    .from(productionTask)
    .where(
      and(
        eq(productionTask.organizationId, params.organizationId),
        inArray(productionTask.id, dependencyTaskIds)
      )
    )

  if (rows.length !== dependencyTaskIds.length) {
    throw new ProductionTaskServiceError(
      'Dependency tasks must belong to the same organization',
      400
    )
  }

  return dependencyTaskIds
}

async function replaceTaskDependencies(params: {
  taskId: string
  dependencyTaskIds: string[]
  createdAt?: Date
}) {
  await db
    .delete(productionTaskDependency)
    .where(eq(productionTaskDependency.taskId, params.taskId))
  if (params.dependencyTaskIds.length === 0) return

  await db.insert(productionTaskDependency).values(
    params.dependencyTaskIds.map((dependsOnTaskId) => ({
      id: generateId(),
      taskId: params.taskId,
      dependsOnTaskId,
      createdAt: params.createdAt ?? new Date(),
    }))
  )
}

async function replaceTaskAttachments(params: {
  taskId: string
  userId: string
  attachments: ResolvedProductionTaskAttachmentInput[]
  createdAt?: Date
}) {
  await db
    .delete(productionTaskAttachment)
    .where(eq(productionTaskAttachment.taskId, params.taskId))
  if (params.attachments.length === 0) return

  const createdAt = params.createdAt ?? new Date()
  await db.insert(productionTaskAttachment).values(
    params.attachments.map((attachment) => ({
      id: generateId(),
      taskId: params.taskId,
      name: attachment.name,
      url: attachment.url,
      source: attachment.source,
      workspaceFileId: attachment.workspaceFileId,
      key: attachment.key,
      contentType: attachment.contentType,
      size: attachment.size,
      createdBy: params.userId,
      createdAt,
    }))
  )
}

async function insertTaskSubmissionAttachments(params: {
  taskId: string
  submissionId: string
  userId: string
  attachments: ResolvedProductionTaskAttachmentInput[]
  createdAt?: Date
}) {
  if (params.attachments.length === 0) return

  const createdAt = params.createdAt ?? new Date()
  await db.insert(productionTaskSubmissionAttachment).values(
    params.attachments.map((attachment) => ({
      id: generateId(),
      taskId: params.taskId,
      submissionId: params.submissionId,
      name: attachment.name,
      url: attachment.url,
      source: attachment.source,
      workspaceFileId: attachment.workspaceFileId,
      key: attachment.key,
      contentType: attachment.contentType,
      size: attachment.size,
      createdBy: params.userId,
      createdAt,
    }))
  )
}

async function resolveTaskAttachments(params: {
  workspaceId: string | null
  attachments: ProductionTaskAttachmentInput[]
}): Promise<ResolvedProductionTaskAttachmentInput[]> {
  const resolved: ResolvedProductionTaskAttachmentInput[] = []

  for (const attachment of params.attachments.slice(0, 20)) {
    if (attachment.source === 'workspace_file') {
      if (!params.workspaceId) {
        throw new ProductionTaskServiceError('Task workspace is required for file attachments', 400)
      }
      if (!attachment.workspaceFileId) {
        throw new ProductionTaskServiceError(
          'workspaceFileId is required for file attachments',
          400
        )
      }

      const file = await getWorkspaceFile(params.workspaceId, attachment.workspaceFileId)
      if (!file) {
        throw new ProductionTaskServiceError('Attachment file not found in task workspace', 404)
      }

      resolved.push({
        name: attachment.name || file.name,
        url: file.path,
        source: 'workspace_file',
        workspaceFileId: file.id,
        key: file.key,
        contentType: file.type,
        size: file.size,
      })
      continue
    }

    if (!attachment.url) {
      throw new ProductionTaskServiceError('Attachment URL is required', 400)
    }
    resolved.push({
      name: attachment.name,
      url: attachment.url,
      source: 'url',
      workspaceFileId: null,
      key: null,
      contentType: null,
      size: null,
    })
  }

  return resolved
}

function getProductionTaskAttachmentDownloadUrl(params: {
  taskId: string
  attachmentId: string
  kind: ProductionTaskAttachmentKind
  source: string
}): string | null {
  if (params.source !== 'workspace_file') return null
  return `/api/production-tasks/${encodeURIComponent(params.taskId)}/attachments/${encodeURIComponent(params.attachmentId)}/download?kind=${params.kind}`
}

function getProductionShowcaseAttachmentDownloadUrl(params: {
  itemId: string
  attachmentId: string
  source: string
}): string | null {
  if (params.source !== 'workspace_file') return null
  return `/api/production-showcase-items/${encodeURIComponent(params.itemId)}/attachments/${encodeURIComponent(params.attachmentId)}/download`
}

function mapProductionTaskAttachment(
  row: ProductionTaskAttachmentRow | ProductionTaskSubmissionAttachmentRow,
  users: Map<string, UserSummary>,
  kind: ProductionTaskAttachmentKind
): ProductionTaskAttachment {
  const source = row.source === 'workspace_file' ? 'workspace_file' : 'url'
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    downloadUrl: getProductionTaskAttachmentDownloadUrl({
      taskId: row.taskId,
      attachmentId: row.id,
      kind,
      source,
    }),
    source,
    workspaceFileId: row.workspaceFileId,
    key: row.key,
    contentType: row.contentType,
    size: row.size,
    createdBy: row.createdBy ? (users.get(row.createdBy) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
  }
}

function mapProductionShowcaseAttachment(
  row: ProductionShowcaseAttachmentRow,
  users: Map<string, UserSummary>
): ProductionTaskAttachment {
  const source = row.source === 'workspace_file' ? 'workspace_file' : 'url'
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    downloadUrl: getProductionShowcaseAttachmentDownloadUrl({
      itemId: row.itemId,
      attachmentId: row.id,
      source,
    }),
    source,
    workspaceFileId: row.workspaceFileId,
    key: row.key,
    contentType: row.contentType,
    size: row.size,
    createdBy: row.createdBy ? (users.get(row.createdBy) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
  }
}

function fallbackWorkgroup(id: string): WorkgroupSummary {
  return {
    id,
    name: 'Unknown team',
    organizationId: '',
    discipline: { id: null, code: null, name: null, agentCode: null },
  }
}

async function enrichTasks(
  rows: ProductionTaskRow[],
  context: ActorTaskContext
): Promise<ProductionTask[]> {
  if (rows.length === 0) return []

  const taskIds = rows.map((row) => row.id)
  const workgroups = await getWorkgroupSummaries(
    rows.flatMap((row) => [row.sourceWorkgroupId, row.assigneeWorkgroupId])
  )

  const messageRows = await db
    .select({
      id: productionTaskMessage.id,
      taskId: productionTaskMessage.taskId,
      senderUserId: productionTaskMessage.senderUserId,
      createdAt: productionTaskMessage.createdAt,
    })
    .from(productionTaskMessage)
    .where(inArray(productionTaskMessage.taskId, taskIds))

  const receiptRows = await db
    .select({
      taskId: productionTaskReadReceipt.taskId,
      lastReadAt: productionTaskReadReceipt.lastReadAt,
    })
    .from(productionTaskReadReceipt)
    .where(
      and(
        eq(productionTaskReadReceipt.userId, context.userId),
        inArray(productionTaskReadReceipt.taskId, taskIds)
      )
    )

  const dependencyRows = await db
    .select({
      taskId: productionTaskDependency.taskId,
      dependsOnTaskId: productionTaskDependency.dependsOnTaskId,
    })
    .from(productionTaskDependency)
    .where(inArray(productionTaskDependency.taskId, taskIds))

  const dependencyTaskIds = [...new Set(dependencyRows.map((row) => row.dependsOnTaskId))]
  const dependencyTaskRows =
    dependencyTaskIds.length > 0
      ? await db
          .select({
            id: productionTask.id,
            title: productionTask.title,
            status: productionTask.status,
            dueAt: productionTask.dueAt,
          })
          .from(productionTask)
          .where(inArray(productionTask.id, dependencyTaskIds))
      : []

  const attachmentRows =
    taskIds.length > 0
      ? await db
          .select()
          .from(productionTaskAttachment)
          .where(inArray(productionTaskAttachment.taskId, taskIds))
          .orderBy(asc(productionTaskAttachment.createdAt))
      : []
  const submissionRows =
    taskIds.length > 0
      ? await db
          .select()
          .from(productionTaskSubmission)
          .where(inArray(productionTaskSubmission.taskId, taskIds))
          .orderBy(desc(productionTaskSubmission.versionNumber))
      : []
  const submissionAttachmentRows =
    taskIds.length > 0
      ? await db
          .select()
          .from(productionTaskSubmissionAttachment)
          .where(inArray(productionTaskSubmissionAttachment.taskId, taskIds))
          .orderBy(asc(productionTaskSubmissionAttachment.createdAt))
      : []
  const users = await getUserSummaries(
    [
      ...rows.flatMap((row) => [
        row.createdBy,
        row.submittedBy,
        row.reviewedBy,
        row.delayReasonUpdatedBy,
      ]),
      ...submissionRows.flatMap((row) => [row.submittedBy, row.reviewedBy, row.adoptedBy]),
      ...attachmentRows.map((row) => row.createdBy),
      ...submissionAttachmentRows.map((row) => row.createdBy),
    ].filter(Boolean) as string[]
  )

  const lastReadByTaskId = new Map(receiptRows.map((row) => [row.taskId, row.lastReadAt]))
  const messagesByTaskId = new Map<string, typeof messageRows>()
  for (const message of messageRows) {
    const existing = messagesByTaskId.get(message.taskId) ?? []
    existing.push(message)
    messagesByTaskId.set(message.taskId, existing)
  }

  const dependencyTaskById = new Map(dependencyTaskRows.map((row) => [row.id, row]))
  const dependenciesByTaskId = new Map<string, typeof dependencyRows>()
  for (const dependency of dependencyRows) {
    const existing = dependenciesByTaskId.get(dependency.taskId) ?? []
    existing.push(dependency)
    dependenciesByTaskId.set(dependency.taskId, existing)
  }

  const attachmentsByTaskId = new Map<string, ProductionTaskAttachment[]>()
  for (const attachment of attachmentRows) {
    const existing = attachmentsByTaskId.get(attachment.taskId) ?? []
    existing.push(mapProductionTaskAttachment(attachment, users, 'task'))
    attachmentsByTaskId.set(attachment.taskId, existing)
  }

  const submissionAttachmentsByTaskId = new Map<string, ProductionTaskAttachment[]>()
  const submissionAttachmentsBySubmissionId = new Map<string, ProductionTaskAttachment[]>()
  for (const attachment of submissionAttachmentRows) {
    const mapped = mapProductionTaskAttachment(attachment, users, 'submission')
    const existing = submissionAttachmentsByTaskId.get(attachment.taskId) ?? []
    existing.push(mapped)
    submissionAttachmentsByTaskId.set(attachment.taskId, existing)
    if (attachment.submissionId) {
      const submissionExisting =
        submissionAttachmentsBySubmissionId.get(attachment.submissionId) ?? []
      submissionExisting.push(mapped)
      submissionAttachmentsBySubmissionId.set(attachment.submissionId, submissionExisting)
    }
  }

  const submissionsByTaskId = new Map<string, ProductionTaskSubmission[]>()
  for (const submission of submissionRows) {
    const existing = submissionsByTaskId.get(submission.taskId) ?? []
    existing.push({
      id: submission.id,
      taskId: submission.taskId,
      versionNumber: submission.versionNumber,
      workflowId: submission.workflowId,
      nodeId: submission.nodeId,
      note: submission.note,
      status: submission.status,
      submittedBy: submission.submittedBy ? (users.get(submission.submittedBy) ?? null) : null,
      submittedAt: submission.submittedAt.toISOString(),
      reviewedBy: submission.reviewedBy ? (users.get(submission.reviewedBy) ?? null) : null,
      reviewedAt: toIso(submission.reviewedAt),
      reviewNote: submission.reviewNote,
      adoptedBy: submission.adoptedBy ? (users.get(submission.adoptedBy) ?? null) : null,
      adoptedAt: toIso(submission.adoptedAt),
      createdAt: submission.createdAt.toISOString(),
      updatedAt: submission.updatedAt.toISOString(),
      attachments: submissionAttachmentsBySubmissionId.get(submission.id) ?? [],
    })
    submissionsByTaskId.set(submission.taskId, existing)
  }

  return rows.map((row) => {
    const sourceWorkgroup =
      workgroups.get(row.sourceWorkgroupId) ?? fallbackWorkgroup(row.sourceWorkgroupId)
    const assigneeWorkgroup =
      workgroups.get(row.assigneeWorkgroupId) ?? fallbackWorkgroup(row.assigneeWorkgroupId)
    const taskMessages = messagesByTaskId.get(row.id) ?? []
    const lastReadAt = lastReadByTaskId.get(row.id) ?? null
    const unreadMessageCount = taskMessages.filter(
      (message) =>
        message.senderUserId !== context.userId && (!lastReadAt || message.createdAt > lastReadAt)
    ).length
    const blockedBy = (dependenciesByTaskId.get(row.id) ?? []).flatMap((dependency) => {
      const dependencyTask = dependencyTaskById.get(dependency.dependsOnTaskId)
      if (!dependencyTask) return []
      return [
        {
          taskId: dependencyTask.id,
          title: dependencyTask.title,
          status: dependencyTask.status,
          dueAt: toIso(dependencyTask.dueAt),
        },
      ]
    })
    const submissions = submissionsByTaskId.get(row.id) ?? []
    const latestSubmission = submissions[0] ?? null

    return {
      id: row.id,
      organizationId: row.organizationId,
      sourceWorkspaceId: row.sourceWorkspaceId,
      sourceWorkflowId: row.sourceWorkflowId,
      sourceWorkgroup,
      assigneeWorkgroup,
      createdBy: row.createdBy ? (users.get(row.createdBy) ?? null) : null,
      title: row.title,
      description: row.description,
      dueAt: toIso(row.dueAt),
      status: row.status,
      resultWorkflowId: row.resultWorkflowId,
      resultNodeId: row.resultNodeId,
      submissionNote: row.submissionNote,
      reviewNote: row.reviewNote,
      submittedBy: row.submittedBy ? (users.get(row.submittedBy) ?? null) : null,
      submittedAt: toIso(row.submittedAt),
      reviewedBy: row.reviewedBy ? (users.get(row.reviewedBy) ?? null) : null,
      reviewedAt: toIso(row.reviewedAt),
      reminderSentAt: toIso(row.reminderSentAt),
      delayReason: row.delayReason,
      delayReasonUpdatedBy: row.delayReasonUpdatedBy
        ? (users.get(row.delayReasonUpdatedBy) ?? null)
        : null,
      delayReasonUpdatedAt: toIso(row.delayReasonUpdatedAt),
      delayReminderSentAt: toIso(row.delayReminderSentAt),
      archivedAt: toIso(row.archivedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      messageCount: taskMessages.length,
      unreadMessageCount,
      blockedBy,
      attachments: attachmentsByTaskId.get(row.id) ?? [],
      submissionAttachments:
        latestSubmission?.attachments ?? submissionAttachmentsByTaskId.get(row.id) ?? [],
      submissions,
      latestSubmission,
      permissions: computeTaskPermissions(row, context),
    }
  })
}

async function enrichTask(row: ProductionTaskRow, userId: string): Promise<ProductionTask> {
  const context = await getActorTaskContext(userId, row.organizationId)
  const permissions = computeTaskPermissions(row, context)
  assertAllowed(permissions.canMessage, 'Production task access denied')
  const [task] = await enrichTasks([row], context)
  return task
}

function recordProductionTaskAudit(params: {
  action:
    | typeof AuditAction.PRODUCTION_TASK_CREATED
    | typeof AuditAction.PRODUCTION_TASK_UPDATED
    | typeof AuditAction.PRODUCTION_TASK_SUBMITTED
    | typeof AuditAction.PRODUCTION_TASK_APPROVED
    | typeof AuditAction.PRODUCTION_TASK_CHANGES_REQUESTED
    | typeof AuditAction.PRODUCTION_TASK_MESSAGE_CREATED
    | typeof AuditAction.PRODUCTION_TASK_DDL_REMINDER
    | typeof AuditAction.PRODUCTION_TASK_DELAY_REASON_REQUIRED
  actorUserId: string
  task: ProductionTaskRow
  description: string
  metadata?: Record<string, unknown>
}) {
  recordAudit({
    workspaceId: params.task.sourceWorkspaceId,
    actorId: params.actorUserId,
    action: params.action,
    resourceType: AuditResourceType.PRODUCTION_TASK,
    resourceId: params.task.id,
    resourceName: params.task.title,
    description: params.description,
    metadata: {
      productionTaskEvent: params.action,
      organizationId: params.task.organizationId,
      sourceWorkspaceId: params.task.sourceWorkspaceId,
      sourceWorkflowId: params.task.sourceWorkflowId,
      sourceWorkgroupId: params.task.sourceWorkgroupId,
      assigneeWorkgroupId: params.task.assigneeWorkgroupId,
      status: params.task.status,
      dueAt: params.task.dueAt?.toISOString() ?? null,
      ...params.metadata,
    },
  })
}

function computeShowcasePermissions(
  item: ProductionShowcaseItemRow,
  context: ActorTaskContext
): { canWithdraw: boolean; canEdit: boolean } {
  const sourceAdmin = getMembershipRole(context, item.sourceWorkgroupId) === 'admin'
  const canManage =
    item.createdBy === context.userId ||
    sourceAdmin ||
    isOrganizationAdmin(context.organizationRole) ||
    isDirectorLikeContext(context)

  return {
    canWithdraw: canManage,
    canEdit: canManage,
  }
}

async function enrichShowcaseItems(
  rows: ProductionShowcaseItemRow[],
  context: ActorTaskContext
): Promise<ProductionShowcaseItem[]> {
  if (rows.length === 0) return []

  const itemIds = rows.map((row) => row.id)
  const workgroups = await getWorkgroupSummaries(rows.map((row) => row.sourceWorkgroupId))
  const submissionIds = rows.map((row) => row.submissionId).filter(Boolean) as string[]
  const submissionRows =
    submissionIds.length > 0
      ? await db
          .select({
            id: productionTaskSubmission.id,
            versionNumber: productionTaskSubmission.versionNumber,
          })
          .from(productionTaskSubmission)
          .where(inArray(productionTaskSubmission.id, submissionIds))
      : []
  const submissionVersionById = new Map(submissionRows.map((row) => [row.id, row.versionNumber]))
  const attachmentRows =
    itemIds.length > 0
      ? await db
          .select()
          .from(productionShowcaseAttachment)
          .where(inArray(productionShowcaseAttachment.itemId, itemIds))
          .orderBy(asc(productionShowcaseAttachment.createdAt))
      : []
  const users = await getUserSummaries(
    [
      ...rows.flatMap((row) => [row.createdBy, row.withdrawnBy]),
      ...attachmentRows.map((row) => row.createdBy),
    ].filter(Boolean) as string[]
  )
  const attachmentsByItemId = new Map<string, ProductionTaskAttachment[]>()
  for (const attachment of attachmentRows) {
    const existing = attachmentsByItemId.get(attachment.itemId) ?? []
    existing.push(mapProductionShowcaseAttachment(attachment, users))
    attachmentsByItemId.set(attachment.itemId, existing)
  }

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    sourceWorkspaceId: row.sourceWorkspaceId,
    sourceWorkflowId: row.sourceWorkflowId,
    sourceNodeId: row.sourceNodeId,
    sourceNodeVariant: normalizeShowcaseSourceNodeVariant(row.sourceNodeVariant),
    sourceWorkgroup:
      workgroups.get(row.sourceWorkgroupId) ?? fallbackWorkgroup(row.sourceWorkgroupId),
    taskId: row.taskId,
    submissionId: row.submissionId,
    submissionVersionNumber: row.submissionId
      ? (submissionVersionById.get(row.submissionId) ?? null)
      : null,
    title: row.title,
    description: row.description,
    category: normalizeShowcaseCategory(row.category),
    content: row.content,
    status: row.status === 'withdrawn' ? 'withdrawn' : 'published',
    createdBy: row.createdBy ? (users.get(row.createdBy) ?? null) : null,
    withdrawnBy: row.withdrawnBy ? (users.get(row.withdrawnBy) ?? null) : null,
    withdrawnAt: toIso(row.withdrawnAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    attachments: attachmentsByItemId.get(row.id) ?? [],
    permissions: computeShowcasePermissions(row, context),
  }))
}

function recordProductionShowcaseAudit(params: {
  action:
    | typeof AuditAction.PRODUCTION_SHOWCASE_ITEM_CREATED
    | typeof AuditAction.PRODUCTION_SHOWCASE_ITEM_WITHDRAWN
  actorUserId: string
  item: ProductionShowcaseItemRow
  description: string
}) {
  recordAudit({
    workspaceId: params.item.sourceWorkspaceId,
    actorId: params.actorUserId,
    action: params.action,
    resourceType: AuditResourceType.PRODUCTION_SHOWCASE_ITEM,
    resourceId: params.item.id,
    resourceName: params.item.title,
    description: params.description,
    metadata: {
      productionShowcaseEvent: params.action,
      organizationId: params.item.organizationId,
      sourceWorkspaceId: params.item.sourceWorkspaceId,
      sourceWorkgroupId: params.item.sourceWorkgroupId,
      sourceWorkflowId: params.item.sourceWorkflowId,
      sourceNodeId: params.item.sourceNodeId,
      sourceNodeVariant: params.item.sourceNodeVariant,
      taskId: params.item.taskId,
      submissionId: params.item.submissionId,
      category: params.item.category,
      status: params.item.status,
    },
  })
}

async function insertProductionShowcaseAttachments(params: {
  itemId: string
  userId: string
  attachments: ResolvedProductionTaskAttachmentInput[]
  createdAt?: Date
}) {
  if (params.attachments.length === 0) return

  const createdAt = params.createdAt ?? new Date()
  await db.insert(productionShowcaseAttachment).values(
    params.attachments.map((attachment) => ({
      id: generateId(),
      itemId: params.itemId,
      name: attachment.name,
      url: attachment.url,
      source: attachment.source,
      workspaceFileId: attachment.workspaceFileId,
      key: attachment.key,
      contentType: attachment.contentType,
      size: attachment.size,
      createdBy: params.userId,
      createdAt,
    }))
  )
}

async function replaceProductionShowcaseAttachments(params: {
  itemId: string
  userId: string
  attachments: ResolvedProductionTaskAttachmentInput[]
  createdAt?: Date
}) {
  await db
    .delete(productionShowcaseAttachment)
    .where(eq(productionShowcaseAttachment.itemId, params.itemId))
  await insertProductionShowcaseAttachments(params)
}

export async function listProductionShowcaseItems(params: {
  userId: string
  workspaceId: string
  category?: ProductionShowcaseCategory
  includeWithdrawn?: boolean
  limit?: number
}): Promise<ProductionShowcaseItem[]> {
  const workspaceContext = await resolveWorkspaceTaskContext(params.userId, params.workspaceId)
  const conditions: SQL[] = [
    eq(productionShowcaseItem.organizationId, workspaceContext.organizationId),
  ]
  if (params.category) {
    conditions.push(eq(productionShowcaseItem.category, params.category))
  }
  const canSeeWithdrawn =
    isOrganizationAdmin(workspaceContext.organizationRole) ||
    isDirectorLikeContext(workspaceContext)
  if (!params.includeWithdrawn || !canSeeWithdrawn) {
    conditions.push(eq(productionShowcaseItem.status, 'published'))
  }

  const rows = await db
    .select()
    .from(productionShowcaseItem)
    .where(and(...conditions))
    .orderBy(desc(productionShowcaseItem.createdAt))
    .limit(params.limit ?? 50)

  return enrichShowcaseItems(rows, workspaceContext)
}

export async function createProductionShowcaseItem(params: {
  userId: string
  workspaceId: string
  title: string
  description?: string | null
  category: ProductionShowcaseCategory
  content?: string | null
  sourceWorkflowId?: string | null
  sourceNodeId?: string | null
  sourceNodeVariant?: ProductionShowcaseSourceNodeVariant | null
  taskId?: string | null
  submissionId?: string | null
  attachments?: ProductionTaskAttachmentInput[]
}): Promise<ProductionShowcaseItem> {
  const context = await resolveWorkspaceTaskContext(params.userId, params.workspaceId)
  let taskId = params.taskId ?? null
  const submissionId = params.submissionId ?? null
  const sourceWorkflowId = params.sourceWorkflowId ?? null
  const sourceNodeId = params.sourceNodeId ?? null
  const sourceNodeVariant = params.sourceNodeVariant ?? null

  if (sourceWorkflowId) {
    await assertWorkflowBelongsToWorkspace(sourceWorkflowId, params.workspaceId)
  }

  if (sourceNodeId) {
    assertAllowed(Boolean(sourceWorkflowId), 'Source workflow is required for source node')
    await assertWorkflowBlockBelongsToWorkflow(sourceNodeId, sourceWorkflowId as string)
  }

  if (taskId) {
    const task = await getTaskRow(taskId)
    assertAllowed(task.organizationId === context.organizationId, 'Production task access denied')
    assertAllowed(computeTaskPermissions(task, context).canMessage, 'Production task access denied')
  }

  if (submissionId) {
    const [submission] = await db
      .select({
        id: productionTaskSubmission.id,
        taskId: productionTaskSubmission.taskId,
        organizationId: productionTask.organizationId,
      })
      .from(productionTaskSubmission)
      .innerJoin(productionTask, eq(productionTaskSubmission.taskId, productionTask.id))
      .where(eq(productionTaskSubmission.id, submissionId))
      .limit(1)
    assertFound(submission, 'Production task submission not found')
    assertAllowed(
      submission.organizationId === context.organizationId,
      'Production task access denied'
    )
    taskId = taskId ?? submission.taskId
  }

  const attachments = await resolveTaskAttachments({
    workspaceId: params.workspaceId,
    attachments: params.attachments ?? [],
  })
  assertAllowed(
    Boolean(params.content?.trim()) || attachments.length > 0 || Boolean(submissionId),
    'Publish text, attachments, or a task submission'
  )

  const now = new Date()
  const [row] = await db
    .insert(productionShowcaseItem)
    .values({
      id: generateId(),
      organizationId: context.organizationId,
      sourceWorkspaceId: params.workspaceId,
      sourceWorkgroupId: context.workgroupId,
      sourceWorkflowId,
      sourceNodeId,
      sourceNodeVariant,
      taskId,
      submissionId,
      title: params.title,
      description: params.description ?? null,
      category: params.category,
      content: params.content?.trim() || null,
      status: 'published',
      createdBy: params.userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  await insertProductionShowcaseAttachments({
    itemId: row.id,
    userId: params.userId,
    attachments,
    createdAt: now,
  })

  recordProductionShowcaseAudit({
    action: AuditAction.PRODUCTION_SHOWCASE_ITEM_CREATED,
    actorUserId: params.userId,
    item: row,
    description: `Project overview result "${row.title}" was published`,
  })

  const [item] = await enrichShowcaseItems([row], context)
  return item
}

export async function getProductionShowcaseItem(params: {
  userId: string
  workspaceId: string
  itemId: string
}): Promise<ProductionShowcaseItem> {
  const context = await resolveWorkspaceTaskContext(params.userId, params.workspaceId)
  const [row] = await db
    .select()
    .from(productionShowcaseItem)
    .where(eq(productionShowcaseItem.id, params.itemId))
    .limit(1)
  const item = assertFound(row, 'Production showcase item not found')
  assertAllowed(item.organizationId === context.organizationId, 'Production showcase access denied')

  const [enriched] = await enrichShowcaseItems([item], context)
  return enriched
}

export async function updateProductionShowcaseItem(params: {
  userId: string
  workspaceId: string
  itemId: string
  title?: string
  description?: string | null
  category?: ProductionShowcaseCategory
  content?: string | null
  attachments?: ProductionTaskAttachmentInput[]
}): Promise<ProductionShowcaseItem> {
  const context = await resolveWorkspaceTaskContext(params.userId, params.workspaceId)
  const [existing] = await db
    .select()
    .from(productionShowcaseItem)
    .where(eq(productionShowcaseItem.id, params.itemId))
    .limit(1)
  const item = assertFound(existing, 'Production showcase item not found')
  assertAllowed(item.organizationId === context.organizationId, 'Production showcase access denied')
  assertAllowed(computeShowcasePermissions(item, context).canEdit, 'Showcase edit access required')

  const now = new Date()
  const updates: Partial<typeof productionShowcaseItem.$inferInsert> = { updatedAt: now }
  if (params.title !== undefined) {
    updates.title = params.title
  }
  if (params.description !== undefined) {
    updates.description = params.description?.trim() || null
  }
  if (params.category !== undefined) {
    updates.category = params.category
  }
  if (params.content !== undefined) {
    updates.content = params.content?.trim() || null
  }

  const [row] = await db
    .update(productionShowcaseItem)
    .set(updates)
    .where(eq(productionShowcaseItem.id, params.itemId))
    .returning()

  if (params.attachments !== undefined) {
    const attachments = await resolveTaskAttachments({
      workspaceId: params.workspaceId,
      attachments: params.attachments,
    })
    await replaceProductionShowcaseAttachments({
      itemId: params.itemId,
      userId: params.userId,
      attachments,
      createdAt: now,
    })
  }

  const [enriched] = await enrichShowcaseItems([row], context)
  return enriched
}

export async function withdrawProductionShowcaseItem(params: {
  userId: string
  workspaceId: string
  itemId: string
}): Promise<ProductionShowcaseItem> {
  const context = await resolveWorkspaceTaskContext(params.userId, params.workspaceId)
  const [existing] = await db
    .select()
    .from(productionShowcaseItem)
    .where(eq(productionShowcaseItem.id, params.itemId))
    .limit(1)
  const item = assertFound(existing, 'Production showcase item not found')
  assertAllowed(item.organizationId === context.organizationId, 'Production showcase access denied')
  assertAllowed(
    computeShowcasePermissions(item, context).canWithdraw,
    'Showcase withdraw access required'
  )

  const now = new Date()
  const [row] = await db
    .update(productionShowcaseItem)
    .set({
      status: 'withdrawn',
      withdrawnBy: params.userId,
      withdrawnAt: now,
      updatedAt: now,
    })
    .where(eq(productionShowcaseItem.id, params.itemId))
    .returning()

  recordProductionShowcaseAudit({
    action: AuditAction.PRODUCTION_SHOWCASE_ITEM_WITHDRAWN,
    actorUserId: params.userId,
    item: row,
    description: `Project overview result "${row.title}" was withdrawn`,
  })

  const [enriched] = await enrichShowcaseItems([row], context)
  return enriched
}

export async function downloadProductionShowcaseAttachment(params: {
  userId: string
  itemId: string
  attachmentId: string
}): Promise<{ buffer: Buffer; name: string; contentType: string }> {
  const [item] = await db
    .select()
    .from(productionShowcaseItem)
    .where(eq(productionShowcaseItem.id, params.itemId))
    .limit(1)
  const showcaseItem = assertFound(item, 'Production showcase item not found')
  const context = await getActorTaskContext(params.userId, showcaseItem.organizationId)
  assertAllowed(
    context.memberships.length > 0 || isOrganizationAdmin(context.organizationRole),
    'Production showcase access denied'
  )

  const [attachment] = await db
    .select()
    .from(productionShowcaseAttachment)
    .where(
      and(
        eq(productionShowcaseAttachment.id, params.attachmentId),
        eq(productionShowcaseAttachment.itemId, params.itemId)
      )
    )
    .limit(1)
  assertFound(attachment, 'Production showcase attachment not found')
  assertAllowed(
    attachment.source === 'workspace_file' && Boolean(attachment.key),
    'Only uploaded showcase files can be downloaded through this endpoint'
  )

  const buffer = await downloadFile({
    key: attachment.key as string,
    context: 'workspace',
  })
  return {
    buffer,
    name: attachment.name,
    contentType: attachment.contentType ?? 'application/octet-stream',
  }
}

export async function listProductionTasks(params: {
  userId: string
  workspaceId: string
  workflowId?: string
  scope?: ProductionTaskScope
  status?: ProductionTaskStatus
  limit?: number
}): Promise<ProductionTask[]> {
  const context = await resolveWorkspaceTaskContext(params.userId, params.workspaceId)
  const scope = params.scope ?? 'auto'
  const canUseOrgWideScope =
    isOrganizationAdmin(context.organizationRole) || isDirectorLikeContext(context)
  const requestedOrgWideScope = scope === 'all' || scope === 'director'
  const orgWide = requestedOrgWideScope || (scope === 'auto' && canUseOrgWideScope)

  if (requestedOrgWideScope && !canUseOrgWideScope) {
    throw new ProductionTaskServiceError('Director task scope required', 403)
  }

  const conditions: SQL[] = [eq(productionTask.organizationId, context.organizationId)]
  if (!orgWide) {
    const workgroupIds = getVisibleWorkgroupIds(context)
    if (workgroupIds.length === 0) return []
    conditions.push(
      or(
        inArray(productionTask.sourceWorkgroupId, workgroupIds),
        inArray(productionTask.assigneeWorkgroupId, workgroupIds)
      ) as SQL
    )
  }
  if (params.workflowId) {
    conditions.push(
      or(
        eq(productionTask.sourceWorkflowId, params.workflowId),
        eq(productionTask.resultWorkflowId, params.workflowId)
      ) as SQL
    )
  }
  if (params.status) {
    conditions.push(eq(productionTask.status, params.status))
  }

  const rows = await db
    .select()
    .from(productionTask)
    .where(and(...conditions))
    .orderBy(sql`${productionTask.dueAt} asc nulls last`, desc(productionTask.updatedAt))
    .limit(params.limit ?? 50)

  return enrichTasks(rows, context)
}

export async function getProductionTask(params: {
  userId: string
  workspaceId: string
  taskId: string
}): Promise<ProductionTask> {
  const workspaceContext = await resolveWorkspaceTaskContext(params.userId, params.workspaceId)
  const row = await getTaskRow(params.taskId)
  assertAllowed(
    row.organizationId === workspaceContext.organizationId,
    'Production task access denied'
  )
  return enrichTask(row, params.userId)
}

export async function getProductionTaskCapabilities(params: {
  userId: string
  workspaceId: string
}): Promise<{ canCreateProductionTask: boolean }> {
  const context = await resolveWorkspaceTaskContext(params.userId, params.workspaceId)
  return { canCreateProductionTask: isDirectorLikeContext(context) }
}

interface MobileProjectAccess {
  organizationId: string
  workspaceId: string
  name: string
  metadata: unknown
  context: ActorTaskContext
}

async function getMobileProjectAccess(userId: string): Promise<MobileProjectAccess[]> {
  const rows = await db
    .select({
      organizationId: organization.id,
      organizationName: organization.name,
      organizationMetadata: organization.metadata,
      workspaceId: workgroup.teamWorkspaceId,
    })
    .from(workgroup)
    .innerJoin(organization, eq(workgroup.organizationId, organization.id))
    .where(and(isNull(workgroup.archivedAt), isNotNull(workgroup.teamWorkspaceId)))
    .orderBy(asc(workgroup.createdAt))

  const byOrganization = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    if (!row.workspaceId || byOrganization.has(row.organizationId)) continue
    const metadata = readMobileProjectMetadata(row.organizationMetadata)
    if (metadata.productionProject) byOrganization.set(row.organizationId, row)
  }

  const candidates = await Promise.all(
    [...byOrganization.values()].map(async (row) => {
      const context = await getActorTaskContext(userId, row.organizationId).catch(() => null)
      if (!context) return null
      const canAccess =
        isOrganizationAdmin(context.organizationRole) || context.memberships.length > 0
      if (!canAccess) return null
      return {
        organizationId: row.organizationId,
        workspaceId: row.workspaceId as string,
        name: row.organizationName,
        metadata: row.organizationMetadata,
        context,
      }
    })
  )
  return candidates.filter((project): project is MobileProjectAccess => project !== null)
}

async function getMobileMetricTasks(
  userId: string,
  projects: readonly MobileProjectAccess[]
): Promise<Map<string, Array<MobileMetricTask & { row: ProductionTaskRow }>>> {
  if (projects.length === 0) return new Map()
  const visibilityConditions = projects.map((project) => {
    const canSeeOrganization =
      isOrganizationAdmin(project.context.organizationRole) ||
      isDirectorLikeContext(project.context)
    if (canSeeOrganization) return eq(productionTask.organizationId, project.organizationId)
    const workgroupIds = getVisibleWorkgroupIds(project.context)
    return and(
      eq(productionTask.organizationId, project.organizationId),
      or(
        inArray(productionTask.sourceWorkgroupId, workgroupIds),
        inArray(productionTask.assigneeWorkgroupId, workgroupIds)
      )
    )
  })
  const rows = await db
    .select()
    .from(productionTask)
    .where(or(...visibilityConditions))

  if (rows.length === 0) return new Map()
  const taskIds = rows.map((row) => row.id)
  const [messageRows, receiptRows, adoptedRows] = await Promise.all([
    db
      .select({
        taskId: productionTaskMessage.taskId,
        senderUserId: productionTaskMessage.senderUserId,
        createdAt: productionTaskMessage.createdAt,
      })
      .from(productionTaskMessage)
      .where(inArray(productionTaskMessage.taskId, taskIds)),
    db
      .select({
        taskId: productionTaskReadReceipt.taskId,
        lastReadAt: productionTaskReadReceipt.lastReadAt,
      })
      .from(productionTaskReadReceipt)
      .where(
        and(
          eq(productionTaskReadReceipt.userId, userId),
          inArray(productionTaskReadReceipt.taskId, taskIds)
        )
      ),
    db
      .select({ taskId: productionTaskSubmission.taskId })
      .from(productionTaskSubmission)
      .where(
        and(
          inArray(productionTaskSubmission.taskId, taskIds),
          sql`${productionTaskSubmission.adoptedAt} is not null`
        )
      ),
  ])
  const lastReadByTask = new Map(receiptRows.map((row) => [row.taskId, row.lastReadAt]))
  const unreadByTask = new Map<string, number>()
  for (const message of messageRows) {
    const lastRead = lastReadByTask.get(message.taskId)
    if (message.senderUserId !== userId && (!lastRead || message.createdAt > lastRead)) {
      unreadByTask.set(message.taskId, (unreadByTask.get(message.taskId) ?? 0) + 1)
    }
  }
  const adoptedTaskIds = new Set(adoptedRows.map((row) => row.taskId))
  const byOrganization = new Map<string, Array<MobileMetricTask & { row: ProductionTaskRow }>>()
  for (const row of rows) {
    const current = byOrganization.get(row.organizationId) ?? []
    current.push({
      row,
      dueAt: row.dueAt,
      status: row.status,
      unreadMessageCount: unreadByTask.get(row.id) ?? 0,
      adopted: adoptedTaskIds.has(row.id),
    })
    byOrganization.set(row.organizationId, current)
  }
  return byOrganization
}

function toMobileProjectSummary(
  project: MobileProjectAccess,
  tasks: readonly MobileMetricTask[]
): MobileProjectSummary {
  const metadata = readMobileProjectMetadata(project.metadata)
  return {
    workspaceId: project.workspaceId,
    organizationId: project.organizationId,
    name: project.name,
    status: metadata.status,
    estimatedDueAt: metadata.estimatedDueAt,
    canCreateProductionTask: isDirectorLikeContext(project.context),
    metrics: computeMobileProjectMetrics(tasks),
  }
}

export async function listMobileProductionProjects(params: {
  userId: string
}): Promise<MobileProjectSummary[]> {
  const projects = await getMobileProjectAccess(params.userId)
  const tasksByOrganization = await getMobileMetricTasks(params.userId, projects)
  return projects
    .map((project) =>
      toMobileProjectSummary(project, tasksByOrganization.get(project.organizationId) ?? [])
    )
    .sort((left, right) => {
      const leftRisk =
        left.metrics.overdue * 100 + left.metrics.pendingReview * 10 + left.metrics.dueSoon
      const rightRisk =
        right.metrics.overdue * 100 + right.metrics.pendingReview * 10 + right.metrics.dueSoon
      return rightRisk - leftRisk || left.name.localeCompare(right.name, 'zh-CN')
    })
}

function matchesMobileTaskFilter(status: ProductionTaskStatus, filter: MobileTaskFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'in_progress') {
    return status === 'todo' || status === 'in_progress' || status === 'changes_requested'
  }
  if (filter === 'pending_review') return status === 'submitted'
  return COMPLETED_TASK_STATUSES.has(status)
}

function getMobileTaskPriority(task: MobileMetricTask, now: Date): number {
  if (!COMPLETED_TASK_STATUSES.has(task.status) && task.dueAt && task.dueAt < now) return 0
  if (task.status === 'submitted') return 1
  if (
    !COMPLETED_TASK_STATUSES.has(task.status) &&
    task.dueAt &&
    task.dueAt <= new Date(now.getTime() + 24 * 60 * 60 * 1000)
  ) {
    return 2
  }
  if (COMPLETED_TASK_STATUSES.has(task.status)) return 4
  return 3
}

export async function getMobileProductionProject(params: {
  userId: string
  workspaceId: string
  taskFilter?: MobileTaskFilter
  limit?: number
  offset?: number
}): Promise<MobileProjectDetailResponse> {
  await resolveWorkspaceTaskContext(params.userId, params.workspaceId)
  const projects = await getMobileProjectAccess(params.userId)
  const project = assertFound(
    projects.find((item) => item.workspaceId === params.workspaceId),
    'Production project not found'
  )
  const tasksByOrganization = await getMobileMetricTasks(params.userId, [project])
  const metricTasks = tasksByOrganization.get(project.organizationId) ?? []
  const filter = params.taskFilter ?? 'all'
  const now = new Date()
  const filtered = metricTasks
    .filter((task) => matchesMobileTaskFilter(task.status, filter))
    .sort((left, right) => {
      const priority = getMobileTaskPriority(left, now) - getMobileTaskPriority(right, now)
      if (priority !== 0) return priority
      return (
        (left.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (right.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
      )
    })
  const offset = params.offset ?? 0
  const limit = params.limit ?? MOBILE_PROJECT_DETAIL_LIMIT
  const pageRows = filtered.slice(offset, offset + limit)
  const workgroups = await getWorkgroupSummaries(
    pageRows.map((task) => task.row.assigneeWorkgroupId)
  )
  const tasks: MobileTaskSummary[] = pageRows.map((task) => ({
    id: task.row.id,
    title: task.row.title,
    status: task.row.status,
    dueAt: toIso(task.row.dueAt),
    delayReason: task.row.delayReason,
    unreadMessageCount: task.unreadMessageCount,
    assigneeWorkgroup:
      workgroups.get(task.row.assigneeWorkgroupId) ??
      fallbackWorkgroup(task.row.assigneeWorkgroupId),
  }))
  const [showcaseItems, assignableRows] = await Promise.all([
    listProductionShowcaseItems({
      userId: params.userId,
      workspaceId: params.workspaceId,
      limit: 30,
    }),
    db
      .select({ id: workgroup.id, name: workgroup.name, disciplineName: discipline.name })
      .from(workgroup)
      .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
      .where(
        and(eq(workgroup.organizationId, project.organizationId), isNull(workgroup.archivedAt))
      )
      .orderBy(asc(discipline.sortOrder), asc(workgroup.name)),
  ])
  const assignableWorkgroups: MobileAssignableWorkgroup[] = assignableRows

  return {
    project: toMobileProjectSummary(project, metricTasks),
    tasks,
    taskPage: {
      total: filtered.length,
      offset,
      limit,
      hasMore: offset + tasks.length < filtered.length,
    },
    showcaseItems: showcaseItems.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      content: item.content,
      category: item.category,
      status: item.status,
      sourceWorkgroup: item.sourceWorkgroup,
      createdAt: item.createdAt,
      attachments: item.attachments,
    })),
    assignableWorkgroups,
  }
}

export async function createProductionTask(params: {
  userId: string
  workspaceId: string
  sourceWorkflowId?: string
  assigneeWorkgroupId: string
  title: string
  description?: string | null
  dueAt?: string | null
  dependencyTaskIds?: string[]
  attachments?: ProductionTaskAttachmentInput[]
}): Promise<ProductionTask> {
  const context = await resolveWorkspaceTaskContext(params.userId, params.workspaceId)
  const canCreate = isDirectorLikeContext(context)
  assertAllowed(canCreate, 'Production task creation requires director team access')

  const assignee = assertFound(
    await getActiveWorkgroup(params.assigneeWorkgroupId),
    'Assignee workgroup not found'
  )
  assertAllowed(
    assignee.organizationId === context.organizationId,
    'Assignee workgroup must be in the same organization'
  )

  if (params.sourceWorkflowId) {
    await assertWorkflowBelongsToWorkspace(params.sourceWorkflowId, params.workspaceId)
  }
  const dependencyTaskIds = await assertDependencyTasks({
    organizationId: context.organizationId,
    dependencyTaskIds: params.dependencyTaskIds,
  })

  const now = new Date()
  const [row] = await db
    .insert(productionTask)
    .values({
      id: generateId(),
      organizationId: context.organizationId,
      sourceWorkspaceId: params.workspaceId,
      sourceWorkflowId: params.sourceWorkflowId ?? null,
      sourceWorkgroupId: context.workgroupId,
      assigneeWorkgroupId: params.assigneeWorkgroupId,
      createdBy: params.userId,
      title: params.title,
      description: params.description ?? null,
      dueAt: params.dueAt ? new Date(params.dueAt) : null,
      status: 'todo',
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  if (dependencyTaskIds.length > 0) {
    await replaceTaskDependencies({
      taskId: row.id,
      dependencyTaskIds,
      createdAt: now,
    })
  }
  if (params.attachments !== undefined) {
    const attachments = await resolveTaskAttachments({
      workspaceId: params.workspaceId,
      attachments: params.attachments,
    })
    await replaceTaskAttachments({
      taskId: row.id,
      userId: params.userId,
      attachments,
      createdAt: now,
    })
  }

  recordProductionTaskAudit({
    action: AuditAction.PRODUCTION_TASK_CREATED,
    actorUserId: params.userId,
    task: row,
    description: `Production task "${row.title}" was created`,
    metadata: { productionTaskNotification: true },
  })

  await notifyProductionTaskRealtime({ task: row, event: 'created' })

  return enrichTask(row, params.userId)
}

export async function updateProductionTask(params: {
  userId: string
  taskId: string
  title?: string
  description?: string | null
  dueAt?: string | null
  assigneeWorkgroupId?: string
  status?: ProductionTaskStatus
  dependencyTaskIds?: string[]
  attachments?: ProductionTaskAttachmentInput[]
  delayReason?: string | null
}): Promise<ProductionTask> {
  const existing = await getTaskRow(params.taskId)
  const context = await getActorTaskContext(params.userId, existing.organizationId)
  const permissions = computeTaskPermissions(existing, context)
  const hasMetadataEdit =
    params.title !== undefined ||
    params.description !== undefined ||
    params.dueAt !== undefined ||
    params.assigneeWorkgroupId !== undefined ||
    params.dependencyTaskIds !== undefined ||
    params.attachments !== undefined
  const assigneeStatusUpdate =
    params.status === 'in_progress' &&
    !hasMetadataEdit &&
    params.delayReason === undefined &&
    permissions.canSubmit &&
    (existing.status === 'todo' || existing.status === 'changes_requested')
  const assigneeDelayReasonUpdate =
    params.delayReason !== undefined &&
    !hasMetadataEdit &&
    params.status === undefined &&
    Boolean(getMembershipRole(context, existing.assigneeWorkgroupId))
  assertAllowed(
    permissions.canEdit || assigneeStatusUpdate || assigneeDelayReasonUpdate,
    'Production task edit access required'
  )

  if (params.status !== undefined) {
    assertValidUpdateStatusTransition(existing.status, params.status)
  }

  if (params.assigneeWorkgroupId) {
    const assignee = assertFound(
      await getActiveWorkgroup(params.assigneeWorkgroupId),
      'Assignee workgroup not found'
    )
    assertAllowed(
      assignee.organizationId === existing.organizationId,
      'Assignee workgroup must be in the same organization'
    )
  }
  const dependencyTaskIds =
    params.dependencyTaskIds !== undefined
      ? await assertDependencyTasks({
          organizationId: existing.organizationId,
          taskId: existing.id,
          dependencyTaskIds: params.dependencyTaskIds,
        })
      : undefined

  const now = new Date()
  const status = params.status
  const delayReason =
    params.delayReason === undefined ? undefined : params.delayReason?.trim() || null
  const [row] = await db
    .update(productionTask)
    .set({
      ...(params.title !== undefined ? { title: params.title } : {}),
      ...(params.description !== undefined ? { description: params.description } : {}),
      ...(params.dueAt !== undefined
        ? { dueAt: params.dueAt ? new Date(params.dueAt) : null }
        : {}),
      ...(params.assigneeWorkgroupId !== undefined
        ? { assigneeWorkgroupId: params.assigneeWorkgroupId }
        : {}),
      ...(status !== undefined ? { status } : {}),
      ...(status === 'archived' ? { archivedAt: now } : {}),
      ...(params.delayReason !== undefined
        ? {
            delayReason,
            delayReasonUpdatedBy: params.userId,
            delayReasonUpdatedAt: now,
            delayReminderSentAt: null,
          }
        : {}),
      ...(params.dueAt !== undefined
        ? {
            reminderSentAt: null,
            delayReminderSentAt: null,
          }
        : {}),
      updatedAt: now,
    })
    .where(eq(productionTask.id, params.taskId))
    .returning()

  if (dependencyTaskIds !== undefined) {
    await replaceTaskDependencies({
      taskId: row.id,
      dependencyTaskIds,
      createdAt: now,
    })
  }
  if (params.attachments !== undefined) {
    const attachments = await resolveTaskAttachments({
      workspaceId: existing.sourceWorkspaceId,
      attachments: params.attachments,
    })
    await replaceTaskAttachments({
      taskId: row.id,
      userId: params.userId,
      attachments,
      createdAt: now,
    })
  }

  recordProductionTaskAudit({
    action: AuditAction.PRODUCTION_TASK_UPDATED,
    actorUserId: params.userId,
    task: row,
    description: `Production task "${row.title}" was updated`,
    metadata: { productionTaskNotification: true },
  })

  await notifyProductionTaskRealtime({ task: row, event: 'updated' })

  return enrichTask(row, params.userId)
}

export async function submitProductionTask(params: {
  userId: string
  taskId: string
  workspaceId: string
  workflowId?: string
  nodeId?: string
  submissionNote?: string | null
  attachments?: ProductionTaskAttachmentInput[]
}): Promise<ProductionTask> {
  const existing = await getTaskRow(params.taskId)
  const context = await resolveWorkspaceTaskContext(params.userId, params.workspaceId)
  assertAllowed(context.organizationId === existing.organizationId, 'Production task access denied')
  const permissions = computeTaskPermissions(existing, context)
  assertAllowed(permissions.canSubmit, 'Production task submit access required')
  assertAllowed(
    isOrganizationAdmin(context.organizationRole) ||
      getMembershipRole(context, existing.assigneeWorkgroupId) !== null,
    'Only the assignee workgroup can submit this task'
  )
  assertAllowed(
    (MUTABLE_SUBMISSION_STATUSES as readonly ProductionTaskStatus[]).includes(existing.status),
    'Only active tasks can be submitted'
  )

  const hasNodeSubmission = Boolean(params.workflowId && params.nodeId)
  const submissionNote = params.submissionNote?.trim() || null
  const submissionAttachments = await resolveTaskAttachments({
    workspaceId: params.workspaceId,
    attachments: params.attachments ?? [],
  })
  assertAllowed(
    hasNodeSubmission || Boolean(submissionNote) || submissionAttachments.length > 0,
    'Submit a node, note, or attachment'
  )
  if (hasNodeSubmission && params.workflowId) {
    await assertWorkflowBelongsToWorkspace(params.workflowId, params.workspaceId)
  }

  const now = new Date()
  const versionNumber = await getNextSubmissionVersion(params.taskId)
  const submissionId = generateId()
  const [row] = await db
    .update(productionTask)
    .set({
      resultWorkflowId: params.workflowId ?? null,
      resultNodeId: params.nodeId ?? null,
      submissionNote,
      status: 'submitted',
      submittedBy: params.userId,
      submittedAt: now,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      updatedAt: now,
    })
    .where(eq(productionTask.id, params.taskId))
    .returning()

  await db.insert(productionTaskSubmission).values({
    id: submissionId,
    taskId: row.id,
    versionNumber,
    workflowId: params.workflowId ?? null,
    nodeId: params.nodeId ?? null,
    note: submissionNote,
    status: 'submitted',
    submittedBy: params.userId,
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
  })

  await insertTaskSubmissionAttachments({
    taskId: row.id,
    submissionId,
    userId: params.userId,
    attachments: submissionAttachments,
    createdAt: now,
  })

  recordProductionTaskAudit({
    action: AuditAction.PRODUCTION_TASK_SUBMITTED,
    actorUserId: params.userId,
    task: row,
    description: `Production task "${row.title}" was submitted for review`,
    metadata: {
      productionTaskNotification: true,
      resultWorkflowId: params.workflowId ?? null,
      resultNodeId: params.nodeId ?? null,
      hasSubmissionNote: Boolean(submissionNote),
      submissionAttachmentCount: submissionAttachments.length,
      submissionId,
      submissionVersionNumber: versionNumber,
    },
  })

  await notifyProductionTaskRealtime({ task: row, event: 'submitted' })

  return enrichTask(row, params.userId)
}

export async function downloadProductionTaskAttachment(params: {
  userId: string
  taskId: string
  attachmentId: string
  kind: ProductionTaskAttachmentKind
}): Promise<{ buffer: Buffer; name: string; contentType: string }> {
  const task = await getTaskRow(params.taskId)
  const context = await getActorTaskContext(params.userId, task.organizationId)
  const permissions = computeTaskPermissions(task, context)
  assertAllowed(permissions.canMessage, 'Production task attachment access required')

  const [attachment] =
    params.kind === 'submission'
      ? await db
          .select()
          .from(productionTaskSubmissionAttachment)
          .where(
            and(
              eq(productionTaskSubmissionAttachment.id, params.attachmentId),
              eq(productionTaskSubmissionAttachment.taskId, params.taskId)
            )
          )
          .limit(1)
      : await db
          .select()
          .from(productionTaskAttachment)
          .where(
            and(
              eq(productionTaskAttachment.id, params.attachmentId),
              eq(productionTaskAttachment.taskId, params.taskId)
            )
          )
          .limit(1)

  assertFound(attachment, 'Production task attachment not found')
  assertAllowed(
    attachment.source === 'workspace_file' && Boolean(attachment.key),
    'Only uploaded task files can be downloaded through this endpoint'
  )

  const buffer = await downloadFile({
    key: attachment.key as string,
    context: 'workspace',
  })
  return {
    buffer,
    name: attachment.name,
    contentType: attachment.contentType ?? 'application/octet-stream',
  }
}

export async function reviewProductionTask(params: {
  userId: string
  taskId: string
  action: 'approve' | 'request_changes'
  reviewNote?: string | null
}): Promise<ProductionTask> {
  const existing = await getTaskRow(params.taskId)
  const context = await getActorTaskContext(params.userId, existing.organizationId)
  const permissions = computeTaskPermissions(existing, context)
  assertAllowed(permissions.canReview, 'Production task review access required')
  assertAllowed(existing.status === 'submitted', 'Only submitted tasks can be reviewed')

  const now = new Date()
  const submission = await getLatestSubmittedSubmission(params.taskId)
  const status: ProductionTaskStatus =
    params.action === 'approve' ? 'approved' : 'changes_requested'
  const [row] = await db
    .update(productionTask)
    .set({
      status,
      reviewNote: params.reviewNote ?? null,
      reviewedBy: params.userId,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(eq(productionTask.id, params.taskId))
    .returning()

  if (params.action === 'approve') {
    await db
      .update(productionTaskSubmission)
      .set({ adoptedAt: null, adoptedBy: null, updatedAt: now })
      .where(eq(productionTaskSubmission.taskId, params.taskId))
  }

  await db
    .update(productionTaskSubmission)
    .set({
      status,
      reviewNote: params.reviewNote ?? null,
      reviewedBy: params.userId,
      reviewedAt: now,
      adoptedBy: params.action === 'approve' ? params.userId : null,
      adoptedAt: params.action === 'approve' ? now : null,
      updatedAt: now,
    })
    .where(eq(productionTaskSubmission.id, submission.id))

  recordProductionTaskAudit({
    action:
      params.action === 'approve'
        ? AuditAction.PRODUCTION_TASK_APPROVED
        : AuditAction.PRODUCTION_TASK_CHANGES_REQUESTED,
    actorUserId: params.userId,
    task: row,
    description:
      params.action === 'approve'
        ? `Production task "${row.title}" was approved`
        : `Production task "${row.title}" needs changes`,
    metadata: {
      productionTaskNotification: true,
      reviewNote: params.reviewNote ?? null,
      submissionId: submission.id,
      submissionVersionNumber: submission.versionNumber,
    },
  })

  await notifyProductionTaskRealtime({
    task: row,
    event: params.action === 'approve' ? 'approved' : 'changes_requested',
  })

  return enrichTask(row, params.userId)
}

async function getSenderAgentCode(
  userId: string,
  task: ProductionTaskRow
): Promise<AgentCode | null> {
  const context = await getActorTaskContext(userId, task.organizationId)
  const assigneeMembership = context.memberships.find(
    (membership) => membership.workgroupId === task.assigneeWorkgroupId
  )
  if (assigneeMembership?.agentCode) return assigneeMembership.agentCode
  const sourceMembership = context.memberships.find(
    (membership) => membership.workgroupId === task.sourceWorkgroupId
  )
  if (sourceMembership?.agentCode) return sourceMembership.agentCode
  return context.memberships.find((membership) => membership.agentCode)?.agentCode ?? null
}

async function enrichMessages(rows: ProductionTaskMessageRow[]): Promise<ProductionTaskMessage[]> {
  const users = await getUserSummaries(
    rows.map((row) => row.senderUserId).filter(Boolean) as string[]
  )
  return rows.map((row) => ({
    id: row.id,
    taskId: row.taskId,
    senderUser: row.senderUserId ? (users.get(row.senderUserId) ?? null) : null,
    senderAgentCode: normalizeAgentCode(row.senderAgentCode),
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  }))
}

export async function listProductionTaskMessages(params: {
  userId: string
  taskId: string
}): Promise<ProductionTaskMessage[]> {
  const task = await getTaskRow(params.taskId)
  const context = await getActorTaskContext(params.userId, task.organizationId)
  const permissions = computeTaskPermissions(task, context)
  assertAllowed(permissions.canMessage, 'Production task message access required')

  const rows = await db
    .select()
    .from(productionTaskMessage)
    .where(eq(productionTaskMessage.taskId, params.taskId))
    .orderBy(asc(productionTaskMessage.createdAt))

  return enrichMessages(rows)
}

export async function createProductionTaskMessage(params: {
  userId: string
  taskId: string
  body: string
}): Promise<ProductionTaskMessage> {
  const task = await getTaskRow(params.taskId)
  const context = await getActorTaskContext(params.userId, task.organizationId)
  const permissions = computeTaskPermissions(task, context)
  assertAllowed(permissions.canMessage, 'Production task message access required')

  const senderAgentCode = await getSenderAgentCode(params.userId, task)
  const [row] = await db
    .insert(productionTaskMessage)
    .values({
      id: generateId(),
      taskId: params.taskId,
      senderUserId: params.userId,
      senderAgentCode,
      body: params.body,
      createdAt: new Date(),
    })
    .returning()

  await markProductionTaskRead({
    userId: params.userId,
    taskId: params.taskId,
  })

  recordProductionTaskAudit({
    action: AuditAction.PRODUCTION_TASK_MESSAGE_CREATED,
    actorUserId: params.userId,
    task,
    description: `Production task "${task.title}" received a new message`,
    metadata: { productionTaskNotification: true, messageId: row.id },
  })

  await notifyProductionTaskRealtime({ task, event: 'message_created' })

  const [message] = await enrichMessages([row])
  return message
}

export async function markProductionTaskRead(params: {
  userId: string
  taskId: string
}): Promise<string> {
  const task = await getTaskRow(params.taskId)
  const context = await getActorTaskContext(params.userId, task.organizationId)
  const permissions = computeTaskPermissions(task, context)
  assertAllowed(permissions.canMessage, 'Production task read access required')

  const now = new Date()
  await db
    .insert(productionTaskReadReceipt)
    .values({
      id: generateId(),
      taskId: params.taskId,
      userId: params.userId,
      lastReadAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [productionTaskReadReceipt.taskId, productionTaskReadReceipt.userId],
      set: { lastReadAt: now, updatedAt: now },
    })

  return now.toISOString()
}

export async function scanProductionTaskReminders(params?: {
  limit?: number
}): Promise<{ scannedAt: string; remindedCount: number; taskIds: string[] }> {
  const scannedAt = new Date()
  const horizon = new Date(scannedAt.getTime() + 24 * 60 * 60 * 1000)
  const lastDailyReminderCutoff = new Date(scannedAt.getTime() - 24 * 60 * 60 * 1000)
  const limit = params?.limit ?? 100

  const upcomingRows = await db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: productionTask.id })
      .from(productionTask)
      .where(
        and(
          isNull(productionTask.reminderSentAt),
          gte(productionTask.dueAt, scannedAt),
          lte(productionTask.dueAt, horizon),
          not(inArray(productionTask.status, [...DONE_STATUSES]))
        )
      )
      .for('update', { skipLocked: true })
      .limit(limit)

    if (candidates.length === 0) return []

    return tx
      .update(productionTask)
      .set({ reminderSentAt: scannedAt, updatedAt: scannedAt })
      .where(
        inArray(
          productionTask.id,
          candidates.map((candidate) => candidate.id)
        )
      )
      .returning()
  })

  const overdueRows = await db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: productionTask.id })
      .from(productionTask)
      .where(
        and(
          lt(productionTask.dueAt, scannedAt),
          sql`(${productionTask.delayReason} is null or btrim(${productionTask.delayReason}) = '')`,
          or(
            isNull(productionTask.delayReminderSentAt),
            lte(productionTask.delayReminderSentAt, lastDailyReminderCutoff)
          ) as SQL,
          not(inArray(productionTask.status, [...DONE_STATUSES]))
        )
      )
      .for('update', { skipLocked: true })
      .limit(limit)

    if (candidates.length === 0) return []

    return tx
      .update(productionTask)
      .set({ delayReminderSentAt: scannedAt, updatedAt: scannedAt })
      .where(
        inArray(
          productionTask.id,
          candidates.map((candidate) => candidate.id)
        )
      )
      .returning()
  })

  for (const task of upcomingRows) {
    if (!task.createdBy) {
      logger.warn('Skipping production task reminder audit without actor', {
        taskId: task.id,
      })
      continue
    }
    recordProductionTaskAudit({
      action: AuditAction.PRODUCTION_TASK_DDL_REMINDER,
      actorUserId: task.createdBy,
      task,
      description: `Production task "${task.title}" is due within 24 hours`,
      metadata: { productionTaskNotification: true, reminderWindowHours: 24 },
    })
    await notifyProductionTaskRealtime({ task, event: 'ddl_reminder' })
  }

  for (const task of overdueRows) {
    if (!task.createdBy) {
      logger.warn('Skipping production task delay reminder audit without actor', {
        taskId: task.id,
      })
      continue
    }
    recordProductionTaskAudit({
      action: AuditAction.PRODUCTION_TASK_DELAY_REASON_REQUIRED,
      actorUserId: task.createdBy,
      task,
      description: `Production task "${task.title}" is overdue and needs a delay reason`,
      metadata: {
        productionTaskNotification: true,
        delayReasonRequired: true,
        overdueSince: task.dueAt?.toISOString() ?? null,
      },
    })
    await notifyProductionTaskRealtime({ task, event: 'delay_reason_required' })
  }

  const rows = [...upcomingRows, ...overdueRows]
  return {
    scannedAt: scannedAt.toISOString(),
    remindedCount: rows.length,
    taskIds: rows.map((row) => row.id),
  }
}
