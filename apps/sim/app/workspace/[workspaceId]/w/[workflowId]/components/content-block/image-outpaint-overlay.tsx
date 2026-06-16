'use client'

import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, Loader2, Proportions, Send, X } from 'lucide-react'
import type {
  ImageGenerationResolution,
  ImageOutpaintAspectRatio,
} from '@/lib/api/contracts/media-images'
import { cn } from '@/lib/core/utils/cn'
import {
  clamp,
  clampFrameToContainSubject,
  createInitialContainingFrame,
  fitFrameToAspectRatio,
  getElementScale,
  getPlacementFromFrame,
  getRelativeElementRect,
  type Rect,
  type ResizeHandle,
  resizeFrameToContainSubject,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-edit-geometry'
import { useImageOutpaintSession } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-image-outpaint-session'

interface UploadedFileValue {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
}

interface ImageOutpaintOverlayProps {
  workspaceId?: string
  rootRef: RefObject<HTMLDivElement | null>
  imageRef: RefObject<HTMLImageElement | null>
  sourceFile: UploadedFileValue
  isProcessingNode: boolean
  onCancel: () => void
  onCreateVariant: (
    file: UploadedFileValue,
    targetAspectRatio: ImageOutpaintAspectRatio
  ) => Promise<void> | void
}

type OutpaintInteraction =
  | {
      type: 'move'
      pointerId: number
      pointer: { x: number; y: number }
      frame: Rect
    }
  | {
      type: 'resize'
      handle: ResizeHandle
      pointerId: number
      pointer: { x: number; y: number }
      frame: Rect
    }

const RESOLUTION_OPTIONS: ImageGenerationResolution[] = ['1K', '2K', '4K']
const DEFAULT_CUSTOM_RATIO = { width: '1', height: '1' }
const ASPECT_RATIO_OPTIONS: Array<{ id: ImageOutpaintAspectRatio; label: string }> = [
  { id: 'original', label: '原图比例' },
  { id: '1:1', label: '1 : 1' },
  { id: '4:3', label: '4 : 3' },
  { id: '3:4', label: '3 : 4' },
  { id: '16:9', label: '16 : 9' },
  { id: '9:16', label: '9 : 16' },
  { id: '21:9', label: '21 : 9' },
  { id: 'custom', label: '自定义...' },
]
const HANDLE_CLASSES: Record<ResizeHandle, string> = {
  n: 'top-[-5px] left-1/2 h-2.5 w-8 -translate-x-1/2 cursor-ns-resize',
  s: 'bottom-[-5px] left-1/2 h-2.5 w-8 -translate-x-1/2 cursor-ns-resize',
  e: 'right-[-5px] top-1/2 h-8 w-2.5 -translate-y-1/2 cursor-ew-resize',
  w: 'left-[-5px] top-1/2 h-8 w-2.5 -translate-y-1/2 cursor-ew-resize',
  nw: 'top-[-5px] left-[-5px] h-3.5 w-3.5 cursor-nwse-resize',
  ne: 'top-[-5px] right-[-5px] h-3.5 w-3.5 cursor-nesw-resize',
  sw: 'bottom-[-5px] left-[-5px] h-3.5 w-3.5 cursor-nesw-resize',
  se: 'right-[-5px] bottom-[-5px] h-3.5 w-3.5 cursor-nwse-resize',
}
const RATIO_VALUES: Partial<Record<ImageOutpaintAspectRatio, number>> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '21:9': 21 / 9,
}

