'use client'

import { useMemo, useState } from 'react'
import { Crown, Mail, Shield, UserMinus, Users } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Button, Input, Loader } from '@/components/emcn'
import {
  useAddWorkgroupMember,
  useCreateTeamWorkspace,
  useMyWorkgroups,
  useRemoveWorkgroupMember,
  useTeamWorkspace,
  useUpdateWorkgroupMember,
  useWorkgroupMembers,
} from '@/hooks/queries/collaboration'

type WorkgroupRole = 'admin' | 'member'

function roleLabel(role: WorkgroupRole) {
  return role === 'admin' ? 'Admin' : 'Member'
}

export function WorkgroupTeamManagement() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const { data: workgroupsData, isLoading: isLoadingWorkgroups } = useMyWorkgroups()
  const workgroups = workgroupsData?.workgroups ?? []
  const activeWorkgroup =
    workgroups.find((workgroup) => workgroup.teamWorkspaceId === workspaceId) ??
    workgroups.find((workgroup) => workgroup.id === workgroupsData?.defaultWorkgroupId) ??
    workgroups[0]
  const activeWorkgroupId = activeWorkgroup?.id
  const isAdmin = activeWorkgroup?.role === 'admin'
  const { data: teamWorkspaceData } = useTeamWorkspace(activeWorkgroupId)
  const { data: membersData, isLoading: isLoadingMembers } = useWorkgroupMembers(
    isAdmin ? activeWorkgroupId : undefined
  )
  const addMember = useAddWorkgroupMember()
  const updateMember = useUpdateWorkgroupMember()
  const removeMember = useRemoveWorkgroupMember()
  const createTeamWorkspace = useCreateTeamWorkspace()
  const [inviteValue, setInviteValue] = useState('')
  const [inviteRole, setInviteRole] = useState<WorkgroupRole>('member')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const members = membersData?.members ?? []
  const teamWorkspaceId = teamWorkspaceData?.workspace.id ?? activeWorkgroup?.teamWorkspaceId
  const isBusy =
    addMember.isPending ||
    updateMember.isPending ||
    removeMember.isPending ||
    createTeamWorkspace.isPending

  const pageState = useMemo(() => {
    if (isLoadingWorkgroups) return 'loading'
    if (!activeWorkgroup) return 'no-team'
    if (!isAdmin) return 'forbidden'
    return 'ready'
  }, [activeWorkgroup, isAdmin, isLoadingWorkgroups])

  const handleInitializeTeamCanvas = async () => {
    if (!activeWorkgroupId) return
    const result = await createTeamWorkspace.mutateAsync({ workgroupId: activeWorkgroupId })
    setStatusMessage('Team canvas initialized.')
    router.push(
      result.defaultWorkflowId
        ? `/workspace/${result.workspace.id}/w/${result.defaultWorkflowId}`
        : `/workspace/${result.workspace.id}/home`
    )
  }

  const handleInvite = async () => {
    const trimmed = inviteValue.trim()
    if (!activeWorkgroupId || !trimmed) return
    const isEmail = trimmed.includes('@')
    await addMember.mutateAsync({
      workgroupId: activeWorkgroupId,
      role: inviteRole,
      ...(isEmail ? { email: trimmed } : { userId: trimmed }),
    })
    setInviteValue('')
    setInviteRole('member')
    setStatusMessage('Member added to the team.')
  }

  const handleRoleChange = async (userId: string, role: WorkgroupRole) => {
    if (!activeWorkgroupId) return
    await updateMember.mutateAsync({ workgroupId: activeWorkgroupId, userId, role })
    setStatusMessage('Member role updated.')
  }

  const handleRemove = async (userId: string) => {
    if (!activeWorkgroupId) return
    await removeMember.mutateAsync({ workgroupId: activeWorkgroupId, userId })
    setStatusMessage('Member removed from the team.')
  }

  if (pageState === 'loading') {
    return (
      <div className='flex h-full items-center justify-center bg-[var(--bg)]'>
        <Loader className='h-[18px] w-[18px] text-[var(--text-icon)]' animate />
      </div>
    )
  }

  if (pageState === 'no-team') {
    return (
      <div className='flex h-full items-center justify-center bg-[var(--bg)] px-6'>
        <div className='max-w-[360px] text-center'>
          <h1 className='font-medium text-[18px] text-[var(--text-primary)]'>No active team</h1>
          <p className='mt-2 text-[13px] text-[var(--text-muted)] leading-5'>
            Join a workgroup before managing team members and the team canvas.
          </p>
        </div>
      </div>
    )
  }

  if (pageState === 'forbidden') {
    return (
      <div className='flex h-full items-center justify-center bg-[var(--bg)] px-6'>
        <div className='max-w-[420px] text-center'>
          <div className='mx-auto flex h-[34px] w-[34px] items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'>
            <Shield className='h-[16px] w-[16px] text-[var(--text-icon)]' />
          </div>
          <h1 className='mt-4 font-medium text-[18px] text-[var(--text-primary)]'>
            Team admin access required
          </h1>
          <p className='mt-2 text-[13px] text-[var(--text-muted)] leading-5'>
            You can use the personal draft, team canvas, and showcase canvas, but only team admins
            can invite members or initialize the team canvas.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className='h-full overflow-y-auto bg-[var(--bg)] [scrollbar-gutter:stable_both-edges]'>
      <div className='mx-auto flex w-full max-w-[72rem] flex-col gap-4 px-4 py-6 sm:px-6 lg:px-10'>
        <div className='flex flex-col gap-3 md:flex-row md:items-start md:justify-between'>
          <div>
            <div className='text-[12px] text-[var(--text-muted)]'>
              {activeWorkgroup?.discipline.name} / {activeWorkgroup?.name}
            </div>
            <h1 className='mt-1 font-medium text-[22px] text-[var(--text-primary)]'>
              Team management
            </h1>
            <p className='mt-2 max-w-[520px] text-[13px] text-[var(--text-muted)] leading-5'>
              Manage members for this workgroup, initialize the shared team canvas, and keep
              personal drafts separate from team administration.
            </p>
          </div>
          <Button
            variant={teamWorkspaceId ? 'default' : 'primary'}
            className='h-[32px]'
            onClick={() =>
              teamWorkspaceId
                ? router.push(`/workspace/${teamWorkspaceId}/home`)
                : void handleInitializeTeamCanvas()
            }
            disabled={isBusy}
          >
            {createTeamWorkspace.isPending ? (
              <Loader className='mr-2 h-[14px] w-[14px]' animate />
            ) : (
              <Users className='mr-2 h-[14px] w-[14px]' />
            )}
            {teamWorkspaceId ? 'Open team canvas' : 'Initialize team canvas'}
          </Button>
        </div>

        {statusMessage && (
          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[12px] text-[var(--text-body)]'>
            {statusMessage}
          </div>
        )}

        <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
          <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
            <Mail className='h-[15px] w-[15px] text-[var(--text-icon)]' />
            <div>
              <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                Invite existing user
              </h2>
              <p className='text-[12px] text-[var(--text-muted)]'>
                Enter an existing account email or user ID, then choose the team role.
              </p>
            </div>
          </div>
          <div className='grid gap-2 p-4 md:grid-cols-[minmax(0,1fr)_140px_auto]'>
            <Input
              value={inviteValue}
              onChange={(event) => setInviteValue(event.target.value)}
              placeholder='name@example.com or user ID'
              disabled={isBusy}
            />
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as WorkgroupRole)}
              disabled={isBusy}
              className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
            >
              <option value='member'>Member</option>
              <option value='admin'>Admin</option>
            </select>
            <Button
              variant='primary'
              onClick={() => void handleInvite()}
              disabled={!inviteValue.trim() || isBusy}
            >
              {addMember.isPending ? <Loader className='mr-2 h-[14px] w-[14px]' animate /> : null}
              Add member
            </Button>
          </div>
        </section>

        <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
          <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
            <Users className='h-[15px] w-[15px] text-[var(--text-icon)]' />
            <div>
              <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>Team members</h2>
              <p className='text-[12px] text-[var(--text-muted)]'>
                Admins can update roles or remove members. The last admin is protected by the
                server.
              </p>
            </div>
          </div>
          <div className='divide-y divide-[var(--border)]'>
            {isLoadingMembers ? (
              <div className='flex items-center gap-2 px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                <Loader className='h-[14px] w-[14px]' animate />
                Loading members...
              </div>
            ) : members.length === 0 ? (
              <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                No team members yet.
              </div>
            ) : (
              members.map((member) => (
                <div
                  key={member.userId}
                  className='grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_140px_auto]'
                >
                  <div className='min-w-0'>
                    <div className='flex items-center gap-2'>
                      <span className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                        {member.name || member.email}
                      </span>
                      {member.role === 'admin' && (
                        <Crown className='h-[13px] w-[13px] text-[var(--text-icon)]' />
                      )}
                    </div>
                    <div className='truncate text-[12px] text-[var(--text-muted)]'>
                      {member.email} · {roleLabel(member.role)}
                    </div>
                  </div>
                  <select
                    value={member.role}
                    onChange={(event) =>
                      void handleRoleChange(member.userId, event.target.value as WorkgroupRole)
                    }
                    disabled={isBusy}
                    className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
                  >
                    <option value='member'>Member</option>
                    <option value='admin'>Admin</option>
                  </select>
                  <Button
                    variant='default'
                    className='h-[32px]'
                    onClick={() => void handleRemove(member.userId)}
                    disabled={isBusy}
                  >
                    <UserMinus className='mr-2 h-[14px] w-[14px]' />
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
