import { db } from '@sim/db'
import { workflow, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { and, desc, eq, type SQL } from 'drizzle-orm'
import { GetExecutionSummary } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('GetExecutionSummaryServerTool')

interface GetExecutionSummaryArgs {
  workspaceId: string
  workflowId?: string
  limit?: number
  status?: 'success' | 'error' | 'all'
}

interface ExecutionSummary {
  executionId: string
  workflowId: string | null
  workflowName: string | null
  status: string
  trigger: string
  startedAt: string
  durationMs: number | null
  cost: number | null
  error: string | null
}

interface ExecutionData {
  errorDetails?: { error?: unknown; message?: unknown }
  finalOutput?: { error?: unknown }
  error?: unknown
}

interface CostData {
  total?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toExecutionData(executionData: unknown): ExecutionData {
  if (!isRecord(executionData)) return {}

  const errorDetails = isRecord(executionData.errorDetails)
    ? {
        error: executionData.errorDetails.error,
        message: executionData.errorDetails.message,
      }
    : undefined
  const finalOutput = isRecord(executionData.finalOutput)
    ? { error: executionData.finalOutput.error }
    : undefined

  return {
    ...(errorDetails ? { errorDetails } : {}),
    ...(finalOutput ? { finalOutput } : {}),
    error: executionData.error,
  }
}

function toCostData(cost: unknown): CostData {
  if (!isRecord(cost)) return {}
  return { total: cost.total }
}

function extractErrorMessage(executionData: unknown): unknown {
  const data = toExecutionData(executionData)
  return (
    data.errorDetails?.error ||
    data.errorDetails?.message ||
    data.finalOutput?.error ||
    data.error ||
    null
  )
}

export const getExecutionSummaryServerTool: BaseServerTool<
  GetExecutionSummaryArgs,
  ExecutionSummary[]
> = {
  name: GetExecutionSummary.id,
  async execute(
    rawArgs: GetExecutionSummaryArgs,
    context?: ServerToolContext
  ): Promise<ExecutionSummary[]> {
    const { workspaceId, workflowId, limit = 10, status = 'all' } = rawArgs || {}

    if (!workspaceId || typeof workspaceId !== 'string') {
      throw new Error('Canvas ID is required')
    }
    if (!context?.userId) {
      throw new Error('Unauthorized access')
    }

    if (workflowId) {
      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId: context.userId,
        action: 'read',
      })
      if (!authorization.allowed || authorization.accessSource !== 'workspace') {
        throw new Error(authorization.message || 'Unauthorized workflow access')
      }
      if (authorization.workflow?.workspaceId !== workspaceId) {
        throw new Error('Workflow does not belong to the requested canvas')
      }
    } else {
      const access = await checkWorkspaceAccess(workspaceId, context.userId)
      if (!access.hasAccess) {
        throw new Error('Unauthorized canvas access')
      }
    }

    const clampedLimit = Math.min(Math.max(1, limit), 20)

    logger.info('Fetching execution summary', {
      workspaceId,
      workflowId,
      limit: clampedLimit,
      status,
    })

    const conditions: SQL[] = [eq(workflowExecutionLogs.workspaceId, workspaceId)]

    if (workflowId) {
      conditions.push(eq(workflowExecutionLogs.workflowId, workflowId))
    }

    if (status === 'error') {
      conditions.push(eq(workflowExecutionLogs.level, 'error'))
    } else if (status === 'success') {
      conditions.push(eq(workflowExecutionLogs.level, 'info'))
    }

    const rows = await db
      .select({
        executionId: workflowExecutionLogs.executionId,
        workflowId: workflowExecutionLogs.workflowId,
        workflowName: workflow.name,
        status: workflowExecutionLogs.status,
        level: workflowExecutionLogs.level,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        cost: workflowExecutionLogs.cost,
        executionData: workflowExecutionLogs.executionData,
      })
      .from(workflowExecutionLogs)
      .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .where(and(...conditions))
      .orderBy(desc(workflowExecutionLogs.startedAt))
      .limit(clampedLimit)

    const summaries: ExecutionSummary[] = rows.map((row) => {
      const costData = toCostData(row.cost)
      const errorMsg = row.level === 'error' ? extractErrorMessage(row.executionData) : null

      return {
        executionId: row.executionId,
        workflowId: row.workflowId,
        workflowName: row.workflowName,
        status: row.status,
        trigger: row.trigger,
        startedAt: row.startedAt.toISOString(),
        durationMs: row.totalDurationMs ?? null,
        cost: costData.total ? Number(costData.total) : null,
        error: errorMsg
          ? typeof errorMsg === 'string'
            ? errorMsg
            : JSON.stringify(errorMsg)
          : null,
      }
    })

    logger.info('Execution summary prepared', {
      count: summaries.length,
      workspaceId,
    })

    return summaries
  },
}
