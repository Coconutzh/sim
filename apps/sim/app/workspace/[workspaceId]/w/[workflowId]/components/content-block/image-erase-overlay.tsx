'use client'

import type { RefObject } from 'react'
import { useCallback, useState } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import type { ImageGenerationResolution } from '@/lib/api/contracts/media-images'
import { ImageMaskEditorOverlay } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-mask-editor-overlay'
import { useImageEraseSession } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-image-erase-session'

interface UploadedFileValue {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
}

interface ImageEraseOverlayProps {
  workspaceId?: string
  rootRef: RefObject<HTMLDivElement | null>
  imageRef: RefObject<HTMLImageElement | null>
  sourceFile: UploadedFileValue
  isProcessingNode: boolean
  onCancel: () => void
  onCreateVariant: (file: UploadedFileValue) => Promise<void> | void
}

const ERASE_RESOLUTION_OPTIONS: ImageGenerationResolution[] = ['1K', '2K', '4K']

export function ImageEraseOverlay({
  workspaceId,
  rootRef,
  imageRef,
  sourceFile,
  isProcessingNode,
  onCancel,
  onCreateVariant,
}: ImageEraseOverlayProps) {
  const [resolution, setResolution] = useState<ImageGenerationResolution>('2K')
  const { abort, disabledReason, error, isSubmitting, setError, submit } = useImageEraseSession({
    workspaceId,
    sourceFile,
    onCreateVariant,
  })
  const isProcessing = isProcessingNode || isSubmitting

  const cancel = useCallback(() => {
    abort()
    onCancel()
  }, [abort, onCancel])

  return (
    <ImageMaskEditorOverlay
      rootRef={rootRef}
      imageRef={imageRef}
      isProcessing={isProcessing}
      onCancel={cancel}
      renderFooter={({ buildMaskImage, hasMask }) => {
        const submitErase = async () => {
          const mask = await buildMaskImage()
          if (!mask) {
            setError('Draw a mask before erasing.')
            return
          }
          await submit({ mask, resolution })
        }

        return (
          <div
            className='nodrag nopan relative mt-3 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-1)]/95 p-2 text-[var(--text-primary)] shadow-2xl backdrop-blur'
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className='min-w-0 flex-1 truncate px-2 text-[var(--text-muted)] text-xs'>
              Draw a mask to erase
            </div>
            <select
              value={resolution}
              disabled={isProcessing}
              className='h-8 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[var(--text-secondary)] text-xs outline-none disabled:cursor-not-allowed disabled:opacity-50'
              onChange={(event) =>
                setResolution(event.currentTarget.value as ImageGenerationResolution)
              }
              onPointerDown={(event) => event.stopPropagation()}
            >
              {ERASE_RESOLUTION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <span className='rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 font-semibold text-[10px] text-[var(--text-muted)]'>
              PRO
            </span>
            <button
              type='button'
              aria-label='Submit erase'
              title={hasMask ? 'Submit erase' : 'Draw a mask before erasing'}
              disabled={isProcessing || Boolean(disabledReason) || !hasMask}
              className='flex h-8 w-8 items-center justify-center rounded-full bg-[var(--text-primary)] text-[var(--text-inverse)] transition-opacity disabled:cursor-not-allowed disabled:opacity-45'
              onClick={submitErase}
            >
              {isSubmitting ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <ArrowUp className='h-4 w-4' />
              )}
            </button>
            {error || disabledReason ? (
              <div className='absolute top-full right-0 mt-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] text-[var(--text-error)] shadow-xl'>
                {error ?? disabledReason}
              </div>
            ) : null}
          </div>
        )
      }}
    />
  )
}
