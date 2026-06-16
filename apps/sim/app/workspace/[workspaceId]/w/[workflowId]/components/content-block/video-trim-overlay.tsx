'use client'

import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { Check, Keyboard, Loader2, Scissors, WandSparkles, X } from 'lucide-react'
import type { GenerateWorkspaceVideoThumbnailsBody } from '@/lib/api/contracts/media-videos'
import { cn } from '@/lib/core/utils/cn'
import { useVideoTrimSession } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-video-trim-session'
import type { VideoTrimRange } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/video-trim-utils'

interface VideoTrimOverlayProps {
  videoRef: RefObject<HTMLVideoElement | null>
  videoSrc: string
  workspaceId: string
  sourceFile: GenerateWorkspaceVideoThumbnailsBody['sourceFile'] | null
  isProcessing: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (range: VideoTrimRange) => void | Promise<void>
}

const LABELS = {
  cancelTrim: '\u53d6\u6d88\u526a\u8f91',
  confirmTrim: '\u786e\u8ba4\u526a\u8f91',
  thumbnailUnavailable: '\u7f29\u7565\u56fe\u4e0d\u53ef\u7528',
  generatingThumbnails: '\u6b63\u5728\u751f\u6210\u7f29\u7565\u56fe...',
  adjustInPoint: '\u8c03\u6574\u5165\u70b9',
  adjustOutPoint: '\u8c03\u6574\u51fa\u70b9',
  showShortcuts: '\u67e5\u770b\u526a\u8f91\u5feb\u6377\u952e',
  smartTrim: '\u667a\u80fd\u526a\u8f91',
  smartTrimUnavailable: '\u667a\u80fd\u526a\u8f91\u670d\u52a1\u5c1a\u672a\u63a5\u5165',
  videoTrim: '\u89c6\u9891\u526a\u8f91',
} as const

const SHORTCUTS: Array<{ keyName: string; description: string }> = [
  { keyName: 'Arrow Left / Arrow Right', description: '\u79fb\u52a8\u9009\u533a' },
  { keyName: 'Arrow Left / Arrow Right', description: '\u6269\u5c55/\u6536\u7f29\u9009\u533a' },
  {
    keyName: 'Shift + Arrow Left / Arrow Right',
    description: '\u7cbe\u786e\u5fae\u8c03 (0.01s)',
  },
  {
    keyName: 'Ctrl/Cmd + Arrow Left / Arrow Right',
    description: '\u5feb\u901f\u8c03\u6574 (1s)',
  },
  { keyName: 'I / O', description: '\u8bbe\u7f6e\u5165\u70b9/\u51fa\u70b9' },
  { keyName: 'Enter', description: LABELS.confirmTrim },
  { keyName: 'Esc', description: '\u53d6\u6d88' },
  { keyName: 'Space', description: '\u64ad\u653e/\u6682\u505c\u9884\u89c8' },
  {
    keyName: 'Hold Shift',
    description: '\u7cbe\u786e\u6a21\u5f0f\uff08\u7981\u7528\u5438\u9644\uff09',
  },
]

function stopPointerEvent(event: ReactPointerEvent<HTMLElement>) {
  event.stopPropagation()
}

