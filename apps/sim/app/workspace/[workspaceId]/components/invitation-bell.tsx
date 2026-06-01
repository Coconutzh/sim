'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Loader,
} from '@/components/emcn'
import { Bell, Check, UserPlus, X } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import type { MyPendingInvitation } from '@/hooks/queries/invitations'
import {
  useAcceptMyInvitation,
  useMyPendingInvitations,
  useRejectMyInvitation,
} from '@/hooks/queries/invitations'

function formatInvitationDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatInvitationTitle(invitation: MyPendingInvitation) {
  if (invitation.organizationName) return invitation.organizationName
  const firstGrant = invitation.grants[0]
  return firstGrant?.workspaceName ?? 'Team canvas'
}

function formatInvitationAccess(invitation: MyPendingInvitation) {
  const role = invitation.role === 'admin' ? 'Admin' : 'Member'
  if (invitation.grants.length === 0) return `${role} team access`

  const grantSummary = invitation.grants
    .slice(0, 2)
    .map((grant) => `${grant.workspaceName ?? 'Canvas'} / ${grant.permission}`)
    .join(', ')
  const remaining = invitation.grants.length > 2 ? ` +${invitation.grants.length - 2}` : ''
  return `${role} access, ${grantSummary}${remaining}`
}

interface InvitationCardProps {
  invitation: MyPendingInvitation
  isBusy: boolean
  onAccept: (invitationId: string) => void
  onReject: (invitationId: string) => void
}

function InvitationCard({ invitation, isBusy, onAccept, onReject }: InvitationCardProps) {
  return (
    <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <UserPlus className='h-[14px] w-[14px] shrink-0 text-[var(--text-icon)]' />
            <span className='line-clamp-1 font-medium text-[12px] text-[var(--text-primary)]'>
              {formatInvitationTitle(invitation)}
            </span>
          </div>
          <p className='mt-1 line-clamp-2 text-[11px] text-[var(--text-muted)]'>
            {invitation.inviterName || invitation.inviterEmail || 'A team admin'} invited you to
            join.
          </p>
        </div>
        <span className='shrink-0 rounded-[6px] border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]'>
          {invitation.kind === 'organization' ? 'team' : 'canvas'}
        </span>
      </div>
      <div className='mt-2 text-[11px] text-[var(--text-muted)]'>
        {formatInvitationAccess(invitation)}
      </div>
      <div className='mt-1 text-[10px] text-[var(--text-muted)]'>
        Expires {formatInvitationDate(invitation.expiresAt)}
      </div>
      <div className='mt-3 grid grid-cols-2 gap-2'>
        <Button
          type='button'
          variant='primary'
          size='sm'
          className='h-[28px] rounded-[6px] text-[11px]'
          disabled={isBusy}
          onClick={() => onAccept(invitation.id)}
        >
          <Check className='mr-1 h-[13px] w-[13px]' />
          Accept
        </Button>
        <Button
          type='button'
          variant='default'
          size='sm'
          className='h-[28px] rounded-[6px] text-[11px]'
          disabled={isBusy}
          onClick={() => onReject(invitation.id)}
        >
          <X className='mr-1 h-[13px] w-[13px]' />
          Decline
        </Button>
      </div>
    </div>
  )
}

interface InvitationBellProps {
  className?: string
}

export function InvitationBell({ className }: InvitationBellProps) {
  const router = useRouter()
  const { data, isLoading, isError } = useMyPendingInvitations()
  const acceptInvitation = useAcceptMyInvitation()
  const rejectInvitation = useRejectMyInvitation()
  const [activeInvitationId, setActiveInvitationId] = useState<string | null>(null)

  const invitations = data ?? []
  const isBusy = acceptInvitation.isPending || rejectInvitation.isPending

  const handleAccept = async (invitationId: string) => {
    setActiveInvitationId(invitationId)
    try {
      const result = await acceptInvitation.mutateAsync(invitationId)
      router.refresh()
      router.push(result.redirectPath)
    } finally {
      setActiveInvitationId(null)
    }
  }

  const handleReject = async (invitationId: string) => {
    setActiveInvitationId(invitationId)
    try {
      await rejectInvitation.mutateAsync(invitationId)
      router.refresh()
    } finally {
      setActiveInvitationId(null)
    }
  }

  return (
    <div className={cn('fixed top-[14px] right-[18px] z-50', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            className='relative flex h-[32px] w-[32px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-sm transition-colors hover-hover:bg-[var(--surface-hover)]'
            aria-label='Team invitations'
            title='Team invitations'
          >
            <Bell className='h-[16px] w-[16px] text-[var(--text-icon)]' />
            {invitations.length > 0 && (
              <span className='absolute -top-1 -right-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white'>
                {invitations.length > 9 ? '9+' : invitations.length}
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='end'
          side='bottom'
          sideOffset={8}
          className='w-[340px] max-w-[calc(100vw-24px)] p-2'
        >
          <div className='flex items-start justify-between gap-3 px-1 py-1'>
            <div>
              <div className='font-medium text-[12px] text-[var(--text-primary)]'>
                Team invitations
              </div>
              <div className='mt-0.5 text-[11px] text-[var(--text-muted)]'>
                {invitations.length} pending invitation{invitations.length === 1 ? '' : 's'}
              </div>
            </div>
            {isLoading && <Loader className='mt-1 h-[14px] w-[14px] animate-spin' />}
          </div>
          <div className='mt-2 grid max-h-[380px] gap-2 overflow-y-auto'>
            {isError ? (
              <div className='rounded-[8px] border border-red-500/25 bg-red-500/10 p-3 text-[12px] text-red-700'>
                Unable to load invitations.
              </div>
            ) : isLoading ? (
              <div className='flex items-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px] text-[var(--text-muted)]'>
                <Loader className='h-[14px] w-[14px] animate-spin' />
                Loading invitations...
              </div>
            ) : invitations.length === 0 ? (
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px] text-[var(--text-muted)]'>
                No pending team invitations for this account.
              </div>
            ) : (
              invitations.map((invitation) => (
                <InvitationCard
                  key={invitation.id}
                  invitation={invitation}
                  isBusy={isBusy && activeInvitationId === invitation.id}
                  onAccept={(invitationId) => void handleAccept(invitationId)}
                  onReject={(invitationId) => void handleReject(invitationId)}
                />
              ))
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
