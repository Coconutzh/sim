'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Bell, Download, Inbox, ShieldCheck, X } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { buttonVariants, Loader } from '@/components/emcn'
import type {
  ProjectNotificationCenterEntry,
  ProjectNotificationCenterKind,
} from '@/lib/api/contracts/collaboration'
import { cn } from '@/lib/core/utils/cn'
import {
  fetchProjectNotificationCenter,
  useMarkProjectNotificationCenterRead,
  useMyWorkgroups,
  useOrganizationWorkgroups,
  useProjectNotificationCenter,
} from '@/hooks/queries/collaboration'
import { useWorkspaceSettings } from '@/hooks/queries/workspace'

const PROJECT_NOTIFICATION_CENTER_LIMIT = 20
const PROJECT_NOTIFICATION_EXPORT_PAGE_SIZE = 50
const PROJECT_NOTIFICATION_EXPORT_MAX_PAGES = 1000

const PROJECT_NOTIFICATION_KIND_OPTIONS: {
  value: ProjectNotificationCenterKind | ''
  label: string
}[] = [
  { value: '', label: 'All notification types' },
  { value: 'publication_review', label: 'Publication review' },
  { value: 'project_admin_failure', label: 'Project admin failure' },
  { value: 'publication_governance', label: 'Publication governance' },
  { value: 'member_management', label: 'Member management' },
  { value: 'team_management', label: 'Team management' },
  { value: 'agent_policy', label: 'Agent policy' },
  { value: 'retention_policy', label: 'Retention policy' },
  { value: 'data_drain', label: 'Data drain' },
  { value: 'organization_management', label: 'Organization management' },
  { value: 'organization_settings', label: 'Organization settings' },
  { value: 'billing_management', label: 'Billing management' },
]

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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatProjectNotificationKind(kind: ProjectNotificationCenterKind) {
  return (
    PROJECT_NOTIFICATION_KIND_OPTIONS.find((option) => option.value === kind)?.label ??
    kind.replaceAll('_', ' ')
  )
}

function projectNotificationSeverityClass(severity: ProjectNotificationCenterEntry['severity']) {
  switch (severity) {
    case 'danger':
      return 'border-red-500/30 bg-red-500/10 text-red-500'
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-500'
    case 'info':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-500'
  }
}

