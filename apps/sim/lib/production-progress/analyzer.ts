import { createLogger } from '@sim/logger'
import type {
  AnalyzeProductionProgressResponse,
  ProductionProgressAnalysisMessage,
  ProductionProgressMetrics,
  ProductionProgressProjectAnalysis,
  ProductionProgressProjectInput,
  ProductionProgressRiskTask,
} from '@/lib/api/contracts/production-progress-analysis'
import type { ProductionTask, ProductionTaskStatus } from '@/lib/api/contracts/production-tasks'
import { callHermesChatCompletion, HermesClientError } from '@/lib/hermes/client'
import { listProductionTasks } from '@/lib/production-tasks/service'

const logger = createLogger('ProductionProgressAnalyzer')

const DAY_MS = 24 * 60 * 60 * 1000
const DONE_STATUSES = new Set<ProductionTaskStatus>(['approved', 'archived'])
const DUE_SOON_24H_MS = 24 * 60 * 60 * 1000
const DUE_SOON_72H_MS = 72 * 60 * 60 * 1000

interface AnalyzeProductionProgressParams {
  userId: string
  projects: ProductionProgressProjectInput[]
  question: string
  history?: ProductionProgressAnalysisMessage[]
  signal?: AbortSignal
}

interface ProjectTaskBundle {
  project: ProductionProgressProjectInput
  tasks: ProductionTask[]
}

function toTimestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

function isOpenTask(task: ProductionTask): boolean {
  return !DONE_STATUSES.has(task.status)
}

