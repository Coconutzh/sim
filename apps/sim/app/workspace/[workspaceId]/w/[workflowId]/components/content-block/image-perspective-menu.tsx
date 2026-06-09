'use client'

import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImageIcon, Loader2, RotateCcw, X } from 'lucide-react'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import type { ContentCanvasModelAvailabilitySnapshot } from '@/lib/api/contracts/content-canvas'
import { generateWorkspaceImageContract } from '@/lib/api/contracts/media-images'
import { getContentCanvasModel } from '@/lib/content-canvas/model-catalog'
import { cn } from '@/lib/core/utils/cn'
import { resolveUserFileUrl } from '@/lib/core/utils/user-file'
import {
  DEFAULT_IMAGE_PERSPECTIVE_MODEL,
  type ImageGenerationModelId,
} from '@/lib/generated-media/image/image-generation-utils'

const ROTATION_MIN = -60
const ROTATION_MAX = 60
const TILT_MIN = -45
const TILT_MAX = 45
const ZOOM_MIN = -50
const ZOOM_MAX = 50

interface UploadedFileValue {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
}

export interface ImagePerspectiveValues {
  rotation: number
  tilt: number
  zoom: number
  wideAngle: boolean
}

interface ImagePerspectiveMenuProps {
  workspaceId?: string
  sourceFile: UploadedFileValue
  availability?: ContentCanvasModelAvailabilitySnapshot | null
  onCreateVariant: (params: {
    file: UploadedFileValue
    model: ImageGenerationModelId
  }) => Promise<void> | void
  onClose: () => void
}

interface PointerDragStart {
  x: number
  y: number
  values: ImagePerspectiveValues
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'Failed to create image variant.'
}

function supportsImageReference(modelId: string): modelId is ImageGenerationModelId {
  const model = getContentCanvasModel(modelId)
  return Boolean(
    model &&
      model.capability === 'image' &&
      model.referenceCapability.allowedSourceVariants.includes('image') &&
      model.referenceCapability.supportedRoles.includes('image_reference')
  )
}

export function getImagePerspectiveModel(
  availability?: ContentCanvasModelAvailabilitySnapshot | null
): { model: ImageGenerationModelId | null; disabledReason: string | null } {
  if (!availability) {
    return { model: DEFAULT_IMAGE_PERSPECTIVE_MODEL, disabledReason: null }
  }

  if (availability.image.enabledModelIds.includes(DEFAULT_IMAGE_PERSPECTIVE_MODEL)) {
    return { model: DEFAULT_IMAGE_PERSPECTIVE_MODEL, disabledReason: null }
  }

  const fallbackModel = availability.image.enabledModelIds.find(supportsImageReference)
  if (fallbackModel) {
    return { model: fallbackModel, disabledReason: null }
  }

  return {
    model: null,
    disabledReason: 'No available image model supports image reference editing.',
  }
}

export function buildImagePerspectivePrompt(values: ImagePerspectiveValues): string {
  return [
    'Using the provided image as the source, create a new version from a different camera angle.',
    'This is an AI perspective redraw, not a CAD model or 3D renderer; the angle values are creative direction and do not need to be numerically exact.',
    'Preserve the main subject identity, style, lighting, colors, composition intent, and background as much as possible.',
    `Apply camera yaw/rotation: ${values.rotation} degrees, camera tilt/pitch: ${values.tilt} degrees, zoom/dolly: ${values.zoom}, ${
      values.wideAngle
        ? 'use a wide-angle lens with natural perspective distortion'
        : 'use a natural standard lens'
    }.`,
    'Do not add text, watermark, UI, frame, or unrelated objects.',
  ].join(' ')
}

export function applyPerspectiveDrag(
  start: ImagePerspectiveValues,
  deltaX: number,
  deltaY: number
): ImagePerspectiveValues {
  const dragDistance = Math.hypot(deltaX, deltaY)
  const zoomDirection = deltaY < 0 ? 1 : -1

  return {
    rotation: clamp(start.rotation + deltaX * 0.45, ROTATION_MIN, ROTATION_MAX),
    tilt: clamp(start.tilt - deltaY * 0.35, TILT_MIN, TILT_MAX),
    zoom: clamp(start.zoom + dragDistance * 0.03 * zoomDirection, ZOOM_MIN, ZOOM_MAX),
    wideAngle: start.wideAngle,
  }
}

