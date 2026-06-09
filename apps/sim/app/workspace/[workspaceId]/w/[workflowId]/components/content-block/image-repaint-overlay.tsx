'use client'

import type { ChangeEvent, RefObject } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Loader2, Paperclip, Send } from 'lucide-react'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type ImageGenerationResolution,
  repaintWorkspaceImageContract,
} from '@/lib/api/contracts/media-images'
import { resolveUserFileUrl } from '@/lib/core/utils/user-file'
import { ImageMaskEditorOverlay } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-mask-editor-overlay'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'

interface UploadedFileValue {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
}

interface ImageRepaintOverlayProps {
  workspaceId?: string
  rootRef: RefObject<HTMLDivElement | null>
  imageRef: RefObject<HTMLImageElement | null>
  sourceFile: UploadedFileValue
  isProcessingNode: boolean
  onCancel: () => void
  onCreateVariant: (file: UploadedFileValue) => Promise<void> | void
}

const REPAINT_RESOLUTION_OPTIONS: ImageGenerationResolution[] = ['1K', '2K', '4K']

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'Repaint failed. Please try again.'
}

function normalizeFile(file: UploadedFileValue) {
  const key = file.key?.trim() ?? ''
  const name = file.name?.trim() || key || 'image.png'

  return {
    id: file.id ?? '',
    name,
    url: resolveUserFileUrl(file),
    key,
    size: file.size ?? 0,
    type: file.type ?? 'image/png',
    context: file.context,
  }
}

function mapGeneratedFile(file: {
  id: string
  name: string
  url: string
  key: string
  size: number
  type: string
  context?: string
}): UploadedFileValue {
  return {
    id: file.id,
    name: file.name,
    path: file.url,
    key: file.key,
    size: file.size,
    type: file.type,
    context: file.context,
  }
}

export function ImageRepaintOverlay({
  workspaceId,
  rootRef,
  imageRef,
  sourceFile,
  isProcessingNode,
  onCancel,
  onCreateVariant,
}: ImageRepaintOverlayProps) {
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const uploadFileMutation = useUploadWorkspaceFile()
  const [prompt, setPrompt] = useState('')
  const [resolution, setResolution] = useState<ImageGenerationResolution>('2K')
  const [referenceImages, setReferenceImages] = useState<UploadedFileValue[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isProcessing = isSubmitting || isProcessingNode || uploadFileMutation.isPending

  const normalizedSourceFile = useMemo(() => normalizeFile(sourceFile), [sourceFile])
  const disabledReason = !workspaceId
    ? 'Missing workspace context.'
    : !normalizedSourceFile.key
      ? 'Source image is missing file information.'
      : null

  const handleReferenceFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? [])
      event.target.value = ''
      if (!workspaceId || files.length === 0) return

      setError(null)
      try {
        const uploaded = await Promise.all(
          files.map((file) =>
            uploadFileMutation.mutateAsync({
              workspaceId,
              file,
              skipToast: true,
            })
          )
        )
        setReferenceImages((current) => [
          ...current,
          ...uploaded.map((result) => ({
            id: result.file.id,
            name: result.file.name,
            path: result.file.url,
            key: result.file.key,
            size: result.file.size,
            type: result.file.type,
            context: result.file.context,
          })),
        ])
      } catch (caughtError) {
        setError(getErrorMessage(caughtError))
      }
    },
    [uploadFileMutation, workspaceId]
  )

  return (
    <ImageMaskEditorOverlay
      rootRef={rootRef}
      imageRef={imageRef}
      isProcessing={isProcessing}
      onCancel={onCancel}
      renderFooter={({ buildMaskImage, hasMask }) => {
        const submit = async () => {
          const trimmedPrompt = prompt.trim()
          if (!trimmedPrompt) {
            setError('Enter repaint instructions.')
            return
          }
          if (disabledReason || !workspaceId) {
            setError(disabledReason ?? 'Unable to submit repaint.')
            return
          }

          setIsSubmitting(true)
          setError(null)

          try {
            const mask = await buildMaskImage()
            if (!mask) {
              setError('Draw a mask before repainting.')
              return
            }

            const response = await requestJson(repaintWorkspaceImageContract, {
              body: {
                workspaceId,
                prompt: trimmedPrompt,
                resolution,
                sourceImage: normalizedSourceFile,
                maskImage: {
                  id: '',
                  name: 'repaint-mask.png',
                  url: '',
                  key: 'repaint-mask.png',
                  size: mask.size,
                  type: 'image/png',
                  base64: mask.base64,
                },
                referenceImages: referenceImages.map(normalizeFile),
              },
            })

            await onCreateVariant(mapGeneratedFile(response.file))
          } catch (caughtError) {
            setError(getErrorMessage(caughtError))
          } finally {
            setIsSubmitting(false)
          }
        }

        return (
          <div
            className='nodrag nopan mt-3 rounded-[8px] border border-white/10 bg-[#111111] p-2 shadow-2xl'
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <textarea
              value={prompt}
              placeholder='Describe what to repaint...'
              disabled={isProcessing}
              className='min-h-[58px] w-full resize-none rounded-[8px] border border-white/10 bg-[#171717] px-3 py-2 text-white text-xs outline-none placeholder:text-white/35 focus:border-white/25 disabled:cursor-not-allowed disabled:opacity-60'
              onChange={(event) => setPrompt(event.currentTarget.value)}
              onPointerDown={(event) => event.stopPropagation()}
            />
            <div className='mt-2 flex items-center justify-between gap-2'>
              <div className='flex min-w-0 items-center gap-2'>
                <input
                  ref={referenceInputRef}
                  type='file'
                  accept='image/*'
                  multiple
                  className='hidden'
                  onChange={handleReferenceFileChange}
                />
                <button
                  type='button'
                  aria-label='Upload reference images'
                  title='Upload reference images'
                  disabled={isProcessing || !workspaceId}
                  className='flex h-8 items-center gap-2 rounded-full px-2 text-white/55 text-xs transition-colors hover-hover:bg-white/10 hover-hover:text-white disabled:cursor-not-allowed disabled:opacity-45'
                  onClick={() => referenceInputRef.current?.click()}
                >
                  <Paperclip className='h-3.5 w-3.5' />
                  <span>
                    References{referenceImages.length > 0 ? ` ${referenceImages.length}` : ''}
                  </span>
                </button>
              </div>
              <div className='flex items-center gap-2'>
                <select
                  value={resolution}
                  disabled={isProcessing}
                  className='h-8 rounded-full border border-white/10 bg-[#171717] px-2 text-white/70 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-50'
                  onChange={(event) =>
                    setResolution(event.currentTarget.value as ImageGenerationResolution)
                  }
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {REPAINT_RESOLUTION_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <span className='rounded-full border border-white/10 bg-white/5 px-2 py-1 font-semibold text-[10px] text-white/75'>
                  PRO
                </span>
                <button
                  type='button'
                  aria-label='Submit repaint'
                  title={hasMask ? 'Submit repaint' : 'Draw a mask before repainting'}
                  disabled={isProcessing || Boolean(disabledReason) || !hasMask}
                  className='flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#111111] transition-opacity disabled:cursor-not-allowed disabled:opacity-45'
                  onClick={submit}
                >
                  {isSubmitting ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : (
                    <Send className='h-4 w-4' />
                  )}
                </button>
              </div>
            </div>
            {error || disabledReason ? (
              <div className='mt-2 rounded-[6px] border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-red-300'>
                {error ?? disabledReason}
              </div>
            ) : null}
          </div>
        )
      }}
    />
  )
}
