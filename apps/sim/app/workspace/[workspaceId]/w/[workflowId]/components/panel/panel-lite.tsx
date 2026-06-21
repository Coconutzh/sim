'use client'

import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/emcn'
import { usePanelStore } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const LazyCopilotTab = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/copilot-tab'
  ).then((mod) => ({
    default: mod.CopilotTab,
  }))
)

interface PanelLiteProps {
  workspaceId?: string
}

export function PanelLite({ workspaceId = '' }: PanelLiteProps) {
  const params = useParams()
  const resolvedWorkspaceId = workspaceId || (params.workspaceId as string)
  const [pendingCopilotMessage, setPendingCopilotMessage] = useState<string | null>(null)
  const { setActiveTab, isCollapsed, setCollapsed, setHasHydrated } = usePanelStore(
    useShallow((state) => ({
      setActiveTab: state.setActiveTab,
      isCollapsed: state.isCollapsed,
      setCollapsed: state.setCollapsed,
      setHasHydrated: state.setHasHydrated,
    }))
  )
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  useEffect(() => {
    setHasHydrated(true)
    setActiveTab('copilot')
  }, [setActiveTab, setHasHydrated])

  useEffect(() => {
    const handler = (event: Event) => {
      const message = (event as CustomEvent<{ message: string }>).detail?.message
      if (!message) return
      setCollapsed(false)
      setActiveTab('copilot')
      setPendingCopilotMessage(message)
    }

    window.addEventListener('mothership-send-message', handler)
    return () => window.removeEventListener('mothership-send-message', handler)
  }, [setActiveTab, setCollapsed])

  const handlePendingCopilotMessageConsumed = useCallback(() => {
    setPendingCopilotMessage(null)
  }, [])

  return (
    <aside
      className='panel-container relative shrink-0 overflow-visible bg-[var(--bg)] transition-[width] duration-150 ease-out'
      aria-label='Agent panel'
      data-state={isCollapsed ? 'collapsed' : 'expanded'}
    >
      {isCollapsed ? (
        <div className='flex h-full flex-col items-center border-[var(--border)] border-l bg-[var(--surface-2)] py-3'>
          <Button
            className='h-8 w-8 rounded-[8px] p-0'
            variant='ghost'
            onClick={() => setCollapsed(false)}
            aria-label='Expand Agent panel'
          >
            <ChevronLeft className='h-4 w-4' />
          </Button>
          <div className='mt-4 rotate-90 whitespace-nowrap text-[11px] text-[var(--text-muted)]'>
            Agent
          </div>
        </div>
      ) : (
        <div className='relative flex h-full min-h-0 flex-col border-[var(--border)] border-l bg-[var(--bg)]'>
          <Button
            className='absolute top-3 left-[-14px] z-30 h-7 w-7 rounded-full border border-[var(--border)] bg-[var(--surface-1)] p-0 shadow-sm'
            variant='ghost'
            onClick={() => setCollapsed(true)}
            aria-label='Collapse Agent panel'
          >
            <ChevronRight className='h-4 w-4' />
          </Button>

          <div className='flex min-h-0 flex-1 flex-col' data-tab-content='copilot'>
            <Suspense fallback={null}>
              <LazyCopilotTab
                workspaceId={resolvedWorkspaceId}
                activeWorkflowId={activeWorkflowId}
                isActive={!isCollapsed}
                pendingMessage={pendingCopilotMessage}
                onPendingMessageConsumed={handlePendingCopilotMessageConsumed}
              />
            </Suspense>
          </div>
        </div>
      )}
    </aside>
  )
}
