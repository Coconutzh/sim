'use client'

import { useMemo } from 'react'
import { ArrowLeft, Compass, GitBranch, Network, RefreshCw } from 'lucide-react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'
import { ShowcaseReadOnlyCanvas } from '@/components/workbench/showcase-readonly-canvas'
import { cn } from '@/lib/core/utils/cn'
import {
  type HeaderAction,
  type ResourceColumn,
  ResourceHeader,
  type ResourceRow,
  ResourceTable,
} from '@/app/workspace/[workspaceId]/components'
import { usePublication } from '@/hooks/queries/collaboration'
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

function formatPublicationDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatVisibility(value: 'workspace' | 'organization' | 'selected_workgroups' | undefined) {
  switch (value) {
    case 'workspace':
      return 'Owner canvas only'
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
  const resourceId = params.workflowId
  const isShowcaseRoute = pathname?.startsWith(`/workspace/${workspaceId}/showcase`) ?? false

  const { data: workspaceSettingsData, isLoading: isWorkspaceLoading } =
    useWorkspaceSettings(workspaceId)
  const workgroupId = workspaceSettingsData?.settings.workspace.workgroupId ?? undefined

  const { data: publishedWorkflows = [], isLoading: isPublishedLoading } =
    usePublishedWorkflowsForWorkgroup(isShowcaseRoute ? undefined : workgroupId)
  const publishedWorkflow = publishedWorkflows.find((workflow) => workflow.id === resourceId)

  const {
    data: publicationData,
    isLoading: isPublicationDetailLoading,
    refetch: refetchPublication,
    isFetching: isFetchingPublication,
  } = usePublication(isShowcaseRoute ? resourceId : undefined)
  const publication = publicationData?.publication

  const {
    data: workflowState,
    isLoading: isWorkflowStateLoading,
    refetch: refetchWorkflowState,
    isFetching: isFetchingWorkflowState,
  } = useWorkflowState(!isShowcaseRoute && publishedWorkflow ? resourceId : undefined)
  const { data: workflowPublication, isLoading: isWorkflowPublicationLoading } =
    useWorkflowPublication(!isShowcaseRoute && publishedWorkflow ? resourceId : undefined)
  const detailWorkflowState = isShowcaseRoute
    ? publicationData?.publication.snapshotState
    : workflowState

  const blockRows = useMemo<ResourceRow[]>(() => {
    const blocks = Object.values(detailWorkflowState?.blocks ?? {})
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
  }, [detailWorkflowState])

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
        label: isFetchingWorkflowState || isFetchingPublication ? 'Refreshing...' : 'Refresh',
        icon: RefreshCw,
        onClick: () => {
          if (isShowcaseRoute) {
            void refetchPublication()
          } else {
            void refetchWorkflowState()
          }
        },
        disabled:
          (isShowcaseRoute ? !publication : !publishedWorkflow) ||
          isFetchingWorkflowState ||
          isFetchingPublication,
      },
    ],
    [
      isFetchingPublication,
      isFetchingWorkflowState,
      isShowcaseRoute,
      publishedWorkflow,
      publication,
      refetchPublication,
      refetchWorkflowState,
      router,
      workspaceId,
    ]
  )

  const isLoading =
    isWorkspaceLoading ||
    (isShowcaseRoute
      ? isPublicationDetailLoading
      : (Boolean(workgroupId) && isPublishedLoading) ||
        isWorkflowStateLoading ||
        isWorkflowPublicationLoading)

  if (!isLoading && (isShowcaseRoute ? !publication : !publishedWorkflow)) {
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
              {isShowcaseRoute
                ? 'Showcase snapshot not visible from this canvas'
                : 'Workflow not visible from this canvas'}
            </h2>
            <p className='mt-2 text-[14px] text-[var(--text-muted)]'>
              {isShowcaseRoute
                ? 'The requested publication is not shared with your current team, or it has been retracted.'
                : 'The requested published workflow is not shared with your current team, or this canvas does not have a configured team yet.'}
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
  const edgeCount = detailWorkflowState?.edges.length ?? 0
  const loopCount = Object.keys(detailWorkflowState?.loops ?? {}).length
  const parallelCount = Object.keys(detailWorkflowState?.parallels ?? {}).length
  const detailTitle =
    publication?.title ??
    publishedWorkflow?.name ??
    (isShowcaseRoute ? 'Showcase Canvas' : 'Published Workflow')
  const detailDescription = publication?.description ?? publishedWorkflow?.description ?? null
  const detailVisibility = publication?.visibility ?? workflowPublication?.visibility ?? publishedWorkflow?.visibility
  const detailPublishedAt = publication?.publishedAt
    ? formatPublicationDate(publication.publishedAt)
    : formatPublishedAt(publishedWorkflow?.publishedAt)
  const sourceDraftLabel = publication?.snapshotMetadata.sourceWorkflowName
    ?? workflowPublication?.sourceWorkflowId
    ?? 'Unknown'

  return (
    <div className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'>
      <ResourceHeader
        icon={Compass}
        title={detailTitle}
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
              {publication?.sourceWorkgroup.name ?? publishedWorkflow?.workspaceName ?? 'Unknown'}
            </div>
            <div className='mt-1 text-[12px] text-[var(--text-muted)]'>
              Visibility: {detailVisibility ? formatVisibility(detailVisibility) : 'Unknown'}
            </div>
          </div>
          <div className='rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)] p-4'>
            <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
              <GitBranch className='h-[14px] w-[14px]' />
              Publication
            </div>
            <div className='mt-2 font-medium text-[var(--text-body)] text-sm'>
              {detailPublishedAt}
            </div>
            <div className='mt-1 text-[12px] text-[var(--text-muted)]'>
              Source workflow: {sourceDraftLabel}
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
      {isShowcaseRoute && publication && (
        <div className='border-[var(--border)] border-b px-6 py-5'>
          <ShowcaseReadOnlyCanvas
            snapshotState={publication.snapshotState}
            title={detailTitle}
            description={detailDescription}
            versionLabel={`v${publication.versionNumber}`}
          />
        </div>
      )}
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
