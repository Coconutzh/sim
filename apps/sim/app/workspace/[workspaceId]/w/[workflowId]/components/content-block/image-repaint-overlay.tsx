'use client'

import type { ChangeEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brush, Eraser, Loader2, Paperclip, Redo2, Send, Square, Undo2, X } from 'lucide-react'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type ImageGenerationResolution,
  repaintWorkspaceImageContract,
} from '@/lib/api/contracts/media-images'
import { cn } from '@/lib/core/utils/cn'
import { resolveUserFileUrl } from '@/lib/core/utils/user-file'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'

type MaskTool = 'brush' | 'rectangle' | 'eraser'

interface UploadedFileValue {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
}

interface RepaintBounds {
  left: number
  top: number
  width: number
  height: number
  scaleX: number
  scaleY: number
}

interface MaskPoint {
  x: number
  y: number
}

interface MaskAction {
  tool: MaskTool
  points: MaskPoint[]
  rect?: { x: number; y: number; width: number; height: number }
  size: number
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
const MASK_COLOR = 'rgba(85, 190, 255, 0.42)'

function getElementScale(element: HTMLElement): { scaleX: number; scaleY: number } {
  const rect = element.getBoundingClientRect()
  return {
    scaleX: element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1,
    scaleY: element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1,
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '重绘失败，请稍后重试。'
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

function resizeCanvas(
  canvas: HTMLCanvasElement,
  bounds: RepaintBounds
): CanvasRenderingContext2D | null {
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(bounds.width * ratio))
  canvas.height = Math.max(1, Math.round(bounds.height * ratio))
  canvas.style.width = `${bounds.width}px`
  canvas.style.height = `${bounds.height}px`
  const context = canvas.getContext('2d')
  if (!context) return null
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  return context
}

function drawBrushAction(context: CanvasRenderingContext2D, action: MaskAction) {
  const firstPoint = action.points[0]
  if (!firstPoint) return

  context.lineWidth = action.size
  context.beginPath()
  context.moveTo(firstPoint.x, firstPoint.y)
  for (const point of action.points.slice(1)) {
    context.lineTo(point.x, point.y)
  }
  if (action.points.length === 1) {
    context.lineTo(firstPoint.x + 0.01, firstPoint.y + 0.01)
  }
  context.stroke()
}

function renderMaskActions({
  context,
  width,
  height,
  actions,
  mode,
}: {
  context: CanvasRenderingContext2D
  width: number
  height: number
  actions: MaskAction[]
  mode: 'display' | 'export'
}) {
  context.clearRect(0, 0, width, height)
  if (mode === 'export') {
    context.fillStyle = 'black'
    context.fillRect(0, 0, width, height)
  }

  for (const action of actions) {
    if (action.tool === 'eraser') {
      context.globalCompositeOperation = mode === 'display' ? 'destination-out' : 'source-over'
      context.strokeStyle = mode === 'display' ? MASK_COLOR : 'black'
      context.fillStyle = mode === 'display' ? MASK_COLOR : 'black'
    } else {
      context.globalCompositeOperation = 'source-over'
      context.strokeStyle = mode === 'display' ? MASK_COLOR : 'white'
      context.fillStyle = mode === 'display' ? MASK_COLOR : 'white'
    }

    if (action.tool === 'rectangle' && action.rect) {
      context.fillRect(action.rect.x, action.rect.y, action.rect.width, action.rect.height)
    } else {
      drawBrushAction(context, action)
    }
  }

  context.globalCompositeOperation = 'source-over'
}

function hasEditablePixels(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('2d')
  if (!context) return false
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] > 0 || data[index + 1] > 0 || data[index + 2] > 0) return true
  }
  return false
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }
      reject(new Error('无法导出蒙版。'))
    }, 'image/png')
  })
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const uploadFileMutation = useUploadWorkspaceFile()
  const [bounds, setBounds] = useState<RepaintBounds | null>(null)
  const [tool, setTool] = useState<MaskTool>('brush')
  const [brushSize, setBrushSize] = useState(28)
  const [prompt, setPrompt] = useState('')
  const [resolution, setResolution] = useState<ImageGenerationResolution>('2K')
  const [referenceImages, setReferenceImages] = useState<UploadedFileValue[]>([])
  const [actions, setActions] = useState<MaskAction[]>([])
  const [redoActions, setRedoActions] = useState<MaskAction[]>([])
  const [draftAction, setDraftAction] = useState<MaskAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isProcessing = isSubmitting || isProcessingNode || uploadFileMutation.isPending

  const normalizedSourceFile = useMemo(() => normalizeFile(sourceFile), [sourceFile])
  const disabledReason = !workspaceId
    ? '缺少工作区上下文。'
    : !normalizedSourceFile.key
      ? '源图片缺少文件信息。'
      : null

  const updateBounds = useCallback(() => {
    const root = rootRef.current
    const image = imageRef.current
    if (!root || !image) return

    const rootRect = root.getBoundingClientRect()
    const imageRect = image.getBoundingClientRect()
    if (imageRect.width <= 0 || imageRect.height <= 0) return
    const scale = getElementScale(root)

    setBounds({
      left: (imageRect.left - rootRect.left) / scale.scaleX,
      top: (imageRect.top - rootRect.top) / scale.scaleY,
      width: imageRect.width / scale.scaleX,
      height: imageRect.height / scale.scaleY,
      scaleX: scale.scaleX,
      scaleY: scale.scaleY,
    })
  }, [imageRef, rootRef])

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !bounds) return
    const context = resizeCanvas(canvas, bounds)
    if (!context) return
    renderMaskActions({
      context,
      width: bounds.width,
      height: bounds.height,
      actions: draftAction ? [...actions, draftAction] : actions,
      mode: 'display',
    })
  }, [actions, bounds, draftAction])

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
    renderCanvas()
  }, [renderCanvas])

  const getCanvasPoint = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement> | PointerEvent): MaskPoint | null => {
      const canvas = canvasRef.current
      if (!canvas || !bounds) return null
      const rect = canvas.getBoundingClientRect()
      return {
        x: ((event.clientX - rect.left) / rect.width) * bounds.width,
        y: ((event.clientY - rect.top) / rect.height) * bounds.height,
      }
    },
    [bounds]
  )

  const finishDraftAction = useCallback(() => {
    setDraftAction((current) => {
      if (!current) return null
      const hasShape =
        current.tool === 'rectangle'
          ? Boolean(
              current.rect && Math.abs(current.rect.width) > 2 && Math.abs(current.rect.height) > 2
            )
          : current.points.length > 0
      if (hasShape) {
        setActions((existing) => [...existing, current])
        setRedoActions([])
      }
      return null
    })
  }, [])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (isProcessing) return
      const point = getCanvasPoint(event)
      if (!point) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      setError(null)
      setDraftAction({
        tool,
        points: [point],
        rect: tool === 'rectangle' ? { x: point.x, y: point.y, width: 0, height: 0 } : undefined,
        size: brushSize,
      })
    },
    [brushSize, getCanvasPoint, isProcessing, tool]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!draftAction || isProcessing) return
      const point = getCanvasPoint(event)
      if (!point) return
      event.preventDefault()
      event.stopPropagation()
      setDraftAction((current) => {
        if (!current) return null
        const startPoint = current.points[0] ?? point
        if (current.tool === 'rectangle') {
          return {
            ...current,
            points: [startPoint, point],
            rect: {
              x: Math.min(startPoint.x, point.x),
              y: Math.min(startPoint.y, point.y),
              width: Math.abs(point.x - startPoint.x),
              height: Math.abs(point.y - startPoint.y),
            },
          }
        }
        return { ...current, points: [...current.points, point] }
      })
    },
    [draftAction, getCanvasPoint, isProcessing]
  )

  const handlePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      finishDraftAction()
    },
    [finishDraftAction]
  )

  const undo = useCallback(() => {
    setActions((current) => {
      const next = current.slice(0, -1)
      const removed = current.at(-1)
      if (removed) {
        setRedoActions((existing) => [removed, ...existing])
      }
      return next
    })
  }, [])

  const redo = useCallback(() => {
    setRedoActions((current) => {
      const [nextAction, ...remaining] = current
      if (nextAction) {
        setActions((existing) => [...existing, nextAction])
      }
      return remaining
    })
  }, [])

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

  const buildMaskImage = useCallback(async (): Promise<{ base64: string; size: number } | null> => {
    if (!bounds) return null
    const ratio = window.devicePixelRatio || 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bounds.width * ratio))
    canvas.height = Math.max(1, Math.round(bounds.height * ratio))
    const context = canvas.getContext('2d')
    if (!context) return null
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    renderMaskActions({
      context,
      width: bounds.width,
      height: bounds.height,
      actions,
      mode: 'export',
    })
    if (!hasEditablePixels(canvas)) return null
    const blob = await canvasToBlob(canvas)
    const buffer = await blob.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return { base64: window.btoa(binary), size: blob.size }
  }, [actions, bounds])

  const submit = useCallback(async () => {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      setError('请输入重绘描述。')
      return
    }
    if (disabledReason || !workspaceId) {
      setError(disabledReason ?? '无法提交重绘。')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const mask = await buildMaskImage()
      if (!mask) {
        setError('请先绘制要重绘的区域。')
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
  }, [
    buildMaskImage,
    disabledReason,
    normalizedSourceFile,
    onCreateVariant,
    prompt,
    referenceImages,
    resolution,
    workspaceId,
  ])

  return (
    <>
      {bounds ? (
        <canvas
          ref={canvasRef}
          className='nodrag nopan absolute z-[86] cursor-crosshair touch-none rounded-xl'
          style={{
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        />
      ) : null}

      <div
        className='nodrag nopan -translate-x-1/2 absolute top-[-52px] left-1/2 z-[92] flex items-center gap-3 rounded-full border border-white/10 bg-[#171717] px-3 py-2 text-white shadow-2xl'
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type='button'
          aria-label='退出重绘'
          title='退出重绘'
          disabled={isProcessing}
          className='flex h-7 w-7 items-center justify-center rounded-full text-white/65 transition-colors hover-hover:bg-white/10 hover-hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
          onClick={onCancel}
        >
          <X className='h-4 w-4' />
        </button>
        <div className='h-5 w-px bg-white/10' />
        {(
          [
            ['brush', Brush, '画笔'],
            ['rectangle', Square, '矩形'],
            ['eraser', Eraser, '橡皮擦'],
          ] as const
        ).map(([id, Icon, label]) => (
          <button
            key={id}
            type='button'
            aria-label={label}
            title={label}
            disabled={isProcessing}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              tool === id
                ? 'bg-white/16 text-white'
                : 'text-white/70 hover-hover:bg-white/10 hover-hover:text-white'
            )}
            onClick={() => setTool(id)}
          >
            <Icon className='h-4 w-4' />
          </button>
        ))}
        <div className='h-5 w-px bg-white/10' />
        <input
          aria-label='笔触宽度'
          type='range'
          min='6'
          max='72'
          value={brushSize}
          disabled={isProcessing}
          className='h-1 w-24 accent-white'
          onChange={(event) => setBrushSize(Number(event.currentTarget.value))}
          onPointerDown={(event) => event.stopPropagation()}
        />
        <button
          type='button'
          aria-label='撤回'
          title='撤回'
          disabled={isProcessing || actions.length === 0}
          className='flex h-7 w-7 items-center justify-center rounded-full text-white/70 transition-colors hover-hover:bg-white/10 hover-hover:text-white disabled:cursor-not-allowed disabled:opacity-35'
          onClick={undo}
        >
          <Undo2 className='h-3.5 w-3.5' />
        </button>
        <button
          type='button'
          aria-label='重做'
          title='重做'
          disabled={isProcessing || redoActions.length === 0}
          className='flex h-7 w-7 items-center justify-center rounded-full text-white/70 transition-colors hover-hover:bg-white/10 hover-hover:text-white disabled:cursor-not-allowed disabled:opacity-35'
          onClick={redo}
        >
          <Redo2 className='h-3.5 w-3.5' />
        </button>
      </div>

      <div
        className='nodrag nopan mt-3 rounded-[8px] border border-white/10 bg-[#111111] p-2 shadow-2xl'
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <textarea
          value={prompt}
          placeholder='描述你想改变什么...'
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
              aria-label='上传参考图'
              title='上传参考图'
              disabled={isProcessing || !workspaceId}
              className='flex h-8 items-center gap-2 rounded-full px-2 text-white/55 text-xs transition-colors hover-hover:bg-white/10 hover-hover:text-white disabled:cursor-not-allowed disabled:opacity-45'
              onClick={() => referenceInputRef.current?.click()}
            >
              <Paperclip className='h-3.5 w-3.5' />
              <span>参考图{referenceImages.length > 0 ? ` ${referenceImages.length}` : ''}</span>
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
              aria-label='提交重绘'
              title='提交重绘'
              disabled={isProcessing || Boolean(disabledReason)}
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
    </>
  )
}
