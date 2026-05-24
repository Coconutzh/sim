'use client'

import { useRouter } from 'next/navigation'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Loader,
} from '@/components/emcn'
import { Bell } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import {
  useMarkProjectNotificationCenterRead,
  useProjectNotificationCenter,
} from '@/hooks/queries/collaboration'

const CENTER_QUERY = { limit: 10 } as const

interface PublicationNotificationBellProps {
  organizationId?: string
  workspaceId: string
  enabled: boolean
}

export function PublicationNotificationBell({
  organizationId,
  workspaceId,
  enabled,
}: PublicationNotificationBellProps) {
  const router = useRouter()
  const { data, isLoading } = useProjectNotificationCenter(
    enabled ? organizationId : undefined,
    CENTER_QUERY
  )
  const markRead = useMarkProjectNotificationCenterRead()
  const notifications = data?.notifications ?? []
  const unreadCount = notifications.filter((entry) => !entry.readAt).length

  if (!enabled || !organizationId) return null

  const markAllRead = () => {
    if (unreadCount === 0 || markRead.isPending) return
    markRead.mutate({ organizationId, markAll: true })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          className='relative flex h-[30px] w-[30px] items-center justify-center rounded-lg transition-colors hover-hover:bg-[var(--surface-hover)]'
          aria-label='Project notification center'
          title='Project notification center'
        >
          <Bell className='h-[16px] w-[16px] text-[var(--text-icon)]' />
          {unreadCount > 0 && (
            <span className='absolute top-[5px] right-[5px] h-[7px] w-[7px] rounded-full bg-red-500' />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        side='bottom'
        sideOffset={8}
        className='w-[320px] max-w-[calc(100vw-24px)] p-2'
      >
        <div className='flex items-start justify-between gap-3 px-1 py-1'>
          <div>
            <div className='font-medium text-[12px] text-[var(--text-primary)]'>
              Project notification center
            </div>
            <div className='mt-0.5 text-[11px] text-[var(--text-muted)]'>
              {unreadCount} unread in recent project alerts
            </div>
          </div>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-[26px] rounded-[6px] px-2 text-[11px]'
            disabled={unreadCount === 0 || markRead.isPending}
            onClick={markAllRead}
          >
            Mark all read
          </Button>
        </div>
        <div className='mt-2 grid max-h-[360px] gap-1 overflow-y-auto'>
          {isLoading ? (
            <div className='flex items-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px] text-[var(--text-muted)]'>
              <Loader className='h-[14px] w-[14px] animate-spin' />
              Loading notifications...
            </div>
          ) : notifications.length === 0 ? (
            <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px] text-[var(--text-muted)]'>
              No project notifications yet.
            </div>
          ) : (
            notifications.map((entry) => (
              <button
                key={entry.id}
                type='button'
                className={cn(
                  'w-full rounded-[8px] border p-3 text-left transition-colors hover-hover:bg-[var(--surface-hover)]',
                  entry.readAt
                    ? 'border-[var(--border)] bg-[var(--surface-2)]'
                    : 'border-amber-500/30 bg-amber-500/10'
                )}
                onClick={() => {
                  if (!entry.readAt && !markRead.isPending) {
                    markRead.mutate({ organizationId, notificationId: entry.id })
                  }
                  router.push(`/workspace/${workspaceId}/project-notifications`)
                }}
              >
                <div className='flex items-start justify-between gap-2'>
                  <span className='line-clamp-1 font-medium text-[12px] text-[var(--text-primary)]'>
                    {entry.title}
                  </span>
                  <span className='shrink-0 rounded-[6px] border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]'>
                    {entry.kind === 'publication_review'
                      ? (entry.channel?.replace('_', ' ') ?? 'publication')
                      : 'failure'}
                  </span>
                </div>
                <div className='mt-1 line-clamp-2 text-[11px] text-[var(--text-muted)]'>
                  {entry.detail || entry.body}
                </div>
                <div className='mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--text-muted)]'>
                  <span>{entry.notificationCount} notifications</span>
                  <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
                  {!entry.readAt && <span className='text-amber-500'>Unread</span>}
                </div>
              </button>
            ))
          )}
        </div>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='mt-2 h-[28px] w-full rounded-[6px] text-[11px]'
          onClick={() => router.push(`/workspace/${workspaceId}/project-notifications`)}
        >
          Open full notification center
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