function getCustomRatio(customRatio: { width: string; height: string }): number | null {
  const width = Number(customRatio.width)
  const height = Number(customRatio.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return width / height
}

export function ImageOutpaintOverlay({
  workspaceId,
  rootRef,
  imageRef,
  sourceFile,
  isProcessingNode,
  onCancel,
  onCreateVariant,
}: ImageOutpaintOverlayProps) {
  const [subjectBounds, setSubjectBounds] = useState<Rect | null>(null)
  const [frame, setFrame] = useState<Rect | null>(null)
  const [aspectRatio, setAspectRatio] = useState<ImageOutpaintAspectRatio>('original')
  const [customRatio, setCustomRatio] = useState(DEFAULT_CUSTOM_RATIO)
  const [resolution, setResolution] = useState<ImageGenerationResolution>('2K')
  const [isAspectMenuOpen, setIsAspectMenuOpen] = useState(false)
  const [interaction, setInteraction] = useState<OutpaintInteraction | null>(null)
  const pointerCaptureRef = useRef<{ element: HTMLElement; pointerId: number } | null>(null)
  const selectedRatio = useMemo(() => {
    if (aspectRatio === 'original') {
      return subjectBounds ? subjectBounds.width / subjectBounds.height : null
    }
    if (aspectRatio === 'custom') return getCustomRatio(customRatio)
    return RATIO_VALUES[aspectRatio] ?? null
  }, [aspectRatio, customRatio, subjectBounds])
  const isProcessing = isProcessingNode
  const { abort, disabledReason, error, isSubmitting, setError, submit } = useImageOutpaintSession({
    workspaceId,
    sourceFile,
    onCreateVariant,
  })
  const controlsDisabled = isProcessing || isSubmitting

  const updateBounds = useCallback(() => {
    const root = rootRef.current
    const image = imageRef.current
    if (!root || !image) return
    const nextSubjectBounds = getRelativeElementRect({ root, element: image })
    if (nextSubjectBounds.width <= 0 || nextSubjectBounds.height <= 0) return

    setSubjectBounds(nextSubjectBounds)
    setFrame((current) =>
      current
        ? clampFrameToContainSubject(current, nextSubjectBounds)
        : createInitialContainingFrame(nextSubjectBounds)
    )
  }, [imageRef, rootRef])

  useEffect(() => {
    updateBounds()
    const root = rootRef.current
    const image = imageRef.current
    if (!root || !image || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateBounds)
    observer.observe(root)
    observer.observe(image)
    window.addEventListener('resize', updateBounds)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateBounds)
    }
  }, [imageRef, rootRef, updateBounds])

  useEffect(() => {
    if (!subjectBounds || !frame || !selectedRatio) return
    setFrame(fitFrameToAspectRatio({ frame, subject: subjectBounds, ratio: selectedRatio }))
  }, [aspectRatio, customRatio.height, customRatio.width, selectedRatio])

  useEffect(() => {
    if (!interaction || !subjectBounds) return

    const releasePointerCapture = () => {
      const capture = pointerCaptureRef.current
      if (!capture) return
      if (capture.element.hasPointerCapture(capture.pointerId)) {
        capture.element.releasePointerCapture(capture.pointerId)
      }
      pointerCaptureRef.current = null
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      const root = rootRef.current
      const scale = root ? getElementScale(root) : { scaleX: 1, scaleY: 1 }
      const delta = {
        x: (event.clientX - interaction.pointer.x) / scale.scaleX,
        y: (event.clientY - interaction.pointer.y) / scale.scaleY,
      }

      if (interaction.type === 'move') {
        setFrame(
          clampFrameToContainSubject(
            {
              ...interaction.frame,
              x: interaction.frame.x + delta.x,
              y: interaction.frame.y + delta.y,
            },
            subjectBounds
          )
        )
        return
      }

      setFrame(
        resizeFrameToContainSubject({
          frame: interaction.frame,
          handle: interaction.handle,
          delta,
          subject: subjectBounds,
          ratio: selectedRatio,
        })
      )
    }

    const clearInteraction = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      releasePointerCapture()
      setInteraction(null)
    }

    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', clearInteraction, true)
    window.addEventListener('pointercancel', clearInteraction, true)
    return () => {
      releasePointerCapture()
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', clearInteraction, true)
      window.removeEventListener('pointercancel', clearInteraction, true)
    }
  }, [interaction, rootRef, selectedRatio, subjectBounds])

  const startInteraction = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      nextInteraction: { type: 'move' } | { type: 'resize'; handle: ResizeHandle }
    ) => {
      event.preventDefault()
      event.stopPropagation()
      if (!frame || controlsDisabled) return
      event.currentTarget.setPointerCapture(event.pointerId)
      pointerCaptureRef.current = {
        element: event.currentTarget,
        pointerId: event.pointerId,
      }
      setError(null)
      setInteraction({
        ...nextInteraction,
        pointerId: event.pointerId,
        pointer: { x: event.clientX, y: event.clientY },
        frame,
      })
    },
    [controlsDisabled, frame, setError]
  )

  const selectAspectRatio = useCallback((nextAspectRatio: ImageOutpaintAspectRatio) => {
    setAspectRatio(nextAspectRatio)
    if (nextAspectRatio !== 'custom') {
      setIsAspectMenuOpen(false)
    }
  }, [])

  const cancel = useCallback(() => {
    abort()
    onCancel()
  }, [abort, onCancel])

  const handleSubmit = useCallback(async () => {
    if (!frame || !subjectBounds) return
    if (aspectRatio === 'custom') {
      const width = Number(customRatio.width)
      const height = Number(customRatio.height)
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        setError('请输入有效的自定义比例。')
        return
      }
    }

    await submit({
      placement: getPlacementFromFrame({ frame, subject: subjectBounds }),
      resolution,
      targetAspectRatio: aspectRatio,
      customAspectRatio:
        aspectRatio === 'custom'
          ? {
              width: Number(customRatio.width),
              height: Number(customRatio.height),
            }
          : undefined,
    })
  }, [
    aspectRatio,
    customRatio.height,
    customRatio.width,
    frame,
    resolution,
    setError,
    subjectBounds,
    submit,
  ])

  const currentAspectLabel =
    ASPECT_RATIO_OPTIONS.find((option) => option.id === aspectRatio)?.label ?? '原图比例'

  return (
    <>
      {subjectBounds && frame ? (
        <div
          className='nodrag nopan absolute z-[88]'
          style={{
            left: frame.x,
            top: frame.y,
            width: frame.width,
            height: frame.height,
          }}
          onPointerDown={(event) => startInteraction(event, { type: 'move' })}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <div className='pointer-events-none absolute inset-0 border-2 border-white bg-white/[0.03] shadow-[0_0_0_9999px_rgba(0,0,0,0.56)]' />
          <div
            className='pointer-events-none absolute border border-white/70 bg-transparent'
            style={{
              left: subjectBounds.x - frame.x,
              top: subjectBounds.y - frame.y,
              width: subjectBounds.width,
              height: subjectBounds.height,
            }}
          />
          {(Object.keys(HANDLE_CLASSES) as ResizeHandle[]).map((handle) => (
            <button
              key={handle}
              type='button'
              aria-label={`调整扩图框 ${handle}`}
              title={`调整扩图框 ${handle}`}
              disabled={controlsDisabled}
              className={cn(
                'nodrag nopan absolute rounded-full border border-white bg-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50',
                HANDLE_CLASSES[handle]
              )}
              onPointerDown={(event) => startInteraction(event, { type: 'resize', handle })}
            />
          ))}
        </div>
      ) : null}

      <div
        className='nodrag nopan -translate-x-1/2 absolute left-1/2 z-[94] flex items-center gap-2 rounded-full border border-white/10 bg-[#151515] px-3 py-2 text-white shadow-2xl'
        style={{
          top: frame ? frame.y + frame.height + 18 : undefined,
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type='button'
          aria-label='退出扩图'
          title='退出扩图'
          disabled={controlsDisabled}
          className='flex h-8 w-8 items-center justify-center rounded-full text-white/65 transition-colors hover-hover:bg-white/10 hover-hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
          onClick={cancel}
        >
          <X className='h-4 w-4' />
        </button>
        <div className='h-5 w-px bg-white/10' />
        <div className='relative'>
          <button
            type='button'
            aria-label='选择扩图比例'
            title='选择扩图比例'
            disabled={controlsDisabled}
            className='flex h-8 items-center gap-1.5 rounded-full px-2 text-white/70 text-xs transition-colors hover-hover:bg-white/10 hover-hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
            onClick={() => setIsAspectMenuOpen((current) => !current)}
          >
            <Proportions className='h-3.5 w-3.5' />
            <span className='max-w-[72px] truncate'>{currentAspectLabel}</span>
          </button>

          {isAspectMenuOpen ? (
            <div className='absolute bottom-[calc(100%+10px)] left-0 z-[96] w-32 rounded-[8px] border border-white/10 bg-[#262626] p-1 shadow-2xl'>
              {ASPECT_RATIO_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type='button'
                  className={cn(
                    'flex w-full items-center rounded-[6px] px-2 py-1.5 text-left text-xs transition-colors hover-hover:bg-white/10',
                    aspectRatio === option.id ? 'text-white' : 'text-white/70'
                  )}
                  onClick={() => selectAspectRatio(option.id)}
                >
                  {option.label}
                </button>
              ))}
              {aspectRatio === 'custom' ? (
                <div className='mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-1 border-white/10 border-t pt-2'>
                  <input
                    aria-label='自定义扩图宽比'
                    type='number'
                    min='1'
                    value={customRatio.width}
                    className='h-7 rounded-[6px] border border-white/10 bg-[#171717] px-2 text-white text-xs outline-none focus:border-white/35'
                    onChange={(event) => {
                      const width = clamp(Number(event.currentTarget.value), 1, 1000)
                      setCustomRatio((current) => ({
                        ...current,
                        width: Number.isFinite(width) ? String(width) : event.currentTarget.value,
                      }))
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  />
                  <span className='text-white/35 text-xs'>:</span>
                  <input
                    aria-label='自定义扩图高比'
                    type='number'
                    min='1'
                    value={customRatio.height}
                    className='h-7 rounded-[6px] border border-white/10 bg-[#171717] px-2 text-white text-xs outline-none focus:border-white/35'
                    onChange={(event) => {
                      const height = clamp(Number(event.currentTarget.value), 1, 1000)
                      setCustomRatio((current) => ({
                        ...current,
                        height: Number.isFinite(height)
                          ? String(height)
                          : event.currentTarget.value,
                      }))
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <span className='hidden whitespace-nowrap text-[11px] text-white/35 sm:inline'>
          拖拽外框进行扩图
        </span>
        <div className='flex items-center gap-1'>
          {RESOLUTION_OPTIONS.map((option) => (
            <button
              key={option}
              type='button'
              disabled={controlsDisabled}
              className={cn(
                'h-8 rounded-full border px-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                resolution === option
                  ? 'border-white/20 bg-white/10 text-white'
                  : 'border-white/10 text-white/55 hover-hover:bg-white/10 hover-hover:text-white'
              )}
              onClick={() => setResolution(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <span className='rounded-full border border-white/10 bg-white/5 px-2 py-1 font-semibold text-[10px] text-white/75'>
          PRO
        </span>
        <span className='hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/65 md:inline-flex'>
          <ImageIcon className='h-3 w-3' />
          15
        </span>
        <button
          type='button'
          aria-label='提交扩图'
          title='提交扩图'
          disabled={controlsDisabled || Boolean(disabledReason) || !frame}
          className='flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#111111] transition-opacity disabled:cursor-not-allowed disabled:opacity-45'
          onClick={handleSubmit}
        >
          {isSubmitting ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <Send className='h-4 w-4' />
          )}
        </button>
      </div>

      {error || disabledReason ? (
        <div
          className='nodrag nopan -translate-x-1/2 absolute left-1/2 z-[94] rounded-[8px] border border-white/10 bg-[#151515] px-3 py-2 text-[11px] text-red-300 shadow-xl'
          style={{
            top: frame ? frame.y + frame.height + 68 : undefined,
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {error ?? disabledReason}
        </div>
      ) : null}
    </>
  )
}
