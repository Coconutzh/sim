'use client'

import { useMemo } from 'react'
import { AlertTriangle, Compass, GitBranch, Network, RefreshCw } from 'lucide-react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import type { PublicationSummary } from '@/lib/api/contracts/collaboration'
import {
  buildPublicationStateGroups,
  type PublicationGovernanceAlertSeverity,
} from '@/lib/collaboration/publication-state-tree'
import { cn } from '@/lib/core/utils/cn'
import {
  type ResourceColumn,
  ResourceHeader,
  type ResourceRow,
  ResourceTable,
} from '@/app/workspace/[workspaceId]/components'
import { useShowcasePublications } from '@/hooks/queries/collaboration'
import {
  type PublishedWorkflowView,
  usePublishedWorkflowsForWorkgroup,
} from '@/hooks/queries/workflows'
import { useWorkspaceSettings } from '@/hooks/queries/workspace'

const PUBLISHED_COLUMNS: ResourceColumn[] = [
  { id: 'workflow', header: 'Workflow', widthMultiplier: 1.15 },
  { id: 'workspace', header: 'Team Workspace' },
  { id: 'visibility', header: 'Visibility' },
  { id: 'publishedAt', header: 'Published' },
] as const

const STATE_TREE_PUBLICATION_FILTERS = { limit: 100 } as const

