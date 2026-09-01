'use client'

import { type ComponentType, useMemo, useState } from 'react'
import {
  BriefcaseBusiness,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPlus,
  FolderKanban,
  Home,
  Loader2,
  PenLine,
  Plus,
  Settings,
  UserPlus,
  Users,
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
import { CreditBalance } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/credit-balance/credit-balance'
import { CreateWorkspaceModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/create-workspace-modal/create-workspace-modal'
import { useCopilotAgentProfile } from '@/hooks/queries/collaboration'
import { useBatchSendWorkspaceInvitations } from '@/hooks/queries/invitations'

interface LiteSidebarProps {
  workspaceId: string
}

interface CanvasNavItemProps {
  active: boolean
  collapsed: boolean
  href: string
  icon: ComponentType<{ className?: string }>
  label: string
  tone?: 'personal' | 'team'
}

function CanvasNavItem({ active, collapsed, href, icon: Icon, label, tone }: CanvasNavItemProps) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        'flex h-9 min-w-0 items-center gap-2 rounded-md px-2 text-[12px] transition-colors',
        active
          ? 'bg-[var(--surface-active)] font-medium text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover-hover:bg-[var(--surface-hover)] hover-hover:text-[var(--text-primary)]',
        collapsed && 'justify-center px-0'
      )}
    >
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          tone === 'personal' && 'text-[var(--badge-blue-text)]',
          tone === 'team' && 'text-[var(--badge-success-text)]'
        )}
      />
      {!collapsed && <span className='min-w-0 truncate'>{label}</span>}
    </Link>
  )
}

