'use client'

import { Activity, AlertTriangle, CheckCircle2, ServerCog } from 'lucide-react'
import { buttonVariants, Loader } from '@/components/emcn'
import type { HermesAdminHealthResponse } from '@/lib/api/contracts/hermes-health'
import type { HermesHealthStatus } from '@/lib/api/contracts/internal/hermes-health'
import { cn } from '@/lib/core/utils/cn'
import { useHermesHealth } from '@/hooks/queries/hermes-health'

interface HermesHealthPanelProps {
  organizationId?: string
}

function statusClass(status: HermesHealthStatus): string {
  switch (status) {
    case 'healthy':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
    case 'degraded':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-500'
    case 'unconfigured':
    case 'unreachable':
      return 'border-red-500/30 bg-red-500/10 text-red-500'
  }
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function displayValue(value: string | null | undefined): string {
  return value?.trim() || 'Not reported'
}

function isHealthResponse(value: unknown): value is HermesAdminHealthResponse {
  return Boolean(value && typeof value === 'object' && 'ok' in value && 'status' in value)
}

function capabilityRows(health: HermesAdminHealthResponse) {
  const capabilities = health.capabilities
  if (!capabilities) {
    return [{ label: 'Capabilities', value: 'Not reported', ok: false }]
  }
  return [
    {
      label: 'Chat completions',
      value: capabilities.chatCompletions ? 'Ready' : 'Missing',
      ok: capabilities.chatCompletions,
    },
    {
      label: 'Responses API',
      value: capabilities.responsesApi ? 'Ready' : 'Missing',
      ok: capabilities.responsesApi,
    },
    {
      label: 'Skills API',
      value: capabilities.skillsApi ? 'Ready' : 'Missing',
      ok: capabilities.skillsApi,
    },
    {
      label: 'Session key header',
      value: capabilities.sessionKeyHeader ?? 'Missing',
      ok: capabilities.sessionKeyHeader === 'X-Hermes-Session-Key',
    },
  ]
}

export function HermesHealthPanel({ organizationId }: HermesHealthPanelProps) {
  const { data, error, isLoading, isFetching, refetch } = useHermesHealth(organizationId)
  const health = isHealthResponse(data) ? data : null
  const toolsets = health?.toolsets
  const missingToolsets = toolsets?.missing ?? []
  const enabledForbiddenToolsets = toolsets?.enabledForbidden ?? []
  const missingTools = Object.entries(toolsets?.missingTools ?? {})

  return (
    <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
      <div className='flex flex-wrap items-start justify-between gap-3 border-[var(--border)] border-b px-4 py-3'>
        <div className='flex items-start gap-2'>
          <ServerCog className='mt-0.5 h-[15px] w-[15px] text-[var(--text-icon)]' />
          <div>
            <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
              Hermes runtime health
            </h2>
            <p className='mt-1 max-w-[760px] text-[12px] text-[var(--text-muted)]'>
              Verify the configured Hermes API Server, commit, capabilities, session-key support,
              and required SIM toolsets before routing production agent work through Hermes.
            </p>
          </div>
        </div>
        <button
          type='button'
          className={buttonVariants({ size: 'sm', variant: 'default' })}
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3 text-[12px] text-red-500'>
          <AlertTriangle className='h-[14px] w-[14px]' />
          {error instanceof Error ? error.message : 'Unable to load Hermes health.'}
        </div>
      )}

      <div className='grid gap-4 p-4'>
        {isLoading ? (
          <div className='flex items-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-4 text-[12px] text-[var(--text-muted)]'>
            <Loader className='h-[14px] w-[14px]' />
            Loading Hermes runtime health...
          </div>
        ) : !health ? (
          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-4 text-[12px] text-[var(--text-muted)]'>
            Hermes health is not available for this organization.
          </div>
        ) : (
          <>
            <div className='grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]'>
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                <div className='text-[11px] text-[var(--text-muted)]'>Runtime status</div>
                <div className='mt-2 flex flex-wrap items-center gap-2'>
                  <span
                    className={cn(
                      'rounded-[6px] border px-2 py-1 font-medium text-[11px]',
                      statusClass(health.status)
                    )}
                  >
                    {health.status}
                  </span>
                  <span className='text-[12px] text-[var(--text-muted)]'>
                    {health.ok ? 'Ready for SIM orchestration' : 'Needs attention'}
                  </span>
                </div>
              </div>
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                <div className='text-[11px] text-[var(--text-muted)]'>Base URL</div>
                <div className='mt-2 break-all font-medium text-[13px] text-[var(--text-primary)]'>
                  {displayValue(health.baseUrl)}
                </div>
              </div>
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                <div className='text-[11px] text-[var(--text-muted)]'>Version / commit</div>
                <div className='mt-2 font-medium text-[13px] text-[var(--text-primary)]'>
                  {displayValue(health.version)}
                </div>
                <div className='mt-1 break-all text-[11px] text-[var(--text-muted)]'>
                  {displayValue(health.commit)}
                </div>
              </div>
            </div>

            {health.error && (
              <div className='rounded-[8px] border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-500'>
                {health.error}
              </div>
            )}

            <div className='grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                <div className='mb-3 flex items-center gap-2 font-medium text-[12px] text-[var(--text-primary)]'>
                  <Activity className='h-[14px] w-[14px] text-[var(--text-icon)]' />
                  Capabilities
                </div>
                <div className='grid gap-2'>
                  {capabilityRows(health).map((row) => (
                    <div
                      key={row.label}
                      className='flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2 text-[12px]'
                    >
                      <span className='text-[var(--text-muted)]'>{row.label}</span>
                      <span
                        className={cn(
                          'font-medium',
                          row.ok ? 'text-emerald-500' : 'text-amber-500'
                        )}
                      >
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                <div className='mb-3 flex items-center gap-2 font-medium text-[12px] text-[var(--text-primary)]'>
                  <CheckCircle2 className='h-[14px] w-[14px] text-[var(--text-icon)]' />
                  Toolset policy
                </div>
                {!toolsets ? (
                  <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2 text-[12px] text-[var(--text-muted)]'>
                    Toolset check was not returned by Hermes.
                  </div>
                ) : (
                  <div className='grid gap-2 text-[12px]'>
                    <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2 text-[var(--text-muted)]'>
                      Required:{' '}
                      {toolsets.required.length > 0 ? toolsets.required.join(', ') : 'None'}
                    </div>
                    <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2 text-[var(--text-muted)]'>
                      Enabled: {toolsets.enabled.length > 0 ? toolsets.enabled.join(', ') : 'None'}
                    </div>
                    <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2 text-[var(--text-muted)]'>
                      Forbidden:{' '}
                      {toolsets.forbidden.length > 0 ? toolsets.forbidden.join(', ') : 'None'}
                    </div>
                    <div
                      className={cn(
                        'rounded-[8px] border p-2',
                        missingToolsets.length > 0
                          ? 'border-red-500/30 bg-red-500/10 text-red-500'
                          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                      )}
                    >
                      Missing: {missingToolsets.length > 0 ? missingToolsets.join(', ') : 'None'}
                    </div>
                    <div
                      className={cn(
                        'rounded-[8px] border p-2',
                        enabledForbiddenToolsets.length > 0
                          ? 'border-red-500/30 bg-red-500/10 text-red-500'
                          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                      )}
                    >
                      Enabled forbidden:{' '}
                      {enabledForbiddenToolsets.length > 0
                        ? enabledForbiddenToolsets.join(', ')
                        : 'None'}
                    </div>
                    <div
                      className={cn(
                        'rounded-[8px] border p-2',
                        missingTools.length > 0
                          ? 'border-red-500/30 bg-red-500/10 text-red-500'
                          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                      )}
                    >
                      Missing tools:{' '}
                      {missingTools.length > 0
                        ? missingTools
                            .map(([toolset, tools]) => `${toolset}: ${tools.join(', ')}`)
                            .join(' / ')
                        : 'None'}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className='text-[11px] text-[var(--text-muted)]'>
              Last checked: {formatDate(health.checkedAt)}
              {health.responseStatus ? ` / HTTP ${health.responseStatus}` : ''}
              {isFetching ? ' / refreshing...' : ''}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
