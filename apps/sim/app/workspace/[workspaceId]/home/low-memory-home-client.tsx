'use client'

import type { ComponentType } from 'react'
import { useState } from 'react'
import { Columns2, Compass, Loader2, MessageSquare, PenLine, Users } from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useLiteCanvasNavigation } from '@/app/workspace/[workspaceId]/use-lite-canvas-navigation'

const HomeCopilot = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/home/home-copilot').then((module) => module.HomeCopilot),
  {
    ssr: false,
    loading: () => <div className='h-full bg-[var(--bg)]' />,
  }
)

interface LowMemoryHomeClientProps {
  chatId?: string
  workspaceId: string
}

interface CanvasEntryCardProps {
  description: string
  disabled?: boolean
  eyebrow: string
  href?: string
  icon: ComponentType<{ className?: string }>
  isLoading?: boolean
  meta: string
  onClick?: () => void
  title: string
}

function CanvasEntryCard({
  description,
  disabled = false,
  eyebrow,
  href,
  icon: Icon,
  isLoading = false,
  meta,
  onClick,
  title,
}: CanvasEntryCardProps) {
  const className =
    'group rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-4 text-left transition-colors hover-hover:bg-[var(--surface-hover)] disabled:opacity-60'
  const content = (
    <>
      <div className='flex items-start justify-between gap-4'>
        <div className='flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'>
          {isLoading ? (
            <Loader2 className='h-[16px] w-[16px] animate-spin text-[var(--text-icon)]' />
          ) : (
            <Icon className='h-[16px] w-[16px] text-[var(--text-icon)]' />
          )}
        </div>
        <span className='rounded-[6px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
          {eyebrow}
        </span>
      </div>
      <div className='mt-5 flex min-h-[120px] flex-col'>
        <h2 className='font-medium text-[18px] text-[var(--text-primary)]'>{title}</h2>
        <p className='mt-2 text-[13px] text-[var(--text-muted)] leading-5'>{description}</p>
        <div className='mt-auto flex items-center justify-between gap-3 pt-5'>
          <span className='truncate text-[12px] text-[var(--text-tertiary)]'>{meta}</span>
        </div>
      </div>
    </>
  )

  if (onClick) {
    return (
      <button type='button' className={className} disabled={disabled} onClick={onClick}>
        {content}
      </button>
    )
  }

  if (!href || disabled) {
    return (
      <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-4 opacity-60'>
        {content}
      </div>
    )
  }

  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  )
}

export function LowMemoryHomeClient({ chatId, workspaceId }: LowMemoryHomeClientProps) {
  const [isCopilotOpen, setIsCopilotOpen] = useState(Boolean(chatId))
  const canvas = useLiteCanvasNavigation({ workspaceId })

  if (isCopilotOpen) {
    return <HomeCopilot chatId={chatId} />
  }

  return (
    <div className='h-full overflow-y-auto bg-[var(--bg)] [scrollbar-gutter:stable_both-edges]'>
      <div className='mx-auto flex min-h-full w-full max-w-[72rem] flex-col px-4 pt-10 pb-8 sm:px-6 lg:px-10'>
        <div className='mb-5 flex flex-col gap-2'>
          <span className='text-[12px] text-[var(--text-muted)]'>
            {canvas.activeWorkgroup
              ? `${canvas.activeWorkgroup.discipline.name} / ${canvas.activeWorkgroup.name}`
              : 'Canvas context'}
          </span>
          <h1
            data-tour='home-greeting'
            className='max-w-[42rem] text-balance font-[430] font-season text-[32px] text-[var(--text-primary)] tracking-[-0.02em]'
          >
            Choose a canvas
          </h1>
          <p className='max-w-[46rem] text-[14px] text-[var(--text-muted)] leading-6'>
            Start from a private draft, jump into the team canvas, compare both sides, or review
            read-only showcase work without leaving the original Sim canvas shell.
          </p>
        </div>

        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
          <CanvasEntryCard
            description='Private space for ideas, tests, and nodes that are not ready for the team.'
            eyebrow='Private'
            href={canvas.personalHref}
            icon={PenLine}
            meta='Only you can edit'
            title='Personal draft canvas'
          />
          <CanvasEntryCard
            description='Shared work area for your active workgroup. Team members collaborate here.'
            disabled={!canvas.teamWorkspaceId && !canvas.canInitializeTeamCanvas}
            eyebrow='Team'
            href={canvas.teamWorkspaceId ? canvas.teamHref : undefined}
            icon={Users}
            isLoading={canvas.isCreatingTeamWorkspace}
            meta={
              canvas.teamWorkspaceId
                ? canvas.activeWorkgroup?.name || 'Team canvas'
                : canvas.canInitializeTeamCanvas
                  ? 'Admin can initialize'
                  : 'Waiting for team admin'
            }
            onClick={
              !canvas.teamWorkspaceId && canvas.canInitializeTeamCanvas
                ? () => void canvas.initializeTeamCanvas()
                : undefined
            }
            title={canvas.teamWorkspaceId ? 'Team canvas' : 'Initialize team canvas'}
          />
          <CanvasEntryCard
            description='Read-only published versions shared with your team or organization.'
            eyebrow='Read-only'
            href={canvas.showcaseHref}
            icon={Compass}
            meta='Published work'
            title='Showcase canvas'
          />
          <CanvasEntryCard
            description='Inspect personal and team node graphs side by side and copy selected nodes.'
            eyebrow='Compare'
            href={canvas.splitHref}
            icon={Columns2}
            meta='Personal + team'
            title='Split view'
          />
        </div>

        <div className='mt-10 flex flex-col items-center'>
          <h2 className='mb-4 text-[13px] text-[var(--text-muted)]'>Or ask Copilot to help</h2>
          <button
            type='button'
            onClick={() => setIsCopilotOpen(true)}
            className='flex items-center gap-2 rounded-[8px] border border-[var(--border)] px-3 py-2 text-[13px] text-[var(--text-muted)] transition-colors hover-hover:bg-[var(--surface-hover)] hover-hover:text-[var(--text-primary)]'
          >
            <MessageSquare className='h-[15px] w-[15px]' />
            Load Copilot
          </button>
        </div>
      </div>
    </div>
  )
}
