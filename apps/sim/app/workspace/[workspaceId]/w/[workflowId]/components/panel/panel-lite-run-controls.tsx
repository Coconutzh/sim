'use client'

import { useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/emcn'
import { Play, Square } from '@/components/emcn/icons'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'

interface PanelLiteRunControlsProps {
  autoRun?: boolean
}

export function PanelLiteRunControls({ autoRun = false }: PanelLiteRunControlsProps) {
  const didAutoRunRef = useRef(false)
  const { handleRunWorkflow, handleCancelExecution, isExecuting } = useWorkflowExecution()

  const runWorkflow = useCallback(async () => {
    await handleRunWorkflow()
  }, [handleRunWorkflow])

  const cancelWorkflow = useCallback(async () => {
    await handleCancelExecution()
  }, [handleCancelExecution])

  useEffect(() => {
    if (!autoRun || didAutoRunRef.current) return
    didAutoRunRef.current = true
    runWorkflow()
  }, [autoRun, runWorkflow])

  return (
    <Button
      className='h-[30px] gap-2 px-2.5'
      data-tour='run-button'
      variant={isExecuting ? 'active' : 'tertiary'}
      onClick={isExecuting ? cancelWorkflow : runWorkflow}
    >
      {isExecuting ? (
        <Square className='h-[11.5px] w-[11.5px] fill-current' />
      ) : (
        <Play className='h-[11.5px] w-[11.5px]' />
      )}
      {isExecuting ? 'Stop' : 'Run'}
    </Button>
  )
}
