'use client'

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/emcn'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import type { ToolbarRef } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/toolbar/toolbar'
import type { PanelTab } from '@/stores/panel'
import { usePanelStore } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const LazyCopilotTab = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/copilot-tab'
  ).then((mod) => ({
    default: mod.CopilotTab,
  }))
)

const LazyEditor = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/editor-lite'
  ).then((mod) => ({
    default: mod.EditorLite,
  }))
)

const LazyToolbar = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/toolbar/toolbar'
  ).then((mod) => ({
    default: mod.Toolbar,
  }))
)

const LazyRunControls = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/panel-lite-run-controls'
  ).then((mod) => ({
    default: mod.PanelLiteRunControls,
  }))
)

interface PanelLiteProps {
  workspaceId?: string
}

export function PanelLite({ workspaceId = '' }: PanelLiteProps) {
  const params = useParams()
  const resolvedWorkspaceId = workspaceId || (params.workspaceId as string)
  const toolbarRef = useRef<ToolbarRef | null>(null)
  const [pendingCopilotMessage, setPendingCopilotMessage] = useState<string | null>(null)
  const [runControlsLoaded, setRunControlsLoaded] = useState(false)
  const { activeTab, setActiveTab, panelWidth, _hasHydrated, setHasHydrated } = usePanelStore(
    useShallow((state) => ({
      activeTab: state.activeTab,
      setActiveTab: state.setActiveTab,
      panelWidth: state.panelWidth,
      _hasHydrated: state._hasHydrated,
      setHasHydrated: state.setHasHydrated,
    }))
  )
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  useEffect(() => {
    setHasHydrated(true)
  }, [setHasHydrated])

  useEffect(() => {
    const handler = (e: Event) => {
      const message = (e as CustomEvent<{ message: string }>).detail?.message
      if (!message) return
      setPendingCopilotMessage(message)
      setActiveTab('copilot')
    }
    window.addEventListener('mothership-send-message', handler)
    return () => window.removeEventListener('mothership-send-message', handler)
  }, [setActiveTab])

  const handlePendingCopilotMessageConsumed = useCallback(() => {
    setPendingCopilotMessage(null)
  }, [])

  const handleTabClick = useCallback(
    (tab: PanelTab) => {
      setActiveTab(tab)
    },
    [setActiveTab]
  )

  useRegisterGlobalCommands([
    {
      id: 'focus-toolbar-search',
      shortcut: 'mod+f',
      handler: () => {
        setActiveTab('toolbar')
        toolbarRef.current?.focusSearch()
      },
    },
  ])

  const shouldMountCopilotTab = activeTab === 'copilot'
  const shouldMountEditorTab = activeTab === 'editor'
  const shouldMountToolbarTab = activeTab === 'toolbar'

  return (
    <aside
      className='relative flex h-full flex-col border-[var(--border)] border-l bg-[var(--surface-2)]'
      style={{ width: panelWidth }}
    >
      <div className='flex h-full min-h-0 flex-col'>
        <div className='flex flex-shrink-0 items-center justify-between border-[var(--border)] border-b px-3 py-2'>
          <div className='font-medium text-[13px] text-[var(--text-primary)]'>Editor</div>
          <Suspense
            fallback={
              <Button className='h-[30px] gap-2 px-2.5' data-tour='run-button' variant='tertiary'>
                Run
              </Button>
            }
          >
            {runControlsLoaded ? (
              <LazyRunControls autoRun />
            ) : (
              <Button
                className='h-[30px] gap-2 px-2.5'
                data-tour='run-button'
                variant='tertiary'
                onClick={() => setRunControlsLoaded(true)}
              >
                Run
              </Button>
            )}
          </Suspense>
        </div>

        <div className='flex flex-shrink-0 items-center justify-between px-2 pt-3.5'>
          <div className='flex gap-1'>
            <Button
              className='h-[28px] truncate rounded-md border px-2 py-[5px] text-[12.5px]'
              variant={_hasHydrated && activeTab === 'copilot' ? 'active' : 'ghost'}
              onClick={() => handleTabClick('copilot')}
              data-tab-button='copilot'
              data-tour='tab-copilot'
            >
              Copilot
            </Button>
            <Button
              className='h-[28px] rounded-md border px-2 py-[5px] text-[12.5px]'
              variant={_hasHydrated && activeTab === 'toolbar' ? 'active' : 'ghost'}
              onClick={() => handleTabClick('toolbar')}
              data-tab-button='toolbar'
              data-tour='tab-toolbar'
            >
              Toolbar
            </Button>
            <Button
              className='h-[28px] rounded-md border px-2 py-[5px] text-[12.5px]'
              variant={_hasHydrated && activeTab === 'editor' ? 'active' : 'ghost'}
              onClick={() => handleTabClick('editor')}
              data-tab-button='editor'
              data-tour='tab-editor'
            >
              Advanced
            </Button>
          </div>
        </div>

        <div className='min-h-0 flex-1 overflow-hidden pt-3'>
          {shouldMountCopilotTab && (
            <div className='flex h-full flex-col' data-tab-content='copilot'>
              <Suspense fallback={null}>
                <LazyCopilotTab
                  workspaceId={resolvedWorkspaceId}
                  activeWorkflowId={activeWorkflowId}
                  isActive={activeTab === 'copilot'}
                  pendingMessage={pendingCopilotMessage}
                  onPendingMessageConsumed={handlePendingCopilotMessageConsumed}
                />
              </Suspense>
            </div>
          )}
          {shouldMountEditorTab && (
            <div className='h-full' data-tab-content='editor'>
              <Suspense fallback={null}>
                <LazyEditor />
              </Suspense>
            </div>
          )}
          {shouldMountToolbarTab && (
            <div className='h-full' data-tab-content='toolbar'>
              <Suspense fallback={null}>
                <LazyToolbar ref={toolbarRef} isActive={activeTab === 'toolbar'} />
              </Suspense>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
