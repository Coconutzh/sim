import { db } from '@sim/db'
import {
  discipline,
  projectTask,
  taskMessage,
  user,
  workflow,
  workflowBlocks,
  workgroup,
  workgroupMember,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, type SQL, sql } from 'drizzle-orm'
import type {
  CreateProjectTaskBody,
  CreateProjectTaskMessageBody,
  ListProjectTaskMessagesQuery,
  ListProjectTasksQuery,
  ProjectTask,
  ProjectTaskAssignee,
  ProjectTaskDueReminderResponse,
  ProjectTaskListResponse,
  ProjectTaskListScope,
  ProjectTaskMessage,
  ProjectTaskMessagesResponse,
  ProjectTaskStatus,
  ReviewProjectTaskBody,
  SubmitProjectTaskBody,
  UpdateProjectTaskBody,
} from '@/lib/api/contracts/project-tasks'
import { publishProjectTaskEvent } from '@/lib/collaboration/project-task-events'
import { getOrganizationRole, getWorkgroupMembership } from '@/lib/collaboration/service'

const CHIEF_DIRECTOR_AGENT_CODE = 'chief_director'
const UNKNOWN_DISCIPLINE_CODE = 'unknown'
const COMPLETED_STATUS: ProjectTaskStatus = 'completed'
const SUBMITTED_STATUSES: ProjectTaskStatus[] = ['submitted', 'in_review']

export class ProjectTaskServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'ProjectTaskServiceError'
  }
}

export function getProjectTaskErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ProjectTaskServiceError) {
    return { message: error.message, status: error.status }
  }
  return { message: fallback, status: 500 }
}

function forbidden(message: string) {
  return new ProjectTaskServiceError(message, 403)
}

function notFound(message: string) {
  return new ProjectTaskServiceError(message, 404)
}

function badRequest(message: string) {
  return new ProjectTaskServiceError(message, 400)
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseNullableDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw badRequest('Invalid due date')
  return date
}

interface ProjectTaskRow {
  id: string
  organizationId: string
  assigneeWorkgroupId: string
  creatorId: string
  title: string
  description: string | null
  dueAt: Date | null
  status: ProjectTaskStatus
  resultWorkspaceId: string | null
  resultWorkflowId: string | null
  resultNodeId: string | null
  submittedBy: string | null
  submittedAt: Date | null
  reviewedBy: string | null
  reviewedAt: Date | null
  reviewNote: string | null
  messageCount: number
  lastMessageAt: Date | null
  reminderSentAt: Date | null
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
  assigneeName: string
  assigneeTeamWorkspaceId: string | null
  disciplineId: string | null
  disciplineCode: string | null
  disciplineName: string | null
  disciplineAgentCode: string | null
}

interface ProjectTaskMeta {
  id: string
  organizationId: string
  assigneeWorkgroupId: string
  status: ProjectTaskStatus
  archivedAt: Date | null
}

interface ProjectTaskUserSummary {
  id: string
  name: string | null
  email: string | null
  avatarUrl: string | null
}

interface TaskMessageRow {
  id: string
  taskId: string
  senderId: string
  content: string
  createdAt: Date
  senderName: string | null
  senderEmail: string | null
  senderAvatarUrl: string | null
}

function formatAssignee(row: {
  id: string
  name: string
  organizationId: string
  teamWorkspaceId: string | null
  disciplineId: string | null
  disciplineCode: string | null
  disciplineName: string | null
  disciplineAgentCode: string | null
}): ProjectTaskAssignee {
  return {
    id: row.id,
    name: row.name,
    organizationId: row.organizationId,
    teamWorkspaceId: row.teamWorkspaceId,
    discipline: {
      id: row.disciplineId ?? '',
      code: row.disciplineCode ?? UNKNOWN_DISCIPLINE_CODE,
      name: row.disciplineName ?? '未分配工种',
      agentCode: row.disciplineAgentCode ?? UNKNOWN_DISCIPLINE_CODE,
    },
  }
}

