'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, GitBranch, Sparkles } from 'lucide-react'
import { buttonVariants, Loader } from '@/components/emcn'
import type {
  HermesSkillProposal,
  HermesSkillProposalStatus,
} from '@/lib/api/contracts/internal/hermes-skill-proposals'
import { cn } from '@/lib/core/utils/cn'
import {
  usePublishSkillProposal,
  useReviewSkillProposal,
  useRollbackSkillRevision,
  useSkillProposals,
} from '@/hooks/queries/skill-proposals'

const STATUS_OPTIONS: { value: HermesSkillProposalStatus | ''; label: string }[] = [
  { value: 'pending_review', label: 'Pending review' },
  { value: 'approved', label: 'Approved' },
  { value: 'published', label: 'Published' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'draft', label: 'Draft' },
  { value: '', label: 'All proposals' },
]

interface SkillProposalGovernanceProps {
  organizationId?: string
}

function formatDate(value: string | null): string {
  if (!value) return 'Not set'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function statusClass(status: HermesSkillProposalStatus): string {
  switch (status) {
    case 'approved':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
    case 'published':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-500'
    case 'rejected':
      return 'border-red-500/30 bg-red-500/10 text-red-500'
    case 'draft':
      return 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]'
    case 'pending_review':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-500'
  }
}

function riskClass(risk: HermesSkillProposal['risk']): string {
  switch (risk) {
    case 'high':
      return 'border-red-500/30 bg-red-500/10 text-red-500'
    case 'medium':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-500'
    case 'low':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
  }
}

function previewText(proposal: HermesSkillProposal): string {
  return (
    proposal.proposedDiff?.trim() ||
    proposal.proposedContent?.trim() ||
    'Hermes did not attach proposed content or diff.'
  )
}

function shortText(value: string, maxLength = 1200): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

