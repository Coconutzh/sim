import type { ComponentType } from 'react'
import { ArrowRight, Compass, PenLine, Users } from 'lucide-react'
import Link from 'next/link'

interface HomeProps {
  chatId?: string
  workspaceId: string
}

interface CopilotEntryProps {
  chatId?: string
}

interface CanvasEntryCardProps {
  description: string
  eyebrow: string
  href: string
  icon: ComponentType<{ className?: string }>
  meta: string
  title: string
}

function CanvasEntryCard({
  description,
  eyebrow,
  href,
  icon: Icon,
  meta,
  title,
}: CanvasEntryCardProps) {
  return (
    <Link
      href={href}
      className='group rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-4 transition-colors hover-hover:bg-[var(--surface-hover)]'
    >
      <div className='flex items-start justify-between gap-4'>
        <div className='flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'>
          <Icon className='h-[16px] w-[16px] text-[var(--text-icon)]' />
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
          <ArrowRight className='h-[15px] w-[15px] flex-shrink-0 text-[var(--text-icon)]' />
        </div>
      </div>
    </Link>
  )
}

function LowMemoryCopilotLauncher(_props: CopilotEntryProps) {
  return (
    <div className='mt-10 flex flex-col items-center'>
      <h2 className='mb-4 text-[13px] text-[var(--text-muted)]'>Or ask Copilot to help</h2>
      <button
        type='button'
        className='rounded-[8px] border border-[var(--border)] px-3 py-2 text-[13px] text-[var(--text-muted)]'
      >
        Load Copilot
      </button>
    </div>
  )
}

export async function Home({ chatId, workspaceId }: HomeProps) {
  const CopilotEntry =
    process.env.SIM_LOW_MEMORY_DEV === 'true'
      ? LowMemoryCopilotLauncher
      : (await import('@/app/workspace/[workspaceId]/home/home-copilot-loader')).HomeCopilotLoader

  return (
    <div className='h-full overflow-y-auto bg-[var(--bg)] [scrollbar-gutter:stable_both-edges]'>
      <div className='mx-auto flex min-h-full w-full max-w-[72rem] flex-col px-4 pt-10 pb-8 sm:px-6 lg:px-10'>
        <div className='mb-5 flex flex-col gap-2'>
          <span className='text-[12px] text-[var(--text-muted)]'>Canvas context</span>
          <h1
            data-tour='home-greeting'
            className='max-w-[42rem] text-balance font-[430] font-season text-[32px] text-[var(--text-primary)] tracking-[-0.02em]'
          >
            Choose a canvas
          </h1>
          <p className='max-w-[46rem] text-[14px] text-[var(--text-muted)] leading-6'>
            Start from a private draft, jump into the team canvas, or review read-only showcase work
            without leaving the original Sim canvas shell.
          </p>
        </div>
        <div className='grid gap-3 md:grid-cols-3'>
          <CanvasEntryCard
            description='Private space for ideas, tests, and nodes that are not ready for the team.'
            eyebrow='Private'
            href={`/workspace/${workspaceId}/home`}
            icon={PenLine}
            meta='Only you can edit'
            title='Personal draft canvas'
          />
          <CanvasEntryCard
            description='Shared work area for your active workgroup. Team members collaborate here.'
            eyebrow='Team'
            href={`/workspace/${workspaceId}/home`}
            icon={Users}
            meta='Team canvas'
            title='Team canvas'
          />
          <CanvasEntryCard
            description='Read-only published versions shared with your team or organization.'
            eyebrow='Read-only'
            href={`/workspace/${workspaceId}/showcase`}
            icon={Compass}
            meta='Published work'
            title='Showcase canvas'
          />
        </div>
        <CopilotEntry chatId={chatId} />
      </div>
    </div>
  )
}