function formatProjectTask(
  row: ProjectTaskRow,
  usersById: Map<string, ProjectTaskUserSummary>
): ProjectTask {
  const fallbackUser = (id: string): ProjectTaskUserSummary => ({
    id,
    name: null,
    email: null,
    avatarUrl: null,
  })

  return {
    id: row.id,
    organizationId: row.organizationId,
    assigneeWorkgroup: formatAssignee({
      id: row.assigneeWorkgroupId,
      name: row.assigneeName,
      organizationId: row.organizationId,
      teamWorkspaceId: row.assigneeTeamWorkspaceId,
      disciplineId: row.disciplineId,
      disciplineCode: row.disciplineCode,
      disciplineName: row.disciplineName,
      disciplineAgentCode: row.disciplineAgentCode,
    }),
    creator: usersById.get(row.creatorId) ?? fallbackUser(row.creatorId),
    title: row.title,
    description: row.description,
    dueAt: toIso(row.dueAt),
    status: row.status,
    resultWorkspaceId: row.resultWorkspaceId,
    resultWorkflowId: row.resultWorkflowId,
    resultNodeId: row.resultNodeId,
    submittedBy: row.submittedBy
      ? (usersById.get(row.submittedBy) ?? fallbackUser(row.submittedBy))
      : null,
    submittedAt: toIso(row.submittedAt),
    reviewedBy: row.reviewedBy
      ? (usersById.get(row.reviewedBy) ?? fallbackUser(row.reviewedBy))
      : null,
    reviewedAt: toIso(row.reviewedAt),
    reviewNote: row.reviewNote,
    messageCount: row.messageCount,
    lastMessageAt: toIso(row.lastMessageAt),
    reminderSentAt: toIso(row.reminderSentAt),
    archivedAt: toIso(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function formatTaskMessage(row: TaskMessageRow): ProjectTaskMessage {
  return {
    id: row.id,
    taskId: row.taskId,
    sender: {
      id: row.senderId,
      name: row.senderName,
      email: row.senderEmail,
      avatarUrl: row.senderAvatarUrl,
    },
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  }
}

async function loadUserSummaries(
  userIds: Array<string | null>
): Promise<Map<string, ProjectTaskUserSummary>> {
  const uniqueIds = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))))
  if (uniqueIds.length === 0) return new Map()

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.image,
    })
    .from(user)
    .where(inArray(user.id, uniqueIds))

  return new Map(rows.map((row) => [row.id, row]))
}

async function selectProjectTaskRows(filters: SQL[], limit: number): Promise<ProjectTaskRow[]> {
  return db
    .select({
      id: projectTask.id,
      organizationId: projectTask.organizationId,
      assigneeWorkgroupId: projectTask.assigneeWorkgroupId,
      creatorId: projectTask.creatorId,
      title: projectTask.title,
      description: projectTask.description,
      dueAt: projectTask.dueAt,
      status: projectTask.status,
      resultWorkspaceId: projectTask.resultWorkspaceId,
      resultWorkflowId: projectTask.resultWorkflowId,
      resultNodeId: projectTask.resultNodeId,
      submittedBy: projectTask.submittedBy,
      submittedAt: projectTask.submittedAt,
      reviewedBy: projectTask.reviewedBy,
      reviewedAt: projectTask.reviewedAt,
      reviewNote: projectTask.reviewNote,
      messageCount: projectTask.messageCount,
      lastMessageAt: projectTask.lastMessageAt,
      reminderSentAt: projectTask.reminderSentAt,
      archivedAt: projectTask.archivedAt,
      createdAt: projectTask.createdAt,
      updatedAt: projectTask.updatedAt,
      assigneeName: workgroup.name,
      assigneeTeamWorkspaceId: workgroup.teamWorkspaceId,
      disciplineId: discipline.id,
      disciplineCode: discipline.code,
      disciplineName: discipline.name,
      disciplineAgentCode: discipline.agentCode,
    })
    .from(projectTask)
    .innerJoin(workgroup, eq(projectTask.assigneeWorkgroupId, workgroup.id))
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(and(...filters))
    .orderBy(sql`${projectTask.dueAt} IS NULL`, asc(projectTask.dueAt), desc(projectTask.updatedAt))
    .limit(limit)
}