function escapeCsvValue(value: string | null | undefined) {
  const normalized = value ?? ''
  if (!/[",\r\n]/.test(normalized)) return normalized
  return `"${normalized.replace(/"/g, '""')}"`
}

function downloadProjectNotificationsCsv(
  entries: ProjectNotificationCenterEntry[],
  scope: 'page' | 'filtered' = 'page'
) {
  const rows = [
    [
      'Audit row ID',
      'Type',
      'Severity',
      'Title',
      'Detail',
      'Channel',
      'Body',
      'Notification count',
      'Actor name',
      'Actor email',
      'Created at',
      'Read at',
    ],
    ...entries.map((entry) => [
      entry.id,
      formatProjectNotificationKind(entry.kind),
      entry.severity,
      entry.title,
      entry.detail,
      entry.channel?.replace('_', ' ') ?? 'Audit',
      entry.body ?? '',
      String(entry.notificationCount),
      entry.actorName ?? '',
      entry.actorEmail ?? '',
      entry.createdAt,
      entry.readAt ?? '',
    ]),
  ]
  const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `project-notifications-${scope}-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function ProjectNotificationsCenter() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [projectNotificationKind, setProjectNotificationKind] = useState<
    ProjectNotificationCenterKind | ''
  >('')
  const [projectNotificationOffset, setProjectNotificationOffset] = useState(0)
  const [selectedProjectNotificationId, setSelectedProjectNotificationId] = useState<string | null>(
    null
  )
  const [isExportingProjectNotifications, setIsExportingProjectNotifications] = useState(false)
  const [projectNotificationStatus, setProjectNotificationStatus] = useState<string | null>(null)

  const { data: workgroupsData, isLoading: isLoadingMyWorkgroups } = useMyWorkgroups()
  const { data: workspaceSettingsData } = useWorkspaceSettings(workspaceId)
  const workgroups = workgroupsData?.workgroups ?? []
  const activeWorkgroup = getActiveWorkgroup(
    workgroups,
    workspaceId,
    workspaceSettingsData?.settings.workspace.workgroupId,
    workgroupsData?.defaultWorkgroupId
  )
  const organizationId = activeWorkgroup?.organizationId
  const { data: organizationWorkgroupsData, isLoading: isLoadingOrganizationWorkgroups } =
    useOrganizationWorkgroups(organizationId)
  const organizationWorkgroups = organizationWorkgroupsData?.workgroups ?? []
  const isProjectAdmin = organizationWorkgroups.some(
    (workgroup) => workgroup.currentUserRole === 'org_admin'
  )

  const projectNotificationCenterQuery = useMemo(
    () => ({
      limit: PROJECT_NOTIFICATION_CENTER_LIMIT,
      offset: projectNotificationOffset,
      kind: projectNotificationKind || undefined,
    }),
    [projectNotificationKind, projectNotificationOffset]
  )
  const { data: projectNotificationCenterData, isLoading: isLoadingProjectNotificationCenter } =
    useProjectNotificationCenter(
      isProjectAdmin ? organizationId : undefined,
      projectNotificationCenterQuery
    )
  const markProjectNotificationCenterRead = useMarkProjectNotificationCenterRead()
  const projectNotifications = projectNotificationCenterData?.notifications ?? []
  const unreadProjectNotificationCount = projectNotifications.filter(
    (entry) => !entry.readAt
  ).length
  const selectedProjectNotification =
    projectNotifications.find((entry) => entry.id === selectedProjectNotificationId) ?? null
  const hasPreviousProjectNotificationPage = projectNotificationOffset > 0
  const hasNextProjectNotificationPage = projectNotificationCenterData?.nextOffset != null
  const projectNotificationRangeLabel =
    projectNotifications.length > 0
      ? `Showing ${projectNotificationOffset + 1}-${projectNotificationOffset + projectNotifications.length} project notifications.`
      : 'No project notifications in this filter.'
  const isLoading = isLoadingMyWorkgroups || isLoadingOrganizationWorkgroups

  const resetProjectNotificationPage = () => {
    setProjectNotificationOffset(0)
    setSelectedProjectNotificationId(null)
    setProjectNotificationStatus(null)
  }

  const handleMarkProjectNotificationRead = async (
    notification?: ProjectNotificationCenterEntry
  ) => {
    if (!organizationId) {
      setProjectNotificationStatus('Select a project organization before marking notifications.')
      return
    }

    try {
      await markProjectNotificationCenterRead.mutateAsync({
        organizationId,
        notificationId: notification?.id,
        markAll: notification ? undefined : true,
        kind: notification?.kind ?? (projectNotificationKind || undefined),
      })
      setProjectNotificationStatus(
        notification
          ? 'Marked project notification as read.'
          : 'Marked current project notification filter as read.'
      )
    } catch (error) {
      setProjectNotificationStatus(
        error instanceof Error ? error.message : 'Unable to mark project notifications read.'
      )
    }
  }

  const handleExportFilteredProjectNotifications = async () => {
    if (!organizationId) return

    setIsExportingProjectNotifications(true)
    setProjectNotificationStatus(null)
    try {
      const notifications: ProjectNotificationCenterEntry[] = []
      let offset = 0
      let nextOffset: number | null = 0
      let pageCount = 0

      while (nextOffset != null && pageCount < PROJECT_NOTIFICATION_EXPORT_MAX_PAGES) {
        const result = await fetchProjectNotificationCenter(organizationId, {
          limit: PROJECT_NOTIFICATION_EXPORT_PAGE_SIZE,
          offset,
          kind: projectNotificationKind || undefined,
        })
        notifications.push(...result.notifications)
        nextOffset = result.nextOffset
        offset = nextOffset ?? offset
        pageCount += 1
      }

      if (notifications.length === 0) {
        setProjectNotificationStatus('No project notifications matched the current filter.')
        return
      }

      downloadProjectNotificationsCsv(notifications, 'filtered')
      setProjectNotificationStatus(
        nextOffset == null
          ? `Exported ${notifications.length} project notification row${notifications.length === 1 ? '' : 's'}.`
          : `Exported the first ${notifications.length} project notification rows. Narrow filters to export more.`
      )
    } catch (error) {
      setProjectNotificationStatus(
        error instanceof Error ? error.message : 'Unable to export project notifications.'
      )
    } finally {
      setIsExportingProjectNotifications(false)
    }
  }

  if (isLoading) {
    return (
      <div className='flex h-full items-center justify-center bg-[var(--bg)] text-[13px] text-[var(--text-muted)]'>
        <Loader className='mr-2 h-[15px] w-[15px]' animate />
        Loading project notification center...
      </div>
    )
  }

  if (!organizationId || !activeWorkgroup) {
    return (
      <div className='h-full overflow-auto bg-[var(--bg)] p-6'>
        <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-6'>
          <h1 className='font-medium text-[18px] text-[var(--text-primary)]'>
            Project notifications
          </h1>
          <p className='mt-2 text-[13px] text-[var(--text-muted)]'>
            Join or create a workgroup before opening the project notification center.
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
            <h1 className='font-medium text-[18px] text-[var(--text-primary)]'>
              Project notifications
            </h1>
          </div>
          <p className='mt-2 max-w-[680px] text-[13px] text-[var(--text-muted)]'>
            Project notification center is reserved for organization owners and admins. Team admins
            can continue using Team management for their own workgroup.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className='h-full overflow-auto bg-[var(--bg)]'>
      <div className='grid gap-5 p-6'>
        <header className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
              <Bell className='h-[14px] w-[14px]' />
              Project-wide alerts
            </div>
            <h1 className='mt-1 font-medium text-[22px] text-[var(--text-primary)]'>
              Project notification center
            </h1>
            <p className='mt-2 max-w-[760px] text-[13px] text-[var(--text-muted)]'>
              Fullscreen queue for publication review digests and project-admin failure audit
              notifications, with read-state actions and CSV evidence export.
            </p>
          </div>
          <Link
            className={cn(buttonVariants({ variant: 'default' }), 'h-[32px]')}
            href={`/workspace/${workspaceId}/project-admin`}
          >
            Back to project admin
          </Link>
        </header>

        <section className='grid gap-3 md:grid-cols-4'>
          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3'>
            <div className='text-[11px] text-[var(--text-muted)]'>Shown on page</div>
            <div className='mt-1 font-semibold text-[18px] text-[var(--text-primary)]'>
              {projectNotifications.length}
            </div>
          </div>
          <div className='rounded-[8px] border border-amber-500/30 bg-amber-500/10 p-3'>
            <div className='text-[11px] text-amber-500'>Unread on page</div>
            <div className='mt-1 font-semibold text-[18px] text-amber-500'>
              {unreadProjectNotificationCount}
            </div>
          </div>
          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3'>
            <div className='text-[11px] text-[var(--text-muted)]'>Current filter</div>
            <div className='mt-1 truncate font-medium text-[13px] text-[var(--text-primary)]'>
              {projectNotificationKind
                ? formatProjectNotificationKind(projectNotificationKind)
                : 'All notification types'}
            </div>
          </div>
          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3'>
            <div className='text-[11px] text-[var(--text-muted)]'>Pagination</div>
            <div className='mt-1 font-medium text-[13px] text-[var(--text-primary)]'>
              {hasNextProjectNotificationPage ? 'More pages available' : 'End of filter'}
            </div>
          </div>
        </section>

        <section className='grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]'>
          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='grid gap-3 border-[var(--border)] border-b px-4 py-3'>
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div className='flex items-center gap-2'>
                  <Inbox className='h-[15px] w-[15px] text-[var(--text-icon)]' />
                  <div>
                    <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                      Notification queue
                    </h2>
                    <p className='text-[12px] text-[var(--text-muted)]'>
                      Filter, export, and mark project notifications without leaving the workspace
                      shell.
                    </p>
                  </div>
                </div>
                <button
                  type='button'
                  className={buttonVariants({ size: 'sm', variant: 'default' })}
                  disabled={
                    unreadProjectNotificationCount === 0 ||
                    markProjectNotificationCenterRead.isPending
                  }
                  onClick={() => void handleMarkProjectNotificationRead()}
                >
                  Mark filter read
                </button>
              </div>
              <div className='grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]'>
                <select
                  value={projectNotificationKind}
                  onChange={(event) => {
                    setProjectNotificationKind(
                      event.target.value as ProjectNotificationCenterKind | ''
                    )
                    resetProjectNotificationPage()
                  }}
                  className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text-body)] outline-none'
                >
                  {PROJECT_NOTIFICATION_KIND_OPTIONS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className='flex flex-wrap items-center gap-2'>
                  <button
                    type='button'
                    className={buttonVariants({ size: 'sm', variant: 'default' })}
                    disabled={projectNotifications.length === 0}
                    onClick={() => downloadProjectNotificationsCsv(projectNotifications)}
                  >
                    <Download className='mr-2 h-[13px] w-[13px]' />
                    Export page
                  </button>
                  <button
                    type='button'
                    className={buttonVariants({ size: 'sm', variant: 'default' })}
                    disabled={!organizationId || isExportingProjectNotifications}
                    onClick={() => void handleExportFilteredProjectNotifications()}
                  >
                    {isExportingProjectNotifications ? (
                      <Loader className='mr-2 h-[13px] w-[13px]' animate />
                    ) : (
                      <Download className='mr-2 h-[13px] w-[13px]' />
                    )}
                    Export filtered
                  </button>
                  <button
                    type='button'
                    className={buttonVariants({ size: 'sm', variant: 'default' })}
                    disabled={
                      !hasPreviousProjectNotificationPage || isLoadingProjectNotificationCenter
                    }
                    onClick={() => {
                      setProjectNotificationOffset((currentOffset) =>
                        Math.max(0, currentOffset - PROJECT_NOTIFICATION_CENTER_LIMIT)
                      )
                      setSelectedProjectNotificationId(null)
                    }}
                  >
                    Previous
                  </button>
                  <button
                    type='button'
                    className={buttonVariants({ size: 'sm', variant: 'default' })}
                    disabled={!hasNextProjectNotificationPage || isLoadingProjectNotificationCenter}
                    onClick={() => {
                      if (projectNotificationCenterData?.nextOffset != null) {
                        setProjectNotificationOffset(projectNotificationCenterData.nextOffset)
                        setSelectedProjectNotificationId(null)
                      }
                    }}
                  >
                    Next
                  </button>
                </div>
              </div>
              <div className='flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]'>
                <span>{projectNotificationRangeLabel}</span>
                {projectNotificationStatus && (
                  <span aria-live='polite'>{projectNotificationStatus}</span>
                )}
              </div>
            </div>

            <div className='divide-y divide-[var(--border)]'>
              {isLoadingProjectNotificationCenter ? (
                <div className='flex items-center gap-2 px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                  <Loader className='h-[14px] w-[14px]' animate />
                  Loading project notifications...
                </div>
              ) : projectNotifications.length === 0 ? (
                <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                  No project notifications match this filter yet.
                </div>
              ) : (
                projectNotifications.map((entry) => (
                  <button
                    key={entry.id}
                    type='button'
                    className={cn(
                      'grid w-full gap-2 px-4 py-3 text-left transition-colors hover-hover:bg-[var(--surface-hover)]',
                      selectedProjectNotificationId === entry.id && 'bg-[var(--surface-active)]'
                    )}
                    onClick={() => setSelectedProjectNotificationId(entry.id)}
                  >
                    <div className='flex flex-wrap items-start justify-between gap-2'>
                      <div className='min-w-0'>
                        <div className='flex flex-wrap items-center gap-2'>
                          <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                            {entry.title}
                          </span>
                          {!entry.readAt && (
                            <span className='rounded-[6px] border border-amber-500/30 px-1.5 py-0.5 font-medium text-[10px] text-amber-500'>
                              Unread
                            </span>
                          )}
                        </div>
                        <div className='mt-1 line-clamp-2 text-[12px] text-[var(--text-muted)]'>
                          {entry.detail ||
                            entry.body ||
                            'No detail recorded for this notification.'}
                        </div>
                      </div>
                      <span className='shrink-0 text-[11px] text-[var(--text-muted)]'>
                        {formatDateTime(entry.createdAt)}
                      </span>
                    </div>
                    <div className='flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]'>
                      <span
                        className={cn(
                          'rounded-[6px] border px-1.5 py-0.5 font-medium text-[10px]',
                          projectNotificationSeverityClass(entry.severity)
                        )}
                      >
                        {entry.severity}
                      </span>
                      <span>{formatProjectNotificationKind(entry.kind)}</span>
                      <span>{entry.channel?.replace('_', ' ') ?? 'Audit'}</span>
                      <span>
                        {entry.notificationCount} item{entry.notificationCount === 1 ? '' : 's'}
                      </span>
                      <span>By {entry.actorName || entry.actorEmail || 'unknown admin'}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <aside className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='flex items-center justify-between gap-2 border-[var(--border)] border-b px-4 py-3'>
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>Details</h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  Inspect the selected notification audit row.
                </p>
              </div>
              {selectedProjectNotification && (
                <button
                  type='button'
                  className={cn(buttonVariants({ size: 'sm', variant: 'default' }), 'h-[30px]')}
                  onClick={() => setSelectedProjectNotificationId(null)}
                  aria-label='Clear selected project notification'
                >
                  <X className='h-[13px] w-[13px]' />
                </button>
              )}
            </div>
            {selectedProjectNotification ? (
              <div className='grid gap-3 p-4'>
                <section
                  className={cn(
                    'rounded-[8px] border p-3',
                    projectNotificationSeverityClass(selectedProjectNotification.severity)
                  )}
                >
                  <div className='text-[11px] uppercase tracking-[0.08em]'>
                    {selectedProjectNotification.severity} notification
                  </div>
                  <h3 className='mt-2 font-medium text-[14px] text-[var(--text-primary)]'>
                    {selectedProjectNotification.title}
                  </h3>
                  <p className='mt-2 whitespace-pre-wrap text-[12px] text-[var(--text-primary)]'>
                    {selectedProjectNotification.detail ||
                      'No detail recorded for this notification.'}
                  </p>
                </section>

                <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                  <div className='grid gap-2 text-[12px]'>
                    <div className='flex justify-between gap-3'>
                      <span className='text-[var(--text-muted)]'>Type</span>
                      <span className='text-right text-[var(--text-primary)]'>
                        {formatProjectNotificationKind(selectedProjectNotification.kind)}
                      </span>
                    </div>
                    <div className='flex justify-between gap-3'>
                      <span className='text-[var(--text-muted)]'>Channel</span>
                      <span className='text-right text-[var(--text-primary)]'>
                        {selectedProjectNotification.channel?.replace('_', ' ') ?? 'Audit'}
                      </span>
                    </div>
                    <div className='flex justify-between gap-3'>
                      <span className='text-[var(--text-muted)]'>Count</span>
                      <span className='text-right text-[var(--text-primary)]'>
                        {selectedProjectNotification.notificationCount}
                      </span>
                    </div>
                    <div className='flex justify-between gap-3'>
                      <span className='text-[var(--text-muted)]'>Actor</span>
                      <span className='truncate text-right text-[var(--text-primary)]'>
                        {selectedProjectNotification.actorName ||
                          selectedProjectNotification.actorEmail ||
                          'Unknown admin'}
                      </span>
                    </div>
                    <div className='flex justify-between gap-3'>
                      <span className='text-[var(--text-muted)]'>Read state</span>
                      <span className='text-right text-[var(--text-primary)]'>
                        {selectedProjectNotification.readAt
                          ? formatDateTime(selectedProjectNotification.readAt)
                          : 'Unread'}
                      </span>
                    </div>
                    <div className='flex justify-between gap-3'>
                      <span className='text-[var(--text-muted)]'>Audit row ID</span>
                      <span className='truncate text-right text-[var(--text-primary)]'>
                        {selectedProjectNotification.id}
                      </span>
                    </div>
                  </div>
                </section>

                {selectedProjectNotification.body && (
                  <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                    <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                      Delivery body
                    </h3>
                    <p className='mt-2 whitespace-pre-wrap text-[12px] text-[var(--text-muted)]'>
                      {selectedProjectNotification.body}
                    </p>
                  </section>
                )}

                {!selectedProjectNotification.readAt && (
                  <button
                    type='button'
                    className={buttonVariants({ size: 'sm', variant: 'default' })}
                    disabled={markProjectNotificationCenterRead.isPending}
                    onClick={() =>
                      void handleMarkProjectNotificationRead(selectedProjectNotification)
                    }
                  >
                    Mark notification read
                  </button>
                )}
              </div>
            ) : (
              <div className='grid gap-2 p-4 text-[12px] text-[var(--text-muted)]'>
                <AlertTriangle className='h-[15px] w-[15px] text-[var(--text-icon)]' />
                Select a notification row to inspect severity, channel, actor, read state, audit row
                ID, and provider body.
              </div>
            )}
          </aside>
        </section>
      </div>
    </div>
  )
}
