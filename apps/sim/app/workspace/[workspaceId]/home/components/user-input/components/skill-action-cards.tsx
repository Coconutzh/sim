'use client'

import type { ComponentType, SVGProps } from 'react'
import { cn } from '@/lib/core/utils/cn'

export interface SkillActionCard {
  id: string
  title: string
  description: string
  prompt: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  actionKind?: 'prompt' | 'create_task' | 'submit_task'
  taskDraft?: {
    title: string
    description?: string
    dueAtOffsetHours?: number
  }
}

interface SkillActionCardsProps {
  actions: SkillActionCard[]
  onSelect: (action: SkillActionCard) => void
  className?: string
}

export function SkillActionCards({ actions, onSelect, className }: SkillActionCardsProps) {
  if (actions.length === 0) return null

  return (
    <div
      className={cn(
        'absolute right-0 bottom-[calc(100%+8px)] left-0 z-20 grid grid-cols-1 gap-1.5',
        className
      )}
    >
      {actions.map((action) => {
        const Icon = action.icon
        return (
          <button
            key={action.id}
            type='button'
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(action)}
            className='group flex w-full items-start gap-2 rounded-[8px] border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 text-left shadow-sm transition-colors hover:bg-[var(--surface-2)] dark:bg-[var(--surface-4)] dark:hover:bg-[var(--surface-5)]'
          >
            <span className='mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] bg-[var(--surface-3)] text-[var(--text-icon)] transition-colors group-hover:bg-[var(--surface-4)]'>
              <Icon className='h-[13px] w-[13px]' strokeWidth={2} />
            </span>
            <span className='min-w-0 flex-1'>
              <span className='block truncate font-medium text-[12px] text-[var(--text-primary)] leading-[16px]'>
                {action.title}
              </span>
              <span className='mt-0.5 block text-[11px] text-[var(--text-tertiary)] leading-[15px]'>
                {action.description}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