async function formatProjectTaskRows(rows: ProjectTaskRow[]): Promise<ProjectTask[]> {
  const usersById = await loadUserSummaries(
    rows.flatMap((row) => [row.creatorId, row.submittedBy, row.reviewedBy])
  )
  return rows.map((row) => formatProjectTask(row, usersById))
}

async function selectTaskMessageRows(taskId: string, limit: number): Promise<TaskMessageRow[]> {
  const rows = await db
    .select({
      id: taskMessage.id,
      taskId: taskMessage.taskId,
      senderId: taskMessage.senderId,
      content: taskMessage.content,
      createdAt: taskMessage.createdAt,
      senderName: user.name,
      senderEmail: user.email,
      senderAvatarUrl: user.image,
    })
    .from(taskMessage)
    .innerJoin(user, eq(taskMessage.senderId, user.id))
    .where(eq(taskMessage.taskId, taskId))
    .orderBy(desc(taskMessage.createdAt))
    .limit(limit)

  return rows.reverse()
}

async function getTaskMessageDto(messageId: string): Promise<ProjectTaskMessage> {
  const [row] = await db
    .select({
      id: taskMessage.id,
      taskId: taskMessage.taskId,
      senderId: taskMessage.senderId,
      content: taskMessage.content,
      createdAt: taskMessage.createdAt,
      senderName: user.name,
      senderEmail: user.email,
      senderAvatarUrl: user.image,
    })
    .from(taskMessage)
    .innerJoin(user, eq(taskMessage.senderId, user.id))
    .where(eq(taskMessage.id, messageId))
    .limit(1)

  if (!row) throw notFound('Message not found')
  return formatTaskMessage(row)
}

async function getProjectTaskMeta(
  taskId: string,
  includeArchived = false
): Promise<ProjectTaskMeta> {
  const filters: SQL[] = [eq(projectTask.id, taskId)]
  if (!includeArchived) filters.push(isNull(projectTask.archivedAt))

  const [row] = await db
    .select({
      id: projectTask.id,
      organizationId: projectTask.organizationId,
      assigneeWorkgroupId: projectTask.assigneeWorkgroupId,
      status: projectTask.status,
      archivedAt: projectTask.archivedAt,
    })
    .from(projectTask)
    .where(and(...filters))
    .limit(1)

  if (!row) throw notFound('Task not found')
  return row
}

async function getProjectTaskDto(taskId: string, includeArchived = false): Promise<ProjectTask> {
  const filters: SQL[] = [eq(projectTask.id, taskId)]
  if (!includeArchived) filters.push(isNull(projectTask.archivedAt))

  const rows = await selectProjectTaskRows(filters, 1)
  if (!rows[0]) throw notFound('Task not found')
  const [task] = await formatProjectTaskRows(rows)
  return task
}

async function getAssigneeWorkgroup(workgroupId: string): Promise<ProjectTaskAssignee> {
  const [row] = await db
    .select({
      id: workgroup.id,
      name: workgroup.name,
      organizationId: workgroup.organizationId,
      teamWorkspaceId: workgroup.teamWorkspaceId,
      disciplineId: discipline.id,
      disciplineCode: discipline.code,
      disciplineName: discipline.name,
      disciplineAgentCode: discipline.agentCode,
    })
    .from(workgroup)
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(and(eq(workgroup.id, workgroupId), isNull(workgroup.archivedAt)))
    .limit(1)

  if (!row) throw notFound('Assignee workgroup not found')
  return formatAssignee(row)
}

