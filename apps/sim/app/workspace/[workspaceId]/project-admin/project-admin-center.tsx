'use client'

import type { ChangeEvent } from 'react'
import { useMemo, useState } from 'react'
import { generateShortId } from '@sim/utils/id'
import {
  Activity,
  AlertTriangle,
  Archive,
  Compass,
  Download,
  GitBranch,
  Network,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { buttonVariants, Loader } from '@/components/emcn'
import type {
  AgentProfile,
  AgentTemplate,
  Discipline,
  OrganizationAgentSkillPolicy,
  OrganizationWorkgroupActivityEntry,
  PublicationReviewState,
  PublicationRiskLevel,
  PublicationSummary,
  PublicationTree,
  WorkgroupAdminSummary,
} from '@/lib/api/contracts/collaboration'
import {
  buildProjectAdminFailureAuditEntry,
  buildProjectAdminFailureAuditSummary,
  type ProjectAdminFailureAuditEntry,
  type ProjectAdminFailureScope,
} from '@/lib/collaboration/project-admin-failure-audit'
import {
  buildPublicationApprovalWorkflow,
  buildPublicationConflictRepairGuide,
  buildPublicationDependencyConflictAlerts,
  buildPublicationDependencyResolutionActions,
  buildPublicationNotificationDeliveryDrafts,
  buildPublicationReviewNotifications,
  buildPublicationStateGroups,
  buildPublicationTeamNudges,
  type PublicationDependencyResolutionAction,
  type PublicationGovernanceAlertSeverity,
  type PublicationNotificationDeliveryDraft,
} from '@/lib/collaboration/publication-state-tree'
import { cn } from '@/lib/core/utils/cn'
import {
  fetchOrganizationWorkgroupActivity,
  useAddWorkgroupMember,
  useAgentProfiles,
  useArchiveWorkgroup,
  useBatchAddWorkgroupMembers,
  useCreateWorkgroup,
  useDeliverPublicationNotifications,
  useDisciplines,
  useMyWorkgroups,
  useOrganizationAgentSkillPolicies,
  useOrganizationAgentTemplates,
  useOrganizationPublications,
  useOrganizationWorkgroupActivity,
  useOrganizationWorkgroups,
  usePublication,
  usePublicationTree,
  useRecordProjectAdminFailureAudit,
  useUpdateOrganizationAgentSkillPolicy,
  useUpdateOrganizationAgentTemplate,
  useUpdatePublicationDetails,
  useUpdatePublicationLifecycle,
  useUpdatePublicationReview,
} from '@/hooks/queries/collaboration'
import { type RosterMember, useOrganizationRoster } from '@/hooks/queries/organization'
import { useWorkspaceSettings } from '@/hooks/queries/workspace'
import { useNotificationStore } from '@/stores/notifications'

const PUBLICATION_FILTERS = { limit: 100 } as const
const PROJECT_ACTIVITY_PAGE_SIZE = 12
const PROJECT_ACTIVITY_EXPORT_PAGE_SIZE = 100
const PROJECT_ACTIVITY_EXPORT_MAX_PAGES = 1000
const PROJECT_ADMIN_FAILURE_AUDIT_LIMIT = 12
const PROJECT_ADMIN_FAILURE_TEXT_MAX = {
  operation: 160,
  target: 160,
  message: 500,
} as const
const PROJECT_ADMIN_FAILURE_SCOPE_OPTIONS: {
  scope: ProjectAdminFailureScope
  label: string
}[] = [
  { scope: 'team', label: 'Team' },
  { scope: 'agent', label: 'Agent' },
  { scope: 'publication', label: 'Publication' },
  { scope: 'member', label: 'Member' },
  { scope: 'activity', label: 'Activity' },
  { scope: 'notification', label: 'Notification' },
]
const BATCH_IMPORT_IGNORED_CELLS = new Set([
  'email',
  'emails',
  'userid',
  'user',
  'id',
  'name',
  'role',
  'member',
  'admin',
  'team',
  'workgroup',
])
const PROJECT_ACTIVITY_ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'member.invited', label: 'Member added' },
  { value: 'member.batch_assigned', label: 'Batch member assignment' },
  { value: 'member.role_changed', label: 'Role updated' },
  { value: 'member.removed', label: 'Member removed' },
  { value: 'workgroup.archived', label: 'Team archived' },
  { value: 'agent_template.updated', label: 'Agent template updated' },
  { value: 'publication.created', label: 'Published showcase' },
  { value: 'publication.updated', label: 'Updated publication' },
  { value: 'publication.archived', label: 'Archived publication' },
  { value: 'publication.retracted', label: 'Retracted publication' },
  { value: 'publication.restored', label: 'Restored publication' },
  { value: 'notification.created', label: 'Notification delivery' },
  { value: 'project_admin_failure.recorded', label: 'Project admin failure' },
  { value: 'skill.updated', label: 'Agent skill updated' },
  { value: 'workspace.created', label: 'Team canvas initialized' },
] as const
const PUBLICATION_REVIEW_OPTIONS: { value: PublicationReviewState | ''; label: string }[] = [
  { value: '', label: 'No review state' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_review', label: 'In review' },
  { value: 'approved', label: 'Approved' },
  { value: 'changes_requested', label: 'Changes requested' },
  { value: 'rejected', label: 'Rejected' },
]
const PUBLICATION_RISK_OPTIONS: { value: PublicationRiskLevel | ''; label: string }[] = [
  { value: '', label: 'No risk level' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]
const RISK_SKILL_KEYWORDS = [
  'delete',
  'deploy',
  'execute',
  'publish',
  'credential',
  'secret',
  'api key',
  'webhook',
  'file',
  'write',
] as const

function governanceAlertClass(severity: PublicationGovernanceAlertSeverity): string {
  switch (severity) {
    case 'danger':
      return 'border-red-500/30 bg-red-500/10 text-red-500'
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-500'
    case 'info':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-500'
  }
}

interface BatchAssignmentResult {
  target: string
  status: 'assigned' | 'failed'
  message: string
}

interface PublicationReviewDraft {
  reviewState: PublicationReviewState | ''
  riskLevel: PublicationRiskLevel | ''
}

interface SnapshotMetric {
  label: string
  candidate: number
  current: number
}

interface SnapshotSummary {
  blockCount: number
  edgeCount: number
  loopCount: number
  parallelCount: number
  variableCount: number
  blockTypes: Record<string, number>
  metadataName: string | null
  metadataDescription: string | null
}

interface SnapshotBlockDiffRow {
  id: string
  label: string
  type: string
  change: 'added' | 'removed' | 'changed'
  detail: string
}

interface SnapshotEdgeDiffRow {
  id: string
  label: string
  change: 'added' | 'removed' | 'changed'
  detail: string
}

interface SnapshotNodeLevelDiff {
  addedBlocks: SnapshotBlockDiffRow[]
  removedBlocks: SnapshotBlockDiffRow[]
  changedBlocks: SnapshotBlockDiffRow[]
  addedEdges: SnapshotEdgeDiffRow[]
  removedEdges: SnapshotEdgeDiffRow[]
  changedEdges: SnapshotEdgeDiffRow[]
  changedVariables: string[]
}

interface PublicationDependencyImpactRow {
  id: string
  title: string
  meta: string
  detail: string
  tone: 'default' | 'warning' | 'danger' | 'info'
}

interface PublicationDependencyImpact {
  directDependencies: PublicationDependencyImpactRow[]
  dependentPublications: PublicationDependencyImpactRow[]
  treeLinks: PublicationDependencyImpactRow[]
  riskFlags: PublicationDependencyImpactRow[]
}

interface AgentPolicyImpact {
  agentCode: string
  disciplineNames: string[]
  teams: WorkgroupAdminSummary[]
  currentPublications: PublicationSummary[]
  riskPublications: PublicationSummary[]
  unapprovedPublications: PublicationSummary[]
  disabledPolicies: OrganizationAgentSkillPolicy[]
  enabledPolicies: OrganizationAgentSkillPolicy[]
  promptChanged: boolean
  promptCharacterDelta: number
}

interface AgentSkillRiskGuardrail {
  policy: OrganizationAgentSkillPolicy
  matchedTerms: string[]
  tone: 'warning' | 'danger'
  reason: string
}

function formatAgentCode(agentCode: string) {
  return agentCode
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatRosterMemberLabel(member: RosterMember | undefined, fallbackUserId?: string | null) {
  if (!member) return fallbackUserId ? `User ${fallbackUserId}` : 'Unassigned'
  return member.name ? `${member.name} / ${member.email}` : member.email
}

function getAgentName(agentCode: string, agents: AgentProfile[]) {
  return agents.find((agent) => agent.code === agentCode)?.name ?? formatAgentCode(agentCode)
}

function getActiveWorkgroup(
  workgroups: NonNullable<ReturnType<typeof useMyWorkgroups>['data']>['workgroups'],
  workspaceId: string,
  currentWorkspaceWorkgroupId?: string | null,
  defaultWorkgroupId?: string | null
) {
  return (
    workgroups.find((workgroup) => workgroup.teamWorkspaceId === workspaceId) ??
    workgroups.find((workgroup) => workgroup.id === currentWorkspaceWorkgroupId) ??
    workgroups.find((workgroup) => workgroup.id === defaultWorkgroupId) ??
    workgroups[0]
  )
}

function buildDisciplineRows(
  disciplines: Discipline[],
  teams: WorkgroupAdminSummary[],
  agents: AgentProfile[],
  publications: PublicationSummary[]
) {
  return disciplines.map((discipline) => {
    const disciplineTeams = teams.filter((team) => team.disciplineId === discipline.id)
    const disciplinePublications = publications.filter(
      (publication) => publication.sourceDiscipline.code === discipline.code
    )
    const currentPublicationCount = disciplinePublications.filter(
      (publication) => publication.status === 'published'
    ).length
    const riskCount = disciplinePublications.filter(
      (publication) => publication.riskLevel === 'critical'
    ).length
    return {
      discipline,
      agentName: getAgentName(discipline.agentCode, agents),
      teamCount: disciplineTeams.length,
      memberCount: disciplineTeams.reduce((sum, team) => sum + team.memberCount, 0),
      currentPublicationCount,
      riskCount,
    }
  })
}

function StatCard({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string
  value: string | number
  detail: string
  tone?: 'default' | 'warning'
}) {
  return (
    <div
      className={cn(
        'rounded-[8px] border bg-[var(--surface-1)] p-4',
        tone === 'warning' ? 'border-amber-500/30' : 'border-[var(--border)]'
      )}
    >
      <div className='text-[12px] text-[var(--text-muted)]'>{label}</div>
      <div className='mt-2 font-medium text-[24px] text-[var(--text-primary)]'>{value}</div>
      <div className='mt-1 text-[12px] text-[var(--text-muted)]'>{detail}</div>
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>{children}</div>
}

function dependencyImpactToneClass(tone: PublicationDependencyImpactRow['tone']): string {
  switch (tone) {
    case 'danger':
      return 'border-red-500/30 bg-red-500/10 text-red-500'
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-500'
    case 'info':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-500'
    default:
      return 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]'
  }
}

function DependencyImpactList({
  title,
  empty,
  rows,
}: {
  title: string
  empty: string
  rows: PublicationDependencyImpactRow[]
}) {
  return (
    <div className='grid gap-2'>
      <div className='font-medium text-[11px] text-[var(--text-primary)]'>{title}</div>
      {rows.length === 0 ? (
        <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-2 text-[11px] text-[var(--text-muted)]'>
          {empty}
        </div>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            className={cn('rounded-[8px] border p-2', dependencyImpactToneClass(row.tone))}
          >
            <div className='font-medium text-[12px]'>{row.title}</div>
            <div className='mt-1 text-[11px] opacity-80'>{row.meta}</div>
            <div className='mt-1 text-[11px] opacity-90'>{row.detail}</div>
          </div>
        ))
      )}
    </div>
  )
}

function ImpactMetric({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string
  value: string | number
  detail: string
  tone?: 'default' | 'warning' | 'danger'
}) {
  return (
    <div
      className={cn(
        'rounded-[8px] border bg-[var(--surface-2)] p-3',
        tone === 'danger'
          ? 'border-red-500/30'
          : tone === 'warning'
            ? 'border-amber-500/30'
            : 'border-[var(--border)]'
      )}
    >
      <div className='text-[11px] text-[var(--text-muted)]'>{label}</div>
      <div
        className={cn(
          'mt-1 font-medium text-[20px] text-[var(--text-primary)]',
          tone === 'danger' && 'text-red-500',
          tone === 'warning' && 'text-amber-500'
        )}
      >
        {value}
      </div>
      <div className='mt-1 text-[11px] text-[var(--text-muted)]'>{detail}</div>
    </div>
  )
}

function SnapshotDiffRows({
  title,
  rows,
  empty,
}: {
  title: string
  rows: Array<SnapshotBlockDiffRow | SnapshotEdgeDiffRow>
  empty: string
}) {
  return (
    <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2'>
      <div className='font-medium text-[11px] text-[var(--text-primary)]'>{title}</div>
      {rows.length === 0 ? (
        <div className='mt-1 text-[11px] text-[var(--text-muted)]'>{empty}</div>
      ) : (
        <div className='mt-2 grid gap-1'>
          {rows.slice(0, 6).map((row) => (
            <div
              key={`${row.change}:${row.id}`}
              className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1'
            >
              <div className='flex items-center justify-between gap-2'>
                <span className='truncate text-[11px] text-[var(--text-primary)]'>{row.label}</span>
                <span
                  className={cn(
                    'shrink-0 text-[10px]',
                    row.change === 'added' && 'text-emerald-500',
                    row.change === 'removed' && 'text-red-500',
                    row.change === 'changed' && 'text-amber-500'
                  )}
                >
                  {row.change}
                </span>
              </div>
              <div className='mt-0.5 truncate text-[10px] text-[var(--text-muted)]'>
                {'type' in row ? `${row.type} / ` : ''}
                {row.detail}
              </div>
            </div>
          ))}
          {rows.length > 6 && (
            <div className='text-[10px] text-[var(--text-muted)]'>
              +{rows.length - 6} more change{rows.length - 6 === 1 ? '' : 's'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function truncateAuditValue(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function countRecordItems(value: unknown) {
  return isRecord(value) ? Object.keys(value).length : 0
}

function countArrayItems(value: unknown) {
  return Array.isArray(value) ? value.length : 0
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? String(value)
}

function getRecordString(value: Record<string, unknown>, key: string) {
  return typeof value[key] === 'string' ? value[key] : null
}

function getBlockLabel(blockId: string, block: unknown) {
  if (!isRecord(block)) return blockId
  const metadata = isRecord(block.metadata) ? block.metadata : {}
  const config = isRecord(block.config) ? block.config : {}
  return (
    getRecordString(block, 'name') ??
    getRecordString(block, 'title') ??
    getRecordString(metadata, 'name') ??
    getRecordString(config, 'name') ??
    blockId
  )
}

function getBlockType(block: unknown) {
  return isRecord(block) && typeof block.type === 'string' ? block.type : 'unknown'
}

function getChangedTopLevelKeys(candidate: unknown, current: unknown) {
  if (!isRecord(candidate) || !isRecord(current)) return []
  const keys = new Set([...Object.keys(candidate), ...Object.keys(current)])
  return [...keys]
    .filter((key) => stableStringify(candidate[key]) !== stableStringify(current[key]))
    .sort((left, right) => left.localeCompare(right))
}

function getSnapshotBlocks(snapshot: unknown) {
  const root = isRecord(snapshot) ? snapshot : {}
  return isRecord(root.blocks) ? root.blocks : {}
}

function getSnapshotVariables(snapshot: unknown) {
  const root = isRecord(snapshot) ? snapshot : {}
  return isRecord(root.variables) ? root.variables : {}
}

function getEdgeKey(edge: unknown, index: number) {
  if (!isRecord(edge)) return `edge-${index}`
  const id = getRecordString(edge, 'id')
  if (id) return id
  const source =
    getRecordString(edge, 'source') ?? getRecordString(edge, 'sourceBlockId') ?? 'source'
  const target =
    getRecordString(edge, 'target') ?? getRecordString(edge, 'targetBlockId') ?? 'target'
  return `${source}->${target}:${index}`
}

function getEdgeLabel(edge: unknown, fallbackId: string) {
  if (!isRecord(edge)) return fallbackId
  const source = getRecordString(edge, 'source') ?? getRecordString(edge, 'sourceBlockId') ?? '?'
  const target = getRecordString(edge, 'target') ?? getRecordString(edge, 'targetBlockId') ?? '?'
  return `${source} -> ${target}`
}

function getSnapshotEdges(snapshot: unknown) {
  const root = isRecord(snapshot) ? snapshot : {}
  const edges = Array.isArray(root.edges) ? root.edges : []
  return new Map(
    edges.map((edge, index) => {
      const key = getEdgeKey(edge, index)
      return [key, edge] as const
    })
  )
}

function summarizeSnapshot(snapshot: unknown): SnapshotSummary {
  const root = isRecord(snapshot) ? snapshot : {}
  const blocks = isRecord(root.blocks) ? root.blocks : {}
  const metadata = isRecord(root.metadata) ? root.metadata : {}
  const blockTypes: Record<string, number> = {}

  for (const block of Object.values(blocks)) {
    if (!isRecord(block) || typeof block.type !== 'string') continue
    blockTypes[block.type] = (blockTypes[block.type] ?? 0) + 1
  }

  return {
    blockCount: Object.keys(blocks).length,
    edgeCount: countArrayItems(root.edges),
    loopCount: countRecordItems(root.loops),
    parallelCount: countRecordItems(root.parallels),
    variableCount: countRecordItems(root.variables),
    blockTypes,
    metadataName: typeof metadata.name === 'string' ? metadata.name : null,
    metadataDescription: typeof metadata.description === 'string' ? metadata.description : null,
  }
}

function buildSnapshotMetricRows(
  candidate: SnapshotSummary,
  current: SnapshotSummary
): SnapshotMetric[] {
  return [
    { label: 'Blocks', candidate: candidate.blockCount, current: current.blockCount },
    { label: 'Edges', candidate: candidate.edgeCount, current: current.edgeCount },
    { label: 'Loops', candidate: candidate.loopCount, current: current.loopCount },
    { label: 'Parallels', candidate: candidate.parallelCount, current: current.parallelCount },
    { label: 'Variables', candidate: candidate.variableCount, current: current.variableCount },
  ]
}

function buildBlockTypeDiff(candidate: SnapshotSummary, current: SnapshotSummary) {
  const types = new Set([...Object.keys(candidate.blockTypes), ...Object.keys(current.blockTypes)])
  return [...types]
    .map((type) => ({
      type,
      candidate: candidate.blockTypes[type] ?? 0,
      current: current.blockTypes[type] ?? 0,
    }))
    .filter((entry) => entry.candidate !== entry.current)
    .sort((a, b) => a.type.localeCompare(b.type))
}

function buildNodeLevelSnapshotDiff(
  candidateSnapshot: unknown,
  currentSnapshot: unknown
): SnapshotNodeLevelDiff {
  const candidateBlocks = getSnapshotBlocks(candidateSnapshot)
  const currentBlocks = getSnapshotBlocks(currentSnapshot)
  const blockIds = new Set([...Object.keys(candidateBlocks), ...Object.keys(currentBlocks)])
  const addedBlocks: SnapshotBlockDiffRow[] = []
  const removedBlocks: SnapshotBlockDiffRow[] = []
  const changedBlocks: SnapshotBlockDiffRow[] = []

  for (const blockId of [...blockIds].sort((left, right) => left.localeCompare(right))) {
    const candidate = candidateBlocks[blockId]
    const current = currentBlocks[blockId]
    if (candidate && !current) {
      addedBlocks.push({
        id: blockId,
        label: getBlockLabel(blockId, candidate),
        type: getBlockType(candidate),
        change: 'added',
        detail: 'Present only in the restore candidate.',
      })
      continue
    }
    if (!candidate && current) {
      removedBlocks.push({
        id: blockId,
        label: getBlockLabel(blockId, current),
        type: getBlockType(current),
        change: 'removed',
        detail: 'Present only in the current published snapshot.',
      })
      continue
    }
    if (stableStringify(candidate) !== stableStringify(current)) {
      const candidateType = getBlockType(candidate)
      const currentType = getBlockType(current)
      const changedKeys = getChangedTopLevelKeys(candidate, current)
      changedBlocks.push({
        id: blockId,
        label: getBlockLabel(blockId, candidate),
        type: candidateType,
        change: 'changed',
        detail:
          candidateType !== currentType
            ? `Type changed from ${currentType} to ${candidateType}.`
            : `Changed fields: ${changedKeys.slice(0, 5).join(', ') || 'unknown'}.`,
      })
    }
  }

  const candidateEdges = getSnapshotEdges(candidateSnapshot)
  const currentEdges = getSnapshotEdges(currentSnapshot)
  const edgeIds = new Set([...candidateEdges.keys(), ...currentEdges.keys()])
  const addedEdges: SnapshotEdgeDiffRow[] = []
  const removedEdges: SnapshotEdgeDiffRow[] = []
  const changedEdges: SnapshotEdgeDiffRow[] = []

  for (const edgeId of [...edgeIds].sort((left, right) => left.localeCompare(right))) {
    const candidate = candidateEdges.get(edgeId)
    const current = currentEdges.get(edgeId)
    if (candidate && !current) {
      addedEdges.push({
        id: edgeId,
        label: getEdgeLabel(candidate, edgeId),
        change: 'added',
        detail: 'Connection exists only in the restore candidate.',
      })
      continue
    }
    if (!candidate && current) {
      removedEdges.push({
        id: edgeId,
        label: getEdgeLabel(current, edgeId),
        change: 'removed',
        detail: 'Connection exists only in the current published snapshot.',
      })
      continue
    }
    if (stableStringify(candidate) !== stableStringify(current)) {
      changedEdges.push({
        id: edgeId,
        label: getEdgeLabel(candidate, edgeId),
        change: 'changed',
        detail: `Changed fields: ${getChangedTopLevelKeys(candidate, current).slice(0, 5).join(', ') || 'unknown'}.`,
      })
    }
  }

  const candidateVariables = getSnapshotVariables(candidateSnapshot)
  const currentVariables = getSnapshotVariables(currentSnapshot)
  const variableNames = new Set([
    ...Object.keys(candidateVariables),
    ...Object.keys(currentVariables),
  ])
  const changedVariables = [...variableNames]
    .filter(
      (name) =>
        stableStringify(candidateVariables[name]) !== stableStringify(currentVariables[name])
    )
    .sort((left, right) => left.localeCompare(right))

  return {
    addedBlocks,
    removedBlocks,
    changedBlocks,
    addedEdges,
    removedEdges,
    changedEdges,
    changedVariables,
  }
}

function getPublicationImpactTone(
  publication: Pick<PublicationSummary, 'status' | 'reviewState' | 'riskLevel'>
): PublicationDependencyImpactRow['tone'] {
  if (publication.riskLevel === 'critical' || publication.status === 'retracted') return 'danger'
  if (publication.status === 'published' || publication.reviewState !== 'approved') return 'warning'
  return 'default'
}

function formatPublicationImpactMeta(
  publication: Pick<
    PublicationSummary,
    'versionNumber' | 'status' | 'sourceWorkgroup' | 'sourceDiscipline'
  >
) {
  return `v${publication.versionNumber} / ${publication.sourceWorkgroup.name} / ${publication.sourceDiscipline.name} / ${publication.status}`
}

function buildPublicationDependencyImpact(
  selectedPublication: PublicationSummary | null,
  publications: PublicationSummary[],
  publicationById: Map<string, PublicationSummary>,
  selectedPublicationTree?: PublicationTree
): PublicationDependencyImpact {
  if (!selectedPublication) {
    return {
      directDependencies: [],
      dependentPublications: [],
      treeLinks: [],
      riskFlags: [],
    }
  }

  const directDependencies = selectedPublication.dependsOnPublicationIds.map((publicationId) => {
    const dependency = publicationById.get(publicationId)
    if (!dependency) {
      return {
        id: `missing-${publicationId}`,
        title: publicationId,
        meta: 'Not returned in the current organization publication list',
        detail:
          'This dependency may be outside the current visibility window, archived beyond the current filter, or no longer readable.',
        tone: 'warning' as const,
      }
    }

    return {
      id: dependency.id,
      title: dependency.title,
      meta: formatPublicationImpactMeta(dependency),
      detail: `Review ${dependency.reviewState ?? 'unreviewed'}; risk ${
        dependency.riskLevel ?? 'none'
      }.`,
      tone: getPublicationImpactTone(dependency),
    }
  })

  const dependentPublications = publications
    .filter(
      (publication) =>
        publication.id !== selectedPublication.id &&
        publication.dependsOnPublicationIds.includes(selectedPublication.id)
    )
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))

  const dependentRows = dependentPublications.map((publication) => ({
    id: publication.id,
    title: publication.title,
    meta: formatPublicationImpactMeta(publication),
    detail: `${
      publication.status === 'published' ? 'Current' : 'Historical'
    } publication directly depends on this version; review ${
      publication.reviewState ?? 'unreviewed'
    }, risk ${publication.riskLevel ?? 'none'}.`,
    tone: getPublicationImpactTone(publication),
  }))

  const treeLinks =
    selectedPublicationTree?.versions
      .filter(
        (version) =>
          version.id !== selectedPublication.id &&
          (version.parentVersionId === selectedPublication.id ||
            version.dependsOnPublicationIds.includes(selectedPublication.id))
      )
      .map((version) => {
        const relation =
          version.parentVersionId === selectedPublication.id &&
          version.dependsOnPublicationIds.includes(selectedPublication.id)
            ? 'Parent and dependency link'
            : version.parentVersionId === selectedPublication.id
              ? 'Parent version link'
              : 'Dependency link'

        return {
          id: version.id,
          title: version.title,
          meta: `v${version.versionNumber} / ${version.sourceWorkgroup.name} / ${version.sourceDiscipline.name} / ${version.status}`,
          detail: `${relation} inside the selected publication family; review ${
            version.reviewState ?? 'unreviewed'
          }, risk ${version.riskLevel ?? 'none'}.`,
          tone: getPublicationImpactTone(version),
        }
      }) ?? []

  const currentDependents = dependentPublications.filter(
    (publication) => publication.status === 'published'
  )
  const criticalDependents = dependentPublications.filter(
    (publication) => publication.riskLevel === 'critical'
  )
  const unapprovedDependents = dependentPublications.filter(
    (publication) => publication.reviewState !== 'approved'
  )
  const missingDependencies = directDependencies.filter((row) => row.id.startsWith('missing-'))
  const riskFlags: PublicationDependencyImpactRow[] = []

  if (currentDependents.length > 0) {
    riskFlags.push({
      id: 'current-dependent-publications',
      title: `${currentDependents.length} current dependent publication${
        currentDependents.length === 1 ? '' : 's'
      }`,
      meta: 'Restore, archive, or retract actions may affect live downstream teams',
      detail: currentDependents.map((publication) => `v${publication.versionNumber}`).join(', '),
      tone: 'warning',
    })
  }

  if (criticalDependents.length > 0) {
    riskFlags.push({
      id: 'critical-dependent-publications',
      title: `${criticalDependents.length} critical-risk dependent publication${
        criticalDependents.length === 1 ? '' : 's'
      }`,
      meta: 'Downstream critical risk should be resolved before changing this version',
      detail: criticalDependents.map((publication) => publication.title).join(', '),
      tone: 'danger',
    })
  }

  if (unapprovedDependents.length > 0) {
    riskFlags.push({
      id: 'unapproved-dependent-publications',
      title: `${unapprovedDependents.length} unapproved dependent publication${
        unapprovedDependents.length === 1 ? '' : 's'
      }`,
      meta: 'Downstream review state is not fully approved',
      detail: unapprovedDependents.map((publication) => publication.title).join(', '),
      tone: 'warning',
    })
  }

  if (missingDependencies.length > 0) {
    riskFlags.push({
      id: 'missing-direct-dependencies',
      title: `${missingDependencies.length} unresolved direct dependenc${
        missingDependencies.length === 1 ? 'y' : 'ies'
      }`,
      meta: 'The current list could not resolve every dependency id',
      detail: missingDependencies.map((row) => row.title).join(', '),
      tone: 'warning',
    })
  }

  return {
    directDependencies,
    dependentPublications: dependentRows,
    treeLinks,
    riskFlags,
  }
}

function buildAgentPolicyImpact(params: {
  template: AgentTemplate | undefined
  draftInstructions: string
  disciplines: Discipline[]
  teams: WorkgroupAdminSummary[]
  publications: PublicationSummary[]
  policies: OrganizationAgentSkillPolicy[]
}): AgentPolicyImpact | null {
  if (!params.template) return null

  const disciplineNames = params.disciplines
    .filter((discipline) => discipline.agentCode === params.template?.code)
    .map((discipline) => discipline.name)
    .sort((left, right) => left.localeCompare(right))
  const teams = params.teams
    .filter((team) => team.agentCode === params.template?.code)
    .sort((left, right) => left.name.localeCompare(right.name))
  const agentPublications = params.publications.filter(
    (publication) => publication.agentCode === params.template?.code
  )
  const currentPublications = agentPublications.filter(
    (publication) => publication.status === 'published'
  )
  const agentPolicies = params.policies.filter(
    (policy) => policy.agentCode === params.template?.code
  )
  const disabledPolicies = agentPolicies.filter((policy) => !policy.enabled)
  const enabledPolicies = agentPolicies.filter((policy) => policy.enabled)
  const savedInstructions = params.template.projectInstructions.trim()
  const draftInstructions = params.draftInstructions.trim()

  return {
    agentCode: params.template.code,
    disciplineNames,
    teams,
    currentPublications,
    riskPublications: currentPublications.filter(
      (publication) => publication.riskLevel === 'critical'
    ),
    unapprovedPublications: currentPublications.filter(
      (publication) => publication.reviewState !== 'approved'
    ),
    disabledPolicies,
    enabledPolicies,
    promptChanged: draftInstructions !== savedInstructions,
    promptCharacterDelta: draftInstructions.length - savedInstructions.length,
  }
}

function getAgentSkillPolicyCopyTargets(
  sourcePolicy: OrganizationAgentSkillPolicy,
  policies: OrganizationAgentSkillPolicy[]
) {
  const sourceName = sourcePolicy.name.trim().toLowerCase()
  return policies.filter(
    (policy) =>
      policy.agentCode === sourcePolicy.agentCode &&
      policy.skillId !== sourcePolicy.skillId &&
      policy.name.trim().toLowerCase() === sourceName &&
      policy.enabled !== sourcePolicy.enabled
  )
}

function buildAgentSkillPolicyCopyGroups(policies: OrganizationAgentSkillPolicy[]) {
  const groups = new Map<
    string,
    { name: string; total: number; enabled: number; disabled: number; teams: string[] }
  >()
  for (const policy of policies) {
    const key = `${policy.agentCode}:${policy.name.trim().toLowerCase()}`
    const group = groups.get(key) ?? {
      name: policy.name,
      total: 0,
      enabled: 0,
      disabled: 0,
      teams: [],
    }
    group.total += 1
    if (policy.enabled) {
      group.enabled += 1
    } else {
      group.disabled += 1
    }
    group.teams.push(policy.sourceWorkgroup.name)
    groups.set(key, group)
  }

  return Array.from(groups.values())
    .filter((group) => group.total > 1)
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name))
}

function buildAgentSkillRiskGuardrails(params: {
  policies: OrganizationAgentSkillPolicy[]
  impact: AgentPolicyImpact | null
}): AgentSkillRiskGuardrail[] {
  if (!params.impact) return []
  const agentCode = params.impact.agentCode
  const hasCriticalPublication = params.impact.riskPublications.length > 0
  return params.policies
    .filter((policy) => policy.agentCode === agentCode)
    .map((policy) => {
      const text = `${policy.name} ${policy.description ?? ''}`.toLowerCase()
      const matchedTerms = RISK_SKILL_KEYWORDS.filter((term) => text.includes(term))
      if (!policy.enabled || matchedTerms.length === 0) return null
      return {
        policy,
        matchedTerms,
        tone: hasCriticalPublication ? ('danger' as const) : ('warning' as const),
        reason: hasCriticalPublication
          ? 'This Agent has critical current publications; risky project-default skills should be disabled until review is complete.'
          : 'This project-default skill looks action-oriented; disable it unless teams explicitly need it.',
      }
    })
    .filter((item): item is AgentSkillRiskGuardrail => Boolean(item))
    .sort((left, right) => left.policy.name.localeCompare(right.policy.name))
}

function parseBatchAssignmentTargets(value: string) {
  const seen = new Set<string>()
  return value
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item.toLowerCase())) return false
      seen.add(item.toLowerCase())
      return true
    })
}

function mergeBatchAssignmentTargets(currentValue: string, additions: string[]) {
  return parseBatchAssignmentTargets([currentValue, ...additions].join('\n')).join('\n')
}

function cleanBatchImportCell(value: string) {
  return value
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
}

function getBatchImportCandidate(line: string) {
  const cells = line
    .split(/[,;\t]/)
    .map(cleanBatchImportCell)
    .filter(Boolean)
  if (cells.length === 0) return null

  const emailCell = cells.find((cell) => cell.includes('@'))
  if (emailCell) return emailCell

  return (
    cells.find((cell) => {
      const normalized = cell.toLowerCase().replace(/[\s_-]/g, '')
      return !BATCH_IMPORT_IGNORED_CELLS.has(normalized)
    }) ?? null
  )
}

function extractBatchAssignmentTargetsFromImport(value: string) {
  const candidates = value
    .split(/\r?\n/)
    .map(getBatchImportCandidate)
    .filter((candidate): candidate is string => Boolean(candidate))
  return parseBatchAssignmentTargets(candidates.join('\n'))
}

function memberHasTeamCanvasAccess(member: RosterMember, team: WorkgroupAdminSummary) {
  if (!team.teamWorkspaceId) return false
  return member.workspaces.some(
    (workspaceAccess) => workspaceAccess.workspaceId === team.teamWorkspaceId
  )
}

function getAssignmentCandidateMember(
  rosterMembers: RosterMember[],
  selectedRosterUserId: string,
  assignmentValue: string
) {
  const trimmed = assignmentValue.trim().toLowerCase()
  return (
    rosterMembers.find((member) => member.userId === selectedRosterUserId) ??
    rosterMembers.find(
      (member) => member.email.toLowerCase() === trimmed || member.userId.toLowerCase() === trimmed
    )
  )
}

function buildRecommendedAssignmentTeams(
  member: RosterMember | undefined,
  teams: WorkgroupAdminSummary[]
) {
  if (!member) return []
  return [...teams]
    .filter((team) => team.teamWorkspaceId && !memberHasTeamCanvasAccess(member, team))
    .sort((a, b) => a.memberCount - b.memberCount || a.name.localeCompare(b.name))
}

function formatActivityAction(action: string) {
  switch (action) {
    case 'member.invited':
      return 'Member added'
    case 'member.batch_assigned':
      return 'Batch member assignment'
    case 'member.role_changed':
      return 'Role updated'
    case 'member.removed':
      return 'Member removed'
    case 'workgroup.archived':
      return 'Team archived'
    case 'agent_template.updated':
      return 'Agent template updated'
    case 'publication.created':
      return 'Published showcase'
    case 'publication.updated':
      return 'Updated publication'
    case 'publication.archived':
      return 'Archived publication'
    case 'publication.retracted':
      return 'Retracted publication'
    case 'publication.restored':
      return 'Restored publication'
    case 'notification.created':
      return 'Notification delivery'
    case 'skill.updated':
      return 'Agent skill updated'
    case 'workspace.created':
      return 'Team canvas initialized'
    default:
      return action
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function escapeCsvValue(value: string | null | undefined) {
  const normalized = value ?? ''
  if (!/[",\r\n]/.test(normalized)) return normalized
  return `"${normalized.replace(/"/g, '""')}"`
}

function downloadProjectActivityCsv(
  entries: OrganizationWorkgroupActivityEntry[],
  scope: 'page' | 'filtered' = 'page'
) {
  const rows = [
    ['Created at', 'Action', 'Team', 'Discipline', 'Resource', 'Description', 'Actor'],
    ...entries.map((entry) => [
      entry.createdAt,
      formatActivityAction(entry.action),
      entry.workgroupName ?? 'Project',
      entry.disciplineName ?? '',
      entry.resourceName ?? '',
      entry.description ?? '',
      entry.actorName || entry.actorEmail || 'Unknown actor',
    ]),
  ]
  const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `project-activity-${scope}-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function ProjectAdminCenter() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const createWorkgroup = useCreateWorkgroup()
  const archiveWorkgroup = useArchiveWorkgroup()
  const updateAgentTemplate = useUpdateOrganizationAgentTemplate()
  const updateAgentSkillPolicy = useUpdateOrganizationAgentSkillPolicy()
  const updatePublicationReview = useUpdatePublicationReview()
  const updatePublicationLifecycle = useUpdatePublicationLifecycle()
  const updatePublicationDetails = useUpdatePublicationDetails()
  const deliverPublicationNotifications = useDeliverPublicationNotifications()
  const recordProjectAdminFailureAudit = useRecordProjectAdminFailureAudit()
  const addWorkgroupMember = useAddWorkgroupMember()
  const batchAddWorkgroupMembers = useBatchAddWorkgroupMembers()
  const addNotification = useNotificationStore((state) => state.addNotification)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDisciplineId, setNewTeamDisciplineId] = useState('')
  const [createTeamStatus, setCreateTeamStatus] = useState<string | null>(null)
  const [archiveTeamStatus, setArchiveTeamStatus] = useState<string | null>(null)
  const [selectedAgentTemplateCode, setSelectedAgentTemplateCode] = useState('')
  const [agentTemplateDrafts, setAgentTemplateDrafts] = useState<Record<string, string>>({})
  const [agentTemplateStatus, setAgentTemplateStatus] = useState<string | null>(null)
  const [agentSkillPolicyStatus, setAgentSkillPolicyStatus] = useState<string | null>(null)
  const [publicationReviewDrafts, setPublicationReviewDrafts] = useState<
    Record<string, PublicationReviewDraft>
  >({})
  const [publicationGovernanceStatus, setPublicationGovernanceStatus] = useState<string | null>(
    null
  )
  const [selectedPublicationId, setSelectedPublicationId] = useState<string | null>(null)
  const [publicationDetailDrafts, setPublicationDetailDrafts] = useState<
    Record<string, { title: string; description: string }>
  >({})
  const [assignmentTeamId, setAssignmentTeamId] = useState('')
  const [selectedRosterUserId, setSelectedRosterUserId] = useState('')
  const [assignmentValue, setAssignmentValue] = useState('')
  const [assignmentRole, setAssignmentRole] = useState<'member' | 'admin'>('member')
  const [assignmentStatus, setAssignmentStatus] = useState<string | null>(null)
  const [batchAssignmentValue, setBatchAssignmentValue] = useState('')
  const [batchAssignmentResults, setBatchAssignmentResults] = useState<BatchAssignmentResult[]>([])
  const [batchImportStatus, setBatchImportStatus] = useState<string | null>(null)
  const [activityTeamId, setActivityTeamId] = useState('')
  const [activityDisciplineId, setActivityDisciplineId] = useState('')
  const [activityAction, setActivityAction] = useState('')
  const [activitySearch, setActivitySearch] = useState('')
  const [activityActor, setActivityActor] = useState('')
  const [activityStartDate, setActivityStartDate] = useState('')
  const [activityEndDate, setActivityEndDate] = useState('')
  const [activityOffset, setActivityOffset] = useState(0)
  const [isExportingActivity, setIsExportingActivity] = useState(false)
  const [activityExportStatus, setActivityExportStatus] = useState<string | null>(null)
  const [projectAdminFailureAudit, setProjectAdminFailureAudit] = useState<
    ProjectAdminFailureAuditEntry[]
  >([])
  const { data: workgroupsData, isLoading: isLoadingMyWorkgroups } = useMyWorkgroups()
  const { data: workspaceSettingsData } = useWorkspaceSettings(workspaceId)
  const workgroups = workgroupsData?.workgroups ?? []
  const currentWorkspaceWorkgroupId = workspaceSettingsData?.settings.workspace.workgroupId
  const activeWorkgroup = getActiveWorkgroup(
    workgroups,
    workspaceId,
    currentWorkspaceWorkgroupId,
    workgroupsData?.defaultWorkgroupId
  )
  const organizationId = activeWorkgroup?.organizationId
  const { data: organizationWorkgroupsData, isLoading: isLoadingOrganizationWorkgroups } =
    useOrganizationWorkgroups(organizationId)
  const { data: agentTemplatesData, isLoading: isLoadingAgentTemplates } =
    useOrganizationAgentTemplates(organizationId)
  const { data: organizationRoster, isLoading: isLoadingOrganizationRoster } =
    useOrganizationRoster(organizationId)
  const { data: disciplinesData, isLoading: isLoadingDisciplines } = useDisciplines()
  const { data: agentsData, isLoading: isLoadingAgents } = useAgentProfiles()
  const { data: publicationsData, isLoading: isLoadingPublications } = useOrganizationPublications(
    organizationId,
    PUBLICATION_FILTERS
  )

  const organizationWorkgroups = organizationWorkgroupsData?.workgroups ?? []
  const rosterMembers = organizationRoster?.members ?? []
  const disciplines = disciplinesData?.disciplines ?? []
  const agents = agentsData?.agents ?? []
  const agentTemplates = agentTemplatesData?.templates ?? []
  const selectedAgentTemplateCodeValue = selectedAgentTemplateCode || agentTemplates[0]?.code || ''
  const { data: agentSkillPoliciesData, isLoading: isLoadingAgentSkillPolicies } =
    useOrganizationAgentSkillPolicies(organizationId, selectedAgentTemplateCodeValue || undefined)
  const agentSkillPolicies = agentSkillPoliciesData?.policies ?? []
  const publications = publicationsData?.publications ?? []
  const selectedPublication =
    publications.find((publication) => publication.id === selectedPublicationId) ?? null
  const selectedPublicationDetailDraft = selectedPublication
    ? (publicationDetailDrafts[selectedPublication.id] ?? {
        title: selectedPublication.title,
        description: selectedPublication.description ?? '',
      })
    : { title: '', description: '' }
  const canSavePublicationDetails = Boolean(
    selectedPublication &&
      selectedPublicationDetailDraft.title.trim() &&
      selectedPublicationDetailDraft.title.trim().length <= 160 &&
      selectedPublicationDetailDraft.description.trim().length <= 2000 &&
      (selectedPublicationDetailDraft.title.trim() !== selectedPublication.title ||
        selectedPublicationDetailDraft.description.trim() !==
          (selectedPublication.description ?? '')) &&
      !updatePublicationDetails.isPending
  )
  const selectedPublicationDetailId =
    selectedPublication && selectedPublication.status !== 'retracted'
      ? selectedPublication.id
      : undefined
  const { data: selectedPublicationDetailData, isLoading: isLoadingSelectedPublicationDetail } =
    usePublication(selectedPublicationDetailId)
  const { data: selectedPublicationTree, isLoading: isLoadingSelectedPublicationTree } =
    usePublicationTree(selectedPublicationDetailId)
  const currentPublishedPublicationId =
    selectedPublicationTree?.versions.find((version) => version.status === 'published')?.id ?? null
  const comparisonPublicationId =
    currentPublishedPublicationId && currentPublishedPublicationId !== selectedPublicationId
      ? currentPublishedPublicationId
      : undefined
  const { data: comparisonPublicationDetailData, isLoading: isLoadingComparisonPublicationDetail } =
    usePublication(comparisonPublicationId)
  const isProjectAdmin = organizationWorkgroups.some(
    (workgroup) => workgroup.currentUserRole === 'org_admin'
  )
  const isLoading =
    isLoadingMyWorkgroups ||
    isLoadingOrganizationWorkgroups ||
    isLoadingAgentTemplates ||
    isLoadingDisciplines ||
    isLoadingAgents ||
    isLoadingPublications

  const disciplineRows = useMemo(
    () => buildDisciplineRows(disciplines, organizationWorkgroups, agents, publications),
    [agents, disciplines, organizationWorkgroups, publications]
  )
  const teamsWithoutCanvas = organizationWorkgroups.filter((team) => !team.teamWorkspaceId)
  const totalMembers = organizationWorkgroups.reduce((sum, team) => sum + team.memberCount, 0)
  const currentPublicationCount = publications.filter(
    (publication) => publication.status === 'published'
  ).length
  const criticalPublicationCount = publications.filter(
    (publication) => publication.riskLevel === 'critical'
  ).length
  const unreviewedPublicationCount = publications.filter(
    (publication) => !publication.reviewState || publication.reviewState === 'pending'
  ).length
  const snapshotDiff = useMemo(() => {
    const candidate = selectedPublicationDetailData?.publication.snapshotState
    const current =
      comparisonPublicationDetailData?.publication.snapshotState ??
      selectedPublicationDetailData?.publication.snapshotState
    if (!candidate || !current) return null
    const candidateSummary = summarizeSnapshot(candidate)
    const currentSummary = summarizeSnapshot(current)
    return {
      candidate: candidateSummary,
      current: currentSummary,
      metrics: buildSnapshotMetricRows(candidateSummary, currentSummary),
      blockTypeDiffs: buildBlockTypeDiff(candidateSummary, currentSummary),
      nodeLevelDiff: buildNodeLevelSnapshotDiff(candidate, current),
    }
  }, [comparisonPublicationDetailData, selectedPublicationDetailData])
  const isLoadingSnapshotDiff =
    isLoadingSelectedPublicationDetail || isLoadingComparisonPublicationDetail
  const publicationStateGroups = useMemo(
    () => buildPublicationStateGroups(publications),
    [publications]
  )
  const publicationTeamNudges = useMemo(
    () =>
      buildPublicationTeamNudges({ teams: organizationWorkgroups, groups: publicationStateGroups }),
    [organizationWorkgroups, publicationStateGroups]
  )
  const publicationDependencyConflictAlerts = useMemo(
    () => buildPublicationDependencyConflictAlerts(publications, publicationStateGroups),
    [publicationStateGroups, publications]
  )
  const publicationReviewNotifications = useMemo(
    () =>
      buildPublicationReviewNotifications(
        publications,
        publicationStateGroups,
        publicationDependencyConflictAlerts
      ),
    [publicationDependencyConflictAlerts, publicationStateGroups, publications]
  )
  const publicationNotificationDeliveryDrafts = useMemo(
    () =>
      buildPublicationNotificationDeliveryDrafts(publicationReviewNotifications, {
        projectName: activeWorkgroup?.name ?? workspaceId,
      }),
    [activeWorkgroup?.name, publicationReviewNotifications, workspaceId]
  )
  const neverPublishedNudgeCount = publicationTeamNudges.filter(
    (nudge) => nudge.type === 'never_published'
  ).length
  const publicationById = useMemo(
    () => new Map(publications.map((publication) => [publication.id, publication])),
    [publications]
  )
  const publicationDependencyResolutionActions = useMemo(
    () =>
      buildPublicationDependencyResolutionActions(
        publicationDependencyConflictAlerts,
        publications
      ),
    [publicationDependencyConflictAlerts, publications]
  )
  const publicationDependencyResolutionActionsByAlertId = useMemo(() => {
    const actionsByAlertId = new Map<string, PublicationDependencyResolutionAction[]>()
    for (const action of publicationDependencyResolutionActions) {
      const actions = actionsByAlertId.get(action.alertId) ?? []
      actions.push(action)
      actionsByAlertId.set(action.alertId, actions)
    }
    return actionsByAlertId
  }, [publicationDependencyResolutionActions])
  const selectedPublicationDependencyImpact = useMemo(
    () =>
      buildPublicationDependencyImpact(
        selectedPublication,
        publications,
        publicationById,
        selectedPublicationTree
      ),
    [publicationById, publications, selectedPublication, selectedPublicationTree]
  )
  const publicationGovernanceAlertGroups = publicationStateGroups.filter(
    (group) => group.governanceAlerts.length > 0
  )
  const publicationGovernanceAlertCount = publicationGovernanceAlertGroups.reduce(
    (sum, group) => sum + group.governanceAlerts.length,
    0
  )
  const selectedPublicationGovernanceGroup =
    publicationStateGroups.find((group) =>
      group.versions.some((version) => version.id === selectedPublication?.id)
    ) ?? null
  const selectedPublicationCurrentVersion = selectedPublicationGovernanceGroup?.current ?? null
  const selectedPublicationCurrentSummary =
    publications.find((publication) => publication.id === selectedPublicationCurrentVersion?.id) ??
    null
  const selectedPublicationCurrentVersions =
    selectedPublicationGovernanceGroup?.versions.filter(
      (version) => version.status === 'published'
    ) ?? []
  const selectedPublicationExtraCurrentVersions = selectedPublicationCurrentVersions.filter(
    (version) => version.id !== selectedPublicationCurrentVersion?.id
  )
  const selectedPublicationRestoreCandidate =
    selectedPublicationGovernanceGroup?.current &&
    selectedPublicationGovernanceGroup.current.status !== 'published' &&
    selectedPublicationGovernanceGroup.current.status !== 'retracted'
      ? (publications.find(
          (publication) => publication.id === selectedPublicationGovernanceGroup.current?.id
        ) ?? null)
      : null
  const selectedPublicationAlertCodes = new Set(
    selectedPublicationGovernanceGroup?.governanceAlerts.map((alert) => alert.code) ?? []
  )
  const selectedPublicationRepairGuide = useMemo(
    () => buildPublicationConflictRepairGuide(selectedPublicationGovernanceGroup),
    [selectedPublicationGovernanceGroup]
  )
  const selectedPublicationApprovalWorkflow = useMemo(
    () => buildPublicationApprovalWorkflow(selectedPublication),
    [selectedPublication]
  )
  const batchUnapprovedCurrentPublications = publicationStateGroups
    .filter((group) =>
      group.governanceAlerts.some((alert) => alert.code === 'unapproved_current_version')
    )
    .map((group) => publicationById.get(group.current?.id ?? ''))
    .filter((publication): publication is PublicationSummary => Boolean(publication))
  const batchCriticalCurrentPublications = publicationStateGroups
    .filter((group) =>
      group.governanceAlerts.some((alert) => alert.code === 'critical_risk_current_version')
    )
    .map((group) => publicationById.get(group.current?.id ?? ''))
    .filter((publication): publication is PublicationSummary => Boolean(publication))
  const batchStaleCurrentPublications = publicationStateGroups
    .filter((group) =>
      group.governanceAlerts.some((alert) => alert.code === 'stale_current_version')
    )
    .map((group) => publicationById.get(group.current?.id ?? ''))
    .filter((publication): publication is PublicationSummary => Boolean(publication))
  const batchExtraCurrentPublications = publicationStateGroups.flatMap((group) => {
    if (!group.governanceAlerts.some((alert) => alert.code === 'multiple_current_versions')) {
      return []
    }
    return group.versions
      .filter((version) => version.status === 'published' && version.id !== group.current?.id)
      .map((version) => publicationById.get(version.id))
      .filter((publication): publication is PublicationSummary => Boolean(publication))
  })
  const batchRestoreCandidatePublications = publicationStateGroups
    .filter((group) => group.governanceAlerts.some((alert) => alert.code === 'no_current_version'))
    .map((group) => publicationById.get(group.current?.id ?? ''))
    .filter(
      (publication): publication is PublicationSummary =>
        Boolean(publication) &&
        publication.status !== 'published' &&
        publication.status !== 'retracted'
    )
  const hasPublicationBatchTargets =
    batchUnapprovedCurrentPublications.length > 0 ||
    batchCriticalCurrentPublications.length > 0 ||
    batchStaleCurrentPublications.length > 0 ||
    batchExtraCurrentPublications.length > 0 ||
    batchRestoreCandidatePublications.length > 0
  const isPublicationBatchPending =
    updatePublicationReview.isPending || updatePublicationLifecycle.isPending
  const selectedNewTeamDisciplineId = newTeamDisciplineId || disciplines[0]?.id || ''
  const selectedNewTeamDiscipline = disciplines.find(
    (discipline) => discipline.id === selectedNewTeamDisciplineId
  )
  const selectedAgentTemplate = agentTemplates.find(
    (template) => template.code === selectedAgentTemplateCodeValue
  )
  const selectedAgentTemplateDraft =
    agentTemplateDrafts[selectedAgentTemplateCodeValue] ??
    selectedAgentTemplate?.projectInstructions ??
    ''
  const selectedAgentPolicyImpact = useMemo(
    () =>
      buildAgentPolicyImpact({
        template: selectedAgentTemplate,
        draftInstructions: selectedAgentTemplateDraft,
        disciplines,
        teams: organizationWorkgroups,
        publications,
        policies: agentSkillPolicies,
      }),
    [
      agentSkillPolicies,
      disciplines,
      organizationWorkgroups,
      publications,
      selectedAgentTemplate,
      selectedAgentTemplateDraft,
    ]
  )
  const agentSkillPolicyCopyGroups = useMemo(
    () => buildAgentSkillPolicyCopyGroups(agentSkillPolicies),
    [agentSkillPolicies]
  )
  const agentSkillRiskGuardrails = useMemo(
    () =>
      buildAgentSkillRiskGuardrails({
        policies: agentSkillPolicies,
        impact: selectedAgentPolicyImpact,
      }),
    [agentSkillPolicies, selectedAgentPolicyImpact]
  )
  const selectedAssignmentTeamId = assignmentTeamId || organizationWorkgroups[0]?.id || ''
  const selectedAssignmentTeam = organizationWorkgroups.find(
    (team) => team.id === selectedAssignmentTeamId
  )
  const selectedRosterMember = useMemo(
    () => getAssignmentCandidateMember(rosterMembers, selectedRosterUserId, assignmentValue),
    [assignmentValue, rosterMembers, selectedRosterUserId]
  )
  const recommendedAssignmentTeams = useMemo(
    () => buildRecommendedAssignmentTeams(selectedRosterMember, organizationWorkgroups),
    [organizationWorkgroups, selectedRosterMember]
  )
  const recommendedAssignmentTeam = recommendedAssignmentTeams[0]
  const canCreateTeam = Boolean(
    organizationId &&
      selectedNewTeamDisciplineId &&
      newTeamName.trim() &&
      !createWorkgroup.isPending
  )
  const canAssignMember = Boolean(
    organizationId &&
      selectedAssignmentTeamId &&
      assignmentValue.trim() &&
      !addWorkgroupMember.isPending
  )
  const batchAssignmentTargets = useMemo(
    () => parseBatchAssignmentTargets(batchAssignmentValue),
    [batchAssignmentValue]
  )
  const suggestedAssignmentMembers = useMemo(() => {
    if (!selectedAssignmentTeam?.teamWorkspaceId) return []
    return [...rosterMembers]
      .filter(
        (member) =>
          !member.workspaces.some(
            (workspaceAccess) =>
              workspaceAccess.workspaceId === selectedAssignmentTeam.teamWorkspaceId
          )
      )
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
  }, [rosterMembers, selectedAssignmentTeam?.teamWorkspaceId])
  const canBatchAssignMembers = Boolean(
    organizationId &&
      selectedAssignmentTeamId &&
      batchAssignmentTargets.length > 0 &&
      !addWorkgroupMember.isPending &&
      !batchAddWorkgroupMembers.isPending
  )
  const canSaveAgentTemplate = Boolean(
    organizationId &&
      selectedAgentTemplate &&
      selectedAgentTemplateDraft.trim().length <= 4000 &&
      !updateAgentTemplate.isPending
  )
  const activityFilterBase = useMemo(
    () => ({
      workgroupId: activityTeamId || undefined,
      disciplineId: activityTeamId ? undefined : activityDisciplineId || undefined,
      action: activityAction || undefined,
      search: activitySearch.trim() || undefined,
      actor: activityActor.trim() || undefined,
      startDate: activityStartDate || undefined,
      endDate: activityEndDate || undefined,
    }),
    [
      activityAction,
      activityActor,
      activityDisciplineId,
      activityEndDate,
      activitySearch,
      activityStartDate,
      activityTeamId,
    ]
  )
  const activityFilters = useMemo(
    () => ({
      ...activityFilterBase,
      limit: PROJECT_ACTIVITY_PAGE_SIZE,
      offset: activityOffset,
    }),
    [activityFilterBase, activityOffset]
  )
  const { data: activityData, isLoading: isLoadingActivity } = useOrganizationWorkgroupActivity(
    isProjectAdmin ? organizationId : undefined,
    activityFilters
  )
  const projectActivity = activityData?.activity ?? []
  const hasPreviousActivityPage = activityOffset > 0
  const hasNextActivityPage = activityData?.nextOffset != null
  const activityRangeLabel =
    projectActivity.length > 0
      ? `Showing ${activityOffset + 1}-${activityOffset + projectActivity.length} of filtered project activity.`
      : 'No filtered project activity to show.'
  const canExportActivity = Boolean(organizationId && !isExportingActivity)
  const projectAdminFailureAuditSummary = useMemo(
    () => buildProjectAdminFailureAuditSummary(projectAdminFailureAudit),
    [projectAdminFailureAudit]
  )

  const recordProjectAdminFailure = (
    scope: ProjectAdminFailureScope,
    operation: string,
    target: string,
    error: unknown
  ) => {
    const message = readErrorMessage(error)
    const entry = buildProjectAdminFailureAuditEntry({
      id: generateShortId(),
      scope,
      operation,
      target,
      message,
    })
    setProjectAdminFailureAudit((entries) =>
      [entry, ...entries].slice(0, PROJECT_ADMIN_FAILURE_AUDIT_LIMIT)
    )
    if (organizationId) {
      recordProjectAdminFailureAudit.mutate({
        organizationId,
        scope: entry.scope,
        operation: truncateAuditValue(entry.operation, PROJECT_ADMIN_FAILURE_TEXT_MAX.operation),
        target: truncateAuditValue(entry.target, PROJECT_ADMIN_FAILURE_TEXT_MAX.target),
        message: truncateAuditValue(entry.message, PROJECT_ADMIN_FAILURE_TEXT_MAX.message),
      })
    }
    return message
  }

  const resetActivityPage = () => {
    setActivityOffset(0)
    setActivityExportStatus(null)
  }

  const handleCreateTeam = async () => {
    if (!organizationId || !selectedNewTeamDisciplineId || !newTeamName.trim()) return
    try {
      const result = await createWorkgroup.mutateAsync({
        organizationId,
        name: newTeamName.trim(),
        disciplineId: selectedNewTeamDisciplineId,
      })
      setNewTeamName('')
      setCreateTeamStatus(
        `Created ${result.workgroup.name} for ${
          selectedNewTeamDiscipline?.name ?? 'the selected discipline'
        }.`
      )
    } catch (error) {
      setCreateTeamStatus(
        recordProjectAdminFailure('team', 'Create team', newTeamName.trim(), error)
      )
    }
  }

  const handleArchiveTeam = async (team: WorkgroupAdminSummary) => {
    if (!organizationId || archiveWorkgroup.isPending) return
    if (!window.confirm(`Archive ${team.name}? Members will lose this team from active lists.`)) {
      return
    }
    setArchiveTeamStatus(null)
    try {
      const result = await archiveWorkgroup.mutateAsync({
        workgroupId: team.id,
        organizationId,
      })
      setArchiveTeamStatus(`Archived ${result.workgroup.name}.`)
      if (assignmentTeamId === team.id) setAssignmentTeamId('')
      if (activityTeamId === team.id) {
        setActivityTeamId('')
        resetActivityPage()
      }
    } catch (error) {
      setArchiveTeamStatus(recordProjectAdminFailure('team', 'Archive team', team.name, error))
    }
  }

  const handleSaveAgentTemplate = async () => {
    if (!organizationId || !selectedAgentTemplate) return
    try {
      const result = await updateAgentTemplate.mutateAsync({
        organizationId,
        agentCode: selectedAgentTemplate.code,
        projectInstructions: selectedAgentTemplateDraft,
      })
      setAgentTemplateStatus(`Updated ${result.template.name} project instructions.`)
      setAgentTemplateDrafts((drafts) => ({
        ...drafts,
        [result.template.code]: result.template.projectInstructions,
      }))
    } catch (error) {
      setAgentTemplateStatus(
        recordProjectAdminFailure(
          'agent',
          'Update project Agent instructions',
          selectedAgentTemplate.name,
          error
        )
      )
    }
  }

  const handleUpdateAgentSkillPolicy = async (
    policy: OrganizationAgentSkillPolicy,
    enabled: boolean
  ) => {
    if (!organizationId) return
    setAgentSkillPolicyStatus(null)
    try {
      const result = await updateAgentSkillPolicy.mutateAsync({
        organizationId,
        agentCode: policy.agentCode,
        skillId: policy.skillId,
        enabled,
      })
      setAgentSkillPolicyStatus(
        `${enabled ? 'Enabled' : 'Disabled'} ${result.policy.name} by default for ${
          selectedAgentTemplate?.name ?? formatAgentCode(policy.agentCode)
        }.`
      )
    } catch (error) {
      setAgentSkillPolicyStatus(
        recordProjectAdminFailure('agent', 'Update Agent skill policy', policy.name, error)
      )
    }
  }

  const handleCopyAgentSkillPolicyAcrossTeams = async (policy: OrganizationAgentSkillPolicy) => {
    if (!organizationId) return
    const targets = getAgentSkillPolicyCopyTargets(policy, agentSkillPolicies)
    if (targets.length === 0) {
      setAgentSkillPolicyStatus(
        `No matching ${policy.name} defaults need to be ${policy.enabled ? 'enabled' : 'disabled'}.`
      )
      return
    }

    setAgentSkillPolicyStatus(null)
    try {
      for (const target of targets) {
        await updateAgentSkillPolicy.mutateAsync({
          organizationId,
          agentCode: target.agentCode,
          skillId: target.skillId,
          enabled: policy.enabled,
        })
      }
      setAgentSkillPolicyStatus(
        `Copied ${policy.enabled ? 'enabled' : 'disabled'} default for ${policy.name} to ${targets.length} matching team canvas${targets.length === 1 ? '' : 'es'}.`
      )
    } catch (error) {
      setAgentSkillPolicyStatus(
        recordProjectAdminFailure(
          'agent',
          'Copy Agent skill policy',
          `${policy.name} / ${targets.length} target${targets.length === 1 ? '' : 's'}`,
          error
        )
      )
    }
  }

  const handleDisableRiskSkillDefaults = async () => {
    if (!organizationId || agentSkillRiskGuardrails.length === 0) return
    setAgentSkillPolicyStatus(null)
    try {
      for (const guardrail of agentSkillRiskGuardrails) {
        await updateAgentSkillPolicy.mutateAsync({
          organizationId,
          agentCode: guardrail.policy.agentCode,
          skillId: guardrail.policy.skillId,
          enabled: false,
        })
      }
      setAgentSkillPolicyStatus(
        `Disabled ${agentSkillRiskGuardrails.length} risky project-default skill${agentSkillRiskGuardrails.length === 1 ? '' : 's'} for ${selectedAgentTemplate?.name ?? 'this Agent'}.`
      )
    } catch (error) {
      setAgentSkillPolicyStatus(
        recordProjectAdminFailure(
          'agent',
          'Disable risky Agent skill defaults',
          selectedAgentTemplate?.name ?? 'Selected Agent',
          error
        )
      )
    }
  }

  const getPublicationReviewDraft = (publication: PublicationSummary): PublicationReviewDraft => ({
    reviewState:
      publicationReviewDrafts[publication.id]?.reviewState ?? publication.reviewState ?? '',
    riskLevel: publicationReviewDrafts[publication.id]?.riskLevel ?? publication.riskLevel ?? '',
  })

  const handlePublicationDetailDraftChange = (
    publication: PublicationSummary,
    field: 'title' | 'description',
    value: string
  ) => {
    setPublicationDetailDrafts((drafts) => ({
      ...drafts,
      [publication.id]: {
        title: publication.title,
        description: publication.description ?? '',
        ...drafts[publication.id],
        [field]: value,
      },
    }))
    setPublicationGovernanceStatus(null)
  }

  const handleSavePublicationDetails = async (publication: PublicationSummary) => {
    const draft = publicationDetailDrafts[publication.id] ?? {
      title: publication.title,
      description: publication.description ?? '',
    }
    try {
      const result = await updatePublicationDetails.mutateAsync({
        publicationVersionId: publication.id,
        title: draft.title,
        description: draft.description.trim() || null,
        reason: 'Project admin publication detail edit',
      })
      setPublicationGovernanceStatus(`Updated details for ${result.publication.title}.`)
      setPublicationDetailDrafts((drafts) => ({
        ...drafts,
        [publication.id]: {
          title: result.publication.title,
          description: result.publication.description ?? '',
        },
      }))
    } catch (error) {
      setPublicationGovernanceStatus(
        recordProjectAdminFailure(
          'publication',
          'Update publication details',
          publication.title,
          error
        )
      )
    }
  }

  const handlePublicationReviewChange = (
    publication: PublicationSummary,
    field: keyof PublicationReviewDraft,
    value: PublicationReviewDraft[keyof PublicationReviewDraft]
  ) => {
    setPublicationReviewDrafts((drafts) => ({
      ...drafts,
      [publication.id]: {
        reviewState: publication.reviewState ?? '',
        riskLevel: publication.riskLevel ?? '',
        ...drafts[publication.id],
        [field]: value,
      },
    }))
    setPublicationGovernanceStatus(null)
  }

  const handleSavePublicationReview = async (publication: PublicationSummary) => {
    const draft = getPublicationReviewDraft(publication)
    try {
      const result = await updatePublicationReview.mutateAsync({
        publicationVersionId: publication.id,
        reviewState: draft.reviewState || null,
        riskLevel: draft.riskLevel || null,
        reason: 'Project admin state tree governance update',
      })
      setPublicationGovernanceStatus(`Updated review metadata for ${result.publication.title}.`)
      setPublicationReviewDrafts((drafts) => ({
        ...drafts,
        [publication.id]: {
          reviewState: result.publication.reviewState ?? '',
          riskLevel: result.publication.riskLevel ?? '',
        },
      }))
    } catch (error) {
      setPublicationGovernanceStatus(
        recordProjectAdminFailure(
          'publication',
          'Update publication review metadata',
          publication.title,
          error
        )
      )
    }
  }

  const handlePublicationReviewerAssignment = async (
    publication: PublicationSummary,
    reviewerUserId: string | null
  ) => {
    const draft = getPublicationReviewDraft(publication)
    const reviewer = rosterMembers.find((member) => member.userId === reviewerUserId)
    try {
      const result = await updatePublicationReview.mutateAsync({
        publicationVersionId: publication.id,
        reviewState: draft.reviewState || null,
        riskLevel: draft.riskLevel || null,
        reviewerUserId,
        reason: reviewerUserId
          ? 'Project admin assigned publication reviewer'
          : 'Project admin cleared publication reviewer',
      })
      setPublicationGovernanceStatus(
        reviewerUserId
          ? `Assigned ${formatRosterMemberLabel(reviewer, reviewerUserId)} to review ${result.publication.title}.`
          : `Cleared reviewer for ${result.publication.title}.`
      )
      setPublicationReviewDrafts((drafts) => ({
        ...drafts,
        [publication.id]: {
          reviewState: result.publication.reviewState ?? '',
          riskLevel: result.publication.riskLevel ?? '',
        },
      }))
    } catch (error) {
      setPublicationGovernanceStatus(
        recordProjectAdminFailure(
          'publication',
          reviewerUserId ? 'Assign publication reviewer' : 'Clear publication reviewer',
          publication.title,
          error
        )
      )
    }
  }

  const handlePublicationLifecycle = async (
    publication: PublicationSummary,
    action: 'archive' | 'retract' | 'restore'
  ) => {
    try {
      const result = await updatePublicationLifecycle.mutateAsync({
        publicationVersionId: publication.id,
        action,
        reason: `Project admin ${action} from state tree governance`,
      })
      setPublicationGovernanceStatus(
        `${result.publication.title} is now ${result.publication.status}.`
      )
    } catch (error) {
      setPublicationGovernanceStatus(
        recordProjectAdminFailure('publication', `Publication ${action}`, publication.title, error)
      )
    }
  }

  const handlePublicationReviewResolution = async (
    publication: PublicationSummary,
    reviewState: PublicationReviewState | null,
    riskLevel: PublicationRiskLevel | null,
    successMessage: string
  ) => {
    try {
      const result = await updatePublicationReview.mutateAsync({
        publicationVersionId: publication.id,
        reviewState,
        riskLevel,
        reason: 'Project admin conflict resolution action',
      })
      setPublicationGovernanceStatus(successMessage)
      setPublicationReviewDrafts((drafts) => ({
        ...drafts,
        [publication.id]: {
          reviewState: result.publication.reviewState ?? '',
          riskLevel: result.publication.riskLevel ?? '',
        },
      }))
    } catch (error) {
      setPublicationGovernanceStatus(
        recordProjectAdminFailure(
          'publication',
          'Publication conflict resolution',
          publication.title,
          error
        )
      )
    }
  }

  const handlePublicationDependencyResolutionAction = async (
    action: PublicationDependencyResolutionAction
  ) => {
    const targetPublication = publicationById.get(action.targetPublicationId)
    if (!targetPublication) {
      setPublicationGovernanceStatus(
        recordProjectAdminFailure(
          'publication',
          action.actionLabel,
          action.targetTitle,
          new Error(`Could not find ${action.targetTitle} in the loaded list.`)
        )
      )
      return
    }

    if (action.operation === 'open') {
      setSelectedPublicationId(action.targetPublicationId)
      setPublicationGovernanceStatus(action.successMessage)
      return
    }

    if (action.operation === 'lifecycle' && action.lifecycleAction) {
      await handlePublicationLifecycle(targetPublication, action.lifecycleAction)
      return
    }

    if (action.operation === 'review') {
      await handlePublicationReviewResolution(
        targetPublication,
        action.reviewState,
        action.riskLevel,
        action.successMessage
      )
    }
  }

  const handlePublicationNotificationDelivery = async (
    draft: PublicationNotificationDeliveryDraft
  ) => {
    if (!organizationId) {
      setPublicationGovernanceStatus('Select a project organization before delivery.')
      return
    }

    try {
      const result = await deliverPublicationNotifications.mutateAsync({
        organizationId,
        channel: draft.channel,
        projectName: activeWorkgroup?.name ?? workspaceId,
      })
      const { delivery } = result
      if (delivery.status === 'skipped') {
        setPublicationGovernanceStatus(delivery.detail)
        return
      }

      if (delivery.channel === 'in_app') {
        addNotification({
          level: delivery.dangerCount > 0 ? 'error' : 'info',
          message: delivery.body,
        })
        setPublicationGovernanceStatus(
          `Persisted digest outbox ${delivery.outboxEventId ?? 'record'} and queued ${delivery.notificationCount} publication review notification${delivery.notificationCount === 1 ? '' : 's'} in the in-app bell.`
        )
        resetActivityPage()
        return
      }

      await navigator.clipboard.writeText(delivery.body)
      setPublicationGovernanceStatus(
        `Persisted ${delivery.channel.replace('_', ' ')} outbox ${delivery.outboxEventId ?? 'record'} and copied ${delivery.title.toLowerCase()} to clipboard.`
      )
      resetActivityPage()
    } catch (error) {
      setPublicationGovernanceStatus(
        recordProjectAdminFailure('notification', draft.title, draft.channel, error)
      )
    }
  }

  const handleBatchPublicationReviewResolution = async (
    publicationsToUpdate: PublicationSummary[],
    getReviewState: (publication: PublicationSummary) => PublicationReviewState | null,
    getRiskLevel: (publication: PublicationSummary) => PublicationRiskLevel | null,
    reason: string,
    successMessage: string
  ) => {
    if (publicationsToUpdate.length === 0) return
    try {
      for (const publication of publicationsToUpdate) {
        const result = await updatePublicationReview.mutateAsync({
          publicationVersionId: publication.id,
          reviewState: getReviewState(publication),
          riskLevel: getRiskLevel(publication),
          reason,
        })
        setPublicationReviewDrafts((drafts) => ({
          ...drafts,
          [publication.id]: {
            reviewState: result.publication.reviewState ?? '',
            riskLevel: result.publication.riskLevel ?? '',
          },
        }))
      }
      setPublicationGovernanceStatus(successMessage)
    } catch (error) {
      setPublicationGovernanceStatus(
        recordProjectAdminFailure(
          'publication',
          'Batch publication review resolution',
          `${publicationsToUpdate.length} publication${publicationsToUpdate.length === 1 ? '' : 's'}`,
          error
        )
      )
    }
  }

  const handleBatchPublicationLifecycle = async (
    publicationsToUpdate: PublicationSummary[],
    action: 'archive' | 'restore',
    reason: string,
    successMessage: string
  ) => {
    if (publicationsToUpdate.length === 0) return
    try {
      for (const publication of publicationsToUpdate) {
        await updatePublicationLifecycle.mutateAsync({
          publicationVersionId: publication.id,
          action,
          reason,
        })
      }
      setPublicationGovernanceStatus(successMessage)
    } catch (error) {
      setPublicationGovernanceStatus(
        recordProjectAdminFailure(
          'publication',
          `Batch publication ${action}`,
          `${publicationsToUpdate.length} publication${publicationsToUpdate.length === 1 ? '' : 's'}`,
          error
        )
      )
    }
  }

  const handleAssignMember = async () => {
    if (!organizationId || !selectedAssignmentTeamId || !assignmentValue.trim()) return
    const trimmed = assignmentValue.trim()
    const isEmail = trimmed.includes('@')
    try {
      await addWorkgroupMember.mutateAsync({
        workgroupId: selectedAssignmentTeamId,
        organizationId,
        role: assignmentRole,
        ...(selectedRosterMember
          ? { userId: selectedRosterMember.userId }
          : isEmail
            ? { email: trimmed }
            : { userId: trimmed }),
      })
      setAssignmentValue('')
      setSelectedRosterUserId('')
      setAssignmentStatus(
        `Assigned ${trimmed} to ${selectedAssignmentTeam?.name ?? 'the selected team'} as ${
          assignmentRole
        }.`
      )
    } catch (error) {
      setAssignmentStatus(
        recordProjectAdminFailure(
          'member',
          'Assign team member',
          `${trimmed} / ${selectedAssignmentTeam?.name ?? 'selected team'}`,
          error
        )
      )
    }
  }

  const handleBatchAssignMembers = async () => {
    if (!organizationId || !selectedAssignmentTeamId || batchAssignmentTargets.length === 0) return
    try {
      const result = await batchAddWorkgroupMembers.mutateAsync({
        workgroupId: selectedAssignmentTeamId,
        organizationId,
        role: assignmentRole,
        targets: batchAssignmentTargets.map((target) => {
          const rosterMember = rosterMembers.find(
            (member) =>
              member.userId === target || member.email.toLowerCase() === target.toLowerCase()
          )
          if (rosterMember) return { userId: rosterMember.userId }
          return target.includes('@') ? { email: target } : { userId: target }
        }),
      })
      setBatchAssignmentResults(
        result.assigned.map((assignment) => ({
          target: assignment.target,
          status: 'assigned',
          message: `Assigned as ${assignment.role}`,
        }))
      )
      setAssignmentStatus(
        `Batch assignment committed for ${selectedAssignmentTeam?.name ?? 'the selected team'}: ${result.assigned.length}/${batchAssignmentTargets.length} unique target${batchAssignmentTargets.length === 1 ? '' : 's'} assigned.`
      )
      setBatchAssignmentValue('')
    } catch (error) {
      const message = recordProjectAdminFailure(
        'member',
        'Batch assign team members',
        selectedAssignmentTeam?.name ?? 'selected team',
        error
      )
      setBatchAssignmentResults(
        batchAssignmentTargets.map((target) => ({ target, status: 'failed', message }))
      )
      setAssignmentStatus(
        `Batch assignment was not committed for ${selectedAssignmentTeam?.name ?? 'the selected team'}: ${message}`
      )
    }
  }

  const handleLoadSuggestedAssignments = () => {
    const suggestedTargets = suggestedAssignmentMembers.map((member) => member.email)
    setBatchAssignmentValue((currentValue) =>
      mergeBatchAssignmentTargets(currentValue, suggestedTargets)
    )
    setBatchAssignmentResults([])
    setBatchImportStatus(null)
    setAssignmentStatus(null)
  }

  const handleImportBatchAssignments = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const importedTargets = extractBatchAssignmentTargetsFromImport(await file.text())
      if (importedTargets.length === 0) {
        setBatchImportStatus(`No email or user ID targets found in ${file.name}.`)
        return
      }

      setBatchAssignmentValue((currentValue) =>
        mergeBatchAssignmentTargets(currentValue, importedTargets)
      )
      setBatchAssignmentResults([])
      setAssignmentStatus(null)
      setBatchImportStatus(`Imported ${importedTargets.length} target(s) from ${file.name}.`)
    } catch (error) {
      setBatchImportStatus(
        recordProjectAdminFailure('member', 'Import batch targets', file.name, error)
      )
    }
  }

  const handleExportFilteredActivity = async () => {
    if (!organizationId) return

    setIsExportingActivity(true)
    setActivityExportStatus(null)
    try {
      const entries: OrganizationWorkgroupActivityEntry[] = []
      let offset = 0
      let nextOffset: number | null = 0
      let pageCount = 0

      while (nextOffset != null && pageCount < PROJECT_ACTIVITY_EXPORT_MAX_PAGES) {
        const result = await fetchOrganizationWorkgroupActivity(organizationId, {
          ...activityFilterBase,
          limit: PROJECT_ACTIVITY_EXPORT_PAGE_SIZE,
          offset,
        })
        entries.push(...result.activity)
        nextOffset = result.nextOffset
        offset = nextOffset ?? offset
        pageCount += 1
      }

      if (entries.length === 0) {
        setActivityExportStatus('No activity matched the current filters.')
        return
      }

      downloadProjectActivityCsv(entries, 'filtered')
      setActivityExportStatus(
        nextOffset == null
          ? `Exported ${entries.length} filtered activity row${entries.length === 1 ? '' : 's'}.`
          : `Exported the first ${entries.length} filtered activity rows. Narrow filters to export more.`
      )
    } catch (error) {
      setActivityExportStatus(
        recordProjectAdminFailure('activity', 'Export filtered activity', 'Project activity', error)
      )
    } finally {
      setIsExportingActivity(false)
    }
  }

  if (isLoading) {
    return (
      <div className='flex h-full items-center justify-center bg-[var(--bg)] text-[13px] text-[var(--text-muted)]'>
        <Loader className='mr-2 h-[15px] w-[15px]' animate />
        Loading project admin center...
      </div>
    )
  }

  if (!organizationId || !activeWorkgroup) {
    return (
      <div className='h-full overflow-auto bg-[var(--bg)] p-6'>
        <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-6'>
          <h1 className='font-medium text-[18px] text-[var(--text-primary)]'>Project admin</h1>
          <p className='mt-2 text-[13px] text-[var(--text-muted)]'>
            Join or create a workgroup before opening the project admin center.
          </p>
        </div>
      </div>
    )
  }

  if (!isProjectAdmin) {
    return (
      <div className='h-full overflow-auto bg-[var(--bg)] p-6'>
        <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-6'>
          <div className='flex items-center gap-2'>
            <ShieldCheck className='h-[18px] w-[18px] text-[var(--text-icon)]' />
            <h1 className='font-medium text-[18px] text-[var(--text-primary)]'>Project admin</h1>
          </div>
          <p className='mt-2 max-w-[680px] text-[13px] text-[var(--text-muted)]'>
            Project admin center is reserved for organization owners and admins. Team admins can
            continue using Team management for their own workgroup.
          </p>
          <Link
            className={cn(buttonVariants({ variant: 'primary' }), 'mt-4')}
            href={`/workspace/${activeWorkgroup.teamWorkspaceId || workspaceId}/team-management`}
          >
            Open team management
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className='h-full overflow-auto bg-[var(--bg)]'>
      <div className='mx-auto grid w-full max-w-[1180px] gap-5 p-6'>
        <header className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-5'>
          <div className='flex flex-wrap items-start justify-between gap-4'>
            <div>
              <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
                <ShieldCheck className='h-[15px] w-[15px]' />
                Phase 10 admin operations
              </div>
              <h1 className='mt-2 font-medium text-[22px] text-[var(--text-primary)]'>
                Project admin center
              </h1>
              <p className='mt-2 max-w-[760px] text-[13px] text-[var(--text-muted)]'>
                Project-level overview for disciplines, teams, members, Agent mapping, and visible
                showcase governance, with controlled admin actions added one slice at a time.
              </p>
            </div>
            <Link
              className={buttonVariants({ variant: 'default' })}
              href={`/workspace/${activeWorkgroup.teamWorkspaceId || workspaceId}/showcase`}
            >
              Open showcase canvas
            </Link>
          </div>
        </header>

        <section className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
          <StatCard
            label='Disciplines covered'
            value={`${disciplineRows.filter((row) => row.teamCount > 0).length}/${disciplines.length}`}
            detail='Disciplines with at least one team'
          />
          <StatCard
            label='Teams'
            value={organizationWorkgroups.length}
            detail={`${totalMembers} total workgroup memberships`}
          />
          <StatCard
            label='Current publications'
            value={currentPublicationCount}
            detail={`${publications.length} visible showcase versions loaded`}
          />
          <StatCard
            label='Governance alerts'
            value={
              criticalPublicationCount +
              unreviewedPublicationCount +
              publicationGovernanceAlertCount +
              publicationReviewNotifications.length +
              neverPublishedNudgeCount +
              teamsWithoutCanvas.length
            }
            detail={`${criticalPublicationCount} critical, ${unreviewedPublicationCount} unreviewed, ${publicationGovernanceAlertCount} state-tree, ${publicationReviewNotifications.length} review notifications, ${neverPublishedNudgeCount} unpublished, ${teamsWithoutCanvas.length} missing canvas`}
            tone={
              criticalPublicationCount +
                unreviewedPublicationCount +
                publicationGovernanceAlertCount +
                publicationReviewNotifications.length +
                neverPublishedNudgeCount +
                teamsWithoutCanvas.length >
              0
                ? 'warning'
                : 'default'
            }
          />
        </section>

        <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
          <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
            <Network className='h-[15px] w-[15px] text-[var(--text-icon)]' />
            <div>
              <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                Project publication governance
              </h2>
              <p className='text-[12px] text-[var(--text-muted)]'>
                Organization-wide state tree controls for review, risk, archive, retract, and
                restore actions.
              </p>
            </div>
          </div>
          {publicationGovernanceStatus && (
            <div
              className='border-[var(--border)] border-b px-4 py-3 text-[12px] text-[var(--text-muted)]'
              aria-live='polite'
            >
              {publicationGovernanceStatus}
            </div>
          )}
          <div className='border-[var(--border)] border-b bg-[var(--surface-2)] px-4 py-3'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div>
                <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                  Batch governance actions
                </h3>
                <p className='mt-1 max-w-[780px] text-[12px] text-[var(--text-muted)]'>
                  Apply low-risk fixes across the current state tree without opening each
                  publication drawer. Destructive lifecycle changes still reuse the existing
                  publication audit trail.
                </p>
              </div>
              <span className='rounded-[8px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
                {publicationGovernanceAlertCount} state-tree alerts /{' '}
                {publicationDependencyConflictAlerts.length} dependency alerts /{' '}
                {publicationDependencyResolutionActions.length} resolution actions /{' '}
                {publicationReviewNotifications.length} review notifications
              </span>
            </div>
            {hasPublicationBatchTargets ? (
              <div className='mt-3 flex flex-wrap gap-2'>
                <button
                  type='button'
                  className={buttonVariants({ size: 'sm', variant: 'default' })}
                  disabled={
                    batchUnapprovedCurrentPublications.length === 0 || isPublicationBatchPending
                  }
                  onClick={() =>
                    void handleBatchPublicationReviewResolution(
                      batchUnapprovedCurrentPublications,
                      () => 'approved',
                      (publication) => publication.riskLevel,
                      'Project admin batch approved current publications',
                      `Approved ${batchUnapprovedCurrentPublications.length} current publication${batchUnapprovedCurrentPublications.length === 1 ? '' : 's'}.`
                    )
                  }
                >
                  Approve current ({batchUnapprovedCurrentPublications.length})
                </button>
                <button
                  type='button'
                  className={buttonVariants({ size: 'sm', variant: 'default' })}
                  disabled={batchStaleCurrentPublications.length === 0 || isPublicationBatchPending}
                  onClick={() =>
                    void handleBatchPublicationReviewResolution(
                      batchStaleCurrentPublications,
                      () => 'in_review',
                      (publication) => publication.riskLevel,
                      'Project admin batch started refresh review',
                      `Started refresh review for ${batchStaleCurrentPublications.length} stale current publication${batchStaleCurrentPublications.length === 1 ? '' : 's'}.`
                    )
                  }
                >
                  Start refresh review ({batchStaleCurrentPublications.length})
                </button>
                <button
                  type='button'
                  className={buttonVariants({ size: 'sm', variant: 'default' })}
                  disabled={
                    batchCriticalCurrentPublications.length === 0 || isPublicationBatchPending
                  }
                  onClick={() =>
                    void handleBatchPublicationReviewResolution(
                      batchCriticalCurrentPublications,
                      (publication) => publication.reviewState,
                      () => 'high',
                      'Project admin batch reduced critical current risk markers',
                      `Reduced ${batchCriticalCurrentPublications.length} critical current risk marker${batchCriticalCurrentPublications.length === 1 ? '' : 's'} to high.`
                    )
                  }
                >
                  Lower critical risk ({batchCriticalCurrentPublications.length})
                </button>
                <button
                  type='button'
                  className={buttonVariants({ size: 'sm', variant: 'default' })}
                  disabled={batchExtraCurrentPublications.length === 0 || isPublicationBatchPending}
                  onClick={() =>
                    void handleBatchPublicationLifecycle(
                      batchExtraCurrentPublications,
                      'archive',
                      'Project admin batch archived duplicate current publications',
                      `Archived ${batchExtraCurrentPublications.length} duplicate current publication${batchExtraCurrentPublications.length === 1 ? '' : 's'}.`
                    )
                  }
                >
                  Archive duplicate current ({batchExtraCurrentPublications.length})
                </button>
                <button
                  type='button'
                  className={buttonVariants({ size: 'sm', variant: 'default' })}
                  disabled={
                    batchRestoreCandidatePublications.length === 0 || isPublicationBatchPending
                  }
                  onClick={() =>
                    void handleBatchPublicationLifecycle(
                      batchRestoreCandidatePublications,
                      'restore',
                      'Project admin batch restored latest visible publications',
                      `Restored ${batchRestoreCandidatePublications.length} latest visible publication${batchRestoreCandidatePublications.length === 1 ? '' : 's'}.`
                    )
                  }
                >
                  Restore missing current ({batchRestoreCandidatePublications.length})
                </button>
              </div>
            ) : (
              <p className='mt-3 text-[12px] text-[var(--text-muted)]'>
                No eligible batch governance actions are currently available.
              </p>
            )}
            {publicationReviewNotifications.length > 0 && (
              <div className='mt-4 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3'>
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div>
                    <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                      Review notification queue
                    </h3>
                    <p className='mt-1 max-w-[760px] text-[12px] text-[var(--text-muted)]'>
                      Project-admin delivery queue for reviewer assignment, pending decisions,
                      critical risk, and dependency follow-up. Bell, email, and external push
                      channels can subscribe to this queue later.
                    </p>
                  </div>
                  <span className='rounded-[8px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
                    {publicationReviewNotifications.length} notifications
                  </span>
                </div>
                <div className='mt-3 grid gap-2'>
                  {publicationReviewNotifications.slice(0, 6).map((notification) => {
                    const reviewer = notification.reviewerUserId
                      ? rosterMembers.find(
                          (member) => member.userId === notification.reviewerUserId
                        )
                      : undefined
                    return (
                      <div
                        key={notification.id}
                        className='grid gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 md:grid-cols-[minmax(0,1fr)_auto]'
                      >
                        <div className='min-w-0'>
                          <div className='flex flex-wrap items-center gap-2'>
                            <span className='font-medium text-[12px] text-[var(--text-primary)]'>
                              {notification.publicationWorkgroupName} v
                              {notification.publicationVersionNumber}
                            </span>
                            <span
                              className={cn(
                                'rounded-[6px] border px-1.5 py-0.5 font-medium text-[10px]',
                                governanceAlertClass(notification.severity)
                              )}
                            >
                              {notification.type.replaceAll('_', ' ')}
                            </span>
                          </div>
                          <p className='mt-1 text-[12px] text-[var(--text-muted)]'>
                            {notification.publicationTitle}: {notification.detail}
                          </p>
                          <div className='mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]'>
                            <span>
                              Reviewer:{' '}
                              {formatRosterMemberLabel(reviewer, notification.reviewerUserId)}
                            </span>
                            <span>Action: {notification.actionLabel}</span>
                          </div>
                        </div>
                        <div className='flex items-center gap-2 md:justify-end'>
                          <button
                            type='button'
                            className={buttonVariants({ size: 'sm', variant: 'default' })}
                            onClick={() => setSelectedPublicationId(notification.publicationId)}
                          >
                            Open publication
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  {publicationReviewNotifications.length > 6 && (
                    <div className='text-[11px] text-[var(--text-muted)]'>
                      +{publicationReviewNotifications.length - 6} more review notification
                      {publicationReviewNotifications.length - 6 === 1 ? '' : 's'}
                    </div>
                  )}
                </div>
                {publicationNotificationDeliveryDrafts.length > 0 && (
                  <div className='mt-4 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                    <div className='flex flex-wrap items-start justify-between gap-3'>
                      <div>
                        <h4 className='font-medium text-[12px] text-[var(--text-primary)]'>
                          Delivery channels
                        </h4>
                        <p className='mt-1 max-w-[720px] text-[11px] text-[var(--text-muted)]'>
                          Persist a server-side outbox delivery record, queue an in-app digest, or
                          copy email and webhook payloads for external delivery setup.
                        </p>
                      </div>
                      <span className='rounded-[8px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
                        {publicationNotificationDeliveryDrafts.length} channels
                      </span>
                    </div>
                    <div className='mt-3 grid gap-2 md:grid-cols-3'>
                      {publicationNotificationDeliveryDrafts.map((draft) => (
                        <div
                          key={draft.id}
                          className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3'
                        >
                          <div className='flex items-center justify-between gap-2'>
                            <span className='font-medium text-[12px] text-[var(--text-primary)]'>
                              {draft.title}
                            </span>
                            <span
                              className={cn(
                                'rounded-[6px] border px-1.5 py-0.5 font-medium text-[10px]',
                                governanceAlertClass(draft.severity)
                              )}
                            >
                              {draft.channel.replace('_', ' ')}
                            </span>
                          </div>
                          <p className='mt-2 text-[11px] text-[var(--text-muted)]'>
                            {draft.detail}
                          </p>
                          <button
                            type='button'
                            className={cn(
                              buttonVariants({ size: 'sm', variant: 'default' }),
                              'mt-3'
                            )}
                            disabled={deliverPublicationNotifications.isPending}
                            onClick={() => void handlePublicationNotificationDelivery(draft)}
                          >
                            {deliverPublicationNotifications.isPending
                              ? 'Delivering...'
                              : draft.actionLabel}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {publicationDependencyConflictAlerts.length > 0 && (
              <div className='mt-4 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3'>
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div>
                    <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                      Dependency conflict alerts
                    </h3>
                    <p className='mt-1 max-w-[760px] text-[12px] text-[var(--text-muted)]'>
                      Review current publications that depend on missing, outdated, unapproved, or
                      critical-risk cross-team baselines before project sign-off.
                    </p>
                  </div>
                  <span className='rounded-[8px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
                    {publicationDependencyConflictAlerts.length} alerts
                  </span>
                </div>
                <div className='mt-3 grid gap-2'>
                  {publicationDependencyConflictAlerts.slice(0, 6).map((alert) => {
                    const resolutionActions =
                      publicationDependencyResolutionActionsByAlertId.get(alert.id) ?? []
                    return (
                      <div
                        key={alert.id}
                        className='grid gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 md:grid-cols-[minmax(0,1fr)_auto]'
                      >
                        <div className='min-w-0'>
                          <div className='flex flex-wrap items-center gap-2'>
                            <span className='font-medium text-[12px] text-[var(--text-primary)]'>
                              {alert.publicationWorkgroupName} v{alert.publicationVersionNumber}
                            </span>
                            <span
                              className={cn(
                                'rounded-[6px] border px-1.5 py-0.5 font-medium text-[10px]',
                                governanceAlertClass(alert.severity)
                              )}
                            >
                              {alert.code.replaceAll('_', ' ')}
                            </span>
                          </div>
                          <p className='mt-1 text-[12px] text-[var(--text-muted)]'>
                            {alert.publicationTitle} depends on {alert.dependencyTitle}.{' '}
                            {alert.detail}
                          </p>
                          <div className='mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]'>
                            <span>Source: {alert.publicationWorkgroupName}</span>
                            {alert.dependencyWorkgroupName ? (
                              <span>Dependency: {alert.dependencyWorkgroupName}</span>
                            ) : null}
                            {alert.currentDependencyVersionNumber ? (
                              <span>
                                Current dependency: v{alert.currentDependencyVersionNumber}
                              </span>
                            ) : null}
                          </div>
                          {resolutionActions.length > 0 && (
                            <div className='mt-2 grid gap-1'>
                              {resolutionActions.slice(0, 3).map((action) => (
                                <div
                                  key={action.id}
                                  className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[11px] text-[var(--text-muted)]'
                                >
                                  <span className='font-medium text-[var(--text-primary)]'>
                                    {action.actionLabel}
                                  </span>{' '}
                                  {action.detail}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className='flex flex-wrap items-center gap-2 md:justify-end'>
                          <button
                            type='button'
                            className={buttonVariants({ size: 'sm', variant: 'default' })}
                            onClick={() => setSelectedPublicationId(alert.publicationId)}
                          >
                            Open publication
                          </button>
                          {resolutionActions.slice(0, 3).map((action) => (
                            <button
                              key={action.id}
                              type='button'
                              className={buttonVariants({ size: 'sm', variant: 'default' })}
                              disabled={
                                (action.operation === 'review' &&
                                  updatePublicationReview.isPending) ||
                                (action.operation === 'lifecycle' &&
                                  updatePublicationLifecycle.isPending)
                              }
                              onClick={() =>
                                void handlePublicationDependencyResolutionAction(action)
                              }
                            >
                              {action.actionLabel}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                  {publicationDependencyConflictAlerts.length > 6 && (
                    <div className='text-[11px] text-[var(--text-muted)]'>
                      +{publicationDependencyConflictAlerts.length - 6} more dependency alert
                      {publicationDependencyConflictAlerts.length - 6 === 1 ? '' : 's'}
                    </div>
                  )}
                </div>
              </div>
            )}
            {publicationTeamNudges.length > 0 && (
              <div className='mt-4 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3'>
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div>
                    <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                      Team publication nudges
                    </h3>
                    <p className='mt-1 max-w-[760px] text-[12px] text-[var(--text-muted)]'>
                      Follow up with teams that have stale, missing, or not-yet-submitted showcase
                      baselines before project sign-off.
                    </p>
                  </div>
                  <span className='rounded-[8px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
                    {publicationTeamNudges.length} nudges
                  </span>
                </div>
                <div className='mt-3 grid gap-2'>
                  {publicationTeamNudges.slice(0, 6).map((nudge) => {
                    const nudgePublication = nudge.publicationId
                      ? publicationById.get(nudge.publicationId)
                      : null
                    return (
                      <div
                        key={nudge.id}
                        className='grid gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 md:grid-cols-[minmax(0,1fr)_auto]'
                      >
                        <div className='min-w-0'>
                          <div className='flex flex-wrap items-center gap-2'>
                            <span className='font-medium text-[12px] text-[var(--text-primary)]'>
                              {nudge.teamName}
                            </span>
                            <span
                              className={cn(
                                'rounded-[6px] border px-1.5 py-0.5 font-medium text-[10px]',
                                governanceAlertClass(nudge.severity)
                              )}
                            >
                              {nudge.type === 'never_published'
                                ? 'No submission'
                                : nudge.type === 'missing_current'
                                  ? 'Missing current'
                                  : 'Stale current'}
                            </span>
                          </div>
                          <p className='mt-1 text-[12px] text-[var(--text-muted)]'>
                            {nudge.detail}
                          </p>
                          <div className='mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]'>
                            <span>{nudge.disciplineName}</span>
                            <span>{formatAgentCode(nudge.agentCode)}</span>
                            {nudge.versionNumber ? <span>v{nudge.versionNumber}</span> : null}
                          </div>
                        </div>
                        <div className='flex items-center gap-2 md:justify-end'>
                          {nudge.type === 'stale_current' && nudgePublication ? (
                            <button
                              type='button'
                              className={buttonVariants({ size: 'sm', variant: 'default' })}
                              disabled={updatePublicationReview.isPending}
                              onClick={() =>
                                void handlePublicationReviewResolution(
                                  nudgePublication,
                                  'in_review',
                                  nudgePublication.riskLevel,
                                  `Started refresh review nudge for ${nudge.teamName}.`
                                )
                              }
                            >
                              {nudge.actionLabel}
                            </button>
                          ) : nudge.type === 'missing_current' && nudgePublication ? (
                            <button
                              type='button'
                              className={buttonVariants({ size: 'sm', variant: 'default' })}
                              disabled={updatePublicationLifecycle.isPending}
                              onClick={() =>
                                void handlePublicationLifecycle(nudgePublication, 'restore')
                              }
                            >
                              {nudge.actionLabel}
                            </button>
                          ) : (
                            <Link
                              className={buttonVariants({ size: 'sm', variant: 'default' })}
                              href={`/workspace/${nudge.teamWorkspaceId || workspaceId}/team-management`}
                            >
                              {nudge.actionLabel}
                            </Link>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
          <div className='divide-y divide-[var(--border)]'>
            {publications.length === 0 ? (
              <EmptyState>
                No organization publication versions match the current project view.
              </EmptyState>
            ) : (
              publications.map((publication) => {
                const draft = getPublicationReviewDraft(publication)
                const hasReviewChanges =
                  draft.reviewState !== (publication.reviewState ?? '') ||
                  draft.riskLevel !== (publication.riskLevel ?? '')
                const canArchive =
                  publication.status === 'published' || publication.status === 'superseded'
                const canRetract = publication.status !== 'retracted'
                const canRestore =
                  publication.status === 'archived' || publication.status === 'superseded'
                const publicationGroup = publicationStateGroups.find((group) =>
                  group.versions.some((version) => version.id === publication.id)
                )

                return (
                  <div
                    key={publication.id}
                    className='grid gap-3 px-4 py-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)_auto]'
                  >
                    <div className='min-w-0'>
                      <div className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                        {publication.title}
                      </div>
                      <div className='mt-1 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]'>
                        <span>v{publication.versionNumber}</span>
                        <span>{publication.sourceWorkgroup.name}</span>
                        <span>{publication.sourceDiscipline.name}</span>
                        <span>{publication.status}</span>
                        <span>{publication.visibility}</span>
                      </div>
                      {publication.dependsOnPublicationIds.length > 0 && (
                        <div className='mt-1 text-[11px] text-[var(--text-muted)]'>
                          Depends on {publication.dependsOnPublicationIds.length} visible version
                          {publication.dependsOnPublicationIds.length === 1 ? '' : 's'}.
                        </div>
                      )}
                      {publicationGroup && publicationGroup.governanceAlerts.length > 0 && (
                        <div className='mt-2 flex flex-wrap gap-1'>
                          {publicationGroup.governanceAlerts.slice(0, 2).map((alert) => (
                            <span
                              key={alert.code}
                              className={cn(
                                'rounded-[8px] border px-2 py-0.5 text-[10px]',
                                governanceAlertClass(alert.severity)
                              )}
                            >
                              {alert.message}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className='grid gap-2 sm:grid-cols-3'>
                      <select
                        value={draft.reviewState}
                        onChange={(event) =>
                          handlePublicationReviewChange(
                            publication,
                            'reviewState',
                            event.target.value as PublicationReviewDraft['reviewState']
                          )
                        }
                        className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none'
                        aria-label={`Review state for ${publication.title}`}
                      >
                        {PUBLICATION_REVIEW_OPTIONS.map((option) => (
                          <option key={option.value || 'none'} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={draft.riskLevel}
                        onChange={(event) =>
                          handlePublicationReviewChange(
                            publication,
                            'riskLevel',
                            event.target.value as PublicationReviewDraft['riskLevel']
                          )
                        }
                        className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none'
                        aria-label={`Risk level for ${publication.title}`}
                      >
                        {PUBLICATION_RISK_OPTIONS.map((option) => (
                          <option key={option.value || 'none'} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={publication.reviewer?.userId ?? ''}
                        onChange={(event) =>
                          void handlePublicationReviewerAssignment(
                            publication,
                            event.target.value || null
                          )
                        }
                        className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none'
                        aria-label={`Reviewer for ${publication.title}`}
                        disabled={updatePublicationReview.isPending}
                      >
                        <option value=''>Unassigned reviewer</option>
                        {rosterMembers.map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {formatRosterMemberLabel(member)}
                          </option>
                        ))}
                      </select>
                      <div className='text-[11px] text-[var(--text-muted)] sm:col-span-3'>
                        Reviewer:{' '}
                        {formatRosterMemberLabel(
                          rosterMembers.find(
                            (member) => member.userId === publication.reviewer?.userId
                          ),
                          publication.reviewer?.userId
                        )}
                      </div>
                    </div>
                    <div className='flex flex-wrap items-center gap-2 xl:justify-end'>
                      <button
                        type='button'
                        className={buttonVariants({ size: 'sm', variant: 'default' })}
                        onClick={() => setSelectedPublicationId(publication.id)}
                      >
                        Details
                      </button>
                      <button
                        type='button'
                        className={buttonVariants({ size: 'sm', variant: 'default' })}
                        disabled={!hasReviewChanges || updatePublicationReview.isPending}
                        onClick={() => void handleSavePublicationReview(publication)}
                      >
                        {updatePublicationReview.isPending ? (
                          <Loader className='mr-2 h-[13px] w-[13px]' animate />
                        ) : null}
                        Save review
                      </button>
                      <button
                        type='button'
                        className={buttonVariants({ size: 'sm', variant: 'default' })}
                        disabled={!canArchive || updatePublicationLifecycle.isPending}
                        onClick={() => void handlePublicationLifecycle(publication, 'archive')}
                      >
                        Archive
                      </button>
                      <button
                        type='button'
                        className={buttonVariants({ size: 'sm', variant: 'default' })}
                        disabled={!canRestore || updatePublicationLifecycle.isPending}
                        onClick={() => void handlePublicationLifecycle(publication, 'restore')}
                      >
                        Restore
                      </button>
                      <button
                        type='button'
                        className={cn(
                          buttonVariants({ size: 'sm', variant: 'default' }),
                          'border-red-500/30 text-red-500 hover:bg-red-500/10'
                        )}
                        disabled={!canRetract || updatePublicationLifecycle.isPending}
                        onClick={() => void handlePublicationLifecycle(publication, 'retract')}
                      >
                        Retract
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>

        <section className='grid gap-5 xl:grid-cols-2'>
          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
              <Users className='h-[15px] w-[15px] text-[var(--text-icon)]' />
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                  Create project team
                </h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  Organization admins can create a discipline team with its team canvas and default
                  workflow graph.
                </p>
              </div>
            </div>
            <div className='grid gap-2 p-4 md:grid-cols-[minmax(0,1fr)_220px_auto] xl:grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_220px_auto]'>
              <input
                value={newTeamName}
                onChange={(event) => {
                  setNewTeamName(event.target.value)
                  setCreateTeamStatus(null)
                }}
                placeholder='Team name, e.g. Lighting show control'
                className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[13px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-muted)]'
              />
              <select
                value={selectedNewTeamDisciplineId}
                onChange={(event) => {
                  setNewTeamDisciplineId(event.target.value)
                  setCreateTeamStatus(null)
                }}
                className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
              >
                {disciplines.length === 0 ? (
                  <option value=''>No discipline available</option>
                ) : (
                  disciplines.map((discipline) => (
                    <option key={discipline.id} value={discipline.id}>
                      {discipline.name}
                    </option>
                  ))
                )}
              </select>
              <button
                type='button'
                className={buttonVariants({ variant: 'primary' })}
                disabled={!canCreateTeam}
                onClick={() => void handleCreateTeam()}
              >
                {createWorkgroup.isPending ? (
                  <Loader className='mr-2 h-[14px] w-[14px]' animate />
                ) : null}
                Create team
              </button>
            </div>
            {createTeamStatus && (
              <div
                className='border-[var(--border)] border-t px-4 py-3 text-[12px] text-[var(--text-muted)]'
                aria-live='polite'
              >
                {createTeamStatus}
              </div>
            )}
          </div>

          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
              <Users className='h-[15px] w-[15px] text-[var(--text-icon)]' />
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                  Assign project member
                </h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  Pick from the organization roster, or enter an existing user email or ID.
                </p>
              </div>
            </div>
            <div className='grid gap-2 p-4'>
              <select
                value={selectedRosterUserId}
                onChange={(event) => {
                  const userId = event.target.value
                  const member = rosterMembers.find((item) => item.userId === userId)
                  const recommendedTeam = buildRecommendedAssignmentTeams(
                    member,
                    organizationWorkgroups
                  )[0]
                  setSelectedRosterUserId(userId)
                  setAssignmentValue(member?.email ?? '')
                  if (recommendedTeam) setAssignmentTeamId(recommendedTeam.id)
                  setAssignmentStatus(null)
                }}
                className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
              >
                <option value=''>
                  {isLoadingOrganizationRoster ? 'Loading organization roster...' : 'Manual entry'}
                </option>
                {rosterMembers.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name || member.email} / {member.email}
                  </option>
                ))}
              </select>
              <div className='grid gap-2 md:grid-cols-[minmax(0,1fr)_160px_130px_auto] xl:grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_160px_130px_auto]'>
                <input
                  value={assignmentValue}
                  onChange={(event) => {
                    const value = event.target.value
                    const member = getAssignmentCandidateMember(rosterMembers, '', value)
                    const recommendedTeam = buildRecommendedAssignmentTeams(
                      member,
                      organizationWorkgroups
                    )[0]
                    setAssignmentValue(value)
                    setSelectedRosterUserId('')
                    if (recommendedTeam) setAssignmentTeamId(recommendedTeam.id)
                    setAssignmentStatus(null)
                  }}
                  placeholder='User email or ID'
                  className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[13px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-muted)]'
                />
                <select
                  value={selectedAssignmentTeamId}
                  onChange={(event) => {
                    setAssignmentTeamId(event.target.value)
                    setAssignmentStatus(null)
                    setBatchAssignmentResults([])
                    setBatchImportStatus(null)
                  }}
                  className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
                >
                  {organizationWorkgroups.length === 0 ? (
                    <option value=''>No team available</option>
                  ) : (
                    organizationWorkgroups.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))
                  )}
                </select>
                <select
                  value={assignmentRole}
                  onChange={(event) => {
                    setAssignmentRole(event.target.value as 'member' | 'admin')
                    setAssignmentStatus(null)
                    setBatchAssignmentResults([])
                    setBatchImportStatus(null)
                  }}
                  className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
                >
                  <option value='member'>Member</option>
                  <option value='admin'>Team admin</option>
                </select>
                <button
                  type='button'
                  className={buttonVariants({ variant: 'primary' })}
                  disabled={!canAssignMember}
                  onClick={() => void handleAssignMember()}
                >
                  {addWorkgroupMember.isPending ? (
                    <Loader className='mr-2 h-[14px] w-[14px]' animate />
                  ) : null}
                  Assign
                </button>
              </div>
              <div className='text-[11px] text-[var(--text-muted)]'>
                {rosterMembers.length} organization member{rosterMembers.length === 1 ? '' : 's'}{' '}
                available for project team assignment.
              </div>
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div>
                    <div className='font-medium text-[12px] text-[var(--text-primary)]'>
                      Smart team suggestion
                    </div>
                    <p className='text-[11px] text-[var(--text-muted)]'>
                      {selectedRosterMember
                        ? recommendedAssignmentTeam
                          ? `${selectedRosterMember.name || selectedRosterMember.email} has no access to ${recommendedAssignmentTeam.name}; it is the least staffed eligible team.`
                          : `${selectedRosterMember.name || selectedRosterMember.email} already has access to every initialized team canvas.`
                        : 'Select or type a roster member to suggest the least staffed team they do not already access.'}
                    </p>
                  </div>
                  <button
                    type='button'
                    className={buttonVariants({ variant: 'default' })}
                    disabled={!recommendedAssignmentTeam}
                    onClick={() => {
                      if (!recommendedAssignmentTeam) return
                      setAssignmentTeamId(recommendedAssignmentTeam.id)
                      setAssignmentStatus(null)
                    }}
                  >
                    Use suggestion
                  </button>
                </div>
                {recommendedAssignmentTeams.length > 1 && (
                  <div className='mt-2 flex flex-wrap gap-2'>
                    {recommendedAssignmentTeams.slice(0, 4).map((team) => (
                      <button
                        key={team.id}
                        type='button'
                        className='rounded-[8px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-1)] hover:text-[var(--text-primary)]'
                        onClick={() => {
                          setAssignmentTeamId(team.id)
                          setAssignmentStatus(null)
                        }}
                      >
                        {team.name} / {team.disciplineName} / {team.memberCount} member
                        {team.memberCount === 1 ? '' : 's'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className='grid gap-2 border-[var(--border)] border-t pt-3'>
                <div>
                  <div className='font-medium text-[12px] text-[var(--text-primary)]'>
                    Batch assign
                  </div>
                  <p className='text-[11px] text-[var(--text-muted)]'>
                    Paste emails or user IDs separated by commas, spaces, or new lines. Batch uses
                    the selected team and role above.
                  </p>
                </div>
                <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <div>
                      <div className='font-medium text-[12px] text-[var(--text-primary)]'>
                        Suggested batch
                      </div>
                      <p className='text-[11px] text-[var(--text-muted)]'>
                        {selectedAssignmentTeam?.teamWorkspaceId
                          ? `${suggestedAssignmentMembers.length} roster member${
                              suggestedAssignmentMembers.length === 1 ? '' : 's'
                            } without ${selectedAssignmentTeam.name} team canvas access.`
                          : 'Selected team has no team canvas access map yet.'}
                      </p>
                    </div>
                    <button
                      type='button'
                      className={buttonVariants({ variant: 'default' })}
                      disabled={suggestedAssignmentMembers.length === 0}
                      onClick={handleLoadSuggestedAssignments}
                    >
                      Load suggestions
                    </button>
                  </div>
                  {suggestedAssignmentMembers.length > 0 && (
                    <div className='mt-2 truncate text-[11px] text-[var(--text-muted)]'>
                      {suggestedAssignmentMembers
                        .slice(0, 3)
                        .map((member) => member.name || member.email)
                        .join(', ')}
                      {suggestedAssignmentMembers.length > 3
                        ? ` +${suggestedAssignmentMembers.length - 3} more`
                        : ''}
                    </div>
                  )}
                </div>
                <textarea
                  value={batchAssignmentValue}
                  onChange={(event) => {
                    setBatchAssignmentValue(event.target.value)
                    setBatchAssignmentResults([])
                    setBatchImportStatus(null)
                    setAssignmentStatus(null)
                  }}
                  placeholder={'alice@example.com\nbob@example.com'}
                  className='min-h-[76px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[13px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-muted)]'
                />
                <div className='flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                  <div>
                    <div className='font-medium text-[12px] text-[var(--text-primary)]'>
                      Import from file
                    </div>
                    <p className='text-[11px] text-[var(--text-muted)]'>
                      Upload a CSV, TSV, or TXT file with email or user ID values.
                    </p>
                  </div>
                  <label className={buttonVariants({ variant: 'default' })}>
                    Choose file
                    <input
                      type='file'
                      accept='.csv,.tsv,.txt,text/csv,text/plain'
                      className='sr-only'
                      onChange={(event) => void handleImportBatchAssignments(event)}
                    />
                  </label>
                </div>
                {batchImportStatus && (
                  <div className='text-[11px] text-[var(--text-muted)]' aria-live='polite'>
                    {batchImportStatus}
                  </div>
                )}
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <span className='text-[11px] text-[var(--text-muted)]'>
                    {batchAssignmentTargets.length} unique target
                    {batchAssignmentTargets.length === 1 ? '' : 's'} parsed.
                  </span>
                  <button
                    type='button'
                    className={buttonVariants({ variant: 'primary' })}
                    disabled={!canBatchAssignMembers}
                    onClick={() => void handleBatchAssignMembers()}
                  >
                    {batchAddWorkgroupMembers.isPending ? (
                      <Loader className='mr-2 h-[14px] w-[14px]' animate />
                    ) : null}
                    Assign batch transaction
                  </button>
                </div>
                {batchAssignmentResults.length > 0 && (
                  <div className='grid gap-2'>
                    {batchAssignmentResults.map((result) => (
                      <div
                        key={result.target}
                        className={cn(
                          'rounded-[8px] border px-3 py-2 text-[12px]',
                          result.status === 'assigned'
                            ? 'border-green-500/25 bg-green-500/10 text-green-700'
                            : 'border-red-500/25 bg-red-500/10 text-red-700'
                        )}
                      >
                        <span className='font-medium'>{result.target}</span> / {result.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {assignmentStatus && (
              <div
                className='border-[var(--border)] border-t px-4 py-3 text-[12px] text-[var(--text-muted)]'
                aria-live='polite'
              >
                {assignmentStatus}
              </div>
            )}
          </div>
        </section>

        <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
          <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
            <Network className='h-[15px] w-[15px] text-[var(--text-icon)]' />
            <div>
              <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                Discipline and Agent coverage
              </h2>
              <p className='text-[12px] text-[var(--text-muted)]'>
                Discipline-level coverage after project team and member operations.
              </p>
            </div>
          </div>
          <div className='divide-y divide-[var(--border)]'>
            {disciplineRows.length === 0 ? (
              <EmptyState>No discipline definitions are available.</EmptyState>
            ) : (
              disciplineRows.map((row) => (
                <div
                  key={row.discipline.id}
                  className='grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]'
                >
                  <div className='min-w-0'>
                    <div className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                      {row.discipline.name}
                    </div>
                    <div className='truncate text-[12px] text-[var(--text-muted)]'>
                      {row.discipline.code}
                    </div>
                  </div>
                  <div className='min-w-0'>
                    <div className='flex items-center gap-2 text-[13px] text-[var(--text-body)]'>
                      <Sparkles className='h-[14px] w-[14px] text-[var(--text-icon)]' />
                      <span className='truncate'>{row.agentName}</span>
                    </div>
                    <div className='text-[12px] text-[var(--text-muted)]'>
                      {row.teamCount} team{row.teamCount === 1 ? '' : 's'} / {row.memberCount}{' '}
                      member{row.memberCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className='flex flex-wrap items-center gap-2 md:justify-end'>
                    <span className='rounded-[8px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
                      {row.currentPublicationCount} current
                    </span>
                    {row.riskCount > 0 && (
                      <span className='rounded-[8px] border border-red-500/30 px-2 py-1 text-[11px] text-red-500'>
                        {row.riskCount} critical
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
          <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
            <Sparkles className='h-[15px] w-[15px] text-[var(--text-icon)]' />
            <div>
              <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                Project Agent templates
              </h2>
              <p className='text-[12px] text-[var(--text-muted)]'>
                Add project-wide instructions that are appended to each discipline Agent prompt.
              </p>
            </div>
          </div>
          <div className='grid gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)]'>
            <div className='grid gap-2'>
              <label
                htmlFor='project-agent-template'
                className='font-medium text-[12px] text-[var(--text-primary)]'
              >
                Agent
              </label>
              <select
                id='project-agent-template'
                value={selectedAgentTemplateCodeValue}
                onChange={(event) => {
                  setSelectedAgentTemplateCode(event.target.value)
                  setAgentTemplateStatus(null)
                }}
                className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
              >
                {agentTemplates.length === 0 ? (
                  <option value=''>No Agent template available</option>
                ) : (
                  agentTemplates.map((template) => (
                    <option key={template.code} value={template.code}>
                      {template.name}
                    </option>
                  ))
                )}
              </select>
              {selectedAgentTemplate && (
                <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px] text-[var(--text-muted)]'>
                  <div className='font-medium text-[var(--text-primary)]'>
                    {selectedAgentTemplate.disciplineCodes.length} discipline
                    {selectedAgentTemplate.disciplineCodes.length === 1 ? '' : 's'}
                  </div>
                  <div className='mt-1'>
                    {selectedAgentTemplate.disciplineCodes.length > 0
                      ? selectedAgentTemplate.disciplineCodes.join(', ')
                      : 'No discipline currently maps to this Agent.'}
                  </div>
                </div>
              )}
            </div>
            <div className='grid gap-3'>
              <div>
                <div className='font-medium text-[12px] text-[var(--text-primary)]'>
                  Base system prompt
                </div>
                <p className='mt-1 line-clamp-3 text-[12px] text-[var(--text-muted)]'>
                  {selectedAgentTemplate?.defaultSystemPrompt ?? 'Select an Agent template.'}
                </p>
              </div>
              <textarea
                value={selectedAgentTemplateDraft}
                onChange={(event) => {
                  setAgentTemplateDrafts((drafts) => ({
                    ...drafts,
                    [selectedAgentTemplateCodeValue]: event.target.value,
                  }))
                  setAgentTemplateStatus(null)
                }}
                placeholder='Project-wide constraints, tone, safety checks, delivery standards, or review priorities for this Agent.'
                className='min-h-[120px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[13px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-muted)]'
                disabled={!selectedAgentTemplate}
              />
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <span className='text-[11px] text-[var(--text-muted)]'>
                  {selectedAgentTemplateDraft.trim().length}/4000 characters used.
                </span>
                <button
                  type='button'
                  className={buttonVariants({ variant: 'primary' })}
                  disabled={!canSaveAgentTemplate}
                  onClick={() => void handleSaveAgentTemplate()}
                >
                  {updateAgentTemplate.isPending ? (
                    <Loader className='mr-2 h-[14px] w-[14px]' animate />
                  ) : null}
                  Save Agent template
                </button>
              </div>
              {agentTemplateStatus && (
                <div className='text-[12px] text-[var(--text-muted)]' aria-live='polite'>
                  {agentTemplateStatus}
                </div>
              )}
              {selectedAgentPolicyImpact && (
                <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                  <div className='flex items-start justify-between gap-3'>
                    <div>
                      <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                        Agent policy impact preview
                      </h3>
                      <p className='mt-1 text-[12px] text-[var(--text-muted)]'>
                        Estimate which disciplines, team canvases, current publications, and project
                        skill defaults would be affected by this Agent policy.
                      </p>
                    </div>
                    <ShieldCheck className='h-[15px] w-[15px] text-[var(--text-muted)]' />
                  </div>
                  <div className='mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4'>
                    <ImpactMetric
                      label='Matching teams'
                      value={selectedAgentPolicyImpact.teams.length}
                      detail={`${selectedAgentPolicyImpact.disciplineNames.length} discipline${
                        selectedAgentPolicyImpact.disciplineNames.length === 1 ? '' : 's'
                      } use this Agent.`}
                    />
                    <ImpactMetric
                      label='Current publications'
                      value={selectedAgentPolicyImpact.currentPublications.length}
                      detail={`${selectedAgentPolicyImpact.unapprovedPublications.length} not approved.`}
                      tone={
                        selectedAgentPolicyImpact.unapprovedPublications.length > 0
                          ? 'warning'
                          : 'default'
                      }
                    />
                    <ImpactMetric
                      label='Critical risk'
                      value={selectedAgentPolicyImpact.riskPublications.length}
                      detail='Current publications marked critical.'
                      tone={
                        selectedAgentPolicyImpact.riskPublications.length > 0 ? 'danger' : 'default'
                      }
                    />
                    <ImpactMetric
                      label='Prompt delta'
                      value={
                        selectedAgentPolicyImpact.promptCharacterDelta === 0
                          ? '0'
                          : `${
                              selectedAgentPolicyImpact.promptCharacterDelta > 0 ? '+' : ''
                            }${selectedAgentPolicyImpact.promptCharacterDelta}`
                      }
                      detail={
                        selectedAgentPolicyImpact.promptChanged
                          ? 'Draft differs from saved instructions.'
                          : 'Draft matches saved instructions.'
                      }
                      tone={selectedAgentPolicyImpact.promptChanged ? 'warning' : 'default'}
                    />
                  </div>
                  <div className='mt-3 grid gap-3 lg:grid-cols-3'>
                    <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2'>
                      <div className='font-medium text-[11px] text-[var(--text-primary)]'>
                        Affected disciplines
                      </div>
                      <div className='mt-1 text-[11px] text-[var(--text-muted)]'>
                        {selectedAgentPolicyImpact.disciplineNames.length > 0
                          ? selectedAgentPolicyImpact.disciplineNames.join(', ')
                          : 'No discipline currently maps to this Agent.'}
                      </div>
                    </div>
                    <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2'>
                      <div className='font-medium text-[11px] text-[var(--text-primary)]'>
                        Team canvases
                      </div>
                      <div className='mt-1 grid gap-1 text-[11px] text-[var(--text-muted)]'>
                        {selectedAgentPolicyImpact.teams.length === 0 ? (
                          <span>No active team canvas uses this Agent.</span>
                        ) : (
                          selectedAgentPolicyImpact.teams.slice(0, 4).map((team) => (
                            <span key={team.id}>
                              {team.name} / {team.memberCount} member
                              {team.memberCount === 1 ? '' : 's'}
                            </span>
                          ))
                        )}
                        {selectedAgentPolicyImpact.teams.length > 4 && (
                          <span>+{selectedAgentPolicyImpact.teams.length - 4} more teams</span>
                        )}
                      </div>
                    </div>
                    <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2'>
                      <div className='font-medium text-[11px] text-[var(--text-primary)]'>
                        Skill default posture
                      </div>
                      <div className='mt-1 text-[11px] text-[var(--text-muted)]'>
                        {selectedAgentPolicyImpact.enabledPolicies.length} enabled /{' '}
                        {selectedAgentPolicyImpact.disabledPolicies.length} disabled defaults.
                      </div>
                      {selectedAgentPolicyImpact.disabledPolicies.length > 0 && (
                        <div className='mt-1 line-clamp-2 text-[11px] text-amber-500'>
                          Disabled:{' '}
                          {selectedAgentPolicyImpact.disabledPolicies
                            .slice(0, 3)
                            .map((policy) => `${policy.name} (${policy.sourceWorkgroup.name})`)
                            .join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className='border-[var(--border)] border-t p-4'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div>
                <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                  Project Agent skill policies
                </h3>
                <p className='mt-1 text-[12px] text-[var(--text-muted)]'>
                  Set the default skill availability for this Agent across matching team canvases.
                  Team admins can still apply local overrides from Team management.
                </p>
              </div>
              <span className='rounded-[8px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
                {agentSkillPolicies.filter((policy) => !policy.enabled).length} disabled defaults
              </span>
            </div>
            {agentSkillPolicyStatus && (
              <div className='mt-3 text-[12px] text-[var(--text-muted)]' aria-live='polite'>
                {agentSkillPolicyStatus}
              </div>
            )}
            {agentSkillPolicyCopyGroups.length > 0 && (
              <div className='mt-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div>
                    <div className='font-medium text-[12px] text-[var(--text-primary)]'>
                      Cross-team copy candidates
                    </div>
                    <p className='mt-1 text-[11px] text-[var(--text-muted)]'>
                      Repeated skill names can be copied across matching team canvases from any row
                      below. Only teams whose default differs are updated.
                    </p>
                  </div>
                  <span className='rounded-[8px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
                    {agentSkillPolicyCopyGroups.length} grouped skills
                  </span>
                </div>
                <div className='mt-2 grid gap-2 md:grid-cols-2'>
                  {agentSkillPolicyCopyGroups.slice(0, 4).map((group) => (
                    <div
                      key={group.name}
                      className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2'
                    >
                      <div className='truncate font-medium text-[12px] text-[var(--text-primary)]'>
                        {group.name}
                      </div>
                      <div className='mt-1 text-[11px] text-[var(--text-muted)]'>
                        {group.enabled} enabled / {group.disabled} disabled across {group.total}{' '}
                        team canvas skills.
                      </div>
                      <div className='mt-1 line-clamp-1 text-[11px] text-[var(--text-muted)]'>
                        {group.teams.join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {agentSkillRiskGuardrails.length > 0 && (
              <div className='mt-3 rounded-[8px] border border-amber-500/30 bg-amber-500/10 p-3'>
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div>
                    <div className='font-medium text-[12px] text-[var(--text-primary)]'>
                      Risk skill guardrails
                    </div>
                    <p className='mt-1 max-w-[760px] text-[11px] text-[var(--text-muted)]'>
                      These enabled project-default skills match risky action keywords. Disable them
                      by default when the Agent is in review or carrying critical publication risk.
                    </p>
                  </div>
                  <button
                    type='button'
                    className={buttonVariants({ size: 'sm', variant: 'default' })}
                    disabled={updateAgentSkillPolicy.isPending}
                    onClick={() => void handleDisableRiskSkillDefaults()}
                  >
                    Disable risky defaults ({agentSkillRiskGuardrails.length})
                  </button>
                </div>
                <div className='mt-2 grid gap-2'>
                  {agentSkillRiskGuardrails.slice(0, 4).map((guardrail) => (
                    <div
                      key={`${guardrail.policy.sourceWorkgroup.id}:${guardrail.policy.skillId}`}
                      className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2'
                    >
                      <div className='flex flex-wrap items-center gap-2'>
                        <span className='font-medium text-[12px] text-[var(--text-primary)]'>
                          {guardrail.policy.name}
                        </span>
                        <span
                          className={cn(
                            'rounded-[6px] border px-1.5 py-0.5 font-medium text-[10px]',
                            guardrail.tone === 'danger'
                              ? 'border-red-500/30 bg-red-500/10 text-red-500'
                              : 'border-amber-500/30 bg-amber-500/10 text-amber-500'
                          )}
                        >
                          {guardrail.matchedTerms.join(', ')}
                        </span>
                      </div>
                      <p className='mt-1 text-[11px] text-[var(--text-muted)]'>
                        {guardrail.reason}
                      </p>
                      <div className='mt-1 text-[11px] text-[var(--text-muted)]'>
                        {guardrail.policy.sourceWorkgroup.name}
                      </div>
                    </div>
                  ))}
                  {agentSkillRiskGuardrails.length > 4 && (
                    <div className='text-[11px] text-[var(--text-muted)]'>
                      +{agentSkillRiskGuardrails.length - 4} more risky defaults will be disabled by
                      the bulk action.
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className='mt-3 grid gap-2'>
              {isLoadingAgentSkillPolicies ? (
                <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
                  <Loader className='h-[13px] w-[13px]' animate />
                  Loading project skill policies...
                </div>
              ) : agentSkillPolicies.length === 0 ? (
                <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px] text-[var(--text-muted)]'>
                  No team canvas skills are available for this Agent yet.
                </div>
              ) : (
                agentSkillPolicies.map((policy) => (
                  <div
                    key={`${policy.sourceWorkgroup.id}:${policy.skillId}`}
                    className='grid gap-2'
                  >
                    <div className='grid gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 md:grid-cols-[minmax(0,1fr)_auto]'>
                      <div className='min-w-0'>
                        <div className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                          {policy.name}
                        </div>
                        <div className='mt-1 text-[12px] text-[var(--text-muted)]'>
                          {policy.description || 'No description provided.'}
                        </div>
                        <div className='mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]'>
                          <span>{policy.sourceWorkgroup.name}</span>
                          <span>{policy.enabled ? 'Default enabled' : 'Default disabled'}</span>
                        </div>
                      </div>
                      <div className='flex flex-wrap items-center gap-2 md:justify-end'>
                        <button
                          type='button'
                          className={buttonVariants({ size: 'sm', variant: 'default' })}
                          disabled={!policy.enabled || updateAgentSkillPolicy.isPending}
                          onClick={() => void handleUpdateAgentSkillPolicy(policy, false)}
                        >
                          Disable default
                        </button>
                        <button
                          type='button'
                          className={buttonVariants({ size: 'sm', variant: 'default' })}
                          disabled={policy.enabled || updateAgentSkillPolicy.isPending}
                          onClick={() => void handleUpdateAgentSkillPolicy(policy, true)}
                        >
                          Enable default
                        </button>
                        <button
                          type='button'
                          className={buttonVariants({ size: 'sm', variant: 'secondary' })}
                          disabled={
                            getAgentSkillPolicyCopyTargets(policy, agentSkillPolicies).length ===
                              0 || updateAgentSkillPolicy.isPending
                          }
                          onClick={() => void handleCopyAgentSkillPolicyAcrossTeams(policy)}
                        >
                          Copy to matches (
                          {getAgentSkillPolicyCopyTargets(policy, agentSkillPolicies).length})
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className='grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.6fr)]'>
          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
              <Users className='h-[15px] w-[15px] text-[var(--text-icon)]' />
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>Teams</h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  Organization-level team inventory with member counts and archive controls.
                </p>
              </div>
            </div>
            {archiveTeamStatus && (
              <div
                className='border-[var(--border)] border-b px-4 py-3 text-[12px] text-[var(--text-muted)]'
                aria-live='polite'
              >
                {archiveTeamStatus}
              </div>
            )}
            <div className='divide-y divide-[var(--border)]'>
              {organizationWorkgroups.length === 0 ? (
                <EmptyState>No teams have been created for this organization.</EmptyState>
              ) : (
                organizationWorkgroups.map((team) => (
                  <div
                    key={team.id}
                    className='grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto]'
                  >
                    <div className='min-w-0'>
                      <div className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                        {team.name}
                      </div>
                      <div className='truncate text-[12px] text-[var(--text-muted)]'>
                        {team.disciplineName} / {getAgentName(team.agentCode, agents)}
                      </div>
                    </div>
                    <span className='rounded-[8px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
                      {team.memberCount} member{team.memberCount === 1 ? '' : 's'}
                    </span>
                    <div className='flex flex-wrap items-center gap-2 md:justify-end'>
                      {team.teamWorkspaceId ? (
                        <Link
                          className={cn(
                            buttonVariants({ size: 'sm', variant: 'default' }),
                            'h-[30px]'
                          )}
                          href={`/workspace/${team.teamWorkspaceId}/team-management`}
                        >
                          Manage
                        </Link>
                      ) : (
                        <span className='rounded-[8px] border border-amber-500/30 px-2 py-1 text-[11px] text-amber-500'>
                          Needs canvas
                        </span>
                      )}
                      <button
                        type='button'
                        className={cn(
                          buttonVariants({ size: 'sm', variant: 'default' }),
                          'h-[30px] border-red-500/30 text-red-500 hover:bg-red-500/10'
                        )}
                        disabled={archiveWorkgroup.isPending}
                        onClick={() => void handleArchiveTeam(team)}
                      >
                        {archiveWorkgroup.isPending ? (
                          <Loader className='mr-2 h-[13px] w-[13px]' animate />
                        ) : (
                          <Archive className='mr-2 h-[13px] w-[13px]' />
                        )}
                        Archive
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className='grid gap-5'>
            <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
              <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
                <Compass className='h-[15px] w-[15px] text-[var(--text-icon)]' />
                <div>
                  <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                    Governance watchlist
                  </h2>
                  <p className='text-[12px] text-[var(--text-muted)]'>
                    Risks, review gaps, state-tree conflicts, and canvas setup.
                  </p>
                </div>
              </div>
              <div className='grid gap-3 p-4'>
                {criticalPublicationCount === 0 &&
                unreviewedPublicationCount === 0 &&
                publicationGovernanceAlertCount === 0 &&
                publicationReviewNotifications.length === 0 &&
                publicationDependencyConflictAlerts.length === 0 &&
                teamsWithoutCanvas.length === 0 ? (
                  <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-muted)]'>
                    No project-level watchlist items in the currently visible data.
                  </div>
                ) : (
                  <>
                    {criticalPublicationCount > 0 && (
                      <div className='rounded-[8px] border border-red-500/30 bg-red-500/10 p-3'>
                        <div className='flex items-center gap-2 text-[13px] text-red-500'>
                          <AlertTriangle className='h-[14px] w-[14px]' />
                          {criticalPublicationCount} critical-risk showcase version
                          {criticalPublicationCount === 1 ? '' : 's'}
                        </div>
                      </div>
                    )}
                    {unreviewedPublicationCount > 0 && (
                      <div className='rounded-[8px] border border-amber-500/30 bg-amber-500/10 p-3'>
                        <div className='flex items-center gap-2 text-[13px] text-amber-500'>
                          <AlertTriangle className='h-[14px] w-[14px]' />
                          {unreviewedPublicationCount} publication
                          {unreviewedPublicationCount === 1 ? '' : 's'} pending review
                        </div>
                      </div>
                    )}
                    {publicationDependencyConflictAlerts.length > 0 && (
                      <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                        <div className='flex items-center gap-2 text-[13px] text-[var(--text-primary)]'>
                          <AlertTriangle className='h-[14px] w-[14px] text-amber-500' />
                          {publicationDependencyConflictAlerts.length} cross-team dependency alert
                          {publicationDependencyConflictAlerts.length === 1 ? '' : 's'}
                        </div>
                        <div className='mt-2 grid gap-2'>
                          {publicationDependencyConflictAlerts.slice(0, 3).map((alert) => (
                            <div
                              key={alert.id}
                              className={cn(
                                'rounded-[8px] border px-2 py-1 text-[11px]',
                                governanceAlertClass(alert.severity)
                              )}
                            >
                              {alert.publicationWorkgroupName} / {alert.dependencyTitle}:{' '}
                              {alert.detail}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {publicationReviewNotifications.length > 0 && (
                      <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                        <div className='flex items-center gap-2 text-[13px] text-[var(--text-primary)]'>
                          <AlertTriangle className='h-[14px] w-[14px] text-amber-500' />
                          {publicationReviewNotifications.length} review notification
                          {publicationReviewNotifications.length === 1 ? '' : 's'}
                        </div>
                        <div className='mt-2 grid gap-2'>
                          {publicationReviewNotifications.slice(0, 3).map((notification) => (
                            <button
                              key={notification.id}
                              type='button'
                              className={cn(
                                'rounded-[8px] border px-2 py-1 text-left text-[11px]',
                                governanceAlertClass(notification.severity)
                              )}
                              onClick={() => setSelectedPublicationId(notification.publicationId)}
                            >
                              {notification.publicationWorkgroupName} /{' '}
                              {notification.publicationTitle}: {notification.actionLabel}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {publicationGovernanceAlertGroups.map((group) => (
                      <div
                        key={group.id}
                        className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'
                      >
                        <div className='font-medium text-[13px] text-[var(--text-primary)]'>
                          {group.sourceDiscipline.name} / {group.sourceWorkgroup.name}
                        </div>
                        <div className='mt-2 grid gap-2'>
                          {group.governanceAlerts.map((alert) => (
                            <div
                              key={alert.code}
                              className={cn(
                                'flex items-center gap-2 rounded-[8px] border px-2 py-1 text-[11px]',
                                governanceAlertClass(alert.severity)
                              )}
                            >
                              <AlertTriangle className='h-[12px] w-[12px]' />
                              {alert.message}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {teamsWithoutCanvas.length > 0 && (
                      <div className='rounded-[8px] border border-amber-500/30 bg-amber-500/10 p-3'>
                        <div className='flex items-center gap-2 text-[13px] text-amber-500'>
                          <AlertTriangle className='h-[14px] w-[14px]' />
                          {teamsWithoutCanvas.length} team
                          {teamsWithoutCanvas.length === 1 ? '' : 's'} missing team canvas
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
              <div className='flex flex-wrap items-start justify-between gap-3 border-[var(--border)] border-b px-4 py-3'>
                <div className='flex items-center gap-2'>
                  <AlertTriangle className='h-[15px] w-[15px] text-[var(--text-icon)]' />
                  <div>
                    <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                      Failure audit
                    </h2>
                    <p className='text-[12px] text-[var(--text-muted)]'>
                      Project-admin operation failures are shown locally and mirrored to server
                      audit when organization context is available.
                    </p>
                  </div>
                </div>
                {projectAdminFailureAuditSummary.total > 0 && (
                  <button
                    type='button'
                    className={cn(buttonVariants({ size: 'sm', variant: 'default' }), 'h-[30px]')}
                    onClick={() => setProjectAdminFailureAudit([])}
                  >
                    <X className='mr-2 h-[13px] w-[13px]' />
                    Clear
                  </button>
                )}
              </div>
              <div className='grid gap-3 p-4'>
                {projectAdminFailureAuditSummary.total === 0 ? (
                  <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-muted)]'>
                    No failed project-admin operations have been recorded in this session.
                  </div>
                ) : (
                  <>
                    <div className='grid gap-2 md:grid-cols-2'>
                      <div className='rounded-[8px] border border-red-500/30 bg-red-500/10 p-3'>
                        <div className='text-[11px] text-red-500'>Failures</div>
                        <div className='mt-1 font-semibold text-[18px] text-red-500'>
                          {projectAdminFailureAuditSummary.total}
                        </div>
                      </div>
                      <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                        <div className='text-[11px] text-[var(--text-muted)]'>Latest</div>
                        <div className='mt-1 truncate font-medium text-[13px] text-[var(--text-primary)]'>
                          {projectAdminFailureAuditSummary.latest?.operation}
                        </div>
                        <div className='truncate text-[11px] text-[var(--text-muted)]'>
                          {projectAdminFailureAuditSummary.latest?.target}
                        </div>
                      </div>
                    </div>
                    <div className='grid grid-cols-2 gap-2 md:grid-cols-3'>
                      {PROJECT_ADMIN_FAILURE_SCOPE_OPTIONS.map((option) => (
                        <div
                          key={option.scope}
                          className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'
                        >
                          <div className='text-[11px] text-[var(--text-muted)]'>{option.label}</div>
                          <div className='font-medium text-[13px] text-[var(--text-primary)]'>
                            {projectAdminFailureAuditSummary.scopeCounts[option.scope]}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className='grid gap-2'>
                      {projectAdminFailureAudit.map((entry) => (
                        <div
                          key={entry.id}
                          className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'
                        >
                          <div className='flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]'>
                            <span className='rounded-[8px] border border-red-500/30 px-2 py-0.5 text-red-500'>
                              {PROJECT_ADMIN_FAILURE_SCOPE_OPTIONS.find(
                                (option) => option.scope === entry.scope
                              )?.label ?? entry.scope}
                            </span>
                            <span>{formatDateTime(entry.occurredAt)}</span>
                          </div>
                          <div className='mt-2 font-medium text-[13px] text-[var(--text-primary)]'>
                            {entry.operation} / {entry.target}
                          </div>
                          <div className='mt-1 text-[12px] text-[var(--text-muted)]'>
                            {entry.message}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
              <div className='grid gap-3 border-[var(--border)] border-b px-4 py-3'>
                <div className='flex items-center gap-2'>
                  <Activity className='h-[15px] w-[15px] text-[var(--text-icon)]' />
                  <div>
                    <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                      Project activity filters
                    </h2>
                    <p className='text-[12px] text-[var(--text-muted)]'>
                      Filter audit-backed activity by team, discipline, action, or actor/resource
                      text.
                    </p>
                  </div>
                </div>
                <div className='grid gap-2 md:grid-cols-2'>
                  <select
                    value={activityTeamId}
                    onChange={(event) => {
                      setActivityTeamId(event.target.value)
                      resetActivityPage()
                    }}
                    className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none'
                  >
                    <option value=''>All teams</option>
                    {organizationWorkgroups.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={activityDisciplineId}
                    onChange={(event) => {
                      setActivityDisciplineId(event.target.value)
                      resetActivityPage()
                    }}
                    disabled={Boolean(activityTeamId)}
                    className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none disabled:opacity-60'
                  >
                    <option value=''>All disciplines</option>
                    {disciplines.map((discipline) => (
                      <option key={discipline.id} value={discipline.id}>
                        {discipline.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={activityAction}
                    onChange={(event) => {
                      setActivityAction(event.target.value)
                      resetActivityPage()
                    }}
                    className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none'
                  >
                    {PROJECT_ACTIVITY_ACTION_OPTIONS.map((option) => (
                      <option key={option.value || 'all'} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={activitySearch}
                    onChange={(event) => {
                      setActivitySearch(event.target.value)
                      resetActivityPage()
                    }}
                    placeholder='Search actor, action, resource...'
                    className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-muted)]'
                  />
                  <input
                    value={activityActor}
                    onChange={(event) => {
                      setActivityActor(event.target.value)
                      resetActivityPage()
                    }}
                    placeholder='Exact actor email or name'
                    className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-muted)]'
                  />
                  <input
                    type='date'
                    value={activityStartDate}
                    max={activityEndDate || undefined}
                    onChange={(event) => {
                      setActivityStartDate(event.target.value)
                      resetActivityPage()
                    }}
                    className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none'
                    aria-label='Project activity start date'
                  />
                  <input
                    type='date'
                    value={activityEndDate}
                    min={activityStartDate || undefined}
                    onChange={(event) => {
                      setActivityEndDate(event.target.value)
                      resetActivityPage()
                    }}
                    className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none'
                    aria-label='Project activity end date'
                  />
                </div>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <span className='text-[11px] text-[var(--text-muted)]'>{activityRangeLabel}</span>
                  <div className='flex flex-wrap items-center gap-2'>
                    <button
                      type='button'
                      className={buttonVariants({ variant: 'default' })}
                      disabled={projectActivity.length === 0}
                      onClick={() => downloadProjectActivityCsv(projectActivity)}
                    >
                      <Download className='mr-2 h-[13px] w-[13px]' />
                      Export page
                    </button>
                    <button
                      type='button'
                      className={buttonVariants({ variant: 'default' })}
                      disabled={!canExportActivity}
                      onClick={() => void handleExportFilteredActivity()}
                    >
                      {isExportingActivity ? (
                        <Loader className='mr-2 h-[13px] w-[13px]' animate />
                      ) : (
                        <Download className='mr-2 h-[13px] w-[13px]' />
                      )}
                      Export filtered
                    </button>
                    <button
                      type='button'
                      className={buttonVariants({ variant: 'default' })}
                      disabled={!hasPreviousActivityPage || isLoadingActivity}
                      onClick={() =>
                        setActivityOffset((currentOffset) =>
                          Math.max(0, currentOffset - PROJECT_ACTIVITY_PAGE_SIZE)
                        )
                      }
                    >
                      Previous
                    </button>
                    <button
                      type='button'
                      className={buttonVariants({ variant: 'default' })}
                      disabled={!hasNextActivityPage || isLoadingActivity}
                      onClick={() => {
                        if (activityData?.nextOffset != null) {
                          setActivityOffset(activityData.nextOffset)
                        }
                      }}
                    >
                      Next
                    </button>
                  </div>
                </div>
                {activityExportStatus && (
                  <div className='text-[11px] text-[var(--text-muted)]' aria-live='polite'>
                    {activityExportStatus}
                  </div>
                )}
              </div>
              <div className='divide-y divide-[var(--border)]'>
                {isLoadingActivity ? (
                  <div className='flex items-center gap-2 px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                    <Loader className='h-[14px] w-[14px]' animate />
                    Loading project activity...
                  </div>
                ) : projectActivity.length === 0 ? (
                  <EmptyState>No activity matches the current project filters.</EmptyState>
                ) : (
                  projectActivity.map((entry) => (
                    <div key={entry.id} className='grid gap-2 px-4 py-3'>
                      <div className='flex min-w-0 items-center justify-between gap-2'>
                        <span className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                          {formatActivityAction(entry.action)}
                        </span>
                        <span className='shrink-0 text-[11px] text-[var(--text-muted)]'>
                          {formatDateTime(entry.createdAt)}
                        </span>
                      </div>
                      <div className='truncate text-[11px] text-[var(--text-muted)]'>
                        {entry.workgroupName ?? 'Project'}{' '}
                        {entry.disciplineName ? `/ ${entry.disciplineName}` : ''}
                      </div>
                      <div className='truncate text-[12px] text-[var(--text-muted)]'>
                        {entry.resourceName ? `${entry.resourceName} / ` : ''}
                        {entry.description?.trim() || 'No additional details'} by{' '}
                        {entry.actorName || entry.actorEmail || 'Unknown actor'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
      {selectedPublication && (
        <div className='fixed inset-0 z-50 flex justify-end bg-black/20'>
          <aside className='flex h-full w-full max-w-[520px] flex-col border-[var(--border)] border-l bg-[var(--bg)] shadow-xl'>
            <div className='flex items-start justify-between gap-3 border-[var(--border)] border-b p-4'>
              <div className='min-w-0'>
                <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
                  <GitBranch className='h-[14px] w-[14px]' />
                  Publication governance drawer
                </div>
                <h2 className='mt-1 truncate font-medium text-[18px] text-[var(--text-primary)]'>
                  {selectedPublication.title}
                </h2>
                <div className='mt-1 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]'>
                  <span>v{selectedPublication.versionNumber}</span>
                  <span>{selectedPublication.status}</span>
                  <span>{selectedPublication.visibility}</span>
                  <span>{selectedPublication.sourceWorkgroup.name}</span>
                </div>
              </div>
              <button
                type='button'
                className={cn(buttonVariants({ size: 'sm', variant: 'default' }), 'h-[30px]')}
                onClick={() => setSelectedPublicationId(null)}
                aria-label='Close publication governance drawer'
              >
                <X className='h-[13px] w-[13px]' />
              </button>
            </div>
            <div className='grid flex-1 gap-4 overflow-auto p-4'>
              <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3'>
                <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                  Governance summary
                </h3>
                <div className='mt-3 grid gap-2 text-[12px] text-[var(--text-muted)]'>
                  <div className='flex items-center justify-between gap-3'>
                    <span>Review</span>
                    <span className='text-[var(--text-primary)]'>
                      {selectedPublication.reviewState ?? 'None'}
                    </span>
                  </div>
                  <div className='flex items-center justify-between gap-3'>
                    <span>Risk</span>
                    <span
                      className={cn(
                        'text-[var(--text-primary)]',
                        selectedPublication.riskLevel === 'critical' && 'text-red-500'
                      )}
                    >
                      {selectedPublication.riskLevel ?? 'None'}
                    </span>
                  </div>
                  <div className='flex items-center justify-between gap-3'>
                    <span>Reviewer</span>
                    <span className='text-right text-[var(--text-primary)]'>
                      {formatRosterMemberLabel(
                        rosterMembers.find(
                          (member) => member.userId === selectedPublication.reviewer?.userId
                        ),
                        selectedPublication.reviewer?.userId
                      )}
                    </span>
                  </div>
                  <div className='flex items-center justify-between gap-3'>
                    <span>Published</span>
                    <span className='text-[var(--text-primary)]'>
                      {formatDateTime(selectedPublication.publishedAt)}
                    </span>
                  </div>
                </div>
              </section>

              <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3'>
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div>
                    <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                      Approval workflow
                    </h3>
                    <p className='mt-1 text-[12px] text-[var(--text-muted)]'>
                      Move this publication through reviewer ownership, in-review state, critical
                      risk triage, and a final approval decision.
                    </p>
                  </div>
                  <select
                    value={selectedPublication.reviewer?.userId ?? ''}
                    onChange={(event) =>
                      void handlePublicationReviewerAssignment(
                        selectedPublication,
                        event.target.value || null
                      )
                    }
                    className='h-[32px] min-w-[220px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text-body)] outline-none'
                    disabled={updatePublicationReview.isPending}
                  >
                    <option value=''>Unassigned reviewer</option>
                    {rosterMembers.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {formatRosterMemberLabel(member)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className='mt-3 grid gap-2'>
                  {selectedPublicationApprovalWorkflow.map((step, index) => (
                    <div
                      key={step.id}
                      className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-2'
                    >
                      <div className='flex flex-wrap items-center gap-2'>
                        <span className='rounded-[6px] border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]'>
                          {index + 1}
                        </span>
                        <span className='font-medium text-[12px] text-[var(--text-primary)]'>
                          {step.title}
                        </span>
                        <span
                          className={cn(
                            'rounded-[6px] border px-1.5 py-0.5 font-medium text-[10px]',
                            step.status === 'complete' &&
                              'border-green-500/30 bg-green-500/10 text-green-500',
                            step.status === 'ready' &&
                              'border-blue-500/30 bg-blue-500/10 text-blue-500',
                            step.status === 'blocked' &&
                              'border-amber-500/30 bg-amber-500/10 text-amber-500'
                          )}
                        >
                          {step.status}
                        </span>
                      </div>
                      <p className='mt-1 text-[11px] text-[var(--text-muted)]'>{step.detail}</p>
                    </div>
                  ))}
                </div>
                <div className='mt-3 flex flex-wrap gap-2'>
                  <button
                    type='button'
                    className={buttonVariants({ size: 'sm', variant: 'default' })}
                    disabled={
                      updatePublicationReview.isPending ||
                      !selectedPublication.reviewer?.userId ||
                      selectedPublication.reviewState === 'in_review' ||
                      selectedPublication.reviewState === 'approved'
                    }
                    onClick={() =>
                      void handlePublicationReviewResolution(
                        selectedPublication,
                        'in_review',
                        selectedPublication.riskLevel,
                        `Started approval review for ${selectedPublication.title}.`
                      )
                    }
                  >
                    Start review
                  </button>
                  <button
                    type='button'
                    className={buttonVariants({ size: 'sm', variant: 'default' })}
                    disabled={
                      updatePublicationReview.isPending ||
                      selectedPublication.riskLevel !== 'critical'
                    }
                    onClick={() =>
                      void handlePublicationReviewResolution(
                        selectedPublication,
                        selectedPublication.reviewState,
                        'high',
                        `Reduced critical risk before approval for ${selectedPublication.title}.`
                      )
                    }
                  >
                    Set risk high
                  </button>
                  <button
                    type='button'
                    className={buttonVariants({ size: 'sm', variant: 'default' })}
                    disabled={
                      updatePublicationReview.isPending ||
                      !selectedPublication.reviewer?.userId ||
                      !['in_review', 'changes_requested', 'rejected'].includes(
                        selectedPublication.reviewState ?? ''
                      ) ||
                      selectedPublication.riskLevel === 'critical'
                    }
                    onClick={() =>
                      void handlePublicationReviewResolution(
                        selectedPublication,
                        'approved',
                        selectedPublication.riskLevel,
                        `Approved ${selectedPublication.title}.`
                      )
                    }
                  >
                    Approve
                  </button>
                  <button
                    type='button'
                    className={buttonVariants({ size: 'sm', variant: 'default' })}
                    disabled={
                      updatePublicationReview.isPending || !selectedPublication.reviewer?.userId
                    }
                    onClick={() =>
                      void handlePublicationReviewResolution(
                        selectedPublication,
                        'changes_requested',
                        selectedPublication.riskLevel,
                        `Requested changes for ${selectedPublication.title}.`
                      )
                    }
                  >
                    Request changes
                  </button>
                  <button
                    type='button'
                    className={buttonVariants({ size: 'sm', variant: 'default' })}
                    disabled={
                      updatePublicationReview.isPending || !selectedPublication.reviewer?.userId
                    }
                    onClick={() =>
                      void handlePublicationReviewResolution(
                        selectedPublication,
                        'rejected',
                        selectedPublication.riskLevel,
                        `Rejected ${selectedPublication.title}.`
                      )
                    }
                  >
                    Reject
                  </button>
                </div>
              </section>

              <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3'>
                <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                  Publication details
                </h3>
                <p className='mt-1 text-[12px] text-[var(--text-muted)]'>
                  Edit the project-facing title and description shown in showcase governance and the
                  published workflow shell.
                </p>
                <div className='mt-3 grid gap-3'>
                  <label className='grid gap-1'>
                    <span className='font-medium text-[11px] text-[var(--text-primary)]'>
                      Title
                    </span>
                    <input
                      value={selectedPublicationDetailDraft.title}
                      onChange={(event) =>
                        handlePublicationDetailDraftChange(
                          selectedPublication,
                          'title',
                          event.target.value
                        )
                      }
                      className='h-[34px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-muted)]'
                      maxLength={160}
                    />
                  </label>
                  <label className='grid gap-1'>
                    <span className='font-medium text-[11px] text-[var(--text-primary)]'>
                      Description
                    </span>
                    <textarea
                      value={selectedPublicationDetailDraft.description}
                      onChange={(event) =>
                        handlePublicationDetailDraftChange(
                          selectedPublication,
                          'description',
                          event.target.value
                        )
                      }
                      className='min-h-[82px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-2 text-[12px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-muted)]'
                      maxLength={2000}
                      placeholder='Describe the governance intent, review notes, or scope of this publication.'
                    />
                  </label>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='text-[11px] text-[var(--text-muted)]'>
                      {selectedPublicationDetailDraft.title.trim().length}/160 title ·{' '}
                      {selectedPublicationDetailDraft.description.trim().length}/2000 description
                    </span>
                    <button
                      type='button'
                      className={buttonVariants({ size: 'sm', variant: 'default' })}
                      disabled={!canSavePublicationDetails}
                      onClick={() => void handleSavePublicationDetails(selectedPublication)}
                    >
                      {updatePublicationDetails.isPending ? (
                        <Loader className='mr-2 h-[13px] w-[13px]' animate />
                      ) : null}
                      Save details
                    </button>
                  </div>
                </div>
              </section>

              <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3'>
                <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                  Conflict detection
                </h3>
                {selectedPublicationGovernanceGroup &&
                selectedPublicationGovernanceGroup.governanceAlerts.length > 0 ? (
                  <div className='mt-3 grid gap-3'>
                    <div className='grid gap-2'>
                      {selectedPublicationGovernanceGroup.governanceAlerts.map((alert) => (
                        <div
                          key={alert.code}
                          className={cn(
                            'flex items-center gap-2 rounded-[8px] border px-2 py-1 text-[12px]',
                            governanceAlertClass(alert.severity)
                          )}
                        >
                          <AlertTriangle className='h-[13px] w-[13px]' />
                          {alert.message}
                        </div>
                      ))}
                    </div>
                    {selectedPublicationRepairGuide.length > 0 && (
                      <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-2'>
                        <div className='font-medium text-[11px] text-[var(--text-primary)]'>
                          Repair guide
                        </div>
                        <div className='mt-2 grid gap-2'>
                          {selectedPublicationRepairGuide.map((step, index) => (
                            <div
                              key={step.alertCode}
                              className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2'
                            >
                              <div className='flex flex-wrap items-center justify-between gap-2'>
                                <div className='flex items-center gap-2'>
                                  <span className='rounded-[6px] border border-[var(--border)] px-1.5 py-0.5 font-medium text-[10px] text-[var(--text-muted)]'>
                                    Step {index + 1}
                                  </span>
                                  <span
                                    className={cn(
                                      'rounded-[6px] border px-1.5 py-0.5 font-medium text-[10px]',
                                      governanceAlertClass(step.severity)
                                    )}
                                  >
                                    {step.actionLabel}
                                  </span>
                                </div>
                              </div>
                              <div className='mt-2 font-medium text-[12px] text-[var(--text-primary)]'>
                                {step.title}
                              </div>
                              <p className='mt-1 text-[11px] text-[var(--text-muted)]'>
                                {step.detail}
                              </p>
                              <p className='mt-1 text-[11px] text-[var(--text-muted)]'>
                                {step.reason}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-2'>
                      <div className='font-medium text-[11px] text-[var(--text-primary)]'>
                        Resolution actions
                      </div>
                      <div className='mt-2 grid gap-2'>
                        {selectedPublicationAlertCodes.has('multiple_current_versions') &&
                          selectedPublicationExtraCurrentVersions.length > 0 && (
                            <div className='grid gap-2'>
                              <div className='text-[11px] text-[var(--text-muted)]'>
                                Keep v{selectedPublicationCurrentVersion?.versionNumber} as the
                                canonical current version and archive duplicate current versions.
                              </div>
                              <div className='flex flex-wrap gap-2'>
                                {selectedPublicationExtraCurrentVersions.map((version) => {
                                  const publication = publications.find(
                                    (item) => item.id === version.id
                                  )
                                  if (!publication) return null
                                  return (
                                    <button
                                      key={version.id}
                                      type='button'
                                      className={buttonVariants({ size: 'sm', variant: 'default' })}
                                      disabled={updatePublicationLifecycle.isPending}
                                      onClick={() =>
                                        void handlePublicationLifecycle(publication, 'archive')
                                      }
                                    >
                                      Archive extra v{version.versionNumber}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        {selectedPublicationAlertCodes.has('no_current_version') &&
                          selectedPublicationRestoreCandidate && (
                            <button
                              type='button'
                              className={buttonVariants({ size: 'sm', variant: 'default' })}
                              disabled={updatePublicationLifecycle.isPending}
                              onClick={() =>
                                void handlePublicationLifecycle(
                                  selectedPublicationRestoreCandidate,
                                  'restore'
                                )
                              }
                            >
                              Restore latest visible version
                            </button>
                          )}
                        {selectedPublicationCurrentSummary &&
                          selectedPublicationAlertCodes.has('unapproved_current_version') && (
                            <button
                              type='button'
                              className={buttonVariants({ size: 'sm', variant: 'default' })}
                              disabled={updatePublicationReview.isPending}
                              onClick={() =>
                                void handlePublicationReviewResolution(
                                  selectedPublicationCurrentSummary,
                                  'approved',
                                  selectedPublicationCurrentSummary.riskLevel,
                                  `Approved current version for ${selectedPublicationGovernanceGroup.sourceWorkgroup.name}.`
                                )
                              }
                            >
                              Approve current version
                            </button>
                          )}
                        {selectedPublicationCurrentSummary &&
                          selectedPublicationAlertCodes.has('stale_current_version') && (
                            <button
                              type='button'
                              className={buttonVariants({ size: 'sm', variant: 'default' })}
                              disabled={updatePublicationReview.isPending}
                              onClick={() =>
                                void handlePublicationReviewResolution(
                                  selectedPublicationCurrentSummary,
                                  'in_review',
                                  selectedPublicationCurrentSummary.riskLevel,
                                  `Started refresh review for ${selectedPublicationGovernanceGroup.sourceWorkgroup.name}.`
                                )
                              }
                            >
                              Start refresh review
                            </button>
                          )}
                        {selectedPublicationCurrentSummary &&
                          selectedPublicationAlertCodes.has('critical_risk_current_version') && (
                            <button
                              type='button'
                              className={buttonVariants({ size: 'sm', variant: 'default' })}
                              disabled={updatePublicationReview.isPending}
                              onClick={() =>
                                void handlePublicationReviewResolution(
                                  selectedPublicationCurrentSummary,
                                  selectedPublicationCurrentSummary.reviewState,
                                  'high',
                                  `Reduced critical risk marker for ${selectedPublicationGovernanceGroup.sourceWorkgroup.name}.`
                                )
                              }
                            >
                              Set risk to high
                            </button>
                          )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className='mt-2 text-[12px] text-[var(--text-muted)]'>
                    No state-tree conflict was detected for this publication group.
                  </p>
                )}
              </section>

              <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3'>
                <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                  Restore impact preview
                </h3>
                <p className='mt-2 text-[12px] text-[var(--text-muted)]'>
                  Restoring this version will make v{selectedPublication.versionNumber} the current
                  published snapshot for {selectedPublication.sourceWorkgroup.name}; existing
                  current versions for the same source workflow are superseded by the service layer.
                </p>
                {selectedPublication.status === 'retracted' && (
                  <div className='mt-3 rounded-[8px] border border-red-500/30 bg-red-500/10 p-2 text-[12px] text-red-500'>
                    Retracted versions cannot be restored or loaded into the state tree preview.
                  </div>
                )}
                {selectedPublication.status !== 'retracted' && (
                  <div className='mt-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'>
                    <div className='border-[var(--border)] border-b px-3 py-2 text-[12px] text-[var(--text-muted)]'>
                      Comparing restore candidate against{' '}
                      {comparisonPublicationId
                        ? `current published version ${comparisonPublicationId}`
                        : 'itself because this is already the current version'}
                      .
                    </div>
                    {isLoadingSnapshotDiff ? (
                      <div className='flex items-center gap-2 p-3 text-[12px] text-[var(--text-muted)]'>
                        <Loader className='h-[13px] w-[13px]' animate />
                        Loading snapshot diff...
                      </div>
                    ) : snapshotDiff ? (
                      <div className='grid gap-3 p-3'>
                        <div className='grid gap-2'>
                          {snapshotDiff.metrics.map((metric) => {
                            const delta = metric.candidate - metric.current
                            return (
                              <div
                                key={metric.label}
                                className='grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-[12px]'
                              >
                                <span className='text-[var(--text-muted)]'>{metric.label}</span>
                                <span
                                  className={cn(
                                    'font-medium text-[var(--text-primary)]',
                                    delta > 0 && 'text-emerald-500',
                                    delta < 0 && 'text-amber-500'
                                  )}
                                >
                                  {metric.candidate} vs {metric.current}
                                  {delta === 0 ? '' : ` (${delta > 0 ? '+' : ''}${delta})`}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                        {(snapshotDiff.candidate.metadataName !==
                          snapshotDiff.current.metadataName ||
                          snapshotDiff.candidate.metadataDescription !==
                            snapshotDiff.current.metadataDescription) && (
                          <div className='rounded-[8px] border border-amber-500/30 bg-amber-500/10 p-2 text-[12px] text-amber-500'>
                            Workflow metadata differs between the restore candidate and current
                            published snapshot.
                          </div>
                        )}
                        {snapshotDiff.blockTypeDiffs.length > 0 ? (
                          <div className='grid gap-1 text-[11px] text-[var(--text-muted)]'>
                            <div className='font-medium text-[var(--text-primary)]'>
                              Block type changes
                            </div>
                            {snapshotDiff.blockTypeDiffs.map((entry) => (
                              <div key={entry.type} className='flex justify-between gap-2'>
                                <span>{entry.type}</span>
                                <span>
                                  {entry.candidate} vs {entry.current}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className='text-[11px] text-[var(--text-muted)]'>
                            No block type count changes detected.
                          </div>
                        )}
                        <div className='grid gap-2'>
                          <div className='flex items-center justify-between gap-2'>
                            <div className='font-medium text-[11px] text-[var(--text-primary)]'>
                              Node-level changes
                            </div>
                            <span className='rounded-[8px] border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]'>
                              {snapshotDiff.nodeLevelDiff.addedBlocks.length +
                                snapshotDiff.nodeLevelDiff.removedBlocks.length +
                                snapshotDiff.nodeLevelDiff.changedBlocks.length}{' '}
                              blocks /{' '}
                              {snapshotDiff.nodeLevelDiff.addedEdges.length +
                                snapshotDiff.nodeLevelDiff.removedEdges.length +
                                snapshotDiff.nodeLevelDiff.changedEdges.length}{' '}
                              edges
                            </span>
                          </div>
                          <div className='grid gap-2 md:grid-cols-3'>
                            <SnapshotDiffRows
                              title='Added blocks'
                              rows={snapshotDiff.nodeLevelDiff.addedBlocks}
                              empty='No added blocks.'
                            />
                            <SnapshotDiffRows
                              title='Removed blocks'
                              rows={snapshotDiff.nodeLevelDiff.removedBlocks}
                              empty='No removed blocks.'
                            />
                            <SnapshotDiffRows
                              title='Changed blocks'
                              rows={snapshotDiff.nodeLevelDiff.changedBlocks}
                              empty='No changed blocks.'
                            />
                          </div>
                          <div className='grid gap-2 md:grid-cols-3'>
                            <SnapshotDiffRows
                              title='Added edges'
                              rows={snapshotDiff.nodeLevelDiff.addedEdges}
                              empty='No added edges.'
                            />
                            <SnapshotDiffRows
                              title='Removed edges'
                              rows={snapshotDiff.nodeLevelDiff.removedEdges}
                              empty='No removed edges.'
                            />
                            <SnapshotDiffRows
                              title='Changed edges'
                              rows={snapshotDiff.nodeLevelDiff.changedEdges}
                              empty='No changed edges.'
                            />
                          </div>
                          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2 text-[11px] text-[var(--text-muted)]'>
                            <span className='font-medium text-[var(--text-primary)]'>
                              Variables changed:
                            </span>{' '}
                            {snapshotDiff.nodeLevelDiff.changedVariables.length > 0
                              ? snapshotDiff.nodeLevelDiff.changedVariables.slice(0, 8).join(', ')
                              : 'None'}
                            {snapshotDiff.nodeLevelDiff.changedVariables.length > 8
                              ? `, +${snapshotDiff.nodeLevelDiff.changedVariables.length - 8} more`
                              : ''}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className='p-3 text-[12px] text-[var(--text-muted)]'>
                        Snapshot diff is unavailable for this publication.
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3'>
                <div className='flex items-start justify-between gap-3'>
                  <div>
                    <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                      Dependency impact preview
                    </h3>
                    <p className='mt-1 text-[12px] text-[var(--text-muted)]'>
                      Preview direct dependency links, downstream publications, same-family links,
                      and review risks before changing this version.
                    </p>
                  </div>
                  <Network className='h-[15px] w-[15px] text-[var(--text-muted)]' />
                </div>
                <div className='mt-3 grid gap-3'>
                  <DependencyImpactList
                    title='Risk flags'
                    empty='No downstream dependency risk flags were found.'
                    rows={selectedPublicationDependencyImpact.riskFlags}
                  />
                  <DependencyImpactList
                    title='Direct dependencies'
                    empty='This publication does not declare direct dependency versions.'
                    rows={selectedPublicationDependencyImpact.directDependencies}
                  />
                  <DependencyImpactList
                    title='Dependent publications'
                    empty='No other visible publication directly depends on this version.'
                    rows={selectedPublicationDependencyImpact.dependentPublications}
                  />
                  {isLoadingSelectedPublicationTree &&
                  selectedPublication.status !== 'retracted' ? (
                    <div className='flex items-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-2 text-[11px] text-[var(--text-muted)]'>
                      <Loader className='h-[12px] w-[12px]' animate />
                      Loading same-family dependency links...
                    </div>
                  ) : (
                    <DependencyImpactList
                      title='Same-family links'
                      empty='No child version or same-family dependency points to this version.'
                      rows={selectedPublicationDependencyImpact.treeLinks}
                    />
                  )}
                </div>
              </section>

              <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
                <div className='border-[var(--border)] border-b p-3'>
                  <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                    Version state tree
                  </h3>
                  <p className='mt-1 text-[12px] text-[var(--text-muted)]'>
                    Visible parent and dependency chain for this publication family.
                  </p>
                </div>
                <div className='divide-y divide-[var(--border)]'>
                  {selectedPublication.status === 'retracted' ? (
                    <EmptyState>
                      State tree is unavailable for retracted publication versions.
                    </EmptyState>
                  ) : isLoadingSelectedPublicationTree ? (
                    <div className='flex items-center gap-2 p-3 text-[12px] text-[var(--text-muted)]'>
                      <Loader className='h-[13px] w-[13px]' animate />
                      Loading state tree...
                    </div>
                  ) : !selectedPublicationTree || selectedPublicationTree.versions.length === 0 ? (
                    <EmptyState>No visible state tree versions were returned.</EmptyState>
                  ) : (
                    selectedPublicationTree.versions.map((version) => (
                      <div
                        key={version.id}
                        className={cn(
                          'grid gap-1 p-3',
                          version.id === selectedPublication.id && 'bg-[var(--surface-2)]'
                        )}
                      >
                        <div className='flex min-w-0 items-center justify-between gap-2'>
                          <span className='truncate font-medium text-[12px] text-[var(--text-primary)]'>
                            v{version.versionNumber} / {version.title}
                          </span>
                          <span className='shrink-0 rounded-[8px] border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]'>
                            {version.status}
                          </span>
                        </div>
                        <div className='text-[11px] text-[var(--text-muted)]'>
                          {version.sourceWorkgroup.name} / {version.sourceDiscipline.name} /{' '}
                          {formatDateTime(version.publishedAt)}
                        </div>
                        <div className='text-[11px] text-[var(--text-muted)]'>
                          Parent: {version.parentVersionId ?? 'None'} / Depends:{' '}
                          {version.dependsOnPublicationIds.length > 0
                            ? version.dependsOnPublicationIds.join(', ')
                            : 'None'}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