function formatPublishedAt(value: Date | null | undefined): string {
  if (!value) {
    return 'Never'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

function formatPublicationDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatPublicationStatus(status: PublicationSummary['status']): string {
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'published':
      return 'Current'
    case 'superseded':
      return 'Superseded'
    case 'archived':
      return 'Archived'
    case 'retracted':
      return 'Retracted'
  }
}

function formatVisibility(visibility: PublishedWorkflowView['visibility']): string {
  switch (visibility) {
    case 'workspace':
      return 'Owner workspace only'
    case 'selected_workgroups':
      return 'Selected workgroups'
    default:
      return 'Organization'
  }
}

function formatPublicationVisibility(visibility: PublicationSummary['visibility']): string {
  return visibility === 'selected_workgroups' ? 'Selected teams' : 'Organization'
}

function formatPublicationReviewState(reviewState: PublicationSummary['reviewState']): string {
  switch (reviewState) {
    case 'pending':
      return 'Pending review'
    case 'in_review':
      return 'In review'
    case 'approved':
      return 'Approved'
    case 'changes_requested':
      return 'Changes requested'
    case 'rejected':
      return 'Rejected'
    default:
      return 'Unreviewed'
  }
}

function formatPublicationRiskLevel(riskLevel: PublicationSummary['riskLevel']): string {
  switch (riskLevel) {
    case 'low':
      return 'Low risk'
    case 'medium':
      return 'Medium risk'
    case 'high':
      return 'High risk'
    case 'critical':
      return 'Critical risk'
    default:
      return 'Risk unset'
  }
}

function formatDependencyVersions(versionNumbers: number[]): string {
  if (versionNumbers.length === 0) return 'No visible dependencies'
  return `Depends on ${versionNumbers.map((versionNumber) => `v${versionNumber}`).join(', ')}`
}

function governanceAlertClass(severity: PublicationGovernanceAlertSeverity): string {
  switch (severity) {
    case 'danger':
      return 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300'
    case 'warning':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    case 'info':
      return 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300'
  }
}

interface PublicationStateTreePanelProps {
  publications: PublicationSummary[]
  isLoading: boolean
}

function PublicationStateTreePanel({ publications, isLoading }: PublicationStateTreePanelProps) {
  const groups = useMemo(() => buildPublicationStateGroups(publications), [publications])
  const publishedCount = publications.filter(
    (publication) => publication.status === 'published'
  ).length
  const historyCount = publications.length - publishedCount

  return (
    <section className='border-[var(--border)] border-b px-6 py-4'>
      <div className='mb-3 flex flex-col gap-2 md:flex-row md:items-end md:justify-between'>
        <div>
          <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
            <Network className='h-[14px] w-[14px]' />
            Publication state tree
          </div>
          <h2 className='mt-1 font-medium text-[var(--text-body)] text-sm'>
            Project showcase governance by discipline, team, and Agent
          </h2>
        </div>
        <div className='flex gap-2 text-[12px] text-[var(--text-muted)]'>
          <span className='rounded-full border border-[var(--border)] px-2 py-0.5'>
            {groups.length} groups
          </span>
          <span className='rounded-full border border-[var(--border)] px-2 py-0.5'>
            {publishedCount} current / {historyCount} history
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {['state-tree-loading-1', 'state-tree-loading-2', 'state-tree-loading-3'].map((id) => (
            <div
              key={id}
              className='h-[148px] animate-pulse rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)]'
            />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className='rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)] p-4 text-[13px] text-[var(--text-muted)]'>
          No visible showcase publication state exists for this workgroup yet.
        </div>
      ) : (
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {groups.map((group) => (
            <article
              key={group.id}
              className='rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)] p-4'
            >
              <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0'>
                  <div className='truncate font-medium text-[var(--text-body)] text-sm'>
                    {group.sourceDiscipline.name}
                  </div>
                  <div className='mt-1 truncate text-[12px] text-[var(--text-muted)]'>
                    {group.sourceWorkgroup.name} / {group.agentCode}
                  </div>
                </div>
                <span className='shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]'>
                  {group.versions.length} versions
                </span>
              </div>

              <div className='mt-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface-1)] p-3'>
                <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
                  <GitBranch className='h-[13px] w-[13px]' />
                  Current / latest visible version
                </div>
                <div className='mt-2 flex items-center justify-between gap-3'>
                  <span className='min-w-0 truncate font-medium text-[var(--text-body)] text-sm'>
                    {group.current?.title ?? 'No current version'}
                  </span>
                  {group.current && (
                    <span className='shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-[11px] text-emerald-700 dark:text-emerald-300'>
                      v{group.current.versionNumber}
                    </span>
                  )}
                </div>
                {group.current && (
                  <div className='mt-1 text-[12px] text-[var(--text-muted)]'>
                    {formatPublicationStatus(group.current.status)} /{' '}
                    {formatPublicationVisibility(group.current.visibility)}
                    {group.current.targetWorkgroupCount > 0
                      ? ` / ${group.current.targetWorkgroupCount} teams`
                      : ''}
                  </div>
                )}
                {group.current && (
                  <div className='mt-1 text-[12px] text-[var(--text-muted)]'>
                    {formatPublicationReviewState(group.current.reviewState)} /{' '}
                    {formatPublicationRiskLevel(group.current.riskLevel)}
                  </div>
                )}
                {group.current && (
                  <div className='mt-1 text-[12px] text-[var(--text-muted)]'>
                    {formatDependencyVersions(group.current.dependencyVersionNumbers)}
                  </div>
                )}
              </div>

              {group.governanceAlerts.length > 0 && (
                <div className='mt-3 grid gap-2'>
                  {group.governanceAlerts.map((alert) => (
                    <div
                      key={alert.code}
                      className={cn(
                        'flex items-center gap-2 rounded-[8px] border px-2 py-1 text-[11px]',
                        governanceAlertClass(alert.severity)
                      )}
                    >
                      <AlertTriangle className='h-[12px] w-[12px]' />
                      <span className='min-w-0 truncate'>{alert.message}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className='mt-3 space-y-2'>
                {group.history.slice(0, 3).map((version) => (
                  <div key={version.id} className='grid gap-1 text-[12px]'>
                    <div className='flex items-center justify-between gap-3'>
                      <span className='min-w-0 truncate text-[var(--text-muted)]'>
                        v{version.versionNumber} / {formatPublicationStatus(version.status)} /{' '}
                        {formatPublicationReviewState(version.reviewState)}
                      </span>
                      <span className='shrink-0 text-[var(--text-muted)]'>
                        {formatPublicationDate(version.publishedAt)}
                      </span>
                    </div>
                    {version.dependencyVersionNumbers.length > 0 && (
                      <div className='text-[11px] text-[var(--text-muted)]'>
                        {formatDependencyVersions(version.dependencyVersionNumbers)}
                      </div>
                    )}
                  </div>
                ))}
                {group.history.length === 0 && (
                  <div className='text-[12px] text-[var(--text-muted)]'>No history yet.</div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export function PublishedWorkflows() {
  const params = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const pathname = usePathname()
  const workspaceId = params.workspaceId
  const isShowcaseRoute = pathname?.startsWith(`/workspace/${workspaceId}/showcase`) ?? false

  const { data: workspaceSettingsData, isLoading: isWorkspaceLoading } =
    useWorkspaceSettings(workspaceId)
  const workgroupId = workspaceSettingsData?.settings.workspace.workgroupId ?? undefined

  const {
    data: publishedWorkflows = [],
    isLoading: isPublishedLoading,
    refetch,
    isFetching,
  } = usePublishedWorkflowsForWorkgroup(workgroupId)
  const { data: publicationData, isLoading: isPublicationsLoading } = useShowcasePublications(
    isShowcaseRoute ? workgroupId : undefined,
    STATE_TREE_PUBLICATION_FILTERS
  )
  const publications = publicationData?.publications ?? []

  const rows = useMemo<ResourceRow[]>(
    () =>
      publishedWorkflows.map((workflow) => ({
        id: workflow.id,
        cells: {
          workflow: {
            content: (
              <div className='flex min-w-0 flex-col'>
                <span className='truncate font-medium text-[var(--text-body)] text-sm'>
                  {workflow.name}
                </span>
                <span className='truncate text-[12px] text-[var(--text-muted)]'>
                  {workflow.description?.trim() || 'No description'}
                </span>
              </div>
            ),
          },
          workspace: {
            label: workflow.workspaceName,
          },
          visibility: {
            content: (
              <span
                className={cn(
                  'inline-flex rounded-full px-2 py-0.5 font-medium text-[12px]',
                  workflow.visibility === 'organization' &&
                    'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                  workflow.visibility === 'selected_workgroups' &&
                    'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                  workflow.visibility === 'workspace' &&
                    'bg-slate-500/10 text-slate-700 dark:text-slate-300'
                )}
              >
                {formatVisibility(workflow.visibility)}
              </span>
            ),
          },
          publishedAt: {
            label: formatPublishedAt(workflow.publishedAt),
          },
        },
        sortValues: {
          workflow: workflow.name,
          workspace: workflow.workspaceName,
          visibility: workflow.visibility ?? '',
          publishedAt: workflow.publishedAt?.getTime() ?? 0,
        },
      })),
    [publishedWorkflows]
  )

  const isLoading = isWorkspaceLoading || (Boolean(workgroupId) && isPublishedLoading)
  const emptyMessage = workgroupId
    ? 'No published workflows are visible to this workgroup yet.'
    : 'This workspace is not assigned to a workgroup yet.'

  return (
    <div className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'>
      <ResourceHeader
        icon={Compass}
        title={isShowcaseRoute ? 'Showcase Canvas' : 'Published'}
        actions={[
          {
            label: isFetching ? 'Refreshing...' : 'Refresh',
            icon: RefreshCw,
            onClick: () => {
              void refetch()
            },
            disabled: !workgroupId || isFetching,
          },
        ]}
      />
      <div className='border-[var(--border)] border-b px-6 py-3'>
        <p className='text-[13px] text-[var(--text-muted)]'>
          Browse read-only mainlines shared with your current workgroup. Opening a row shows a safe
          summary view instead of entering another team&apos;s collaborative workspace.
        </p>
      </div>
      {isShowcaseRoute && (
        <PublicationStateTreePanel
          publications={publications}
          isLoading={Boolean(workgroupId) && isPublicationsLoading}
        />
      )}
      <ResourceTable
        columns={PUBLISHED_COLUMNS}
        rows={rows}
        isLoading={isLoading}
        defaultSort='publishedAt'
        emptyMessage={emptyMessage}
        onRowClick={(workflowId) => {
          router.push(
            `/workspace/${workspaceId}/${isShowcaseRoute ? 'showcase' : 'published'}/${workflowId}`
          )
        }}
      />
      {!workgroupId && !isWorkspaceLoading && (
        <div className='border-[var(--border)] border-t px-6 py-3 text-[12px] text-[var(--text-muted)]'>
          Configure a `workgroupId` on the current workspace to enable cross-workgroup published
          workflow browsing.
        </div>
      )}
    </div>
  )
}
