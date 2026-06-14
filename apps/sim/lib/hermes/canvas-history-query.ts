import { db } from '@sim/db'
import { hermesToolCallAudit } from '@sim/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import type {
  HermesCanvasHistoryItem,
  HermesCanvasHistoryQueryResponse,
  ParsedHermesCanvasHistoryQueryBody,
} from '@/lib/api/contracts/internal/hermes-canvas-history'

const CANVAS_TOOL_NAME = 'sim_canvas_agent_run'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function toIds(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

function toStatus(value: string): 'success' | 'error' | 'unauthenticated' {
  return value === 'success' || value === 'unauthenticated' ? value : 'error'
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function serializeHistoryItem(
  row: typeof hermesToolCallAudit.$inferSelect
): HermesCanvasHistoryItem {
  const outputSummary = asRecord(row.outputSummary)
  const evidenceRef = `hermes_tool_call_audit:${row.id}`
  return {
    auditId: row.id,
    traceId: row.traceId,
    hermesRunId: row.hermesRunId,
    simRequestId: row.simRequestId,
    toolName: row.toolName,
    mode: row.mode,
    status: toStatus(row.status),
    risk: row.risk,
    requiresConfirmation: row.requiresConfirmation,
    pendingActionId: asString(outputSummary.pendingActionId),
    changedNodeIds: toIds(row.changedNodeIds),
    generatedNodeIds: toIds(row.generatedNodeIds),
    verificationSummary: row.verificationSummary,
    inputSummary: asRecord(row.inputSummary),
    outputSummary,
    errorCode: row.errorCode,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    evidenceRef,
  }
}

export async function queryHermesCanvasHistory(
  params: ParsedHermesCanvasHistoryQueryBody
): Promise<HermesCanvasHistoryQueryResponse> {
  const rows = await db
    .select()
    .from(hermesToolCallAudit)
    .where(
      and(
        eq(hermesToolCallAudit.toolName, CANVAS_TOOL_NAME),
        eq(hermesToolCallAudit.userId, params.userId),
        params.organizationId
          ? eq(hermesToolCallAudit.organizationId, params.organizationId)
          : undefined,
        eq(hermesToolCallAudit.workspaceId, params.workspaceId),
        eq(hermesToolCallAudit.workflowId, params.workflowId),
        params.auditId ? eq(hermesToolCallAudit.id, params.auditId) : undefined,
        params.mode ? eq(hermesToolCallAudit.mode, params.mode) : undefined,
        params.status ? eq(hermesToolCallAudit.status, params.status) : undefined,
        params.query === 'pending_actions'
          ? eq(hermesToolCallAudit.requiresConfirmation, true)
          : undefined
      )
    )
    .orderBy(desc(hermesToolCallAudit.createdAt))
    .limit(params.query === 'operation_detail' ? 1 : params.limit)

  const items = rows.map(serializeHistoryItem)
  const successCount = items.filter((item) => item.status === 'success').length
  const errorCount = items.filter((item) => item.status === 'error').length
  const pendingConfirmationCount = items.filter((item) => item.requiresConfirmation === true).length
  const latestVerificationSummary =
    items.find((item) => item.verificationSummary)?.verificationSummary ?? null

  return {
    success: true,
    traceId: params.traceId,
    scope: {
      userId: params.userId,
      ...(params.organizationId ? { organizationId: params.organizationId } : {}),
      workspaceId: params.workspaceId,
      workflowId: params.workflowId,
      ...(params.chatId ? { chatId: params.chatId } : {}),
      query: params.query,
    },
    summary: {
      total: items.length,
      successCount,
      errorCount,
      pendingConfirmationCount,
      changedNodeIds: unique(items.flatMap((item) => item.changedNodeIds)),
      generatedNodeIds: unique(items.flatMap((item) => item.generatedNodeIds)),
      latestVerificationSummary,
    },
    items,
    evidenceRefs: items.map((item) => item.evidenceRef),
  }
}
