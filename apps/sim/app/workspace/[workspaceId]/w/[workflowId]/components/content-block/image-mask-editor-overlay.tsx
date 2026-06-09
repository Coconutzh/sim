'use client'

import type { ReactNode, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brush, Eraser, Redo2, Square, Undo2, X } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'
import {
  getRelativeImageMaskBounds,
  hasMaskPixels,
  type ImageMaskAction,
  type ImageMaskBounds,
  type ImageMaskPoint,
  type ImageMaskTool,
  renderMaskActions,
  resizeMaskCanvas,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-mask-drawing-utils'

export interface ExportedMaskImage {
  base64: string
  size: number
}

export interface ImageMaskEditorApi {
  buildMaskImage: () => Promise<ExportedMaskImage | null>
  hasMask: boolean
}

interface ImageMaskEditorOverlayProps {
  rootRef: RefObject<HTMLDivElement | null>
  imageRef: RefObject<HTMLImageElement | null>
  isProcessing: boolean
  onCancel: () => void
  renderFooter: (api: ImageMaskEditorApi) => ReactNode
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }
      reject(new Error('Unable to export mask.'))
    }, 'image/png')
  })
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return window.btoa(binary)
}

export function ImageMaskEditorOverlay({
  rootRef,
  imageRef,
  isProcessing,
  onCancel,
  renderFooter,
}: ImageMaskEditorOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [bounds, setBounds] = useState<ImageMaskBounds | null>(null)
  const [tool, setTool] = useState<ImageMaskTool>('brush')
  const [brushSize, setBrushSize] = useState(28)
  const [actions, setActions] = useState<ImageMaskAction[]>([])
  const [redoActions, setRedoActions] = useState<ImageMaskAction[]>([])
  const [draftAction, setDraftAction] = useState<ImageMaskAction | null>(null)

  const committedActions = useMemo(
    () => (draftAction ? [...actions, draftAction] : actions),
    [actions, draftAction]
  )
  const hasMask = actions.some((action) => action.tool !== 'eraser')

  const updateBounds = useCallback(() => {
    const root = rootRef.current
    const image = imageRef.current
    if (!root || !image) return
    const nextBounds = getRelativeImageMaskBounds({ root, image })
    if (nextBounds) setBounds(nextBounds)
  }, [imageRef, rootRef])

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !bounds) return
    const context = resizeMaskCanvas(canvas, bounds)
    if (!context) return
    renderMaskActions({
      context,
      width: bounds.width,
      height: bounds.height,
      actions: committedActions,
      mode: 'display',
    })
  }, [bounds, committedActions])

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
    (event: ReactPointerEvent<HTMLCanvasElement>): ImageMaskPoint | null => {
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

  const buildMaskImage = useCallback(async (): Promise<ExportedMaskImage | null> => {
    if (!bounds) return null
    const canvas = document.createElement('canvas')
    const context = resizeMaskCanvas(canvas, bounds)
    if (!context) return null
    renderMaskActions({
      context,
      width: bounds.width,
      height: bounds.height,
      actions,
      mode: 'export',
    })
    if (!hasMaskPixels(canvas)) return null
    const blob = await canvasToBlob(canvas)
    return {
      base64: arrayBufferToBase64(await blob.arrayBuffer()),
      size: blob.size,
    }
  }, [actions, bounds])

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
          aria-label='Exit mask editing'
          title='Exit'
          disabled={isProcessing}
          className='flex h-7 w-7 items-center justify-center rounded-full text-white/65 transition-colors hover-hover:bg-white/10 hover-hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
          onClick={onCancel}
        >
          <X className='h-4 w-4' />
        </button>
        <div className='h-5 w-px bg-white/10' />
        {(
          [
            ['brush', Brush, 'Brush'],
            ['rectangle', Square, 'Rectangle'],
            ['eraser', Eraser, 'Eraser'],
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
          aria-label='Brush width'
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
          aria-label='Undo'
          title='Undo'
          disabled={isProcessing || actions.length === 0}
          className='flex h-7 w-7 items-center justify-center rounded-full text-white/70 transition-colors hover-hover:bg-white/10 hover-hover:text-white disabled:cursor-not-allowed disabled:opacity-35'
          onClick={undo}
        >
          <Undo2 className='h-3.5 w-3.5' />
        </button>
        <button
          type='button'
          aria-label='Redo'
          title='Redo'
          disabled={isProcessing || redoActions.length === 0}
          className='flex h-7 w-7 items-center justify-center rounded-full text-white/70 transition-colors hover-hover:bg-white/10 hover-hover:text-white disabled:cursor-not-allowed disabled:opacity-35'
          onClick={redo}
        >
          <Redo2 className='h-3.5 w-3.5' />
        </button>
      </div>

      {renderFooter({ buildMaskImage, hasMask })}
    </>
  )
}