export function LiteSidebar({ workspaceId }: LiteSidebarProps) {
  const pathname = usePathname()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([])
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [inviteEmails, setInviteEmails] = useState('')
  const canvas = useLiteCanvasNavigation({ workspaceId })
  const { data: agentProfile } = useCopilotAgentProfile(workspaceId)
  const sendInvitations = useBatchSendWorkspaceInvitations()

  const scopedWorkspaceId = canvas.teamWorkspaceId ?? workspaceId
  const personalWorkflowsHref = `/workspace/${scopedWorkspaceId}/personal-workflows`
  const createTaskHref = `${canvas.showcaseHref}?tab=tasks&createTask=1`
  const isDirectorTeam =
    agentProfile?.agent.code === 'chief_director' || agentProfile?.agent.code === 'show_director'
  const canManageTeams = canvas.isProjectAdmin || canvas.activeWorkgroup?.role === 'admin'
  const canInviteTeamMembers = Boolean(canvas.teamWorkspaceId && canvas.activeWorkgroupId)

  const projectGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        id: string
        name: string
        workgroups: Array<{
          id: string
          name: string
          personalCanvases: Array<{ id: string; name: string }>
          teamWorkspaceId: string
        }>
      }
    >()

    for (const workgroup of canvas.workgroups) {
      const project = groups.get(workgroup.organizationId) ?? {
        id: workgroup.organizationId,
        name: workgroup.organization.name,
        workgroups: [],
      }
      project.workgroups.push({
        id: workgroup.id,
        name: `${workgroup.discipline.name} / ${workgroup.name}`,
        personalCanvases: canvas.personalDraftWorkspaces
          .filter((workspace) => workspace.workgroupId === workgroup.id)
          .map((workspace) => ({ id: workspace.id, name: workspace.name })),
        teamWorkspaceId: workgroup.teamWorkspaceId,
      })
      groups.set(workgroup.organizationId, project)
    }

    return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }, [canvas.personalDraftWorkspaces, canvas.workgroups])

  function isActive(href?: string) {
    if (!href || !pathname) return false
    const cleanHref = href.split('?')[0]
    return pathname === cleanHref || pathname.startsWith(`${cleanHref}/`)
  }

  function toggleProject(projectId: string) {
    setExpandedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    )
  }

  const isHomePath = pathname === `/workspace/${workspaceId}/home`
  if (isHomePath) return null

  return (
    <>
      <aside
        className={cn(
          'flex h-full shrink-0 flex-col border-[var(--border)] border-r bg-[var(--surface-1)] p-2 transition-[width] duration-200',
          isCollapsed ? 'w-14' : 'w-72'
        )}
      >
        <div className={cn('flex items-center gap-1', isCollapsed && 'flex-col')}>
          <Button
            type='button'
            variant='ghost'
            aria-label={isCollapsed ? '展开项目导航' : '收起项目导航'}
            className={cn('h-9 shrink-0 px-2', !isCollapsed && 'flex-1 justify-start')}
            onClick={() => setIsCollapsed((value) => !value)}
          >
            {isCollapsed ? (
              <ChevronRight className='h-4 w-4' />
            ) : (
              <ChevronLeft className='h-4 w-4' />
            )}
            {!isCollapsed && <span className='ml-1 font-medium'>项目</span>}
          </Button>
          <ProductionNotificationBell includeAllInvitations workspaceId={scopedWorkspaceId} />
        </div>

        {!isCollapsed && (
          <div className='mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
            <div className='text-[11px] text-[var(--text-tertiary)]'>
              {canvas.canvasContext.label}
            </div>
            <div className='mt-0.5 truncate font-medium text-[12px] text-[var(--text-primary)]'>
              {canvas.canvasContext.detail}
            </div>
          </div>
        )}

        <Button
          type='button'
          size='sm'
          variant='ghost'
          title={isCollapsed ? '新建个人画布' : undefined}
          className={cn(
            'mt-3 h-9 text-[12px]',
            isCollapsed ? 'justify-center px-0' : 'w-full justify-start'
          )}
          disabled={!canvas.canCreatePersonalCanvas || canvas.isCreatingPersonalWorkspace}
          onClick={() => setIsCreateModalOpen(true)}
        >
          {canvas.isCreatingPersonalWorkspace ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <Plus className='h-4 w-4' />
          )}
          {!isCollapsed && <span className='ml-2'>新建个人画布</span>}
        </Button>

        <div className='mt-4 min-h-0 flex-1 overflow-y-auto'>
          {!isCollapsed && (
            <div className='mb-1 px-2 font-medium text-[11px] text-[var(--text-tertiary)] uppercase tracking-wide'>
              项目画布
            </div>
          )}
          <div className='space-y-1'>
            {projectGroups.map((project) => {
              const isExpanded =
                expandedProjectIds.includes(project.id) ||
                project.workgroups.some(
                  (workgroup) =>
                    workgroup.teamWorkspaceId === workspaceId ||
                    workgroup.personalCanvases.some((workspace) => workspace.id === workspaceId)
                )

              if (isCollapsed) {
                const targetWorkspaceId =
                  project.workgroups.find((workgroup) => workgroup.personalCanvases.length > 0)
                    ?.personalCanvases[0]?.id ?? project.workgroups[0]?.teamWorkspaceId
                return targetWorkspaceId ? (
                  <CanvasNavItem
                    key={project.id}
                    active={project.workgroups.some(
                      (workgroup) =>
                        workgroup.teamWorkspaceId === workspaceId ||
                        workgroup.personalCanvases.some((workspace) => workspace.id === workspaceId)
                    )}
                    collapsed
                    href={`/workspace/${targetWorkspaceId}/w`}
                    icon={FolderKanban}
                    label={project.name}
                  />
                ) : null
              }

              return (
                <div key={project.id}>
                  <Button
                    type='button'
                    variant='ghost'
                    className='h-9 w-full justify-start px-2 text-[12px]'
                    onClick={() => toggleProject(project.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className='mr-1 h-3.5 w-3.5' />
                    ) : (
                      <ChevronRight className='mr-1 h-3.5 w-3.5' />
                    )}
                    <FolderKanban className='mr-2 h-4 w-4 text-[var(--text-tertiary)]' />
                    <span className='min-w-0 truncate'>{project.name}</span>
                  </Button>
                  {isExpanded && (
                    <div className='ml-3 border-[var(--border)] border-l pl-2'>
                      {project.workgroups.map((workgroup) => (
                        <div key={workgroup.id} className='mb-1'>
                          <div className='px-2 py-1 text-[10px] text-[var(--text-tertiary)]'>
                            {workgroup.name}
                          </div>
                          {workgroup.personalCanvases.map((personalCanvas) => (
                            <CanvasNavItem
                              key={personalCanvas.id}
                              active={personalCanvas.id === workspaceId}
                              collapsed={false}
                              href={`/workspace/${personalCanvas.id}/w`}
                              icon={PenLine}
                              label={personalCanvas.name}
                              tone='personal'
                            />
                          ))}
                          {workgroup.teamWorkspaceId && (
                            <CanvasNavItem
                              active={workgroup.teamWorkspaceId === workspaceId}
                              collapsed={false}
                              href={`/workspace/${workgroup.teamWorkspaceId}/w`}
                              icon={Users}
                              label='团队画布'
                              tone='team'
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {!isCollapsed && (
          <div className='mt-2 space-y-1 border-[var(--border)] border-t pt-2'>
            <CanvasNavItem
              active={isActive(`/workspace/${workspaceId}/home`)}
              collapsed={false}
              href={`/workspace/${workspaceId}/home`}
              icon={Home}
              label='项目首页'
            />
            <CanvasNavItem
              active={isActive(personalWorkflowsHref)}
              collapsed={false}
              href={personalWorkflowsHref}
              icon={PenLine}
              label='个人工作流'
            />
            <CanvasNavItem
              active={isActive(canvas.showcaseHref)}
              collapsed={false}
              href={canvas.showcaseHref}
              icon={BriefcaseBusiness}
              label='项目总览'
            />
            {canManageTeams && (
              <CanvasNavItem
                active={isActive(canvas.teamManagementHref)}
                collapsed={false}
                href={canvas.teamManagementHref}
                icon={Settings}
                label='团队管理'
              />
            )}
            {isDirectorTeam && (
              <CanvasNavItem
                active={isActive(createTaskHref)}
                collapsed={false}
                href={createTaskHref}
                icon={ClipboardPlus}
                label='发布任务'
              />
            )}
            <Button
              type='button'
              size='sm'
              variant='ghost'
              className='h-9 w-full justify-start px-2 text-[12px]'
              disabled={!canInviteTeamMembers || sendInvitations.isPending}
              onClick={() => setIsInviteOpen(true)}
            >
              <UserPlus className='mr-2 h-4 w-4' />
              邀请成员
            </Button>
          </div>
        )}
        <div className='mt-2'>
          <CreditBalance isCollapsed={isCollapsed} />
        </div>
      </aside>

      <CreateWorkspaceModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onConfirm={async (input) => {
          await canvas.createPersonalCanvas(input)
          setIsCreateModalOpen(false)
        }}
        isCreating={canvas.isCreatingPersonalWorkspace}
        projects={canvas.projectOptions}
      />

      <Modal open={isInviteOpen} onOpenChange={setIsInviteOpen}>
        <ModalContent size='md'>
          <ModalHeader>邀请成员加入当前团队</ModalHeader>
          <ModalBody>
            <div className='space-y-3'>
              <div className='rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                <div className='text-[11px] text-[var(--text-tertiary)]'>当前团队</div>
                <div className='mt-0.5 truncate font-medium text-[13px] text-[var(--text-primary)]'>
                  {canvas.activeWorkgroup
                    ? `${canvas.activeWorkgroup.discipline.name} / ${canvas.activeWorkgroup.name}`
                    : '团队画布'}
                </div>
              </div>
              <Textarea
                value={inviteEmails}
                onChange={(event) => setInviteEmails(event.target.value)}
                placeholder='输入一个或多个邮箱，以换行、逗号或分号分隔'
                className='min-h-[100px]'
              />
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
              {sendInvitations.isPending && <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />}
              发送邀请
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