async function listProjectTaskAssignees(params: {
  organizationId: string
  userId: string
  canManage: boolean
  workgroupId?: string
}): Promise<ProjectTaskAssignee[]> {
  if (params.canManage) {
    const rows = await db
      .select({
        id: workgroup.id,
        name: workgroup.name,
        organizationId: workgroup.organizationId,
        teamWorkspaceId: workgroup.teamWorkspaceId,
        disciplineId: discipline.id,
        disciplineCode: discipline.code,
        disciplineName: discipline.name,
        disciplineAgentCode: discipline.agentCode,
      })
      .from(workgroup)
      .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
      .where(and(eq(workgroup.organizationId, params.organizationId), isNull(workgroup.archivedAt)))
      .orderBy(asc(discipline.sortOrder), asc(workgroup.name))

    return rows.map(formatAssignee)
  }

  if (!params.workgroupId) return []
  const membership = await getWorkgroupMembership(params.userId, params.workgroupId)
  if (!membership || membership.organizationId !== params.organizationId) return []
  return [await getAssigneeWorkgroup(params.workgroupId)]
}

export async function canManageProjectTasks(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const organizationRole = await getOrganizationRole(userId, organizationId)
  if (organizationRole === 'owner' || organizationRole === 'admin') return true

  const [directorWorkgroup] = await db
    .select({ id: workgroup.id })
    .from(workgroupMember)
    .innerJoin(workgroup, eq(workgroupMember.workgroupId, workgroup.id))
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(
      and(
        eq(workgroupMember.userId, userId),
        eq(workgroup.organizationId, organizationId),
        isNull(workgroup.archivedAt),
        eq(discipline.agentCode, CHIEF_DIRECTOR_AGENT_CODE)
      )
    )
    .limit(1)

  return Boolean(directorWorkgroup)
}

export async function assertCanReadProjectTaskEvents(params: {
  userId: string
  organizationId: string
  scope: ProjectTaskListScope
  workgroupId?: string
}): Promise<void> {
  if (params.scope === 'director') {
    if (!(await canManageProjectTasks(params.userId, params.organizationId))) {
      throw forbidden('Director task access required')
    }
    return
  }

  if (!params.workgroupId) throw badRequest('Workgroup ID is required')
  const membership = await getWorkgroupMembership(params.userId, params.workgroupId)
  if (!membership || membership.organizationId !== params.organizationId) {
    throw forbidden('Workgroup task access required')
  }
}

async function assertCanManageTask(userId: string, organizationId: string): Promise<void> {
  if (!(await canManageProjectTasks(userId, organizationId))) {
    throw forbidden('Director task access required')
  }
}

async function assertCanReadTask(userId: string, task: ProjectTaskMeta): Promise<void> {
  if (await canManageProjectTasks(userId, task.organizationId)) return
  const membership = await getWorkgroupMembership(userId, task.assigneeWorkgroupId)
  if (!membership) throw forbidden('Workgroup task access required')
}

async function assertCanSubmitTask(userId: string, task: ProjectTaskMeta): Promise<void> {
  const membership = await getWorkgroupMembership(userId, task.assigneeWorkgroupId)
  if (!membership) throw forbidden('Workgroup task access required')
}

async function validateResultBinding(params: {
  task: ProjectTaskMeta
  body: SubmitProjectTaskBody
}) {
  const [workspaceRow] = await db
    .select({
      id: workspace.id,
      organizationId: workspace.organizationId,
      workgroupId: workspace.workgroupId,
      archivedAt: workspace.archivedAt,
    })
    .from(workspace)
    .where(eq(workspace.id, params.body.resultWorkspaceId))
    .limit(1)

  if (
    !workspaceRow ||
    workspaceRow.archivedAt ||
    workspaceRow.organizationId !== params.task.organizationId ||
    workspaceRow.workgroupId !== params.task.assigneeWorkgroupId
  ) {
    throw badRequest('Selected result node must belong to the assigned workgroup canvas')
  }

  const [workflowRow] = await db
    .select({ id: workflow.id, workspaceId: workflow.workspaceId, archivedAt: workflow.archivedAt })
    .from(workflow)
    .where(eq(workflow.id, params.body.resultWorkflowId))
    .limit(1)

  if (
    !workflowRow ||
    workflowRow.archivedAt ||
    workflowRow.workspaceId !== params.body.resultWorkspaceId
  ) {
    throw badRequest('Selected result workflow is not available in this canvas')
  }

  const [blockRow] = await db
    .select({ id: workflowBlocks.id })
    .from(workflowBlocks)
    .where(
      and(
        eq(workflowBlocks.id, params.body.resultNodeId),
        eq(workflowBlocks.workflowId, params.body.resultWorkflowId)
      )
    )
    .limit(1)

  if (!blockRow) throw badRequest('Selected result node was not found in this workflow')
}

