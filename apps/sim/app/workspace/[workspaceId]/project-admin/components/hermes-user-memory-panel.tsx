'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Brain, Download, Loader, Trash2 } from 'lucide-react'
import { buttonVariants } from '@/components/emcn'
import type {
  HermesUserMemoryAdminCategory,
  HermesUserMemoryAdminEntry,
} from '@/lib/api/contracts/hermes-user-memories'
import { cn } from '@/lib/core/utils/cn'
import {
  useDeleteHermesUserMemory,
  useHermesUserMemories,
} from '@/hooks/queries/hermes-user-memories'

const CATEGORY_OPTIONS: { value: HermesUserMemoryAdminCategory | ''; label: string }[] = [
  { value: '', label: 'All categories' },
  { value: 'preference', label: 'Preference' },
  { value: 'communication_style', label: 'Communication style' },
  { value: 'content_interest', label: 'Content interest' },
  { value: 'workflow_habit', label: 'Workflow habit' },
  { value: 'tool_habit', label: 'Tool habit' },
  { value: 'correction', label: 'Correction' },
  { value: 'other', label: 'Other' },
]

interface HermesUserMemoryPanelProps {
  organizationId?: string
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function categoryClass(category: HermesUserMemoryAdminCategory): string {
  switch (category) {
    case 'workflow_habit':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
    case 'communication_style':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-500'
    case 'content_interest':
      return 'border-violet-500/30 bg-violet-500/10 text-violet-500'
    case 'tool_habit':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-500'
    case 'correction':
      return 'border-red-500/30 bg-red-500/10 text-red-500'
    case 'preference':
    case 'other':
      return 'border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-muted)]'
  }
}

function shortText(value: string, maxLength = 900): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function idLabel(value: string | null | undefined, fallback = 'Not recorded'): string {
  return value?.trim() || fallback
}

function evidenceLabel(refs: string[]): string {
  if (!refs.length) return 'No evidence refs'
  return refs.slice(0, 6).join(', ') + (refs.length > 6 ? ` +${refs.length - 6}` : '')
}

function exportMemories(memories: HermesUserMemoryAdminEntry[]): void {
  if (typeof window === 'undefined') return
  const blob = new Blob(
    [JSON.stringify({ exportedAt: new Date().toISOString(), memories }, null, 2)],
    {
      type: 'application/json',
    }
  )
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `hermes-user-memories-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function HermesUserMemoryCard({
  deleting,
  memory,
  onDelete,
}: {
  deleting: boolean
  memory: HermesUserMemoryAdminEntry
  onDelete: (memory: HermesUserMemoryAdminEntry) => void
}) {
  return (
    <article className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            <h3 className='font-medium text-[14px] text-[var(--text-primary)]'>
              User {memory.userId}
            </h3>
            <span
              className={cn(
                'rounded-[6px] border px-1.5 py-0.5 font-medium text-[10px]',
                categoryClass(memory.category)
              )}
            >
              {memory.category}
            </span>
            <span className='rounded-[6px] border border-[var(--border)] bg-[var(--surface-1)] px-1.5 py-0.5 font-medium text-[10px] text-[var(--text-muted)]'>
              {memory.source}
            </span>
          </div>
          <div className='mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]'>
            <span>Created: {formatDate(memory.createdAt)}</span>
            <span>Updated: {formatDate(memory.updatedAt)}</span>
            <span>Last seen: {formatDate(memory.lastSeenAt)}</span>
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='rounded-[8px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
            Memory {memory.id}
          </span>
          <button
            type='button'
            className={buttonVariants({ size: 'sm', variant: 'ghost' })}
            disabled={deleting}
            onClick={() => onDelete(memory)}
          >
            <Trash2 className='mr-1 h-[13px] w-[13px]' />
            Delete
          </button>
        </div>
      </div>

      <p className='mt-3 whitespace-pre-wrap break-words rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3 text-[12px] text-[var(--text-primary)]'>
        {shortText(memory.content)}
      </p>

      <div className='mt-3 grid gap-2 text-[11px] text-[var(--text-muted)] md:grid-cols-2'>
        <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2'>
          <div>Workspace: {idLabel(memory.workspaceId, 'Global user memory')}</div>
          <div>Hermes run: {idLabel(memory.sourceHermesRunId)}</div>
          <div>Trace: {idLabel(memory.sourceTraceId)}</div>
        </div>
        <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2'>
          <div>Organization: {memory.organizationId}</div>
          <div>Evidence: {evidenceLabel(memory.evidenceRefs)}</div>
        </div>
      </div>
    </article>
  )
}

export function HermesUserMemoryPanel({ organizationId }: HermesUserMemoryPanelProps) {
  const [category, setCategory] = useState<HermesUserMemoryAdminCategory | ''>('')
  const [userId, setUserId] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const query = useMemo(
    () => ({
      category: category || undefined,
      userId: userId.trim() || undefined,
      workspaceId: workspaceId.trim() || undefined,
      limit: 25,
    }),
    [category, userId, workspaceId]
  )
  const { data, isLoading, isFetching, error, refetch } = useHermesUserMemories(
    organizationId,
    query
  )
  const deleteMemory = useDeleteHermesUserMemory()
  const memories = data?.memories ?? []
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleDelete = (memory: HermesUserMemoryAdminEntry) => {
    if (!organizationId) return
    const confirmed = window.confirm(
      `Delete Hermes user memory ${memory.id}? This removes it from future SIM-backed Hermes memory prefetches.`
    )
    if (!confirmed) return
    setDeleteError(null)
    deleteMemory.mutate(
      {
        memoryId: memory.id,
        organizationId,
        body: { reason: 'Deleted from SIM project admin Hermes user memory panel' },
      },
      {
        onError: (mutationError) => {
          setDeleteError(
            mutationError instanceof Error
              ? mutationError.message
              : 'Unable to delete Hermes user memory.'
          )
        },
      }
    )
  }

  return (
    <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
      <div className='flex flex-wrap items-start justify-between gap-3 border-[var(--border)] border-b px-4 py-3'>
        <div className='flex items-start gap-2'>
          <Brain className='mt-0.5 h-[15px] w-[15px] text-[var(--text-icon)]' />
          <div>
            <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
              Hermes user memory
            </h2>
            <p className='mt-1 max-w-[760px] text-[12px] text-[var(--text-muted)]'>
              Inspect SIM-scoped long-term user preferences stored by the Hermes memory provider.
              Current canvas task state and raw tool outputs should not appear here.
            </p>
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <select
            className='h-8 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text-primary)]'
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as HermesUserMemoryAdminCategory | '')
            }
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            className='h-8 w-[190px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]'
            placeholder='User id'
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          />
          <input
            className='h-8 w-[210px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]'
            placeholder='Workspace id'
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
          />
          <button
            type='button'
            className={buttonVariants({ size: 'sm', variant: 'default' })}
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            Refresh
          </button>
          <button
            type='button'
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
            disabled={!memories.length}
            onClick={() => exportMemories(memories)}
          >
            <Download className='mr-1 h-[13px] w-[13px]' />
            Export JSON
          </button>
        </div>
      </div>

      {(error || deleteError) && (
        <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3 text-[12px] text-red-500'>
          <AlertTriangle className='h-[14px] w-[14px]' />
          {deleteError ??
            (error instanceof Error ? error.message : 'Unable to load Hermes user memories.')}
        </div>
      )}

      <div className='grid gap-3 p-4'>
        {isLoading ? (
          <div className='flex items-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-4 text-[12px] text-[var(--text-muted)]'>
            <Loader className='h-[14px] w-[14px]' />
            Loading Hermes user memories...
          </div>
        ) : memories.length === 0 ? (
          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-4 text-[12px] text-[var(--text-muted)]'>
            No Hermes user memory rows match the current filters. Durable user preferences will
            appear here after the SIM-backed memory provider accepts them.
          </div>
        ) : (
          memories.map((memory) => (
            <HermesUserMemoryCard
              key={memory.id}
              deleting={deleteMemory.isPending && deleteMemory.variables?.memoryId === memory.id}
              memory={memory}
              onDelete={handleDelete}
            />
          ))
        )}

        {isFetching && !isLoading && (
          <div className='text-[11px] text-[var(--text-muted)]'>Refreshing memory rows...</div>
        )}
      </div>
    </section>
  )
}
