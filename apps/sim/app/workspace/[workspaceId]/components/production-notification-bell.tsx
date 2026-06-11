'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  CalendarClock,
  Check,
  CheckCheck,
  Loader2,
  MessageSquare,
  UserPlus,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  toast,
} from '@/components/emcn'
import type { ProductionTask } from '@/lib/api/contracts/production-tasks'
import { cn } from '@/lib/core/utils/cn'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import {
  useAcceptMyInvitation,
  useMyPendingInvitations,
  useRejectMyInvitation,
} from '@/hooks/queries/invitations'
import {
  productionTaskKeys,
  useMarkProductionTaskRead,
  useProductionTasks,
} from '@/hooks/queries/production-tasks'

interface ProductionNotificationBellProps {
  buttonClassName?: string
  className?: string
  includeAllInvitations?: boolean
  projectName?: string
  showLabel?: boolean
  workspaceId: string
}

function formatDateTime(value: string | null): string {
  if (!value) return '未设置'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function isTaskDone(task: ProductionTask): boolean {
  return task.status === 'approved' || task.status === 'archived'
}

function isDueSoon(task: ProductionTask): boolean {
  if (!task.dueAt || isTaskDone(task)) return false
  const diffMs = new Date(task.dueAt).getTime() - Date.now()
  return diffMs >= 0 && diffMs <= 24 * 60 * 60 * 1000
}

function groupUnreadTasks(tasks: ProductionTask[]) {
  const groups = new Map<string, { id: string; name: string; tasks: ProductionTask[] }>()
  for (const task of tasks) {
    const id = task.assigneeWorkgroup.id
    const existing = groups.get(id)
    if (existing) {
      existing.tasks.push(task)
      continue
    }
    groups.set(id, { id, name: task.assigneeWorkgroup.name, tasks: [task] })
  }
  return [...groups.values()]
}

function getDismissedDueKey(workspaceId: string): string {
  return `production-task-dismissed-due:${workspaceId}`
}

function readDismissedDueWarnings(workspaceId: string): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const value = window.localStorage.getItem(getDismissedDueKey(workspaceId))
    if (!value) return {}
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function writeDismissedDueWarnings(workspaceId: string, value: Record<string, string>) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(getDismissedDueKey(workspaceId), JSON.stringify(value))
}