export async function listProjectTasks(params: {
  userId: string
  organizationId: string
  query: ListProjectTasksQuery
}): Promise<ProjectTaskListResponse> {
  const canManage = await canManageProjectTasks(params.userId, params.organizationId)
  const scope = params.query.scope ?? 'self'

  if (scope === 'director' && !canManage) {
    throw forbidden('Director task access required')
  }

  if (scope === 'self') {
    if (!params.query.workgroupId) throw badRequest('Workgroup ID is required')
    const membership = await getWorkgroupMembership(params.userId, params.query.workgroupId)
    if (!membership || membership.organizationId !== params.organizationId) {
      throw forbidden('Workgroup task access required')
    }
  }

  const filters: SQL[] = [eq(projectTask.organizationId, params.organizationId)]
  if (!params.query.includeArchived) filters.push(isNull(projectTask.archivedAt))
  if (scope === 'self' && params.query.workgroupId) {
    filters.push(eq(projectTask.assigneeWorkgroupId, params.query.workgroupId))
  }
  if (params.query.status) {
    filters.push(eq(projectTask.status, params.query.status))
  } else if (!params.query.includeCompleted) {
    filters.push(ne(projectTask.status, COMPLETED_STATUS))
  }

  const rows = await selectProjectTaskRows(filters, params.query.limit ?? 100)
  const [tasks, assigneeWorkgroups] = await Promise.all([
    formatProjectTaskRows(rows),
    listProjectTaskAssignees({
      organizationId: params.organizationId,
      userId: params.userId,
      canManage,
      workgroupId: params.query.workgroupId,
    }),
  ])

  return {
    tasks,
    assigneeWorkgroups,
    access: {
      canManage,
      scope,
      workgroupId: scope === 'self' ? (params.query.workgroupId ?? null) : null,
    },
  }
}

export async function getProjectTask(params: {
  userId: string
  taskId: string
}): Promise<ProjectTask> {
  const meta = await getProjectTaskMeta(params.taskId)
  await assertCanReadTask(params.userId, meta)
  return getProjectTaskDto(params.taskId)
}

export async function createProjectTask(params: {
  actorUserId: string
  organizationId: string
  body: CreateProjectTaskBody
}): Promise<ProjectTask> {
  await assertCanManageTask(params.actorUserId, params.organizationId)
  const assignee = await getAssigneeWorkgroup(params.body.assigneeWorkgroupId)
  if (assignee.organizationId !== params.organizationId) {
    throw badRequest('Assignee workgroup must belong to this organization')
  }

  const now = new Date()
  const taskId = generateId()
  await db.insert(projectTask).values({
    id: taskId,
    organizationId: params.organizationId,
    assigneeWorkgroupId: params.body.assigneeWorkgroupId,
    creatorId: params.actorUserId,
    title: params.body.title.trim(),
    description: normalizeOptionalText(params.body.description),
    dueAt: parseNullableDate(params.body.dueAt) ?? null,
    status: 'todo',
    createdAt: now,
    updatedAt: now,
  })

  const task = await getProjectTaskDto(taskId)
  publishProjectTaskEvent({
    type: 'created',
    taskId,
    organizationId: params.organizationId,
    assigneeWorkgroupId: params.body.assigneeWorkgroupId,
    actorUserId: params.actorUserId,
    taskStatus: task.status,
  })
  return task
}

