'use client'

import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ImageIcon, Music4, Type, Video } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'

type ContentNodeTitleVariant = 'text' | 'image' | 'video' | 'audio'

interface ContentNodeTitleBarProps {
  blockId: string
  name: string
  variant: ContentNodeTitleVariant
  canEdit: boolean
  zoom: number
  onRename: (nextName: string) => boolean
}

const CONTENT_NODE_TITLE_ICONS: Record<ContentNodeTitleVariant, LucideIcon> = {
  text: Type,
  image: ImageIcon,
  video: Video,
  audio: Music4,
}

const BASE_TITLE_FONT_SIZE = 13
const MIN_SCREEN_FONT_SIZE = 12
const MAX_SCREEN_FONT_SIZE = 16
const MIN_TITLE_SCALE = 0.5
const MAX_TITLE_SCALE = 2.25

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getTitleScaleStyle(zoom: number): CSSProperties {
  const safeZoom = zoom > 0 ? zoom : 1
  const currentScreenFontSize = BASE_TITLE_FONT_SIZE * safeZoom
  const targetScreenFontSize = clampValue(
    currentScreenFontSize,
    MIN_SCREEN_FONT_SIZE,
    MAX_SCREEN_FONT_SIZE
  )
  const scale = clampValue(
    targetScreenFontSize / currentScreenFontSize,
    MIN_TITLE_SCALE,
    MAX_TITLE_SCALE
  )

  return {
    fontSize: `${BASE_TITLE_FONT_SIZE}px`,
    transform: `scale(${scale})`,
    transformOrigin: 'left center',
    maxWidth: `${Math.round(220 / scale)}px`,
  }
}

function stopCanvasInteraction(event: PointerEvent<HTMLElement>): void {
  event.stopPropagation()
}

export const ContentNodeTitleBar = memo(function ContentNodeTitleBar({
  blockId,
  name,
  variant,
  canEdit,
  zoom,
  onRename,
}: ContentNodeTitleBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const Icon = CONTENT_NODE_TITLE_ICONS[variant]
  const titleStyle = useMemo(() => getTitleScaleStyle(zoom), [zoom])

  useEffect(() => {
    if (!isEditing) {
      setDraftName(name)
    }
  }, [isEditing, name])

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing])

  const submitEdit = useCallback(() => {
    const nextName = draftName.trim()
    const currentName = name.trim()

    setIsEditing(false)

    if (!nextName) {
      setDraftName(name)
      return
    }

    if (nextName === currentName) {
      setDraftName(name)
      return
    }

    onRename(nextName)
  }, [draftName, name, onRename])

  const cancelEdit = useCallback(() => {
    setDraftName(name)
    setIsEditing(false)
  }, [name])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation()

      if (event.key === 'Enter') {
        event.preventDefault()
        submitEdit()
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        cancelEdit()
      }
    },
    [cancelEdit, submitEdit]
  )

  return (
    <div
      className='nodrag nopan pointer-events-auto absolute top-[-28px] left-0 z-[65] flex h-7 max-w-[240px] items-center gap-1.5 rounded-[7px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[var(--text-primary)] shadow-sm'
      style={titleStyle}
      onPointerDown={stopCanvasInteraction}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      data-block-id={blockId}
    >
      <Icon className='h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]' />
      {isEditing ? (
        <input
          ref={inputRef}
          value={draftName}
          placeholder='请输入标题'
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={submitEdit}
          onKeyDown={handleKeyDown}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className='nodrag nopan h-5 min-w-0 flex-1 bg-transparent p-0 text-current outline-none placeholder:text-[var(--text-tertiary)]'
        />
      ) : (
        <button
          type='button'
          disabled={!canEdit}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (canEdit) setIsEditing(true)
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          className={cn(
            'nodrag nopan min-w-0 truncate p-0 text-left font-medium leading-none outline-none',
            canEdit
              ? 'cursor-text hover-hover:text-[var(--text-primary)]'
              : 'cursor-default text-[var(--text-secondary)]'
          )}
          title={name}
        >
          {name}
        </button>
      )}
    </div>
  )
})
