import { db } from '@sim/db'
import { workflow, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { exportLogsContract } from '@/lib/api/contracts/logs'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { buildFilterConditions } from '@/lib/logs/filters'
import { expandFolderIdsWithDescendants } from '@/lib/logs/folder-expansion'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('LogsExportAPI')

export const revalidate = 0

interface ExportExecutionData {
  finalOutput?: unknown
  message?: string
  traceSpans?: unknown
}

interface LogExportRow {
  startedAt: Date | string | null
  level: string
  workflowName: string
  trigger: string | null
  totalDurationMs: number | null
  cost: unknown
  workflowId: string | null
  executionId: string | null
  executionData: ExportExecutionData | null
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function getTotalCost(cost: unknown): unknown {
  if (!cost || typeof cost !== 'object') return ''
  const record = cost as Record<string, unknown>
  if (record.total !== undefined) return record.total
  const value = record.value
  if (value && typeof value === 'object' && 'total' in value) {
    return (value as Record<string, unknown>).total
  }
  return ''
}

function formatDate(value: Date | string | null): string {
  if (value instanceof Date) return value.toISOString()
  return value ?? ''
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const parsed = await parseRequest(exportLogsContract, request, {})
    if (!parsed.success) return parsed.response

    const params = parsed.data.query
    const access = await checkWorkspaceAccess(params.workspaceId, userId)
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }

    const selectColumns = {
      id: workflowExecutionLogs.id,
      workflowId: workflowExecutionLogs.workflowId,
      executionId: workflowExecutionLogs.executionId,
      level: workflowExecutionLogs.level,
      trigger: workflowExecutionLogs.trigger,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      cost: workflowExecutionLogs.cost,
      executionData: workflowExecutionLogs.executionData,
      workflowName: sql<string>`COALESCE(${workflow.name}, 'Deleted Workflow')`,
    }

    if (params.folderIds) {
      params.folderIds = await expandFolderIdsWithDescendants(params.workspaceId, params.folderIds)
    }

    const workspaceCondition = eq(workflowExecutionLogs.workspaceId, params.workspaceId)
    const filterConditions = buildFilterConditions(params)
    const conditions = filterConditions
      ? and(workspaceCondition, filterConditions)
      : workspaceCondition

    const header = [
      'startedAt',
      'level',
      'workflow',
      'trigger',
      'durationMs',
      'costTotal',
      'workflowId',
      'executionId',
      'message',
      'traceSpans',
    ].join(',')

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        controller.enqueue(encoder.encode(`${header}\n`))
        const pageSize = 1000
        let offset = 0
        try {
          while (true) {
            const rows = await db
              .select(selectColumns)
              .from(workflowExecutionLogs)
              .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
              .where(conditions)
              .orderBy(desc(workflowExecutionLogs.startedAt))
              .limit(pageSize)
              .offset(offset)

            if (!rows.length) break

            for (const row of rows as LogExportRow[]) {
              let message = ''
              let traces: unknown = null
              try {
                const executionData = row.executionData
                if (executionData) {
                  if (executionData.finalOutput) {
                    message =
                      typeof executionData.finalOutput === 'string'
                        ? executionData.finalOutput
                        : JSON.stringify(executionData.finalOutput)
                  }
                  if (executionData.message) message = executionData.message
                  if (executionData.traceSpans) traces = executionData.traceSpans
                }
              } catch {}
              const line = [
                escapeCsv(formatDate(row.startedAt)),
                escapeCsv(row.level),
                escapeCsv(row.workflowName),
                escapeCsv(row.trigger),
                escapeCsv(row.totalDurationMs ?? ''),
                escapeCsv(getTotalCost(row.cost)),
                escapeCsv(row.workflowId ?? ''),
                escapeCsv(row.executionId ?? ''),
                escapeCsv(message),
                escapeCsv(traces ? JSON.stringify(traces) : ''),
              ].join(',')
              controller.enqueue(encoder.encode(`${line}\n`))
            }

            offset += pageSize
          }
          controller.close()
        } catch (error) {
          logger.error('Export stream error', { error: getErrorMessage(error) })
          try {
            controller.error(error)
          } catch {}
        }
      },
    })

    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `logs-${ts}.csv`

    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    logger.error('Export error', { error: getErrorMessage(error) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
