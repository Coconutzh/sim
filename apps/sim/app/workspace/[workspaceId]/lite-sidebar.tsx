'use client'

import type React from 'react'
import { useState } from 'react'
import {
  BriefcaseBusiness,
  ClipboardPlus,
  Home,
  Loader2,
  Menu,
  PenLine,
  Settings,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
  toast,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { ProductionNotificationBell } from '@/app/workspace/[workspaceId]/components/production-notification-bell'
import { useLiteCanvasNavigation } from '@/app/workspace/[workspaceId]/use-lite-canvas-navigation'
import { CreateWorkspaceModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/create-workspace-modal/create-workspace-modal'
import { useCopilotAgentProfile } from '@/hooks/queries/collaboration'
import { useBatchSendWorkspaceInvitations } from '@/hooks/queries/invitations'

interface LiteSidebarProps {
  workspaceId: string
}

interface ProjectNavItemProps {
  active?: boolean
  disabled?: boolean
  href?: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  loading?: boolean
  onClick?: () => void
}

function ProjectNavItem({
  active = false,
  disabled = false,
  href,
  icon: Icon,
  label,
  loading = false,
  onClick,
}: ProjectNavItemProps) {
  const className = cn(
    'flex h-10 w-full items-center gap-2 rounded-[8px] border px-3 text-left text-[13px] transition-colors',
    active
      ? 'border-[var(--border-1)] bg-[var(--surface-active)] text-[var(--text-primary)] shadow-subtle'
      : 'border-transparent text-[var(--text-muted)] hover-hover:border-[var(--border)] hover-hover:bg-[var(--surface-hover)] hover-hover:text-[var(--text-primary)]',
    disabled && 'pointer-events-none opacity-50'
  )
  const content = (
    <>
      {loading ? (
        <Loader2 className='h-4 w-4 shrink-0 animate-spin' />
      ) : (
        <Icon className='h-4 w-4 shrink-0' />
      )}
      <span className='min-w-0 truncate'>{label}</span>
    </>
  )

  if (onClick) {
    return (
      <Button
        type='button'
        variant='ghost'
        className={className}
        disabled={disabled}
        onClick={onClick}
      >
        {content}
      </Button>
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

export function LiteSidebar({ workspaceId }: LiteSidebarProps) {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [inviteEmails, setInviteEmails] = useState('')
  const canvas = useLiteCanvasNavigation({ workspaceId })
  const { data: agentProfile } = useCopilotAgentProfile(workspaceId)
  const sendInvitations = useBatchSendWorkspaceInvitations()

  const scopedWorkspaceId = canvas.teamWorkspaceId ?? workspaceId
  const personalWorkflowsHref = `/workspace/${scopedWorkspaceId}/personal-workflows`
  const createTaskHref = `${canvas.showcaseHref}?tab=tasks&createTask=1`
  const teamManagementHref = canvas.teamManagementHref
  const isDirectorTeam =
    agentProfile?.agent.code === 'chief_director' || agentProfile?.agent.code === 'show_director'
  const canManageTeams = canvas.isProjectAdmin || canvas.activeWorkgroup?.role === 'admin'
  const canInviteTeamMembers = Boolean(canvas.teamWorkspaceId && canvas.activeWorkgroupId)

  function isActive(href?: string) {
    if (!href || !pathname) return false
    const cleanHref = href.split('?')[0]
    return pathname === cleanHref || pathname.startsWith(`${cleanHref}/`)
  }

  const closeMenu = () => setIsOpen(false)
  const isHomePath = pathname === `/workspace/${workspaceId}/home`

  if (isHomePath) return null

  return (
    <>
      <div className='pointer-events-none fixed top-3 left-3 z-[var(--z-popover)] flex flex-col items-start gap-2'>
        <div className='pointer-events-auto flex items-center gap-2'>
          <Button
            type='button'
            variant='ghost'
            aria-label={isOpen ? '收起项目导航' : '打开项目导航'}
            aria-expanded={isOpen}
            className={cn(
              'flex h-11 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[13px] text-[var(--text-primary)] shadow-medium transition-colors hover-hover:bg-[var(--surface-hover)]',
              isOpen && 'bg-[var(--surface-2)]'
            )}
            onClick={() => setIsOpen((value) => !value)}
          >
            {isOpen ? <X className='h-4 w-4' /> : <Menu className='h-4 w-4' />}
            <span className='max-w-[132px] truncate'>
              {canvas.activeWorkgroup?.organization.name ?? '项目导航'}
            </span>
          </Button>
          <ProductionNotificationBell includeAllInvitations workspaceId={scopedWorkspaceId} />
        </div>

        <div className='pointer-events-auto max-w-[320px] rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 shadow-subtle'>
          <div className='flex items-center gap-2 text-[11px]'>
            <span
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                canvas.canvasContext.kind === 'personal'
                  ? 'bg-[var(--badge-blue-text)]'
                  : canvas.canvasContext.kind === 'team'
                    ? 'bg-[var(--badge-success-text)]'
                    : 'bg-[var(--text-tertiary)]'
              )}
            />
            <span className='shrink-0 font-medium text-[var(--text-primary)]'>
              {canvas.canvasContext.label}
            </span>
            <span className='min-w-0 truncate text-[var(--text-tertiary)]'>
              {canvas.canvasContext.detail}
            </span>
          </div>
        </div>

        {isOpen && (
          <div className='pointer-events-auto w-[272px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2 shadow-overlay'>
            <div className='px-2 py-1.5'>
              <div className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                {canvas.activeWorkgroup?.organization.name ?? '项目'}
              </div>
              <div className='mt-0.5 truncate text-[11px] text-[var(--text-tertiary)]'>
                {canvas.activeWorkgroup
                  ? `${canvas.activeWorkgroup.discipline.name} / ${canvas.activeWorkgroup.name}`
                  : '团队画布'}
              </div>
            </div>

            <div className='mt-1 flex flex-col gap-1'>
              <ProjectNavItem
                active={isActive(`/workspace/${workspaceId}/home`)}
                href={`/workspace/${workspaceId}/home`}
                icon={Home}
                label='项目首页'
              />
              <ProjectNavItem
                active={canvas.teamWorkspaceId ? isActive(canvas.teamHref) : false}
                disabled={!canvas.teamWorkspaceId && !canvas.canInitializeTeamCanvas}
                href={canvas.teamWorkspaceId ? canvas.teamHref : undefined}
                icon={Users}
                label={canvas.teamWorkspaceId ? '团队画布' : '初始化团队画布'}
                loading={canvas.isCreatingTeamWorkspace}
                onClick={
                  !canvas.teamWorkspaceId && canvas.canInitializeTeamCanvas
                    ? () => {
                        void canvas.initializeTeamCanvas().then(closeMenu)
                      }
                    : undefined
                }
              />
              <ProjectNavItem
                active={isActive(personalWorkflowsHref)}
                href={personalWorkflowsHref}
                icon={PenLine}
                label='个人画布'
              />
              <ProjectNavItem
                active={isActive(canvas.showcaseHref)}
                href={canvas.showcaseHref}
                icon={BriefcaseBusiness}
                label='项目总览'
              />
              {canManageTeams && (
                <ProjectNavItem
                  active={isActive(teamManagementHref)}
                  href={teamManagementHref}
                  icon={Settings}
                  label='团队管理'
                />
              )}
              {isDirectorTeam && (
                <ProjectNavItem
                  active={isActive(createTaskHref)}
                  href={createTaskHref}
                  icon={ClipboardPlus}
                  label='发布任务'
                />
              )}
            </div>

            <div className='mt-2 border-[var(--border)] border-t pt-2'>
              <Button
                type='button'
                size='sm'
                variant='ghost'
                className='mb-1 w-full justify-start'
                disabled={!canInviteTeamMembers || sendInvitations.isPending}
                onClick={() => setIsInviteOpen(true)}
              >
                <UserPlus className='mr-2 h-3.5 w-3.5' />
                邀请成员
              </Button>
              <Button
                type='button'
                size='sm'
                variant='ghost'
                className='w-full justify-start'
                disabled={!canvas.canCreatePersonalCanvas || canvas.isCreatingPersonalWorkspace}
                onClick={() => setIsCreateModalOpen(true)}
              >
                {canvas.isCreatingPersonalWorkspace ? (
                  <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' />
                ) : (
                  <PenLine className='mr-2 h-3.5 w-3.5' />
                )}
                新建个人画布
              </Button>
            </div>
          </div>
        )}
      </div>

      <CreateWorkspaceModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onConfirm={async (name) => {
          await canvas.createPersonalCanvas(name)
          setIsCreateModalOpen(false)
          setIsOpen(false)
        }}
        isCreating={canvas.isCreatingPersonalWorkspace}
      />

      <Modal open={isInviteOpen} onOpenChange={setIsInviteOpen}>
        <ModalContent size='md'>
          <ModalHeader>邀请成员加入当前团队</ModalHeader>
          <ModalBody>
            <div className='space-y-3'>
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                <div className='text-[11px] text-[var(--text-tertiary)]'>当前团队</div>
                <div className='mt-0.5 truncate font-medium text-[13px] text-[var(--text-primary)]'>
                  {canvas.activeWorkgroup
                    ? `${canvas.activeWorkgroup.discipline.name} / ${canvas.activeWorkgroup.name}`
                    : '团队画布'}
                </div>
              </div>
              <div className='space-y-1.5'>
                <div className='font-medium text-[12px] text-[var(--text-secondary)]'>邀请邮箱</div>
                <Textarea
                  value={inviteEmails}
                  onChange={(event) => setInviteEmails(event.target.value)}
                  placeholder='输入一个或多个邮箱，换行、逗号或分号分隔'
                  className='min-h-[100px]'
                />
                <div className='text-[11px] text-[var(--text-tertiary)]'>
                  对方接受邀请后会加入当前工种团队，并获得团队画布编辑权限。
                </div>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button type='button' variant='default' onClick={() => setIsInviteOpen(false)}>
              取消
            </Button>
            <Button
              type='button'
              disabled={
                !inviteEmails.trim() || !canvas.teamWorkspaceId || sendInvitations.isPending
              }
              onClick={async () => {
                const emails = inviteEmails
                  .split(/[\n,;]+/)
                  .map((email) => email.trim())
                  .filter(Boolean)
                if (emails.length === 0 || !canvas.teamWorkspaceId) return
                try {
                  const result = await sendInvitations.mutateAsync({
                    workspaceId: canvas.teamWorkspaceId,
                    organizationId: canvas.activeWorkgroup?.organizationId,
                    invitations: emails.map((email) => ({ email, permission: 'write' })),
                  })
                  setInviteEmails('')
                  setIsInviteOpen(false)
                  setIsOpen(false)
                  if (result.failed.length > 0) {
                    toast.error(
                      `${result.successful.length} 个邀请已发送，${result.failed.length} 个失败`
                    )
                    return
                  }
                  toast.success(`已发送 ${result.successful.length} 个团队邀请`)
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : '邀请发送失败')
                }
              }}
            >
              {sendInvitations.isPending ? (
                <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
              ) : (
                <UserPlus className='mr-1.5 h-3.5 w-3.5' />
              )}
              发送邀请
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
