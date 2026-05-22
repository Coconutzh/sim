'use client'

import { useMemo } from 'react'
import { ArrowLeft, Compass, GitBranch, Network, RefreshCw } from 'lucide-react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  type HeaderAction,
  type ResourceColumn,
  ResourceHeader,
  type ResourceRow,
  ResourceTable,
} from '@/app/workspace/[workspaceId]/components'
import {
  usePublishedWorkflowsForWorkgroup,
  useWorkflowPublication,
  useWorkflowState,
} from '@/hooks/queries/workflows'
import { useWorkspaceSettings } from '@/hooks/queries/workspace'

const BLOCK_COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Block', widthMultiplier: 1.15 },
  { id: 'type', header: 'Type' },
  { id: 'status', header: 'Status' },
  { id: 'position', header: 'Position' },
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

function formatVisibility(value: 'workspace' | 'organization' | 'selected_workgroups' | undefined) {
  switch (value) {
    case 'workspace':
      return 'Owner workspace only'
    case 'selected_workgroups':
      return 'Selected workgroups'
    default:
      return 'Organization'
  }
}

export function PublishedWorkflowDetail() {
  const params = useParams<{ workspaceId: string; workflowId: string }>()
  const router = useRouter()
  const pathname = usePathname()
  const workspaceId = params.workspaceId
  const workflowId = params.workflowId
  const isShowcaseRoute = pathname?.startsWith(`/workspace/${workspaceId}/showcase`) ?? false

  const { data: workspaceSettingsData, isLoading: isWorkspaceLoading } =
    useWorkspaceSettings(workspaceId)
  const workgroupId = workspaceSettingsData?.settings.workspace.workgroupId ?? undefined

  const { data: publishedWorkflows = [], isLoading: isPublishedLoading } =
    usePublishedWorkflowsForWorkgroup(workgroupId)
  const publishedWorkflow = publishedWorkflows.find((workflow) => workflow.id === workflowId)

  const {
    data: workflowState,
    isLoading: isWorkflowStateLoading,
    refetch: refetchWorkflowState,
    isFetching: isFetchingWorkflowState,
  } = useWorkflowState(publishedWorkflow ? workflowId : undefined)
  const { data: publication, isLoading: isPublicationLoading } = useWorkflowPublication(
    publishedWorkflow ? workflowId : undefined
  )

  const blockRows = useMemo<ResourceRow[]>(() => {
    const blocks = Object.values(workflowState?.blocks ?? {})
    return blocks
      .sort((left, right) => {
        if (left.position.y !== right.position.y) {
          return left.position.y - right.position.y
        }
        return left.position.x - right.position.x
      })
      .map((block) => ({
        id: block.id,
        cells: {
          name: {
            content: (
              <div className='flex min-w-0 flex-col'>
                <span className='truncate font-medium text-[var(--text-body)] text-sm'>
                  {block.name}
                </span>
              </div>
            ),
          },
          type: {
            label: block.type,
          },
          status: {
            content: (
              <span
                className={cn(
                  'inline-flex rounded-full px-2 py-0.5 font-medium text-[12px]',
                  block.enabled
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-slate-500/10 text-slate-700 dark:text-slate-300'
                )}
              >
                {block.enabled ? 'Enabled' : 'Disabled'}
              </span>
            ),
          },
          position: {
            label: `${Math.round(block.position.x)}, ${Math.round(block.position.y)}`,
          },
        },
        sortValues: {
          name: block.name,
          type: block.type,
          status: block.enabled ? 1 : 0,
          position: block.position.y * 100000 + block.position.x,
        },
      }))
  }, [workflowState])

  const headerActions = useMemo<HeaderAction[]>(
    () => [
      {
        label: 'Back',
        icon: ArrowLeft,
        onClick: () => {
          router.push(`/workspace/${workspaceId}/${isShowcaseRoute ? 'showcase' : 'published'}`)
        },
      },
      {
        label: isFetchingWorkflowState ? 'Refreshing...' : 'Refresh',
        icon: RefreshCw,
        onClick: () => {
          void refetchWorkflowState()
        },
        disabled: !publishedWorkflow || isFetchingWorkflowState,
      },
    ],
    [
      isFetchingWorkflowState,
      isShowcaseRoute,
      publishedWorkflow,
      refetchWorkflowState,
      router,
      workspaceId,
    ]
  )

  const isLoading =
    isWorkspaceLoading ||
    (Boolean(workgroupId) && isPublishedLoading) ||
    isWorkflowStateLoading ||
    isPublicationLoading

  if (!isLoading && !publishedWorkflow) {
    return (
      <div className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'>
        <ResourceHeader
          icon={Compass}
          title={isShowcaseRoute ? 'Showcase Canvas' : 'Published Workflow'}
          actions={headerActions}
        />
        <div className='flex flex-1 items-center justify-center px-6'>
          <div className='max-w-[520px] rounded-[16px] border border-[var(--border)] bg-[var(--surface-2)] p-6'>
            <h2 className='font-medium text-[var(--text-body)] text-lg'>
              Workflow not visible from this workspace
            </h2>
            <p className='mt-2 text-[14px] text-[var(--text-muted)]'>
              The requested published workflow is not shared with your current workgroup, or this
              workspace does not have a configured workgroup yet.
            </p>
            <Button
              variant='subtle'
              className='mt-4 px-3 py-1.5 text-caption'
              onClick={() => {
                router.push(
                  `/workspace/${workspaceId}/${isShowcaseRoute ? 'showcase' : 'published'}`
                )
              }}
            >
              Back to {isShowcaseRoute ? 'showcase' : 'published'} list
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const blockCount = blockRows.length
  const edgeCount = workflowState?.edges.length ?? 0
  const loopCount = Object.keys(workflowState?.loops ?? {}).length
  const parallelCount = Object.keys(workflowState?.parallels ?? {}).length

  return (
    <div className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'>
      <ResourceHeader
        icon={Compass}
        title={
          publishedWorkflow?.name ?? (isShowcaseRoute ? 'Showcase Canvas' : 'Published Workflow')
        }
        actions={headerActions}
      />
      <div className='border-[var(--border)] border-b px-6 py-4'>
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4'>
          <div className='rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)] p-4'>
            <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
              <Compass className='h-[14px] w-[14px]' />
              Source team
            </div>
            <div className='mt-2 font-medium text-[var(--text-body)] text-sm'>
              {publishedWorkflow?.workspaceName ?? 'Unknown'}
            </div>
            <div className='mt-1 text-[12px] text-[var(--text-muted)]'>
              Visibility:{' '}
              {formatVisibility(publication?.visibility ?? publishedWorkflow?.visibility)}
            </div>
          </div>
          <div className='rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)] p-4'>
            <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
              <GitBranch className='h-[14px] w-[14px]' />
              Publication
            </div>
            <div className='mt-2 font-medium text-[var(--text-body)] text-sm'>
              {formatPublishedAt(publishedWorkflow?.publishedAt)}
            </div>
            <div className='mt-1 text-[12px] text-[var(--text-muted)]'>
              Source draft: {publication?.sourceWorkflowId ?? 'Unknown'}
            </div>
          </div>
          <div className='rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)] p-4'>
            <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
              <Network className='h-[14px] w-[14px]' />
              Structure
            </div>
            <div className='mt-2 font-medium text-[var(--text-body)] text-sm'>
              {blockCount} blocks / {edgeCount} edges
            </div>
            <div className='mt-1 text-[12px] text-[var(--text-muted)]'>
              {loopCount} loops / {parallelCount} parallels
            </div>
          </div>
          <div className='rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)] p-4'>
            <div className='text-[12px] text-[var(--text-muted)]'>Mode</div>
            <div className='mt-2 font-medium text-[var(--text-body)] text-sm'>
              Read-only summary
            </div>
            <div className='mt-1 text-[12px] text-[var(--text-muted)]'>
              This surface intentionally avoids realtime editing and stays inside the current
              workspace shell.
            </div>
          </div>
        </div>
      </div>
      <ResourceTable
        columns={BLOCK_COLUMNS}
        rows={blockRows}
        isLoading={isLoading}
        defaultSort='position'
        emptyMessage='This published workflow does not contain any blocks yet.'
      />
    </div>
  )
}
