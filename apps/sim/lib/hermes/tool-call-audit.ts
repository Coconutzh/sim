import { db } from '@sim/db'
import { hermesToolCallAudit } from '@sim/db/schema'
import { createLogger } from '@sim/logger'

const logger = createLogger('HermesToolCallAudit')
const MAX_SUMMARY_STRING_LENGTH = 2000
const MAX_ERROR_LENGTH = 2000

export type HermesToolCallStatus = 'success' | 'error' | 'unauthenticated'

export interface HermesToolCallAuditParams {
  auditId: string
  traceId?: string
  hermesRunId?: string
  simRequestId?: string
  userId?: string
  organizationId?: string
  workspaceId?: string
  workflowId?: string
  toolName: string
  mode?: string
  operation?: string
  status: HermesToolCallStatus
  inputSummary?: Record<string, unknown>
  outputSummary?: Record<string, unknown>
  risk?: string
  requiresConfirmation?: boolean
  changedNodeIds?: string[]
  generatedNodeIds?: string[]
  verificationSummary?: string
  durationMs?: number
  errorCode?: string
  error?: string
}

function trim(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function sanitizeSummaryValue(value: unknown): unknown {
  if (typeof value === 'string') return trim(value, MAX_SUMMARY_STRING_LENGTH)
  if (Array.isArray(value)) return value.slice(0, 100).map(sanitizeSummaryValue)
  if (!value || typeof value !== 'object') return value

  const output: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    output[key] = sanitizeSummaryValue(nestedValue)
  }
  return output
}

function sanitizeSummary(summary: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!summary) return {}
  return sanitizeSummaryValue(summary) as Record<string, unknown>
}

function cleanIds(ids: string[] | undefined): string[] {
  return Array.isArray(ids)
    ? ids.filter((id) => typeof id === 'string' && id.trim().length > 0).slice(0, 200)
    : []
}

export async function recordHermesToolCallAudit(params: HermesToolCallAuditParams): Promise<void> {
  try {
    await db.insert(hermesToolCallAudit).values({
      id: params.auditId,
      traceId: params.traceId,
      hermesRunId: params.hermesRunId,
      simRequestId: params.simRequestId ?? params.auditId,
      userId: params.userId,
      organizationId: params.organizationId,
      workspaceId: params.workspaceId,
      workflowId: params.workflowId,
      toolName: params.toolName,
      mode: params.mode,
      operation: params.operation,
      status: params.status,
      inputSummary: sanitizeSummary(params.inputSummary),
      outputSummary: sanitizeSummary(params.outputSummary),
      risk: params.risk,
      requiresConfirmation: params.requiresConfirmation,
      changedNodeIds: cleanIds(params.changedNodeIds),
      generatedNodeIds: cleanIds(params.generatedNodeIds),
      verificationSummary: trim(params.verificationSummary, MAX_SUMMARY_STRING_LENGTH),
      durationMs: params.durationMs,
      errorCode: params.errorCode,
      error: trim(params.error, MAX_ERROR_LENGTH),
    })
  } catch (error) {
    logger.warn('Failed to persist Hermes tool call audit', {
      auditId: params.auditId,
      traceId: params.traceId,
      toolName: params.toolName,
      status: params.status,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
