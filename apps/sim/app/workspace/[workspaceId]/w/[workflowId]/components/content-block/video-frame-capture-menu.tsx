'use client'

import type { PointerEvent as ReactPointerEvent } from 'react'
import type { VideoFrameCaptureMode } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/video-frame-capture-utils'

const MENU_ITEMS: ReadonlyArray<{ mode: VideoFrameCaptureMode; label: string }> = [
  { mode: 'current', label: '截取当前帧' },
  { mode: 'first', label: '截取首帧' },
  { mode: 'last', label: '截取尾帧' },
]

interface VideoFrameCaptureMenuProps {
  onSelect: (mode: VideoFrameCaptureMode) => void
}

function stopPointerEvent(event: ReactPointerEvent<HTMLElement>) {
  event.stopPropagation()
}

export function VideoFrameCaptureMenu({ onSelect }: VideoFrameCaptureMenuProps) {
  return (
    <div
      className='nodrag nopan -translate-x-1/2 absolute top-[calc(100%+8px)] left-1/2 z-50 w-[220px] rounded-[14px] border border-white/10 bg-[#2D2F33] p-1.5 shadow-[0_18px_44px_rgba(0,0,0,0.32)]'
      onPointerDown={stopPointerEvent}
      onClick={(event) => {
        event.stopPropagation()
      }}
    >
      {MENU_ITEMS.map((item) => (
        <button
          key={item.mode}
          type='button'
          className='nodrag nopan flex w-full items-center rounded-[10px] px-3 py-2.5 text-left font-semibold text-sm text-white transition-colors hover-hover:bg-white/10'
          onPointerDown={stopPointerEvent}
          onClick={(event) => {
            event.stopPropagation()
            onSelect(item.mode)
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