export function ProductionNotificationBell({
  buttonClassName,
  className,
  includeAllInvitations = false,
  projectName,
  showLabel = false,
  workspaceId,
}: ProductionNotificationBellProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { socket } = useSocket()
  const { data: taskData, isLoading: isLoadingTasks } = useProductionTasks(
    workspaceId,
    {
      scope: 'auto',
      limit: 100,
    },
    { refetchIntervalMs: 5 * 1000 }
  )
  const { data: invitationData, isLoading: isLoadingInvitations } = useMyPendingInvitations()
  const acceptInvitation = useAcceptMyInvitation()
  const rejectInvitation = useRejectMyInvitation()
  const markRead = useMarkProductionTaskRead()
  const [activeInvitationId, setActiveInvitationId] = useState<string | null>(null)
  const [activeReadTaskId, setActiveReadTaskId] = useState<string | null>(null)
  const [dismissedDueWarnings, setDismissedDueWarnings] = useState<Record<string, string>>({})

  const tasks = taskData?.tasks ?? []
  const unreadTasks = useMemo(() => tasks.filter((task) => task.unreadMessageCount > 0), [tasks])
  const dueSoonTasks = useMemo(
    () =>
      tasks.filter(
        (task) => isDueSoon(task) && task.dueAt && dismissedDueWarnings[task.id] !== task.dueAt
      ),
    [dismissedDueWarnings, tasks]
  )
  const invitationItems = useMemo(
    () =>
      includeAllInvitations
        ? (invitationData ?? [])
        : (invitationData ?? []).filter((invitation) =>
            invitation.grants.some((grant) => grant.workspaceId === workspaceId)
          ),
    [includeAllInvitations, invitationData, workspaceId]
  )
  const unreadGroups = useMemo(() => groupUnreadTasks(unreadTasks), [unreadTasks])
  const unreadMessageCount = unreadTasks.reduce((sum, task) => sum + task.unreadMessageCount, 0)
  const totalSignalCount = unreadMessageCount + dueSoonTasks.length + invitationItems.length
  const isBusy = acceptInvitation.isPending || rejectInvitation.isPending || markRead.isPending
  const isLoading = isLoadingTasks || isLoadingInvitations
  const organizationIds = useMemo(
    () => [...new Set(tasks.map((task) => task.organizationId))],
    [tasks]
  )

  useEffect(() => {
    setDismissedDueWarnings(readDismissedDueWarnings(workspaceId))
  }, [workspaceId])

  useEffect(() => {
    if (!socket) return
    const handleProductionTaskUpdated = (event: { organizationId?: string | null }) => {
      if (
        event.organizationId &&
        organizationIds.length > 0 &&
        !organizationIds.includes(event.organizationId)
      ) {
        return
      }
      queryClient.invalidateQueries({ queryKey: productionTaskKeys.lists() })
    }
    socket.on('production-task-updated', handleProductionTaskUpdated)
    return () => {
      socket.off('production-task-updated', handleProductionTaskUpdated)
    }
  }, [organizationIds, queryClient, socket])

  const openTask = (taskId: string) => {
    router.push(`/workspace/${workspaceId}/showcase?tab=tasks&taskId=${taskId}`)
  }

  const dismissDueWarnings = (targetTasks: ProductionTask[]) => {
    setDismissedDueWarnings((current) => {
      const next = { ...current }
      for (const task of targetTasks) {
        if (task.dueAt) next[task.id] = task.dueAt
      }
      writeDismissedDueWarnings(workspaceId, next)
      return next
    })
  }

  const handleMarkTaskRead = async (taskId: string) => {
    setActiveReadTaskId(taskId)
    try {
      await markRead.mutateAsync(taskId)
      toast.success('已标记为已读')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '标记已读失败')
    } finally {
      setActiveReadTaskId(null)
    }
  }

  const handleMarkAllRead = async () => {
    setActiveReadTaskId('all')
    try {
      for (const task of unreadTasks) {
        await markRead.mutateAsync(task.id)
      }
      if (dueSoonTasks.length > 0) dismissDueWarnings(dueSoonTasks)
      toast.success('已全部标记为已读')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '全部已读失败')
    } finally {
      setActiveReadTaskId(null)
    }
  }

  const handleAcceptInvitation = async (invitationId: string) => {
    setActiveInvitationId(invitationId)
    try {
      const result = await acceptInvitation.mutateAsync(invitationId)
      toast.success('已接受团队邀请')
      router.refresh()
      router.push(result.redirectPath)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '接受邀请失败')
    } finally {
      setActiveInvitationId(null)
    }
  }

  const handleRejectInvitation = async (invitationId: string) => {
    setActiveInvitationId(invitationId)
    try {
      await rejectInvitation.mutateAsync(invitationId)
      toast.success('已拒绝团队邀请')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '拒绝邀请失败')
    } finally {
      setActiveInvitationId(null)
    }
  }

  return (
    <div className={cn('relative', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className={cn(
              'relative h-9 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-2.5 text-[12px] text-[var(--text-primary)] shadow-medium hover-hover:bg-[var(--surface-hover)]',
              showLabel ? 'gap-2' : 'w-9 px-0',
              buttonClassName
            )}
            aria-label='项目消息'
          >
            {isLoading ? (
              <Loader2 className='h-[14px] w-[14px] animate-spin text-[var(--text-icon)]' />
            ) : (
              <Bell className='h-[14px] w-[14px] text-[var(--text-icon)]' />
            )}
            {showLabel ? <span>消息</span> : null}
            {totalSignalCount > 0 ? (
              <span className='-top-1 -right-1 absolute flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[var(--badge-error-text)] px-1 font-medium text-[10px] text-[var(--text-inverse)]'>
                {totalSignalCount > 9 ? '9+' : totalSignalCount}
              </span>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='start'
          side='bottom'
          sideOffset={8}
          className='w-[360px] max-w-[calc(100vw-24px)] p-2'
        >
          <div className='flex items-start justify-between gap-3 px-1 py-1'>
            <div className='min-w-0'>
              <div className='truncate font-medium text-[12px] text-[var(--text-primary)]'>
                {projectName ? `${projectName}消息` : '项目消息'}
              </div>
              <div className='mt-0.5 text-[11px] text-[var(--text-muted)]'>
                {unreadMessageCount} 条未读 / {dueSoonTasks.length} 个 DDL 预警 /{' '}
                {invitationItems.length} 个邀请
              </div>
            </div>
            {unreadTasks.length > 0 || dueSoonTasks.length > 0 ? (
              <Button
                type='button'
                size='sm'
                variant='ghost'
                disabled={isBusy}
                onClick={() => void handleMarkAllRead()}
              >
                {activeReadTaskId === 'all' ? (
                  <Loader2 className='mr-1 h-[13px] w-[13px] animate-spin' />
                ) : (
                  <CheckCheck className='mr-1 h-[13px] w-[13px]' />
                )}
                全部已读
              </Button>
            ) : null}
          </div>

          <div className='mt-2 max-h-[420px] space-y-3 overflow-y-auto'>
            {invitationItems.length > 0 ? (
              <section className='space-y-2'>
                <div className='px-1 font-medium text-[11px] text-[var(--text-tertiary)]'>
                  待处理邀请
                </div>
                {invitationItems.map((invitation) => (
                  <div
                    key={invitation.id}
                    className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'
                  >
                    <div className='flex items-start gap-2'>
                      <UserPlus className='mt-0.5 h-[14px] w-[14px] text-[var(--text-icon)]' />
                      <div className='min-w-0 flex-1'>
                        <div className='truncate font-medium text-[12px] text-[var(--text-primary)]'>
                          {invitation.organizationName ??
                            invitation.grants[0]?.workspaceName ??
                            '团队邀请'}
                        </div>
                        <div className='mt-1 text-[11px] text-[var(--text-muted)]'>
                          {invitation.inviterName || invitation.inviterEmail || '团队成员'}{' '}
                          邀请你加入
                        </div>
                      </div>
                    </div>
                    <div className='mt-3 flex justify-end gap-2'>
                      <Button
                        type='button'
                        size='sm'
                        variant='default'
                        disabled={isBusy && activeInvitationId === invitation.id}
                        onClick={() => void handleRejectInvitation(invitation.id)}
                      >
                        <X className='mr-1 h-[13px] w-[13px]' />
                        拒绝
                      </Button>
                      <Button
                        type='button'
                        size='sm'
                        variant='primary'
                        disabled={isBusy && activeInvitationId === invitation.id}
                        onClick={() => void handleAcceptInvitation(invitation.id)}
                      >
                        <Check className='mr-1 h-[13px] w-[13px]' />
                        接受
                      </Button>
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            {unreadGroups.length > 0 ? (
              <section className='space-y-2'>
                <div className='px-1 font-medium text-[11px] text-[var(--text-tertiary)]'>
                  未读任务消息
                </div>
                {unreadGroups.map((group) => (
                  <div key={group.id} className='space-y-1.5'>
                    <div className='px-1 text-[11px] text-[var(--text-muted)]'>{group.name}</div>
                    {group.tasks.map((task) => (
                      <div
                        key={task.id}
                        className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'
                      >
                        <div className='min-w-0'>
                          <div className='truncate font-medium text-[12px] text-[var(--text-primary)]'>
                            {task.title}
                          </div>
                          <div className='mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]'>
                            <MessageSquare className='h-3 w-3' />
                            {task.unreadMessageCount} 条新消息
                          </div>
                        </div>
                        <div className='mt-3 flex justify-end gap-2'>
                          <Button
                            type='button'
                            size='sm'
                            variant='default'
                            disabled={isBusy && activeReadTaskId === task.id}
                            onClick={() => void handleMarkTaskRead(task.id)}
                          >
                            {activeReadTaskId === task.id ? (
                              <Loader2 className='mr-1 h-[13px] w-[13px] animate-spin' />
                            ) : (
                              <Check className='mr-1 h-[13px] w-[13px]' />
                            )}
                            已读
                          </Button>
                          <Button
                            type='button'
                            size='sm'
                            variant='primary'
                            onClick={() => openTask(task.id)}
                          >
                            打开
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            ) : null}

            {dueSoonTasks.length > 0 ? (
              <section className='space-y-2'>
                <div className='px-1 font-medium text-[11px] text-[var(--text-tertiary)]'>
                  24h DDL 预警
                </div>
                {dueSoonTasks.map((task) => (
                  <div
                    key={task.id}
                    className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'
                  >
                    <div className='flex items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <div className='truncate font-medium text-[12px] text-[var(--text-primary)]'>
                          {task.title}
                        </div>
                        <div className='mt-1 flex items-center gap-1.5 text-[11px] text-[var(--badge-amber-text)]'>
                          <CalendarClock className='h-3 w-3' />
                          DDL {formatDateTime(task.dueAt)}
                        </div>
                      </div>
                      <Badge variant='amber' size='sm' className='shrink-0 rounded-full px-2'>
                        预警
                      </Badge>
                    </div>
                    <div className='mt-3 flex justify-end gap-2'>
                      <Button
                        type='button'
                        size='sm'
                        variant='default'
                        onClick={() => dismissDueWarnings([task])}
                      >
                        <Check className='mr-1 h-[13px] w-[13px]' />
                        忽略
                      </Button>
                      <Button
                        type='button'
                        size='sm'
                        variant='primary'
                        onClick={() => openTask(task.id)}
                      >
                        打开
                      </Button>
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            {totalSignalCount === 0 && !isLoading ? (
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px] text-[var(--text-muted)]'>
                暂无未读任务消息、DDL 预警或待处理邀请。
              </div>
            ) : null}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