export async function updateProjectTask(params: {
  actorUserId: string
  taskId: string
  body: UpdateProjectTaskBody
}): Promise<ProjectTask> {
  const meta = await getProjectTaskMeta(params.taskId)
  await assertCanManageTask(params.actorUserId, meta.organizationId)

  const now = new Date()
  const updates: Partial<typeof projectTask.$inferInsert> = { updatedAt: now }

  if (params.body.assigneeWorkgroupId !== undefined) {
    if (!['todo', 'rejected'].includes(meta.status)) {
      throw badRequest('Assignee can only be changed before submission')
    }
    const assignee = await getAssigneeWorkgroup(params.body.assigneeWorkgroupId)
    if (assignee.organizationId !== meta.organizationId) {
      throw badRequest('Assignee workgroup must belong to this organization')
    }
    updates.assigneeWorkgroupId = params.body.assigneeWorkgroupId
  }

  if (params.body.title !== undefined) updates.title = params.body.title.trim()
  if (params.body.description !== undefined) {
    updates.description = normalizeOptionalText(params.body.description)
  }
  const dueAt = parseNullableDate(params.body.dueAt)
  if (dueAt !== undefined) {
    updates.dueAt = dueAt
    updates.reminderSentAt = null
  }

  await db.update(projectTask).set(updates).where(eq(projectTask.id, params.taskId))

  const task = await getProjectTaskDto(params.taskId)
  publishProjectTaskEvent({
    type: 'updated',
    taskId: task.id,
    organizationId: task.organizationId,
    assigneeWorkgroupId: task.assigneeWorkgroup.id,
    actorUserId: params.actorUserId,
    taskStatus: task.status,
  })
  return task
}

export async function archiveProjectTask(params: {
  actorUserId: string
  taskId: string
}): Promise<ProjectTask> {
  const meta = await getProjectTaskMeta(params.taskId)
  await assertCanManageTask(params.actorUserId, meta.organizationId)

  const now = new Date()
  await db
    .update(projectTask)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(projectTask.id, params.taskId))

  const task = await getProjectTaskDto(params.taskId, true)
  publishProjectTaskEvent({
    type: 'archived',
    taskId: task.id,
    organizationId: task.organizationId,
    assigneeWorkgroupId: task.assigneeWorkgroup.id,
    actorUserId: params.actorUserId,
    taskStatus: task.status,
  })
  return task
}

export async function submitProjectTask(params: {
  actorUserId: string
  taskId: string
  body: SubmitProjectTaskBody
}): Promise<ProjectTask> {
  const meta = await getProjectTaskMeta(params.taskId)
  await assertCanSubmitTask(params.actorUserId, meta)

  if (meta.status !== 'todo' && meta.status !== 'rejected') {
    throw badRequest('Task can only be submitted from todo or rejected status')
  }

  await validateResultBinding({ task: meta, body: params.body })

  const now = new Date()
  await db
    .update(projectTask)
    .set({
      status: 'submitted',
      resultWorkspaceId: params.body.resultWorkspaceId,
      resultWorkflowId: params.body.resultWorkflowId,
      resultNodeId: params.body.resultNodeId,
      submittedBy: params.actorUserId,
      submittedAt: now,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      updatedAt: now,
    })
    .where(eq(projectTask.id, params.taskId))

  const task = await getProjectTaskDto(params.taskId)
  publishProjectTaskEvent({
    type: 'submitted',
    taskId: task.id,
    organizationId: task.organizationId,
    assigneeWorkgroupId: task.assigneeWorkgroup.id,
    actorUserId: params.actorUserId,
    taskStatus: task.status,
  })
  return task
}