export function SkillProposalGovernance({ organizationId }: SkillProposalGovernanceProps) {
  const [status, setStatus] = useState<HermesSkillProposalStatus | ''>('pending_review')
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [rollbackVersions, setRollbackVersions] = useState<Record<string, string>>({})
  const [rollbackReasons, setRollbackReasons] = useState<Record<string, string>>({})
  const [actionStatus, setActionStatus] = useState<string | null>(null)
  const query = useMemo(() => ({ status: status || undefined, limit: 50 }), [status])
  const { data, isLoading, isFetching, error } = useSkillProposals(organizationId, query)
  const reviewProposal = useReviewSkillProposal()
  const publishProposal = usePublishSkillProposal()
  const rollbackSkill = useRollbackSkillRevision()
  const proposals = data?.proposals ?? []
  const pendingAction =
    reviewProposal.isPending || publishProposal.isPending || rollbackSkill.isPending

  const handleReview = async (proposal: HermesSkillProposal, action: 'approve' | 'reject') => {
    if (!organizationId) return
    setActionStatus(null)
    try {
      await reviewProposal.mutateAsync({
        organizationId,
        proposalId: proposal.id,
        body: {
          action,
          reviewNote: reviewNotes[proposal.id]?.trim() || undefined,
        },
      })
      setActionStatus(`${action === 'approve' ? 'Approved' : 'Rejected'} "${proposal.title}".`)
    } catch (mutationError) {
      setActionStatus(
        mutationError instanceof Error ? mutationError.message : 'Unable to review proposal.'
      )
    }
  }

  const handlePublish = async (proposal: HermesSkillProposal) => {
    if (!organizationId) return
    setActionStatus(null)
    try {
      const result = await publishProposal.mutateAsync({
        organizationId,
        proposalId: proposal.id,
        body: { enableBinding: true },
      })
      setActionStatus(`Published "${result.skill.name}" as revision ${result.revision.version}.`)
    } catch (mutationError) {
      setActionStatus(
        mutationError instanceof Error ? mutationError.message : 'Unable to publish proposal.'
      )
    }
  }

  const handleRollback = async (proposal: HermesSkillProposal) => {
    if (!organizationId || !proposal.publishedSkillId) return
    const version = Number(rollbackVersions[proposal.id])
    if (!Number.isInteger(version) || version < 1) {
      setActionStatus('Enter a valid published revision number before rollback.')
      return
    }
    setActionStatus(null)
    try {
      const result = await rollbackSkill.mutateAsync({
        organizationId,
        skillId: proposal.publishedSkillId,
        body: {
          version,
          reason: rollbackReasons[proposal.id]?.trim() || undefined,
        },
      })
      setActionStatus(
        `Rolled back "${result.skill.name}" and created revision ${result.revision.version}.`
      )
    } catch (mutationError) {
      setActionStatus(
        mutationError instanceof Error ? mutationError.message : 'Unable to rollback skill.'
      )
    }
  }

  return (
    <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
      <div className='flex flex-wrap items-start justify-between gap-3 border-[var(--border)] border-b px-4 py-3'>
        <div className='flex items-start gap-2'>
          <Sparkles className='mt-0.5 h-[15px] w-[15px] text-[var(--text-icon)]' />
          <div>
            <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
              Hermes Skill Proposal governance
            </h2>
            <p className='mt-1 max-w-[760px] text-[12px] text-[var(--text-muted)]'>
              Review Hermes-generated team skill candidates before they become SIM published skills.
              Hermes can propose and patch; admins approve, publish, and rollback.
            </p>
          </div>
        </div>
        <label className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
          Status
          <select
            className='h-8 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text-primary)]'
            value={status}
            onChange={(event) => setStatus(event.target.value as HermesSkillProposalStatus | '')}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {actionStatus && (
        <div
          className='border-[var(--border)] border-b px-4 py-3 text-[12px] text-[var(--text-muted)]'
          aria-live='polite'
        >
          {actionStatus}
        </div>
      )}

      {error && (
        <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3 text-[12px] text-red-500'>
          <AlertTriangle className='h-[14px] w-[14px]' />
          {error instanceof Error ? error.message : 'Unable to load skill proposals.'}
        </div>
      )}

      <div className='grid gap-3 p-4'>
        {isLoading ? (
          <div className='flex items-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-4 text-[12px] text-[var(--text-muted)]'>
            <Loader className='h-[14px] w-[14px]' />
            Loading Hermes skill proposals...
          </div>
        ) : proposals.length === 0 ? (
          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-4 text-[12px] text-[var(--text-muted)]'>
            No skill proposals match the current filter. Hermes suggestions will appear here after
            background review or explicit proposal tool calls.
          </div>
        ) : (
          proposals.map((proposal) => {
            const reviewNote = reviewNotes[proposal.id] ?? ''
            const canReview = proposal.status !== 'published'
            const canPublish = proposal.status === 'approved'
            const canRollback =
              proposal.status === 'published' && Boolean(proposal.publishedSkillId)
            return (
              <article
                key={proposal.id}
                className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-4'
              >
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div className='min-w-0'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h3 className='font-medium text-[14px] text-[var(--text-primary)]'>
                        {proposal.title}
                      </h3>
                      <span
                        className={cn(
                          'rounded-[6px] border px-1.5 py-0.5 font-medium text-[10px]',
                          statusClass(proposal.status)
                        )}
                      >
                        {proposal.status.replaceAll('_', ' ')}
                      </span>
                      <span
                        className={cn(
                          'rounded-[6px] border px-1.5 py-0.5 font-medium text-[10px]',
                          riskClass(proposal.risk)
                        )}
                      >
                        {proposal.risk} risk
                      </span>
                    </div>
                    <p className='mt-1 text-[12px] text-[var(--text-muted)]'>
                      {proposal.description}
                    </p>
                    <div className='mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]'>
                      <span>Type: {proposal.type}</span>
                      <span>Agent: {proposal.agentCode ?? 'Not scoped'}</span>
                      <span>Workgroup: {proposal.workgroupId ?? 'Not scoped'}</span>
                      <span>Created: {formatDate(proposal.createdAt)}</span>
                      <span>Reviewed: {formatDate(proposal.reviewedAt)}</span>
                    </div>
                  </div>
                  {proposal.sourceHermesRunId && (
                    <span className='rounded-[8px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
                      Hermes run {proposal.sourceHermesRunId}
                    </span>
                  )}
                </div>

                <pre className='mt-3 max-h-[260px] overflow-auto whitespace-pre-wrap rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3 text-[11px] text-[var(--text-muted)]'>
                  {shortText(previewText(proposal))}
                </pre>

                {proposal.evidenceRefs.length > 0 && (
                  <div className='mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]'>
                    {proposal.evidenceRefs.slice(0, 8).map((ref) => (
                      <span
                        key={ref}
                        className='rounded-[6px] border border-[var(--border)] px-2 py-1'
                      >
                        {ref}
                      </span>
                    ))}
                    {proposal.evidenceRefs.length > 8 && (
                      <span>+{proposal.evidenceRefs.length - 8} more evidence refs</span>
                    )}
                  </div>
                )}

                <div className='mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]'>
                  <textarea
                    className='min-h-[72px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]'
                    placeholder='Review note for audit trail...'
                    value={reviewNote}
                    onChange={(event) =>
                      setReviewNotes((current) => ({
                        ...current,
                        [proposal.id]: event.target.value,
                      }))
                    }
                    disabled={!canReview || pendingAction}
                  />
                  <div className='flex flex-wrap items-start gap-2 md:justify-end'>
                    <button
                      type='button'
                      className={buttonVariants({ size: 'sm', variant: 'default' })}
                      disabled={!canReview || pendingAction}
                      onClick={() => void handleReview(proposal, 'approve')}
                    >
                      Approve
                    </button>
                    <button
                      type='button'
                      className={buttonVariants({ size: 'sm', variant: 'default' })}
                      disabled={!canReview || pendingAction}
                      onClick={() => void handleReview(proposal, 'reject')}
                    >
                      Reject
                    </button>
                    <button
                      type='button'
                      className={buttonVariants({ size: 'sm', variant: 'primary' })}
                      disabled={!canPublish || pendingAction}
                      onClick={() => void handlePublish(proposal)}
                    >
                      Publish
                    </button>
                  </div>
                </div>

                {canRollback && (
                  <div className='mt-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3'>
                    <div className='flex items-center gap-2 text-[12px] text-[var(--text-primary)]'>
                      <GitBranch className='h-[14px] w-[14px] text-[var(--text-icon)]' />
                      Rollback published skill
                    </div>
                    <div className='mt-2 grid gap-2 md:grid-cols-[120px_minmax(0,1fr)_auto]'>
                      <input
                        className='h-8 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text-primary)] outline-none'
                        placeholder='Version'
                        value={rollbackVersions[proposal.id] ?? ''}
                        onChange={(event) =>
                          setRollbackVersions((current) => ({
                            ...current,
                            [proposal.id]: event.target.value,
                          }))
                        }
                      />
                      <input
                        className='h-8 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text-primary)] outline-none'
                        placeholder='Rollback reason'
                        value={rollbackReasons[proposal.id] ?? ''}
                        onChange={(event) =>
                          setRollbackReasons((current) => ({
                            ...current,
                            [proposal.id]: event.target.value,
                          }))
                        }
                      />
                      <button
                        type='button'
                        className={buttonVariants({ size: 'sm', variant: 'default' })}
                        disabled={pendingAction}
                        onClick={() => void handleRollback(proposal)}
                      >
                        Rollback
                      </button>
                    </div>
                  </div>
                )}
              </article>
            )
          })
        )}

        {isFetching && !isLoading && (
          <div className='text-[11px] text-[var(--text-muted)]'>Refreshing proposals...</div>
        )}
      </div>
    </section>
  )
}
