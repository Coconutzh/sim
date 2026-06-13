import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { hermesToolCallAudit } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, lt } from 'drizzle-orm'
import type {
  ExportHermesToolCallAuditsQuery,
  ExportHermesToolCallAuditsResponse,
  HermesToolCallAuditEntry,
  HermesToolCallAuditStatus,
  ListHermesToolCallAuditsQuery,
} from '@/lib/api/contracts/hermes-tool-call-audits'
import { assertOrganizationAdmin } from '@/lib/collaboration/service'

const logger = createLogger('HermesToolCallAudit')
const MAX_SUMMARY_STRING_LENGTH = 2000
const MAX_ERROR_LENGTH = 2000
const HERMES_TOOL_CALL_AUDIT_RETENTION_JOB_TYPE = 'hermes_tool_call_audit_retention'

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

export interface ListHermesToolCallAuditsParams {
  userId: string
  organizationId: string
  query: ListHermesToolCallAuditsQuery
}

export interface ExportHermesToolCallAuditsParams {
  userId: string
  organizationId: string
  query: ExportHermesToolCallAuditsQuery
}

export interface CleanupHermesToolCallAuditsParams {
  userId: string
  organizationId: string
  retentionHours: number
  dryRun?: boolean
}

export interface HermesToolCallAuditCleanupResult {
  retentionHours: number
  cutoff: string
  dryRun: boolean
  matchedCount: number
  deletedCount: number
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

function toStatus(value: string): HermesToolCallAuditStatus {
  return value === 'success' || value === 'unauthenticated' ? value : 'error'
}

function toSummary(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function toIds(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

function serializeToolCallAudit(
  row: typeof hermesToolCallAudit.$inferSelect
): HermesToolCallAuditEntry {
  return {
    id: row.id,
    traceId: row.traceId,
    hermesRunId: row.hermesRunId,
    simRequestId: row.simRequestId,
    userId: row.userId,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    workflowId: row.workflowId,
    toolName: row.toolName,
    mode: row.mode,
    operation: row.operation,
    status: toStatus(row.status),
    inputSummary: toSummary(row.inputSummary),
    outputSummary: toSummary(row.outputSummary),
    risk: row.risk,
    requiresConfirmation: row.requiresConfirmation,
    changedNodeIds: toIds(row.changedNodeIds),
    generatedNodeIds: toIds(row.generatedNodeIds),
    verificationSummary: row.verificationSummary,
    durationMs: row.durationMs,
    errorCode: row.errorCode,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function listHermesToolCallAudits(
  params: ListHermesToolCallAuditsParams
): Promise<HermesToolCallAuditEntry[]> {
  await assertOrganizationAdmin(params.userId, params.organizationId)

  const rows = await db
    .select()
    .from(hermesToolCallAudit)
    .where(
      and(
        eq(hermesToolCallAudit.organizationId, params.organizationId),
        params.query.status ? eq(hermesToolCallAudit.status, params.query.status) : undefined,
        params.query.toolName ? eq(hermesToolCallAudit.toolName, params.query.toolName) : undefined,
        params.query.workflowId
          ? eq(hermesToolCallAudit.workflowId, params.query.workflowId)
          : undefined,
        params.query.hermesRunId
          ? eq(hermesToolCallAudit.hermesRunId, params.query.hermesRunId)
          : undefined
      )
    )
    .orderBy(desc(hermesToolCallAudit.createdAt))
    .limit(params.query.limit)

  return rows.map(serializeToolCallAudit)
}

export async function exportHermesToolCallAudits(
  params: ExportHermesToolCallAuditsParams
): Promise<ExportHermesToolCallAuditsResponse> {
  await assertOrganizationAdmin(params.userId, params.organizationId)

  const rows = await db
    .select()
    .from(hermesToolCallAudit)
    .where(
      and(
        eq(hermesToolCallAudit.organizationId, params.organizationId),
        params.query.status ? eq(hermesToolCallAudit.status, params.query.status) : undefined,
        params.query.toolName ? eq(hermesToolCallAudit.toolName, params.query.toolName) : undefined,
        params.query.workflowId
          ? eq(hermesToolCallAudit.workflowId, params.query.workflowId)
          : undefined,
        params.query.hermesRunId
          ? eq(hermesToolCallAudit.hermesRunId, params.query.hermesRunId)
          : undefined
      )
    )
    .orderBy(desc(hermesToolCallAudit.createdAt))
    .limit(params.query.limit)

  const audits = rows.map(serializeToolCallAudit)
  return {
    exportedAt: new Date().toISOString(),
    filters: params.query,
    count: audits.length,
    audits,
  }
}

export async function cleanupHermesToolCallAudits(
  params: CleanupHermesToolCallAuditsParams
): Promise<HermesToolCallAuditCleanupResult> {
  await assertOrganizationAdmin(params.userId, params.organizationId)

  const retentionHours = Math.trunc(params.retentionHours)
  const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000)
  const condition = and(
    eq(hermesToolCallAudit.organizationId, params.organizationId),
    lt(hermesToolCallAudit.createdAt, cutoff)
  )
  const matchedRows = await db
    .select({ id: hermesToolCallAudit.id })
    .from(hermesToolCallAudit)
    .where(condition)
  const dryRun = params.dryRun === true
  const deletedRows = dryRun
    ? []
    : await db
        .delete(hermesToolCallAudit)
        .where(condition)
        .returning({ id: hermesToolCallAudit.id })
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
    resourceName: 'Hermes tool-call audit retention',
    description: dryRun
      ? `Previewed Hermes tool-call audit retention for ${retentionHours}h: ${result.matchedCount} row(s) matched`
      : `Cleaned Hermes tool-call audit older than ${retentionHours}h: ${result.deletedCount} row(s) deleted`,
    metadata: {
      organizationId: params.organizationId,
      cleanupEvent: 'cleanup.execution_completed',
      jobType: HERMES_TOOL_CALL_AUDIT_RETENTION_JOB_TYPE,
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
