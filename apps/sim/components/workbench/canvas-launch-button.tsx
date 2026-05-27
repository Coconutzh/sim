'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { useCreateWorkflow, useWorkflows } from '@/hooks/queries/workflows'

const logger = createLogger('CanvasLaunchButton')

interface CanvasLaunchButtonProps {
  workspaceId: string
  label: string
  loadingLabel: string
  workflowName: string
  workflowDescription: string
  className: string
}

export function CanvasLaunchButton({
  workspaceId,
  label,
  loadingLabel,
  workflowName,
  workflowDescription,
  className,
}: CanvasLaunchButtonProps) {
  const router = useRouter()
  const { data: workflows = [], isLoading } = useWorkflows(workspaceId)
  const createWorkflow = useCreateWorkflow()
  const [isOpening, setIsOpening] = useState(false)

  const disabled = isLoading || isOpening || createWorkflow.isPending

  const openCanvas = async () => {
    if (disabled) return
    setIsOpening(true)
    try {
      const existingWorkflow = workflows.find((workflow) => workflow.workspaceId === workspaceId)
      const workflowId =
        existingWorkflow?.id ??
        (
          await createWorkflow.mutateAsync({
            workspaceId,
            name: workflowName,
            description: workflowDescription,
          })
        ).id

      router.push(`/workspace/${workspaceId}/w/${workflowId}`)
    } catch (error) {
      logger.error('Failed to open collaboration canvas', { workspaceId, error })
      setIsOpening(false)
    }
  }

  return (
    <button className={className} disabled={disabled} onClick={openCanvas} type='button'>
      {disabled ? loadingLabel : label}
    </button>
  )
}