function normalizeSourceFile(file: UploadedFileValue) {
  const key = file.key?.trim() ?? ''
  const name = file.name?.trim() || key || 'source-image'

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

function SliderControl({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  unit?: string
  onChange: (value: number) => void
}) {
  return (
    <label className='grid grid-cols-[54px_1fr_42px] items-center gap-3 text-[11px] text-[var(--text-secondary)]'>
      <span className='font-medium'>{label}</span>
      <input
        type='range'
        min={min}
        max={max}
        value={value}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className='nodrag nopan h-1 w-full appearance-none rounded-full bg-[var(--surface-4)] accent-[var(--text-primary)]'
      />
      <span className='text-right font-semibold text-[var(--text-primary)]'>
        {value}
        {unit}
      </span>
    </label>
  )
}

export function ImagePerspectiveMenu({
  workspaceId,
  sourceFile,
  availability,
  onCreateVariant,
  onClose,
}: ImagePerspectiveMenuProps) {
  const [values, setValues] = useState<ImagePerspectiveValues>({
    rotation: 0,
    tilt: 0,
    zoom: 0,
    wideAngle: false,
  })
  const [error, setError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const dragStartRef = useRef<PointerDragStart | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const requestSequenceRef = useRef(0)
  const { model, disabledReason: modelDisabledReason } = useMemo(
    () => getImagePerspectiveModel(availability),
    [availability]
  )
  const normalizedSourceFile = useMemo(() => normalizeSourceFile(sourceFile), [sourceFile])
  const disabledReason =
    modelDisabledReason ??
    (!workspaceId
      ? 'Missing workspace context.'
      : !normalizedSourceFile.key
        ? 'Source image is missing stored file metadata.'
        : null)
  const cubeTransform = `rotateX(${-values.tilt}deg) rotateY(${values.rotation}deg) scale(${
    1 + values.zoom / 200
  })`

  const abortCurrentRequest = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      abortCurrentRequest()
    }
  }, [abortCurrentRequest])

  useEffect(() => {
    setError(null)
    abortCurrentRequest()
  }, [abortCurrentRequest, normalizedSourceFile.key])

  const resetValues = useCallback(() => {
    setValues({ rotation: 0, tilt: 0, zoom: 0, wideAngle: false })
    setError(null)
  }, [])

  const handleClose = useCallback(() => {
    abortCurrentRequest()
    onClose()
  }, [abortCurrentRequest, onClose])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      dragStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        values,
      }
    },
    [values]
  )

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return
    event.preventDefault()
    event.stopPropagation()
    const deltaX = event.clientX - dragStartRef.current.x
    const deltaY = event.clientY - dragStartRef.current.y
    setValues(applyPerspectiveDrag(dragStartRef.current.values, deltaX, deltaY))
  }, [])

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragStartRef.current = null
  }, [])

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setValues((current) => ({
      ...current,
      zoom: clamp(current.zoom - event.deltaY * 0.05, ZOOM_MIN, ZOOM_MAX),
    }))
  }, [])

  const createVariant = useCallback(async () => {
    if (!workspaceId || !model || disabledReason) {
      setError(disabledReason ?? 'Unable to create image variant.')
      return
    }

    const requestId = requestSequenceRef.current + 1
    requestSequenceRef.current = requestId
    abortCurrentRequest()
    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsGenerating(true)
    setError(null)

    try {
      const response = await requestJson(generateWorkspaceImageContract, {
        body: {
          workspaceId,
          model,
          prompt: buildImagePerspectivePrompt(values),
          aspectRatio: 'auto',
          referenceContext: {
            text: [],
            images: [normalizedSourceFile],
          },
        },
        signal: controller.signal,
      })

      if (requestSequenceRef.current !== requestId) return
      await onCreateVariant({
        file: mapGeneratedFile(response.file),
        model,
      })
      onClose()
    } catch (caughtError) {
      if (controller.signal.aborted || requestSequenceRef.current !== requestId) return
      setError(getErrorMessage(caughtError))
    } finally {
      if (requestSequenceRef.current === requestId) {
        setIsGenerating(false)
        abortControllerRef.current = null
      }
    }
  }, [
    abortCurrentRequest,
    disabledReason,
    model,
    normalizedSourceFile,
    onClose,
    onCreateVariant,
    values,
    workspaceId,
  ])

  return (
    <div
      className='nodrag nopan -translate-x-1/2 absolute top-[252px] left-1/2 z-[80] w-[550px] max-w-[calc(100vw-32px)] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-4 text-[var(--text-primary)] shadow-2xl'
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type='button'
        aria-label='Close multi-angle menu'
        title='Close'
        onClick={handleClose}
        className='absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover-hover:bg-[var(--surface-3)] hover-hover:text-[var(--text-primary)]'
      >
        <X className='h-4 w-4' />
      </button>

      <div className='grid grid-cols-[220px_1fr] gap-4'>
        <div className='flex min-w-0 flex-col gap-3'>
          <div className='font-semibold text-sm'>拖拽方块调整角度</div>
          <div
            className='nodrag nopan flex h-[190px] items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] [perspective:520px]'
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onWheel={handleWheel}
          >
            <div
              className='relative h-16 w-16 text-[var(--text-primary)] shadow-lg transition-transform duration-75 [transform-style:preserve-3d]'
              style={{ transform: cubeTransform }}
            >
              <div className='absolute inset-0 flex items-center justify-center rounded-[8px] border border-white/20 bg-[#555B64] [backface-visibility:hidden] [transform:translateZ(32px)]'>
                <ImageIcon className='h-6 w-6 text-white' />
              </div>
              <div className='absolute inset-0 flex items-center justify-center rounded-[8px] border border-white/10 bg-[#353B44] font-semibold text-[#D9DEE7] text-[13px] [backface-visibility:hidden] [transform:rotateY(-90deg)_translateZ(32px)]'>
                L
              </div>
              <div className='absolute inset-0 flex items-center justify-center rounded-[8px] border border-white/10 bg-[#252A31] font-semibold text-[#AEB6C4] text-[13px] [backface-visibility:hidden] [transform:rotateX(-90deg)_translateZ(32px)]'>
                B
              </div>
            </div>
          </div>
          <button
            type='button'
            onClick={resetValues}
            className='inline-flex w-fit items-center gap-1.5 rounded-[6px] px-2 py-1 text-[var(--text-secondary)] text-xs transition-colors hover-hover:bg-[var(--surface-3)] hover-hover:text-[var(--text-primary)]'
          >
            <RotateCcw className='h-3.5 w-3.5' />
            <span>重置</span>
          </button>
        </div>

        <div className='flex min-w-0 flex-col gap-4 pt-8'>
          <SliderControl
            label='旋转'
            value={values.rotation}
            min={ROTATION_MIN}
            max={ROTATION_MAX}
            unit='°'
            onChange={(rotation) => setValues((current) => ({ ...current, rotation }))}
          />
          <SliderControl
            label='倾斜'
            value={values.tilt}
            min={TILT_MIN}
            max={TILT_MAX}
            unit='°'
            onChange={(tilt) => setValues((current) => ({ ...current, tilt }))}
          />
          <SliderControl
            label='缩放'
            value={values.zoom}
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            onChange={(zoom) => setValues((current) => ({ ...current, zoom }))}
          />
          <label className='flex items-center justify-between text-[11px] text-[var(--text-secondary)]'>
            <span className='font-medium'>广角镜头</span>
            <input
              type='checkbox'
              checked={values.wideAngle}
              onChange={(event) =>
                setValues((current) => ({ ...current, wideAngle: event.currentTarget.checked }))
              }
              className='nodrag nopan h-4 w-4 accent-[var(--text-primary)]'
            />
          </label>

          {error || disabledReason ? (
            <div className='rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] text-[var(--text-error)]'>
              {error ?? disabledReason}
            </div>
          ) : null}

          <div className='mt-auto flex justify-end'>
            <button
              type='button'
              disabled={isGenerating || Boolean(disabledReason)}
              onClick={createVariant}
              className={cn(
                'inline-flex h-9 min-w-[72px] items-center justify-center gap-2 rounded-full bg-[var(--text-primary)] px-4 font-medium text-[var(--surface-1)] text-xs transition-opacity',
                (isGenerating || disabledReason) && 'cursor-not-allowed opacity-60'
              )}
            >
              {isGenerating ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : null}
              <span>新建</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