function statusLabel(status: ProductionTaskStatus): string {
  switch (status) {
    case 'todo':
      return '待开始'
    case 'in_progress':
      return '进行中'
    case 'submitted':
      return '已提交待审核'
    case 'approved':
      return '已通过'
    case 'changes_requested':
      return '需修改'
    case 'archived':
      return '已归档'
    default:
      return status
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '未设置'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未设置'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getProjectName(projectsByOrganizationId: Map<string, ProductionProgressProjectInput>) {
  return (task: ProductionTask): string =>
    projectsByOrganizationId.get(task.organizationId)?.name ?? task.sourceWorkgroup.name
}

function buildTaskRisk(
  task: ProductionTask,
  projectName: string,
  now: number
): ProductionProgressRiskTask | null {
  if (!isOpenTask(task)) return null

  const dueMs = toTimestamp(task.dueAt)
  const latestSubmissionAt = task.latestSubmission?.submittedAt ?? task.submittedAt ?? null
  const reviewNote = task.reviewNote ?? task.latestSubmission?.reviewNote ?? null
  const delayReason = task.delayReason?.trim() || null
  const daysOverdue =
    dueMs !== null && dueMs < now ? Math.max(1, Math.ceil((now - dueMs) / DAY_MS)) : null

  if (daysOverdue !== null) {
    if (!delayReason) {
      return {
        taskId: task.id,
        organizationId: task.organizationId,
        projectName,
        title: task.title,
        assigneeWorkgroupName: task.assigneeWorkgroup.name,
        status: task.status,
        severity: 'critical',
        dueAt: task.dueAt,
        daysOverdue,
        reason: `已超过 DDL ${daysOverdue} 天，且承接团队尚未提交延期理由。`,
        delayReason,
        latestSubmissionAt,
        reviewNote,
      }
    }

    return {
      taskId: task.id,
      organizationId: task.organizationId,
      projectName,
      title: task.title,
      assigneeWorkgroupName: task.assigneeWorkgroup.name,
      status: task.status,
      severity: task.status === 'submitted' ? 'warning' : 'critical',
      dueAt: task.dueAt,
      daysOverdue,
      reason:
        task.status === 'submitted'
          ? `已超期 ${daysOverdue} 天，但已有提交，当前瓶颈更可能在审核或返修确认。`
          : `已超期 ${daysOverdue} 天，延期理由显示：${delayReason}`,
      delayReason,
      latestSubmissionAt,
      reviewNote,
    }
  }

  if (task.status === 'changes_requested') {
    return {
      taskId: task.id,
      organizationId: task.organizationId,
      projectName,
      title: task.title,
      assigneeWorkgroupName: task.assigneeWorkgroup.name,
      status: task.status,
      severity: 'warning',
      dueAt: task.dueAt,
      daysOverdue: null,
      reason: reviewNote
        ? `审核要求修改：${reviewNote}`
        : '任务处于返修状态，需要承接团队重新提交。',
      delayReason,
      latestSubmissionAt,
      reviewNote,
    }
  }

  if (task.status === 'submitted') {
    return {
      taskId: task.id,
      organizationId: task.organizationId,
      projectName,
      title: task.title,
      assigneeWorkgroupName: task.assigneeWorkgroup.name,
      status: task.status,
      severity: 'info',
      dueAt: task.dueAt,
      daysOverdue: null,
      reason: '任务已提交，等待导演或项目管理员审核。',
      delayReason,
      latestSubmissionAt,
      reviewNote,
    }
  }

  if (dueMs !== null && dueMs >= now && dueMs - now <= DUE_SOON_24H_MS) {
    return {
      taskId: task.id,
      organizationId: task.organizationId,
      projectName,
      title: task.title,
      assigneeWorkgroupName: task.assigneeWorkgroup.name,
      status: task.status,
      severity: 'warning',
      dueAt: task.dueAt,
      daysOverdue: null,
      reason: '距离 DDL 不到 24 小时，且任务尚未完成。',
      delayReason,
      latestSubmissionAt,
      reviewNote,
    }
  }

  if (!task.dueAt) {
    return {
      taskId: task.id,
      organizationId: task.organizationId,
      projectName,
      title: task.title,
      assigneeWorkgroupName: task.assigneeWorkgroup.name,
      status: task.status,
      severity: 'info',
      dueAt: null,
      daysOverdue: null,
      reason: '任务未设置 DDL，无法判断是否拖延。',
      delayReason,
      latestSubmissionAt,
      reviewNote,
    }
  }

  return null
}

function createEmptyMetrics(projectCount: number): ProductionProgressMetrics {
  return {
    projectCount,
    taskCount: 0,
    completedTaskCount: 0,
    openTaskCount: 0,
    overdueTaskCount: 0,
    delayReasonMissingCount: 0,
    dueWithin24hCount: 0,
    dueWithin72hCount: 0,
    submittedAwaitingReviewCount: 0,
    changesRequestedCount: 0,
    unplannedTaskCount: 0,
  }
}

function collectMetrics(tasks: ProductionTask[], projectCount: number, now: number) {
  const metrics = createEmptyMetrics(projectCount)
  for (const task of tasks) {
    const open = isOpenTask(task)
    const dueMs = toTimestamp(task.dueAt)

    metrics.taskCount += 1
    if (open) {
      metrics.openTaskCount += 1
    } else {
      metrics.completedTaskCount += 1
    }
    if (!task.dueAt && open) metrics.unplannedTaskCount += 1
    if (task.status === 'submitted') metrics.submittedAwaitingReviewCount += 1
    if (task.status === 'changes_requested') metrics.changesRequestedCount += 1
    if (open && dueMs !== null && dueMs < now) {
      metrics.overdueTaskCount += 1
      if (!task.delayReason?.trim()) metrics.delayReasonMissingCount += 1
    }
    if (open && dueMs !== null && dueMs >= now && dueMs - now <= DUE_SOON_24H_MS) {
      metrics.dueWithin24hCount += 1
    }
    if (open && dueMs !== null && dueMs >= now && dueMs - now <= DUE_SOON_72H_MS) {
      metrics.dueWithin72hCount += 1
    }
  }
  return metrics
}

function buildProjectSummary(
  project: ProductionProgressProjectInput,
  tasks: ProductionTask[],
  now: number
): ProductionProgressProjectAnalysis {
  const metrics = collectMetrics(tasks, 1, now)
  const health =
    metrics.delayReasonMissingCount > 0 || metrics.overdueTaskCount > 1
      ? 'blocked'
      : metrics.overdueTaskCount > 0 ||
          metrics.dueWithin72hCount > 0 ||
          metrics.changesRequestedCount > 0 ||
          metrics.submittedAwaitingReviewCount > 0
        ? 'attention'
        : 'normal'
  const summary =
    metrics.taskCount === 0
      ? '暂无任务数据。'
      : health === 'blocked'
        ? `存在 ${metrics.overdueTaskCount} 个超期任务，其中 ${metrics.delayReasonMissingCount} 个缺少延期理由。`
        : health === 'attention'
          ? `有 ${metrics.dueWithin72hCount} 个任务 72 小时内到期，${metrics.submittedAwaitingReviewCount} 个任务待审核。`
          : '当前任务节奏正常。'

  return {
    organizationId: project.organizationId,
    projectName: project.name,
    health,
    summary,
    taskCount: metrics.taskCount,
    completedTaskCount: metrics.completedTaskCount,
    overdueTaskCount: metrics.overdueTaskCount,
    delayReasonMissingCount: metrics.delayReasonMissingCount,
    dueWithin72hCount: metrics.dueWithin72hCount,
    submittedAwaitingReviewCount: metrics.submittedAwaitingReviewCount,
    changesRequestedCount: metrics.changesRequestedCount,
  }
}

function buildRecommendations(metrics: ProductionProgressMetrics): string[] {
  const recommendations: string[] = []
  if (metrics.delayReasonMissingCount > 0) {
    recommendations.push('先要求所有超期且无延期理由的承接团队补交原因，避免风险不可追踪。')
  }
  if (metrics.submittedAwaitingReviewCount > 0) {
    recommendations.push('集中处理已提交待审核任务，防止审核积压被误判为工种拖延。')
  }
  if (metrics.changesRequestedCount > 0) {
    recommendations.push('对返修任务明确下一版提交时间，并把返修原因沉淀到任务记录。')
  }
  if (metrics.unplannedTaskCount > 0) {
    recommendations.push('为未设置 DDL 的任务补齐截止时间，否则总排期无法真实反映压力。')
  }
  if (recommendations.length === 0) {
    recommendations.push('保持当前节奏，继续关注 72 小时内到期任务和审核积压。')
  }
  return recommendations
}

function buildRuleAnswer(params: {
  metrics: ProductionProgressMetrics
  projectAnalyses: ProductionProgressProjectAnalysis[]
  question: string
  recommendations: string[]
  riskTasks: ProductionProgressRiskTask[]
}): string {
  const { metrics, projectAnalyses, recommendations, riskTasks } = params
  if (metrics.taskCount === 0) {
    return '当前可见项目还没有任务数据，暂时无法判断进度是否正常。建议先为各工种建立带 DDL 的任务。'
  }

  const blockedProjects = projectAnalyses.filter((project) => project.health === 'blocked')
  const attentionProjects = projectAnalyses.filter((project) => project.health === 'attention')
  const topRisks = riskTasks
    .filter((task) => task.severity !== 'info')
    .slice(0, 5)
    .map(
      (task, index) =>
        `${index + 1}. ${task.projectName} / ${task.assigneeWorkgroupName} / ` +
        `${task.title}：${task.reason}`
    )

  return [
    `整体判断：${blockedProjects.length > 0 ? '存在阻塞风险' : attentionProjects.length > 0 ? '需要关注' : '基本正常'}。`,
    `任务总数 ${metrics.taskCount}，已完成 ${metrics.completedTaskCount}，` +
      `未完成 ${metrics.openTaskCount}；超期 ${metrics.overdueTaskCount}，` +
      `24 小时内到期 ${metrics.dueWithin24hCount}，` +
      `待审核 ${metrics.submittedAwaitingReviewCount}。`,
    topRisks.length > 0 ? `主要异常：\n${topRisks.join('\n')}` : '当前没有明显异常拖延任务。',
    `建议：${recommendations.join('；')}`,
  ].join('\n\n')
}

function compactTaskForPrompt(task: ProductionProgressRiskTask) {
  return {
    project: task.projectName,
    title: task.title,
    assignee: task.assigneeWorkgroupName,
    status: statusLabel(task.status),
    severity: task.severity,
    dueAt: formatDateTime(task.dueAt),
    daysOverdue: task.daysOverdue,
    reason: task.reason,
    delayReason: task.delayReason,
    latestSubmissionAt: formatDateTime(task.latestSubmissionAt),
    reviewNote: task.reviewNote,
  }
}

async function buildHermesAnswer(params: {
  metrics: ProductionProgressMetrics
  projectAnalyses: ProductionProgressProjectAnalysis[]
  question: string
  recommendations: string[]
  riskTasks: ProductionProgressRiskTask[]
  history?: ProductionProgressAnalysisMessage[]
  signal?: AbortSignal
}): Promise<string | null> {
  const snapshot = {
    metrics: params.metrics,
    projects: params.projectAnalyses,
    riskTasks: params.riskTasks.slice(0, 40).map(compactTaskForPrompt),
    recommendations: params.recommendations,
  }

  try {
    const result = await callHermesChatCompletion({
      sessionKey: 'production-progress-analysis',
      signal: params.signal,
      messages: [
        {
          role: 'system',
          content:
            '你是大型舞台/制作项目的进度分析 agent。只能基于用户提供的任务 JSON 判断，' +
            '不要编造不存在的任务。请用简洁中文回答，不要使用 Markdown 标题、表格或加粗。' +
            '控制在 500 字以内，最多列 5 条重点，说明整体是否正常、异常拖延任务、' +
            '拖延原因和下一步建议。',
        },
        ...(params.history ?? []).slice(-8),
        {
          role: 'user',
          content: [
            `用户问题：${params.question}`,
            '当前项目任务快照 JSON：',
            JSON.stringify(snapshot),
            '请直接给出中文短分析，不要输出原始 JSON，不要输出 Markdown。',
          ].join('\n'),
        },
      ],
      metadata: {
        source: 'sim-production-progress-analysis',
        taskCount: params.metrics.taskCount,
        projectCount: params.metrics.projectCount,
      },
    })
    return result.content.trim() || null
  } catch (error) {
    if (error instanceof HermesClientError) {
      logger.warn('Hermes progress analysis unavailable, falling back to rules', {
        error: error.message,
        status: error.status,
      })
      return null
    }
    logger.warn('Unexpected Hermes progress analysis failure, falling back to rules', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function listVisibleTasks(params: {
  projects: ProductionProgressProjectInput[]
  userId: string
}): Promise<ProjectTaskBundle[]> {
  const bundles: ProjectTaskBundle[] = []
  const seenTaskIds = new Set<string>()
  for (const project of params.projects) {
    const tasks = await listProductionTasks({
      userId: params.userId,
      workspaceId: project.teamWorkspaceId,
      scope: 'auto',
      limit: 250,
    })
    const uniqueTasks = tasks.filter((task) => {
      if (seenTaskIds.has(task.id)) return false
      seenTaskIds.add(task.id)
      return true
    })
    bundles.push({ project, tasks: uniqueTasks })
  }
  return bundles
}

export async function analyzeProductionProgress(
  params: AnalyzeProductionProgressParams
): Promise<AnalyzeProductionProgressResponse['analysis']> {
  const generatedAt = new Date().toISOString()
  const now = Date.now()
  const bundles = await listVisibleTasks({
    projects: params.projects,
    userId: params.userId,
  })
  const projectsByOrganizationId = new Map(
    params.projects.map((project) => [project.organizationId, project])
  )
  const allTasks = bundles.flatMap((bundle) => bundle.tasks)
  const projectNameForTask = getProjectName(projectsByOrganizationId)
  const riskTasks = allTasks
    .map((task) => buildTaskRisk(task, projectNameForTask(task), now))
    .filter((task): task is ProductionProgressRiskTask => Boolean(task))
    .sort((a, b) => {
      const severityRank = { critical: 0, warning: 1, info: 2 } as const
      const severityDiff = severityRank[a.severity] - severityRank[b.severity]
      if (severityDiff !== 0) return severityDiff
      const aDueAt = toTimestamp(a.dueAt) ?? Number.MAX_SAFE_INTEGER
      const bDueAt = toTimestamp(b.dueAt) ?? Number.MAX_SAFE_INTEGER
      return aDueAt - bDueAt
    })

  const metrics = collectMetrics(allTasks, params.projects.length, now)
  const projectAnalyses = params.projects.map((project) =>
    buildProjectSummary(
      project,
      allTasks.filter((task) => task.organizationId === project.organizationId),
      now
    )
  )
  const recommendations = buildRecommendations(metrics)
  const fallbackAnswer = buildRuleAnswer({
    metrics,
    projectAnalyses,
    question: params.question,
    recommendations,
    riskTasks,
  })
  const hermesAnswer = await buildHermesAnswer({
    metrics,
    projectAnalyses,
    question: params.question,
    recommendations,
    riskTasks,
    history: params.history,
    signal: params.signal,
  })

  return {
    generatedAt,
    generatedBy: hermesAnswer ? 'hermes' : 'rules',
    answer: hermesAnswer ?? fallbackAnswer,
    metrics,
    projects: projectAnalyses,
    riskTasks: riskTasks.slice(0, 50),
    recommendations,
  }
}
