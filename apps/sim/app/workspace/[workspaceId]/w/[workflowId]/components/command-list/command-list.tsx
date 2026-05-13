'use client'

import type { ComponentType } from 'react'
import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { Library, Search } from 'lucide-react'
import Image from 'next/image'
import { useParams, useRouter } from 'next/navigation'
import { usePreventZoom } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  getAddableContentNodePresets,
  type ContentNodePresetId,
} from '@/lib/product/content-node-presets'
import { useSearchModalStore } from '@/stores/modals/search/store'

const logger = createLogger('WorkflowCommandList')

interface UtilityCommand {
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
}

const utilityCommands: UtilityCommand[] = [
  {
    label: 'Logs',
    description: 'Open workflow logs for debugging.',
    icon: Library,
  },
  {
    label: 'Search Blocks',
    description: 'Find blocks and jump through the canvas.',
    icon: Search,
  },
] as const

/**
 * Empty workflow overlay that promotes content-node-first creation.
 */
export function CommandList() {
  const params = useParams()
  const router = useRouter()
  const openSearchModal = useSearchModalStore((s) => s.open)
  const preventZoomRef = usePreventZoom()
  const contentNodePresets = getAddableContentNodePresets()

  const workspaceId = params.workspaceId as string | undefined

  const handleContentNodeClick = useCallback((presetId: ContentNodePresetId) => {
    const event = new CustomEvent('add-content-node', {
      detail: { presetId },
    })
    window.dispatchEvent(event)
  }, [])

  const handleUtilityCommandClick = useCallback(
    (label: string) => {
      try {
        switch (label) {
          case 'Logs': {
            if (!workspaceId) {
              logger.warn('No workspace ID found, cannot navigate to logs from command list')
              return
            }
            router.push(`/workspace/${workspaceId}/logs`)
            return
          }
          case 'Search Blocks': {
            openSearchModal()
            return
          }
          default:
            logger.warn('Unknown utility command clicked in command list', { label })
        }
      } catch (error) {
        logger.error('Failed to handle utility command click in command list', { error, label })
      }
    },
    [openSearchModal, router, workspaceId]
  )

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types.includes('application/json')) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types.includes('application/json')) {
      return
    }

    event.preventDefault()

    try {
      const raw = event.dataTransfer.getData('application/json')
      if (!raw) return

      const data = JSON.parse(raw) as { type?: string; enableTriggerMode?: boolean }
      if (!data?.type || data.type === 'connectionBlock') return

      const overlayDropEvent = new CustomEvent('toolbar-drop-on-empty-workflow-overlay', {
        detail: {
          type: data.type,
          enableTriggerMode: data.enableTriggerMode ?? false,
          clientX: event.clientX,
          clientY: event.clientY,
        },
      })

      window.dispatchEvent(overlayDropEvent)
    } catch (error) {
      logger.error('Failed to handle drop on command list', { error })
    }
  }, [])

  return (
    <div
      ref={preventZoomRef}
      className={cn(
        'pointer-events-none absolute inset-0 mb-[50px] flex items-center justify-center'
      )}
    >
      <div
        data-tour='command-list'
        className='pointer-events-auto flex w-full max-w-[420px] flex-col gap-4 px-6'
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className='mb-2 flex flex-col items-center gap-3'>
          <Image
            src='/logo/b&w/text/b&w.svg'
            alt='Sim'
            width={99.56}
            height={48.56}
            className='opacity-70'
            style={{
              filter:
                'brightness(0) saturate(100%) invert(69%) sepia(0%) saturate(0%) hue-rotate(202deg) brightness(94%) contrast(89%)',
            }}
          />
          <div className='text-center'>
            <p className='font-medium text-[var(--text-primary)] text-sm'>
              Start with a content node
            </p>
            <p className='mt-1 text-[var(--text-tertiary)] text-xs'>
              Build like TapNow first. Advanced workflow configuration stays in the right panel.
            </p>
          </div>
        </div>

        <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
          {contentNodePresets.map((preset) => {
            const Icon = preset.icon

            return (
              <button
                key={preset.id}
                type='button'
                className='flex min-h-[74px] flex-col items-start gap-2 rounded-xl border border-[var(--border-1)] bg-[var(--surface-2)] px-3 py-3 text-left transition-colors hover-hover:bg-[var(--surface-3)]'
                onClick={() => handleContentNodeClick(preset.id)}
              >
                <div className='flex items-center gap-2'>
                  <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-4)] text-[var(--text-primary)]'>
                    <Icon className='h-4 w-4' />
                  </div>
                  <span className='font-medium text-[var(--text-primary)] text-sm'>
                    {preset.label}
                  </span>
                </div>
                <span className='text-[var(--text-tertiary)] text-xs'>{preset.description}</span>
              </button>
            )
          })}
        </div>

        <div className='mt-2 flex flex-col gap-2'>
          {utilityCommands.map((command) => {
            const Icon = command.icon

            return (
              <button
                key={command.label}
                type='button'
                className='flex items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover-hover:bg-[var(--surface-2)]'
                onClick={() => handleUtilityCommandClick(command.label)}
              >
                <div className='flex h-7 w-7 items-center justify-center rounded-md bg-[var(--surface-3)] text-[var(--text-tertiary)]'>
                  <Icon className='h-4 w-4' />
                </div>
                <div className='min-w-0 flex-1'>
                  <div className='font-medium text-[var(--text-primary)] text-sm'>
                    {command.label}
                  </div>
                  <div className='text-[var(--text-tertiary)] text-xs'>{command.description}</div>
                </div>
                <Button
                  className='pointer-events-none px-2 py-[3px] text-caption'
                  variant='3d'
                >
                  Open
                </Button>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
