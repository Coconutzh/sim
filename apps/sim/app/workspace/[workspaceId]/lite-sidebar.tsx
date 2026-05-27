'use client'

import type React from 'react'
import { useState } from 'react'
import {
  BookOpen,
  Columns2,
  Compass,
  Database,
  FileText,
  Home,
  Loader2,
  PenLine,
  Plus,
  ScrollText,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
  Workflow,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/core/utils/cn'
import { useLiteCanvasNavigation } from '@/app/workspace/[workspaceId]/use-lite-canvas-navigation'
import { CreateWorkspaceModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/create-workspace-modal/create-workspace-modal'

interface LiteSidebarProps {
  workspaceId: string
}

interface LiteNavItemProps {
  active?: boolean
  disabled?: boolean
  href?: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  loading?: boolean
  onClick?: () => void
}

function LiteNavItem({
  active = false,
  disabled = false,
  href,
  icon: Icon,
  label,
  loading = false,
  onClick,
}: LiteNavItemProps) {
  const className = cn(
    'flex h-[30px] items-center gap-2 rounded-[8px] px-2 text-[13px] transition-colors',
    active
      ? 'bg-[var(--surface-active)] text-[var(--text-primary)]'
      : 'text-[var(--text-muted)] hover-hover:bg-[var(--surface-hover)] hover-hover:text-[var(--text-primary)]',
    disabled && 'pointer-events-none opacity-50'
  )
  const content = (
    <>
      {loading ? (
        <Loader2 className='h-[15px] w-[15px] flex-shrink-0 animate-spin' />
      ) : (
        <Icon className='h-[15px] w-[15px] flex-shrink-0' />
      )}
      <span className='min-w-0 truncate'>{label}</span>
    </>
  )

  if (onClick) {
    return (
      <button type='button' className={cn(className, 'w-full text-left')} onClick={onClick}>
        {content}
      </button>
    )
  }

  if (!href || disabled) {
    return <div className={className}>{content}</div>
  }

  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  )
}

function LiteSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='mt-3 flex flex-col gap-1'>
      <div className='px-2 pb-0.5 text-[11px] text-[var(--text-tertiary)]'>{label}</div>
      <div className='flex flex-col gap-1'>{children}</div>
    </div>
  )
}

