'use client'

import { type MouseEvent, type PointerEvent, type ReactNode, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'

interface ContentAiComposerShellProps {
  canEdit: boolean
  selected: boolean
  prompt: string
  placeholder: string
  isGenerating: boolean
  loadingLabel: string
  error: string | null
  header?: ReactNode
  footer: ReactNode
  afterFooter?: ReactNode
  onChangePrompt: (value: string) => void
  onSubmit: () => void
}

function stopCanvasInteraction(event: PointerEvent<HTMLElement>) {
  event.stopPropagation()
}

function stopCanvasClick(event: MouseEvent<HTMLElement>) {
  event.stopPropagation()
}

export function ContentAiComposerShell({
  canEdit,
  selected,
  prompt,
  placeholder,
  isGenerating,
  loadingLabel,
  error,
  header,
  footer,
  afterFooter,
  onChangePrompt,
  onSubmit,
}: ContentAiComposerShellProps) {
  const [isComposing, setIsComposing] = useState(false)

  if (!selected) return null

  return (
    <div
      className='nodrag nopan mt-3 w-full'
      onPointerDownCapture={stopCanvasInteraction}
      onClick={stopCanvasClick}
      onDoubleClick={stopCanvasClick}
    >
      <div className='overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-primary)] shadow-[0_20px_50px_rgba(0,0,0,0.18)]'>
        <div className='relative px-4 pt-4 pb-3'>
          {header ? <div className='mb-3'>{header}</div> : null}

          <textarea
            value={prompt}
            onChange={(event) => onChangePrompt(event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onFocus={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
                event.preventDefault()
                onSubmit()
              }
            }}
            placeholder={placeholder}
            disabled={!canEdit}
            rows={3}
            className={cn(
              'h-[92px] w-full resize-none bg-transparent text-sm leading-6 caret-[var(--text-primary)] outline-none placeholder:text-[var(--text-subtle)]',
              !canEdit && 'cursor-not-allowed opacity-70'
            )}
          />

          {isGenerating && (
            <div className='pointer-events-none absolute inset-x-4 top-4 bottom-3 flex items-start justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]/95 px-3 py-3'>
              <div className='flex items-center gap-2 text-[var(--text-secondary)] text-xs'>
                <Loader2 className='h-3.5 w-3.5 animate-spin' />
                <span>{loadingLabel}</span>
              </div>
              <div className='flex items-center gap-1'>
                <span className='h-2 w-2 animate-pulse rounded-full bg-[#F4B740]' />
                <span className='h-2 w-2 animate-pulse rounded-full bg-[#F4B740] [animation-delay:150ms]' />
                <span className='h-2 w-2 animate-pulse rounded-full bg-[#F4B740] [animation-delay:300ms]' />
              </div>
            </div>
          )}
        </div>

        <div className='border-[var(--border)] border-t px-4 py-3'>{footer}</div>

        {afterFooter}

        {error && (
          <div className='border-[var(--border)] border-t bg-[var(--surface-3)] px-4 py-2.5 text-[11px] text-[var(--text-error)]'>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

export function ComposerSendButton({
  canEdit,
  isGenerating,
  onSubmit,
  ariaLabel,
}: {
  canEdit: boolean
  isGenerating: boolean
  onSubmit: () => void
  ariaLabel: string
}) {
  return (
    <button
      type='button'
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onSubmit()
      }}
      disabled={!canEdit || isGenerating}
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
        !canEdit || isGenerating
          ? 'cursor-not-allowed bg-[var(--surface-5)] text-[var(--text-muted)]'
          : 'bg-[#F4B740] text-[#1D1F24] hover-hover:bg-[#F6C15A]'
      )}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      aria-label={ariaLabel}
    >
      {isGenerating ? (
        <Loader2 className='h-4.5 w-4.5 animate-spin' />
      ) : (
        <span className='font-semibold text-xs uppercase tracking-[0.2em]'>Go</span>
      )}
    </button>
  )
}

export function ComposerActionChip({
  children,
  onClick,
}: {
  children: string
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      className='rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-[var(--text-primary)] text-xs transition-colors hover-hover:bg-[var(--surface-3)]'
    >
      {children}
    </button>
  )
}
