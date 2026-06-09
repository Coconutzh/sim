'use client'

import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Proportions, X } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'

interface CropBounds {
  left: number
  top: number
  width: number
  height: number
  scaleX: number
  scaleY: number
}

interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

type RatioMode = 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | 'custom'
type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

interface CropInteraction {
  type: 'move' | 'resize'
  handle?: ResizeHandle
  pointer: { x: number; y: number }
  rect: CropRect
}

export interface ImageCropOverlayProps {
  rootRef: RefObject<HTMLDivElement | null>
  imageRef: RefObject<HTMLImageElement | null>
  imageName?: string
  imageType?: string
  isProcessing: boolean
  onCancel: () => void
  onConfirm: (file: File) => Promise<void>
}

const MIN_CROP_SIZE = 24
const DEFAULT_CUSTOM_RATIO: { width: string; height: string } = { width: '1', height: '1' }

const RATIO_OPTIONS: Array<{ id: RatioMode; label: string; ratio: number | null }> = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: 'custom', label: 'Custom', ratio: null },
] as const

const RESIZE_HANDLE_CLASSES: Record<ResizeHandle, string> = {
  n: 'top-[-5px] left-1/2 h-2.5 w-7 -translate-x-1/2 cursor-ns-resize',
  s: 'bottom-[-5px] left-1/2 h-2.5 w-7 -translate-x-1/2 cursor-ns-resize',
  e: 'right-[-5px] top-1/2 h-7 w-2.5 -translate-y-1/2 cursor-ew-resize',
  w: 'left-[-5px] top-1/2 h-7 w-2.5 -translate-y-1/2 cursor-ew-resize',
  nw: 'top-[-5px] left-[-5px] h-3 w-3 cursor-nwse-resize',
  ne: 'top-[-5px] right-[-5px] h-3 w-3 cursor-nesw-resize',
  sw: 'bottom-[-5px] left-[-5px] h-3 w-3 cursor-nesw-resize',
  se: 'right-[-5px] bottom-[-5px] h-3 w-3 cursor-nwse-resize',
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getElementScale(element: HTMLElement): { scaleX: number; scaleY: number } {
  const rect = element.getBoundingClientRect()
  return {
    scaleX: element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1,
    scaleY: element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1,
  }
}

function getLargestCropForRatio(bounds: CropBounds, ratio: number | null): CropRect {
  if (!ratio) {
    const width = bounds.width * 0.8
    const height = bounds.height * 0.8
    return {
      x: (bounds.width - width) / 2,
      y: (bounds.height - height) / 2,
      width,
      height,
    }
  }

  const widthFromFullHeight = bounds.height * ratio
  const width = widthFromFullHeight <= bounds.width ? widthFromFullHeight : bounds.width
  const height = width / ratio

  return {
    x: (bounds.width - width) / 2,
    y: (bounds.height - height) / 2,
    width,
    height,
  }
}

function getOutputImageType(imageType?: string): string {
  if (imageType === 'image/jpeg' || imageType === 'image/png' || imageType === 'image/webp') {
    return imageType
  }
  return 'image/png'
}

function getOutputFileName(imageName: string | undefined, outputType: string): string {
  const extension =
    outputType === 'image/jpeg' ? 'jpg' : outputType === 'image/webp' ? 'webp' : 'png'
  const baseName = (imageName || 'image').replace(/\.[^.]+$/, '')
  return `${baseName}-crop.${extension}`
}

function resizeFreeCrop(
  start: CropRect,
  handle: ResizeHandle,
  delta: { x: number; y: number },
  bounds: CropBounds
): CropRect {
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height

  if (handle.includes('w')) left = clamp(left + delta.x, 0, right - MIN_CROP_SIZE)
  if (handle.includes('e')) right = clamp(right + delta.x, left + MIN_CROP_SIZE, bounds.width)
  if (handle.includes('n')) top = clamp(top + delta.y, 0, bottom - MIN_CROP_SIZE)
  if (handle.includes('s')) bottom = clamp(bottom + delta.y, top + MIN_CROP_SIZE, bounds.height)

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

function resizeLockedCrop(
  start: CropRect,
  handle: ResizeHandle,
  delta: { x: number; y: number },
  bounds: CropBounds,
  ratio: number
): CropRect {
  const hasHorizontalHandle = handle.includes('e') || handle.includes('w')
  const hasVerticalHandle = handle.includes('n') || handle.includes('s')
  const horizontalSign = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0
  const verticalSign = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0
  const candidateWidth = hasHorizontalHandle ? start.width + horizontalSign * delta.x : 0
  const candidateHeight = hasVerticalHandle ? start.height + verticalSign * delta.y : 0
  const useWidth =
    hasHorizontalHandle &&
    (!hasVerticalHandle ||
      Math.abs(candidateWidth - start.width) >= Math.abs(candidateHeight - start.height) * ratio)
  let desiredWidth = useWidth ? candidateWidth : candidateHeight * ratio

  if (!Number.isFinite(desiredWidth) || desiredWidth <= 0) {
    desiredWidth = start.width
  }

  const centerX = start.x + start.width / 2
  const centerY = start.y + start.height / 2
  const maxWidthByX = handle.includes('e')
    ? bounds.width - start.x
    : handle.includes('w')
      ? start.x + start.width
      : Math.min(centerX, bounds.width - centerX) * 2
  const maxHeightByY = handle.includes('s')
    ? bounds.height - start.y
    : handle.includes('n')
      ? start.y + start.height
      : Math.min(centerY, bounds.height - centerY) * 2
  const maxWidth = Math.max(MIN_CROP_SIZE, Math.min(maxWidthByX, maxHeightByY * ratio))
  const minWidth = Math.min(maxWidth, Math.max(MIN_CROP_SIZE, MIN_CROP_SIZE * ratio))
  const width = clamp(desiredWidth, minWidth, maxWidth)
  const height = width / ratio

  const x = handle.includes('e')
    ? start.x
    : handle.includes('w')
      ? start.x + start.width - width
      : centerX - width / 2
  const y = handle.includes('s')
    ? start.y
    : handle.includes('n')
      ? start.y + start.height - height
      : centerY - height / 2

  return {
    x: clamp(x, 0, bounds.width - width),
    y: clamp(y, 0, bounds.height - height),
    width,
    height,
  }
}

export function ImageCropOverlay({
  rootRef,
  imageRef,
  imageName,
  imageType,
  isProcessing,
  onCancel,
  onConfirm,
}: ImageCropOverlayProps) {
  const [bounds, setBounds] = useState<CropBounds | null>(null)
  const [cropRect, setCropRect] = useState<CropRect | null>(null)
  const [ratioMode, setRatioMode] = useState<RatioMode>('free')
  const [customRatio, setCustomRatio] = useState(DEFAULT_CUSTOM_RATIO)
  const [isRatioMenuOpen, setIsRatioMenuOpen] = useState(false)
  const [interaction, setInteraction] = useState<CropInteraction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedRatio = useMemo(() => {
    if (ratioMode === 'custom') {
      const width = Number(customRatio.width)
      const height = Number(customRatio.height)
      return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
        ? width / height
        : null
    }
    return RATIO_OPTIONS.find((option) => option.id === ratioMode)?.ratio ?? null
  }, [customRatio.height, customRatio.width, ratioMode])

  const updateBounds = useCallback(() => {
    const root = rootRef.current
    const image = imageRef.current
    if (!root || !image) return

    const rootRect = root.getBoundingClientRect()
    const imageRect = image.getBoundingClientRect()
    if (imageRect.width <= 0 || imageRect.height <= 0) return
    const { scaleX, scaleY } = getElementScale(root)

    setBounds({
      left: (imageRect.left - rootRect.left) / scaleX,
      top: (imageRect.top - rootRect.top) / scaleY,
      width: imageRect.width / scaleX,
      height: imageRect.height / scaleY,
      scaleX,
      scaleY,
    })
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
    if (!bounds) return
    setCropRect((current) => current ?? getLargestCropForRatio(bounds, selectedRatio))
  }, [bounds, selectedRatio])

  useEffect(() => {
    if (!bounds || ratioMode === 'free') return
    setCropRect(getLargestCropForRatio(bounds, selectedRatio))
  }, [bounds, ratioMode, selectedRatio])

  useEffect(() => {
    if (!interaction || !bounds || !cropRect) return

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const root = rootRef.current
      const scale = root ? getElementScale(root) : bounds
      const delta = {
        x: (event.clientX - interaction.pointer.x) / scale.scaleX,
        y: (event.clientY - interaction.pointer.y) / scale.scaleY,
      }

      if (interaction.type === 'move') {
        setCropRect({
          ...interaction.rect,
          x: clamp(interaction.rect.x + delta.x, 0, bounds.width - interaction.rect.width),
          y: clamp(interaction.rect.y + delta.y, 0, bounds.height - interaction.rect.height),
        })
        return
      }

      if (!interaction.handle) return
      setCropRect(
        selectedRatio
          ? resizeLockedCrop(interaction.rect, interaction.handle, delta, bounds, selectedRatio)
          : resizeFreeCrop(interaction.rect, interaction.handle, delta, bounds)
      )
    }

    const clearInteraction = (event: PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setInteraction(null)
    }

    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', clearInteraction, true)
    window.addEventListener('pointercancel', clearInteraction, true)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', clearInteraction, true)
      window.removeEventListener('pointercancel', clearInteraction, true)
    }
  }, [bounds, cropRect, interaction, rootRef, selectedRatio])

  const startInteraction = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      nextInteraction: Pick<CropInteraction, 'type' | 'handle'>
    ) => {
      if (!cropRect || isProcessing) return
      event.preventDefault()
      event.stopPropagation()
      setInteraction({
        ...nextInteraction,
        pointer: { x: event.clientX, y: event.clientY },
        rect: cropRect,
      })
    },
    [cropRect, isProcessing]
  )

  const selectRatioMode = useCallback(
    (mode: RatioMode) => {
      setRatioMode(mode)
      if (mode !== 'custom') {
        setIsRatioMenuOpen(false)
      }
      if (!bounds) return
      const nextRatio =
        mode === 'custom'
          ? selectedRatio
          : (RATIO_OPTIONS.find((option) => option.id === mode)?.ratio ?? null)
      setCropRect(getLargestCropForRatio(bounds, nextRatio))
    },
    [bounds, selectedRatio]
  )

  const handleConfirm = useCallback(async () => {
    const image = imageRef.current
    if (!image || !bounds || !cropRect) return

    setError(null)
    const scaleX = image.naturalWidth / bounds.width
    const scaleY = image.naturalHeight / bounds.height
    const sourceX = Math.round(cropRect.x * scaleX)
    const sourceY = Math.round(cropRect.y * scaleY)
    const sourceWidth = Math.round(cropRect.width * scaleX)
    const sourceHeight = Math.round(cropRect.height * scaleY)
    const outputType = getOutputImageType(imageType)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, sourceWidth)
    canvas.height = Math.max(1, sourceHeight)

    const context = canvas.getContext('2d')
    if (!context) {
      setError('Unable to create a canvas for this crop.')
      return
    }

    try {
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height
      )

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (nextBlob) => {
            if (nextBlob) {
              resolve(nextBlob)
              return
            }
            reject(new Error('Unable to export cropped image.'))
          },
          outputType,
          0.95
        )
      })

      await onConfirm(
        new File([blob], getOutputFileName(imageName, outputType), { type: outputType })
      )
    } catch (cropError) {
      setError(cropError instanceof Error ? cropError.message : 'Unable to crop this image.')
    }
  }, [bounds, cropRect, imageName, imageRef, imageType, onConfirm])

  const currentRatioLabel = RATIO_OPTIONS.find((option) => option.id === ratioMode)?.label ?? 'Free'

  return (
    <>
      {bounds && cropRect ? (
        <div
          className='nodrag nopan absolute z-[80]'
          style={{
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
          }}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <div className='pointer-events-none absolute inset-0 bg-black/35' />
          <div
            className='absolute border-2 border-white bg-white/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]'
            style={{
              left: cropRect.x,
              top: cropRect.y,
              width: cropRect.width,
              height: cropRect.height,
            }}
            onPointerDown={(event) => startInteraction(event, { type: 'move' })}
          >
            <div className='pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3'>
              {Array.from({ length: 9 }).map((_, index) => (
                <span key={index} className='border-white/45 border-r border-b last:border-r-0' />
              ))}
            </div>
            {(Object.keys(RESIZE_HANDLE_CLASSES) as ResizeHandle[]).map((handle) => (
              <button
                key={handle}
                type='button'
                aria-label={`Resize crop ${handle}`}
                title={`Resize crop ${handle}`}
                className={cn(
                  'nodrag nopan absolute rounded-full border border-white bg-[var(--surface-1)] shadow-sm',
                  RESIZE_HANDLE_CLASSES[handle]
                )}
                onPointerDown={(event) => startInteraction(event, { type: 'resize', handle })}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div
        className='nodrag nopan mt-2 flex items-center justify-center gap-2'
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type='button'
          aria-label='Cancel crop'
          title='Cancel crop'
          disabled={isProcessing}
          className='flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] shadow-sm transition-colors hover-hover:bg-[var(--surface-3)] disabled:cursor-not-allowed disabled:opacity-50'
          onClick={onCancel}
        >
          <X className='h-4 w-4' />
        </button>

        <div className='relative'>
          <button
            type='button'
            aria-label='Choose crop aspect ratio'
            title='Choose crop aspect ratio'
            disabled={isProcessing}
            className='flex h-8 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[var(--text-primary)] text-xs shadow-sm transition-colors hover-hover:bg-[var(--surface-3)] disabled:cursor-not-allowed disabled:opacity-50'
            onClick={() => setIsRatioMenuOpen((current) => !current)}
          >
            <Proportions className='h-3.5 w-3.5' />
            <span>{currentRatioLabel}</span>
          </button>

          {isRatioMenuOpen ? (
            <div className='-translate-x-1/2 absolute bottom-[calc(100%+8px)] left-1/2 z-[95] w-40 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-1 shadow-xl'>
              {RATIO_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type='button'
                  className={cn(
                    'flex w-full items-center rounded-[6px] px-2.5 py-1.5 text-left text-xs transition-colors hover-hover:bg-[var(--surface-3)]',
                    ratioMode === option.id
                      ? 'text-[var(--brand-secondary)]'
                      : 'text-[var(--text-primary)]'
                  )}
                  onClick={() => selectRatioMode(option.id)}
                >
                  {option.label}
                </button>
              ))}

              {ratioMode === 'custom' ? (
                <div className='mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-1 border-[var(--border)] border-t pt-2'>
                  <input
                    aria-label='Custom crop width ratio'
                    type='number'
                    min='1'
                    value={customRatio.width}
                    className='h-7 rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[var(--text-primary)] text-xs outline-none focus:border-[var(--brand-secondary)]'
                    onChange={(event) =>
                      setCustomRatio((current) => ({ ...current, width: event.target.value }))
                    }
                  />
                  <span className='text-[var(--text-tertiary)] text-xs'>:</span>
                  <input
                    aria-label='Custom crop height ratio'
                    type='number'
                    min='1'
                    value={customRatio.height}
                    className='h-7 rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[var(--text-primary)] text-xs outline-none focus:border-[var(--brand-secondary)]'
                    onChange={(event) =>
                      setCustomRatio((current) => ({ ...current, height: event.target.value }))
                    }
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <button
          type='button'
          aria-label='Confirm crop'
          title='Confirm crop'
          disabled={isProcessing || !cropRect}
          className='flex h-8 w-8 items-center justify-center rounded-full border border-[var(--brand-secondary)] bg-[var(--brand-secondary)] text-white shadow-sm transition-colors hover-hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50'
          onClick={handleConfirm}
        >
          <Check className='h-4 w-4' />
        </button>
      </div>

      {error ? (
        <div className='nodrag nopan mt-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[11px] text-[var(--text-error)]'>
          {error}
        </div>
      ) : null}
    </>
  )
}
