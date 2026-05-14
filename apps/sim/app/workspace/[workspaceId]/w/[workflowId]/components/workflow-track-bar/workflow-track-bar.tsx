'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'
import { usePublishWorkflow, useWorkflowPublication } from '@/hooks/queries/workflows'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

interface WorkflowTrackBarProps {
  workspaceId: string
  workflowId: string
  workflow: WorkflowMetadata | undefined
  canPublish: boolean
  onNotify: (message: string, level?: 'info' | 'error') => void
}

function getVisibilityLabel(
  visibility: 'workspace' | 'organization' | 'selected_workgroups' | undefined
): string {
  if (visibility === 'organization') return 'Org Visible'
  if (visibility === 'selected_workgroups') return 'Scoped'
  return 'Team Only'
}

export function WorkflowTrackBar({
  workspaceId,
  workflowId,
  workflow,
  canPublish,
  onNotify,
}: WorkflowTrackBarProps) {
  const router = useRouter()
  const { data: publication } = useWorkflowPublication(workflowId)
  const publishWorkflow = usePublishWorkflow()

  const trackLabel = workflow?.track === 'published' ? 'Team Mainline' : 'Team Draft'
  const counterpartWorkflowId = useMemo(() => {
    if (workflow?.track === 'published') {
      return publication?.sourceWorkflowId ?? null
    }

    return publication?.publishedWorkflowId ?? null
  }, [publication?.publishedWorkflowId, publication?.sourceWorkflowId, workflow?.track])

  const visibilityLabel = getVisibilityLabel(
    workflow?.track === 'published'
      ? (publication?.visibility ?? workflow.visibility)
      : workflow?.visibility
  )

  const handleOpenCounterpart = () => {
    if (!counterpartWorkflowId) return
    router.push(`/workspace/${workspaceId}/w/${counterpartWorkflowId}`)
  }

  const handlePublish = async () => {
    try {
      const publishedWorkflow = await publishWorkflow.mutateAsync({
        workflowId,
        workspaceId,
        visibility: publication?.visibility ?? 'organization',
      })

      onNotify(`Published to mainline: ${publishedWorkflow.name}`, 'info')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to publish workflow'
      onNotify(message, 'error')
    }
  }

  return (
    <div className='absolute top-4 right-4 left-4 z-10 flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface-1)]/95 px-4 py-2 backdrop-blur'>
      <div className='flex items-center gap-3'>
        <div className='rounded-full bg-[var(--surface-3)] px-3 py-1 font-medium text-[var(--text-primary)] text-xs'>
          {trackLabel}
        </div>
        <div className='text-[var(--text-secondary)] text-xs'>{visibilityLabel}</div>
      </div>

      <div className='flex items-center gap-2'>
        {counterpartWorkflowId && (
          <Button variant='secondary' size='sm' onClick={handleOpenCounterpart}>
            {workflow?.track === 'published' ? 'Open Draft' : 'Open Mainline'}
          </Button>
        )}
        {workflow?.track !== 'published' && canPublish && (
          <Button
            variant='default'
            size='sm'
            onClick={handlePublish}
            disabled={publishWorkflow.isPending}
          >
            {publishWorkflow.isPending ? 'Publishing...' : 'Publish to Mainline'}
          </Button>
        )}
      </div>
    </div>
  )
}
