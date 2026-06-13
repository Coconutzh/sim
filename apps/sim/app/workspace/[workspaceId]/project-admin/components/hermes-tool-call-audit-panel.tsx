'use client'

import { useMemo, useState } from 'react'
import { Activity, AlertTriangle } from 'lucide-react'
import { buttonVariants, Loader } from '@/components/emcn'
import type {
  HermesToolCallAuditEntry,
  HermesToolCallAuditStatus,
} from '@/lib/api/contracts/hermes-tool-call-audits'
import { cn } from '@/lib/core/utils/cn'
import { useHermesToolCallAudits } from '@/hooks/queries/hermes-tool-call-audits'

const STATUS_OPTIONS: { value: HermesToolCallAuditStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'success', label: 'Success' },
  { value: 'error', label: 'Error' },
  { value: 'unauthenticated', label: 'Unauthenticated' },
]

interface HermesToolCallAuditPanelProps {
  organizationId?: string
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function statusClass(status: HermesToolCallAuditStatus): string {
  switch (status) {
    case 'success':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
    case 'unauthenticated':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-500'
    case 'error':
      return 'border-red-500/30 bg-red-500/10 text-red-500'
  }
}

function riskClass(risk: string | null): string {
  switch (risk) {
    case 'high':
      return 'border-red-500/30 bg-red-500/10 text-red-500'
    case 'medium':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-500'
    case 'low':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
    default:
      return 'border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-muted)]'
  }
}

function shortText(value: string, maxLength = 900): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function jsonPreview(value: Record<string, unknown>): string {
  const entries = Object.entries(value)
  if (entries.length === 0) return 'No summary recorded.'
  return shortText(JSON.stringify(value, null, 2))
}

function auditIdLabel(value: string | null | undefined, fallback = 'Not recorded'): string {
  return value?.trim() || fallback
}

function nodeListLabel(ids: string[]): string {
  if (ids.length === 0) return 'None'
  return ids.slice(0, 8).join(', ') + (ids.length > 8 ? ` +${ids.length - 8}` : '')
}

function HermesToolCallAuditCard({ audit }: { audit: HermesToolCallAuditEntry }) {
  return (
    <article className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            <h3 className='font-medium text-[14px] text-[var(--text-primary)]'>{audit.toolName}</h3>
            <span
              className={cn(
                'rounded-[6px] border px-1.5 py-0.5 font-medium text-[10px]',
                statusClass(audit.status)
              )}
            >
              {audit.status}
            </span>
            <span
              className={cn(
                'rounded-[6px] border px-1.5 py-0.5 font-medium text-[10px]',
                riskClass(audit.risk)
              )}
            >
              {audit.risk ?? 'no risk'}
            </span>
            {audit.requiresConfirmation && (
              <span className='rounded-[6px] border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-medium text-[10px] text-amber-500'>
                confirmation required
              </span>
            )}
          </div>
          <div className='mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]'>
            <span>Mode: {audit.mode ?? 'Not recorded'}</span>
            <span>Operation: {audit.operation ?? 'Not recorded'}</span>
            <span>Duration: {audit.durationMs ?? 'n/a'}ms</span>
            <span>Created: {formatDate(audit.createdAt)}</span>
          </div>
        </div>
        <span className='rounded-[8px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
          Audit {audit.id}
        </span>
      </div>

      <div className='mt-3 grid gap-2 text-[11px] text-[var(--text-muted)] md:grid-cols-2'>
        <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2'>
          <div>Trace: {auditIdLabel(audit.traceId)}</div>
          <div>Hermes run: {auditIdLabel(audit.hermesRunId)}</div>
          <div>SIM request: {auditIdLabel(audit.simRequestId)}</div>
        </div>
        <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2'>
          <div>Workspace: {auditIdLabel(audit.workspaceId)}</div>
          <div>Workflow: {auditIdLabel(audit.workflowId)}</div>
          <div>User: {auditIdLabel(audit.userId)}</div>
        </div>
      </div>

      {(audit.error || audit.errorCode || audit.verificationSummary) && (
        <div className='mt-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3 text-[12px] text-[var(--text-muted)]'>
          {audit.errorCode && <div>Error code: {audit.errorCode}</div>}
          {audit.error && <div className='text-red-500'>Error: {audit.error}</div>}
          {audit.verificationSummary && <div>Verify: {audit.verificationSummary}</div>}
        </div>
      )}

      <div className='mt-3 grid gap-2 text-[11px] text-[var(--text-muted)] md:grid-cols-2'>
        <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2'>
          Changed nodes: {nodeListLabel(audit.changedNodeIds)}
        </div>
        <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2'>
          Generated nodes: {nodeListLabel(audit.generatedNodeIds)}
        </div>
      </div>

      <div className='mt-3 grid gap-3 md:grid-cols-2'>
        <div>
          <div className='mb-1 font-medium text-[11px] text-[var(--text-primary)]'>
            Input summary
          </div>
          <pre className='max-h-[220px] overflow-auto whitespace-pre-wrap rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3 text-[11px] text-[var(--text-muted)]'>
            {jsonPreview(audit.inputSummary)}
          </pre>
        </div>
        <div>
          <div className='mb-1 font-medium text-[11px] text-[var(--text-primary)]'>
            Output summary
          </div>
          <pre className='max-h-[220px] overflow-auto whitespace-pre-wrap rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3 text-[11px] text-[var(--text-muted)]'>
            {jsonPreview(audit.outputSummary)}
          </pre>
        </div>
      </div>
    </article>
  )
}

export function HermesToolCallAuditPanel({ organizationId }: HermesToolCallAuditPanelProps) {
  const [status, setStatus] = useState<HermesToolCallAuditStatus | ''>('')
  const [toolName, setToolName] = useState('')
  const query = useMemo(
    () => ({
      status: status || undefined,
      toolName: toolName.trim() || undefined,
      limit: 25,
    }),
    [status, toolName]
  )
  const { data, isLoading, isFetching, error, refetch } = useHermesToolCallAudits(
    organizationId,
    query
  )
  const audits = data?.audits ?? []

  return (
    <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
      <div className='flex flex-wrap items-start justify-between gap-3 border-[var(--border)] border-b px-4 py-3'>
        <div className='flex items-start gap-2'>
          <Activity className='mt-0.5 h-[15px] w-[15px] text-[var(--text-icon)]' />
          <div>
            <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
              Hermes tool-call audit
            </h2>
            <p className='mt-1 max-w-[760px] text-[12px] text-[var(--text-muted)]'>
              Inspect service-token calls from Hermes into SIM, including trace ids, sanitized
              summaries, risk, confirmation state, errors, and verify results.
            </p>
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <select
            className='h-8 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text-primary)]'
            value={status}
            onChange={(event) => setStatus(event.target.value as HermesToolCallAuditStatus | '')}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            className='h-8 w-[220px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]'
            placeholder='Exact tool name'
            value={toolName}
            onChange={(event) => setToolName(event.target.value)}
          />
          <button
            type='button'
            className={buttonVariants({ size: 'sm', variant: 'default' })}
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3 text-[12px] text-red-500'>
          <AlertTriangle className='h-[14px] w-[14px]' />
          {error instanceof Error ? error.message : 'Unable to load Hermes tool-call audits.'}
        </div>
      )}

      <div className='grid gap-3 p-4'>
        {isLoading ? (
          <div className='flex items-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-4 text-[12px] text-[var(--text-muted)]'>
            <Loader className='h-[14px] w-[14px]' />
            Loading Hermes tool-call audits...
          </div>
        ) : audits.length === 0 ? (
          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-4 text-[12px] text-[var(--text-muted)]'>
            No Hermes tool-call audit rows match the current filters. Calls from the SIM plugin
            canvas and skill proposal tools will appear here once Hermes invokes SIM internal APIs.
          </div>
        ) : (
          audits.map((audit) => <HermesToolCallAuditCard key={audit.id} audit={audit} />)
        )}

        {isFetching && !isLoading && (
          <div className='text-[11px] text-[var(--text-muted)]'>Refreshing audit rows...</div>
        )}
      </div>
    </section>
  )
}