export async function reviewProjectTask(params: {
  actorUserId: string
  taskId: string
  body: ReviewProjectTaskBody
}): Promise<ProjectTask> {
  const meta = await getProjectTaskMeta(params.taskId)
  await assertCanManageTask(params.actorUserId, meta.organizationId)

  const now = new Date()
  const reviewNote = normalizeOptionalText(params.body.reviewNote)

  if (params.body.action === 'start') {
    if (meta.status !== 'submitted') throw badRequest('Task must be submitted before review starts')
    await db
      .update(projectTask)
      .set({
        status: 'in_review',
        reviewedBy: params.actorUserId,
        reviewedAt: now,
        reviewNote,
        updatedAt: now,
      })
      .where(eq(projectTask.id, params.taskId))
  } else {
    if (!SUBMITTED_STATUSES.includes(meta.status)) {
      throw badRequest('Task must be submitted or in review before a review decision')
    }
    await db
      .update(projectTask)
      .set({
        status: params.body.action === 'approve' ? 'completed' : 'rejected',
        reviewedBy: params.actorUserId,
        reviewedAt: now,
        reviewNote,
        updatedAt: now,
      })
      .where(eq(projectTask.id, params.taskId))
  }

  const task = await getProjectTaskDto(params.taskId)
  publishProjectTaskEvent({
    type:
      params.body.action === 'start'
        ? 'review_started'
        : params.body.action === 'approve'
          ? 'approved'
          : 'rejected',
    taskId: task.id,
    organizationId: task.organizationId,
    assigneeWorkgroupId: task.assigneeWorkgroup.id,
    actorUserId: params.actorUserId,
    taskStatus: task.status,
  })
  return task
}

export async function listProjectTaskMessages(params: {
  userId: string
  taskId: string
  query: ListProjectTaskMessagesQuery
}): Promise<ProjectTaskMessagesResponse> {
  const meta = await getProjectTaskMeta(params.taskId)
  await assertCanReadTask(params.userId, meta)

  const limit = params.query.limit ?? 100
  const rows = await selectTaskMessageRows(params.taskId, limit)
  const [task] = await db
    .select({ messageCount: projectTask.messageCount })
    .from(projectTask)
    .where(eq(projectTask.id, params.taskId))
    .limit(1)

  return {
    messages: rows.map(formatTaskMessage),
    messageCount: task?.messageCount ?? rows.length,
  }
}

export async function createProjectTaskMessage(params: {
  actorUserId: string
  taskId: string
  body: CreateProjectTaskMessageBody
}): Promise<ProjectTaskMessage> {
  const meta = await getProjectTaskMeta(params.taskId)
  await assertCanReadTask(params.actorUserId, meta)

  const now = new Date()
  const messageId = generateId()
  await db.insert(taskMessage).values({
    id: messageId,
    taskId: params.taskId,
    senderId: params.actorUserId,
    content: params.body.content.trim(),
    createdAt: now,
  })
  await db
    .update(projectTask)
    .set({
      messageCount: sql`${projectTask.messageCount} + 1`,
      lastMessageAt: now,
      updatedAt: now,
    })
    .where(eq(projectTask.id, params.taskId))

  const message = await getTaskMessageDto(messageId)
  publishProjectTaskEvent({
    type: 'message_created',
    taskId: params.taskId,
    organizationId: meta.organizationId,
    assigneeWorkgroupId: meta.assigneeWorkgroupId,
    actorUserId: params.actorUserId,
    taskStatus: meta.status,
  })
  return message
}

export async function dispatchProjectTaskDueReminders(): Promise<ProjectTaskDueReminderResponse> {
  const now = new Date()
  const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const rows = await db
    .select({
      id: projectTask.id,
      organizationId: projectTask.organizationId,
      assigneeWorkgroupId: projectTask.assigneeWorkgroupId,
      status: projectTask.status,
    })
    .from(projectTask)
    .where(
      and(
        isNull(projectTask.archivedAt),
        isNull(projectTask.reminderSentAt),
        ne(projectTask.status, COMPLETED_STATUS),
        gte(projectTask.dueAt, now),
        lte(projectTask.dueAt, windowEnd)
      )
    )
    .limit(500)

  if (rows.length === 0) {
    return { matchedCount: 0, notifiedCount: 0, taskIds: [] }
  }

  const taskIds = rows.map((row) => row.id)
  await db
    .update(projectTask)
    .set({ reminderSentAt: now, updatedAt: now })
    .where(inArray(projectTask.id, taskIds))

  for (const row of rows) {
    publishProjectTaskEvent({
      type: 'due_reminder',
      taskId: row.id,
      organizationId: row.organizationId,
      assigneeWorkgroupId: row.assigneeWorkgroupId,
      actorUserId: 'system',
      taskStatus: row.status,
    })
  }

  return { matchedCount: rows.length, notifiedCount: rows.length, taskIds }
}