export function LiteSidebar({ workspaceId }: LiteSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const canvas = useLiteCanvasNavigation({ workspaceId })
  const activeWorkgroupId = canvas.activeWorkgroupId ?? ''

  function isActive(href?: string) {
    return Boolean(href && pathname?.startsWith(href))
  }

  return (
    <aside className='flex h-full w-[232px] flex-col overflow-y-auto border-[var(--border)] border-r bg-[var(--surface-1)] px-2 py-3'>
      <Link
        href={`/workspace/${workspaceId}/home`}
        className='mb-2 flex h-[30px] items-center rounded-[8px] px-2 font-medium text-[13px] text-[var(--text-primary)]'
      >
        Sim
      </Link>

      <LiteSection label='Main'>
        <LiteNavItem
          active={isActive(`/workspace/${workspaceId}/home`)}
          href={`/workspace/${workspaceId}/home`}
          icon={Home}
          label='Home'
        />
        <LiteNavItem
          active={isActive(`/workspace/${workspaceId}/w`)}
          href={`/workspace/${workspaceId}/w`}
          icon={Workflow}
          label='Workflows'
        />
      </LiteSection>

      <LiteSection label='Canvases'>
        {canvas.workgroups.length > 1 && (
          <select
            value={activeWorkgroupId}
            onChange={(event) => void canvas.switchWorkgroup(event.target.value)}
            disabled={canvas.isSettingActiveWorkgroup}
            aria-label='Switch team canvas context'
            className='mb-1 h-[28px] rounded-[6px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none transition-colors hover-hover:bg-[var(--surface-hover)] disabled:opacity-50'
          >
            {canvas.workgroups.map((workgroup) => (
              <option key={workgroup.id} value={workgroup.id}>
                {workgroup.discipline.name} / {workgroup.name}
              </option>
            ))}
          </select>
        )}

        {canvas.personalDraftWorkspaces.length > 1 && (
          <select
            value={canvas.activePersonalDraftWorkspace?.id ?? canvas.personalWorkspaceId}
            onChange={(event) => {
              router.push(`/workspace/${event.target.value}/home`)
            }}
            aria-label='Switch personal draft canvas'
            className='mb-1 h-[28px] rounded-[6px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none transition-colors hover-hover:bg-[var(--surface-hover)]'
          >
            {canvas.personalDraftWorkspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        )}

        <LiteNavItem
          active={pathname?.startsWith(`/workspace/${canvas.personalWorkspaceId}/`) ?? false}
          href={canvas.personalHref}
          icon={PenLine}
          label='Personal draft'
        />
        <LiteNavItem
          active={
            canvas.teamWorkspaceId
              ? (pathname?.startsWith(`/workspace/${canvas.teamWorkspaceId}/`) ?? false)
              : false
          }
          disabled={!canvas.teamWorkspaceId && !canvas.canInitializeTeamCanvas}
          href={canvas.teamWorkspaceId ? canvas.teamHref : undefined}
          icon={Users}
          label={canvas.teamWorkspaceId ? 'Team canvas' : 'Initialize team canvas'}
          loading={canvas.isCreatingTeamWorkspace}
          onClick={
            !canvas.teamWorkspaceId && canvas.canInitializeTeamCanvas
              ? () => void canvas.initializeTeamCanvas()
              : undefined
          }
        />
        <LiteNavItem
          active={isActive(canvas.showcaseHref)}
          href={canvas.showcaseHref}
          icon={Compass}
          label='Showcase canvas'
        />
        <LiteNavItem
          active={isActive(canvas.splitHref)}
          href={canvas.splitHref}
          icon={Columns2}
          label='Split view'
        />
        {canvas.activeWorkgroup?.role === 'admin' && (
          <LiteNavItem
            active={isActive(canvas.teamManagementHref)}
            href={canvas.teamManagementHref}
            icon={UserPlus}
            label='Team management'
          />
        )}
        {canvas.isProjectAdmin && (
          <LiteNavItem
            active={isActive(canvas.projectAdminHref)}
            href={canvas.projectAdminHref}
            icon={ShieldCheck}
            label='Project admin'
          />
        )}
        <button
          type='button'
          className='mt-1 flex h-[30px] items-center gap-2 rounded-[8px] px-2 text-left text-[13px] text-[var(--text-muted)] transition-colors hover-hover:bg-[var(--surface-hover)] hover-hover:text-[var(--text-primary)] disabled:opacity-50'
          disabled={!canvas.canCreatePersonalCanvas || canvas.isCreatingPersonalWorkspace}
          onClick={() => setIsCreateModalOpen(true)}
        >
          {canvas.isCreatingPersonalWorkspace ? (
            <Loader2 className='h-[15px] w-[15px] flex-shrink-0 animate-spin' />
          ) : (
            <Plus className='h-[15px] w-[15px] flex-shrink-0' />
          )}
          <span className='min-w-0 truncate'>New personal draft canvas</span>
        </button>
      </LiteSection>

      <LiteSection label='Resources'>
        <LiteNavItem
          active={isActive(`/workspace/${workspaceId}/files`)}
          href={`/workspace/${workspaceId}/files`}
          icon={FileText}
          label='Files'
        />
        <LiteNavItem
          active={isActive(`/workspace/${workspaceId}/knowledge`)}
          href={`/workspace/${workspaceId}/knowledge`}
          icon={Database}
          label='Knowledge'
        />
        <LiteNavItem
          active={isActive(`/workspace/${workspaceId}/tables`)}
          href={`/workspace/${workspaceId}/tables`}
          icon={BookOpen}
          label='Tables'
        />
        <LiteNavItem
          active={isActive(`/workspace/${workspaceId}/logs`)}
          href={`/workspace/${workspaceId}/logs`}
          icon={ScrollText}
          label='Logs'
        />
        <LiteNavItem
          active={isActive(`/workspace/${workspaceId}/settings`)}
          href={`/workspace/${workspaceId}/settings`}
          icon={Settings}
          label='Settings'
        />
      </LiteSection>

      <CreateWorkspaceModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onConfirm={async (name) => {
          await canvas.createPersonalCanvas(name)
          setIsCreateModalOpen(false)
        }}
        isCreating={canvas.isCreatingPersonalWorkspace}
      />
    </aside>
  )
}