export function VideoTrimOverlay({
  videoRef,
  videoSrc,
  workspaceId,
  sourceFile,
  isProcessing,
  error,
  onCancel,
  onConfirm,
}: VideoTrimOverlayProps) {
  const {
    durationSeconds,
    range,
    thumbnails,
    thumbnailError,
    activeEdge,
    isHelpOpen,
    formattedRetainedDuration,
    setActiveEdge,
    setIsHelpOpen,
    beginPointerInteraction,
    beginTimelinePointerInteraction,
    updatePointerInteraction,
    endPointerInteraction,
    confirmCurrentRange,
    togglePlayback,
  } = useVideoTrimSession({
    videoRef,
    videoSrc,
    workspaceId,
    sourceFile,
    onCancel,
    onConfirm,
  })

  const hasDuration = durationSeconds > 0
  const startPercent = hasDuration ? (range.startSeconds / durationSeconds) * 100 : 0
  const widthPercent = hasDuration
    ? ((range.endSeconds - range.startSeconds) / durationSeconds) * 100
    : 0

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    updatePointerInteraction(event.clientX, rect.width)
  }

  const handleTimelinePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    beginTimelinePointerInteraction(event.clientX, rect.left, rect.width)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    endPointerInteraction()
  }

  return (
    <div
      className='nodrag nopan -translate-x-1/2 absolute top-full left-1/2 z-50 mt-4 w-[720px] max-w-[calc(100vw-48px)]'
      onPointerDown={stopPointerEvent}
      onClick={(event) => {
        event.stopPropagation()
      }}
    >
      <div className='grid grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-3'>
        <button
          type='button'
          aria-label={LABELS.cancelTrim}
          title={LABELS.cancelTrim}
          disabled={isProcessing}
          className='nodrag nopan flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[#222428] text-white shadow-sm hover-hover:bg-[#2E3137] disabled:cursor-not-allowed disabled:opacity-50'
          onPointerDown={stopPointerEvent}
          onClick={(event) => {
            event.stopPropagation()
            onCancel()
          }}
        >
          <X className='h-4 w-4' />
        </button>

        <div
          className='nodrag nopan relative h-12 overflow-hidden rounded-[14px] border border-white/12 bg-black shadow-[0_10px_32px_rgba(0,0,0,0.35)]'
          onPointerDown={handleTimelinePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className='absolute inset-0 flex'>
            {thumbnails.length > 0 ? (
              thumbnails.map((thumbnail, index) => (
                <div key={`${thumbnail}-${index}`} className='h-full flex-1 overflow-hidden'>
                  <img
                    src={thumbnail}
                    alt=''
                    aria-hidden='true'
                    className='h-full w-full object-cover'
                    draggable={false}
                  />
                </div>
              ))
            ) : (
              <div className='flex h-full w-full items-center justify-center bg-[#17191D] text-[#8D939F] text-[11px]'>
                {thumbnailError ? LABELS.thumbnailUnavailable : LABELS.generatingThumbnails}
              </div>
            )}
          </div>

          <div
            className='absolute inset-y-0 left-0 bg-black/55'
            style={{ width: `${startPercent}%` }}
          />
          <div
            className='absolute inset-y-0 right-0 bg-black/55'
            style={{ width: `${Math.max(0, 100 - startPercent - widthPercent)}%` }}
          />

          <div
            className='nodrag nopan absolute top-0 bottom-0 cursor-grab rounded-[12px] border-2 border-white bg-white/8 shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_6px_18px_rgba(0,0,0,0.35)] active:cursor-grabbing'
            style={{ left: `${startPercent}%`, width: `${widthPercent}%` }}
            onPointerDown={(event) => {
              event.stopPropagation()
              event.currentTarget.parentElement?.setPointerCapture(event.pointerId)
              beginPointerInteraction('move', event.clientX)
            }}
            onDoubleClick={(event) => {
              event.stopPropagation()
              togglePlayback()
            }}
          >
            <button
              type='button'
              aria-label={LABELS.adjustInPoint}
              title={LABELS.adjustInPoint}
              className={cn(
                'nodrag nopan absolute top-0 bottom-0 left-[-5px] w-3 cursor-ew-resize rounded-full bg-white shadow-sm',
                activeEdge === 'start' && 'bg-[#F4B740]'
              )}
              onPointerDown={(event) => {
                event.stopPropagation()
                event.currentTarget.parentElement?.parentElement?.setPointerCapture(event.pointerId)
                beginPointerInteraction('start', event.clientX)
              }}
              onFocus={() => setActiveEdge('start')}
              onBlur={() => setActiveEdge(null)}
            />
            <button
              type='button'
              aria-label={LABELS.adjustOutPoint}
              title={LABELS.adjustOutPoint}
              className={cn(
                'nodrag nopan absolute top-0 right-[-5px] bottom-0 w-3 cursor-ew-resize rounded-full bg-white shadow-sm',
                activeEdge === 'end' && 'bg-[#F4B740]'
              )}
              onPointerDown={(event) => {
                event.stopPropagation()
                event.currentTarget.parentElement?.parentElement?.setPointerCapture(event.pointerId)
                beginPointerInteraction('end', event.clientX)
              }}
              onFocus={() => setActiveEdge('end')}
              onBlur={() => setActiveEdge(null)}
            />
            <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
              <span className='rounded-full bg-black/70 px-3 py-1 font-semibold text-white text-xs shadow-sm'>
                {formattedRetainedDuration}
              </span>
            </div>
          </div>
        </div>

        <button
          type='button'
          aria-label={LABELS.confirmTrim}
          title={LABELS.confirmTrim}
          disabled={isProcessing || !hasDuration}
          className='nodrag nopan flex h-8 w-8 items-center justify-center rounded-full bg-white text-black shadow-sm hover-hover:bg-[#F2F3F5] disabled:cursor-not-allowed disabled:opacity-50'
          onPointerDown={stopPointerEvent}
          onClick={(event) => {
            event.stopPropagation()
            void confirmCurrentRange()
          }}
        >
          {isProcessing ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <Check className='h-4 w-4' />
          )}
        </button>
      </div>

      <div className='mt-2 flex items-start justify-between gap-3 px-11'>
        <div className='relative'>
          <button
            type='button'
            aria-label={LABELS.showShortcuts}
            title={LABELS.showShortcuts}
            className='nodrag nopan inline-flex items-center gap-2 rounded-full bg-black/50 px-2.5 py-1.5 text-[11px] text-white shadow-sm hover-hover:bg-black/70'
            onPointerDown={stopPointerEvent}
            onClick={(event) => {
              event.stopPropagation()
              setIsHelpOpen(!isHelpOpen)
            }}
          >
            <Keyboard className='h-3 w-3' />
            <span>{`Enter ${LABELS.confirmTrim}`}</span>
          </button>
          {isHelpOpen ? (
            <div className='absolute bottom-full left-0 mb-2 w-[320px] rounded-[8px] border border-white/10 bg-[#1F2126] p-3 text-[11px] text-white shadow-xl'>
              {SHORTCUTS.map((shortcut) => (
                <div
                  key={`${shortcut.keyName}-${shortcut.description}`}
                  className='flex items-center justify-between gap-4 py-1'
                >
                  <span className='text-[#B7BDC8]'>{shortcut.keyName}</span>
                  <span>{shortcut.description}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type='button'
          aria-label={LABELS.smartTrim}
          title={LABELS.smartTrimUnavailable}
          disabled
          className='nodrag nopan inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#24262C] px-3 py-1.5 text-[#A8AFBC] text-[11px] shadow-sm disabled:cursor-not-allowed disabled:opacity-70'
          onPointerDown={stopPointerEvent}
          onClick={(event) => {
            event.stopPropagation()
          }}
        >
          <WandSparkles className='h-3.5 w-3.5' />
          <span>{LABELS.smartTrim}</span>
        </button>
      </div>

      {error ? (
        <div className='mt-2 px-11 text-[11px] text-[var(--text-error)]'>{error}</div>
      ) : null}

      <div className='-top-7 -translate-x-1/2 pointer-events-none absolute left-1/2 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-white text-xs shadow-sm'>
        <Scissors className='h-3.5 w-3.5' />
        <span>{LABELS.videoTrim}</span>
      </div>
    </div>
  )
}
