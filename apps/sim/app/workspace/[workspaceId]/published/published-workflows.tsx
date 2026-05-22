'use client'

import { useMemo } from 'react'
import { Compass, RefreshCw } from 'lucide-react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/core/utils/cn'
import {
  type ResourceColumn,
  ResourceHeader,
  type ResourceRow,
  ResourceTable,
} from '@/app/workspace/[workspaceId]/components'
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
