'use client'

import { useMemo, useState } from 'react'
import {
  Activity,
  Archive,
  Crown,
  EyeOff,
  Mail,
  RotateCcw,
  Send,
  Shield,
  Sparkles,
  UserMinus,
  Users,
  X,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Button, Input, Loader, Switch } from '@/components/emcn'
import {
  useAddWorkgroupMember,
  useCreateTeamWorkspace,
  useMyWorkgroups,
  useRemoveWorkgroupMember,
  useShowcasePublications,
  useTeamWorkspace,
  useUpdatePublicationLifecycle,
  useUpdateWorkgroupAgentSkill,
  useUpdateWorkgroupMember,
  useWorkgroupActivity,
  useWorkgroupAgentSkills,
  useWorkgroupMembers,
} from '@/hooks/queries/collaboration'
import {
  useCancelWorkspaceInvitation,
  usePendingInvitations,
  useResendWorkspaceInvitation,
} from '@/hooks/queries/invitations'
import { useInviteMember } from '@/hooks/queries/organization'
import { usePublishWorkflow, useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceSettings } from '@/hooks/queries/workspace'

type WorkgroupRole = 'admin' | 'member'

function roleLabel(role: WorkgroupRole) {
  return role === 'admin' ? 'Admin' : 'Member'
}

function formatPublicationDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatPublicationStatus(status: string) {
  switch (status) {
    case 'published':
      return 'Published'
    case 'superseded':
      return 'Superseded'
    case 'archived':
      return 'Archived'
    case 'retracted':
      return 'Retracted'
    default:
      return status
  }
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function formatActivityAction(action: string) {
  switch (action) {
    case 'member.invited':
      return 'Member added'
    case 'member.role_changed':
      return 'Role updated'
    case 'member.removed':
      return 'Member removed'
    case 'publication.created':
      return 'Published showcase'
    case 'publication.archived':
      return 'Archived publication'
    case 'publication.retracted':
      return 'Retracted publication'
    case 'skill.updated':
      return 'Agent skill updated'
    case 'workspace.created':
      return 'Team canvas initialized'
    default:
      return action
  }
}

export function WorkgroupTeamManagement() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const { data: workgroupsData, isLoading: isLoadingWorkgroups } = useMyWorkgroups()
  const workgroups = workgroupsData?.workgroups ?? []
  const { data: workspaceSettingsData } = useWorkspaceSettings(workspaceId)
  const currentWorkspaceWorkgroupId = workspaceSettingsData?.settings.workspace.workgroupId
  const activeWorkgroup =
    workgroups.find((workgroup) => workgroup.teamWorkspaceId === workspaceId) ??
    workgroups.find((workgroup) => workgroup.id === currentWorkspaceWorkgroupId) ??
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
  const inviteMember = useInviteMember()
  const updatePublicationLifecycle = useUpdatePublicationLifecycle()
  const updateAgentSkill = useUpdateWorkgroupAgentSkill()
  const publishWorkflow = usePublishWorkflow()
  const cancelInvitation = useCancelWorkspaceInvitation()
  const resendInvitation = useResendWorkspaceInvitation()
  const [inviteValue, setInviteValue] = useState('')
  const [emailInvitationValue, setEmailInvitationValue] = useState('')
  const [inviteRole, setInviteRole] = useState<WorkgroupRole>('member')
  const [publishWorkflowId, setPublishWorkflowId] = useState('')
  const [publishTitle, setPublishTitle] = useState('')
  const [publishDescription, setPublishDescription] = useState('')
  const [publishVisibility, setPublishVisibility] = useState<
    'organization' | 'selected_workgroups'
  >('organization')
  const [publishTargetWorkgroupIds, setPublishTargetWorkgroupIds] = useState<string[]>([])
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const members = membersData?.members ?? []
  const teamWorkspaceId = teamWorkspaceData?.workspace.id ?? activeWorkgroup?.teamWorkspaceId
  const { data: teamWorkflows = [], isLoading: isLoadingTeamWorkflows } = useWorkflows(
    isAdmin && teamWorkspaceId ? teamWorkspaceId : undefined
  )
  const selectedPublishWorkflow =
    teamWorkflows.find((workflow) => workflow.id === publishWorkflowId) ?? teamWorkflows[0]
  const publishTargetWorkgroups = workgroups.filter(
    (workgroup) => workgroup.organizationId === activeWorkgroup?.organizationId
  )
  const publicationFilters = useMemo(
    () =>
      isAdmin && activeWorkgroupId ? { sourceWorkgroupId: activeWorkgroupId, limit: 8 } : undefined,
    [activeWorkgroupId, isAdmin]
  )
  const {
    data: publicationsData,
    isLoading: isLoadingPublications,
    refetch: refetchPublications,
  } = useShowcasePublications(isAdmin ? activeWorkgroupId : undefined, publicationFilters)
  const { data: agentSkillsData, isLoading: isLoadingAgentSkills } = useWorkgroupAgentSkills(
    isAdmin ? activeWorkgroupId : undefined
  )
  const {
    data: activityData,
    isLoading: isLoadingActivity,
    refetch: refetchActivity,
  } = useWorkgroupActivity(isAdmin ? activeWorkgroupId : undefined, 10)
  const { data: pendingInvitations = [], isLoading: isLoadingPendingInvitations } =
    usePendingInvitations(isAdmin ? teamWorkspaceId : undefined)
  const publications = publicationsData?.publications ?? []
  const agentSkills = agentSkillsData?.skills ?? []
  const activity = activityData?.activity ?? []
  const isBusy =
    addMember.isPending ||
    inviteMember.isPending ||
    updatePublicationLifecycle.isPending ||
    updateAgentSkill.isPending ||
    publishWorkflow.isPending ||
    cancelInvitation.isPending ||
    resendInvitation.isPending ||
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

  const handleEmailInvitation = async () => {
    const email = emailInvitationValue.trim()
    if (!activeWorkgroup?.organizationId || !teamWorkspaceId || !email) return
    try {
      await inviteMember.mutateAsync({
        orgId: activeWorkgroup.organizationId,
        emails: [email],
        workspaceInvitations: [
          {
            workspaceId: teamWorkspaceId,
            permission: inviteRole === 'admin' ? 'admin' : 'write',
          },
        ],
      })
      setEmailInvitationValue('')
      setStatusMessage('Invitation email sent for the team canvas.')
    } catch (error) {
      setStatusMessage(readErrorMessage(error))
    }
  }

  const handleResendInvitation = async (invitationId: string) => {
    if (!teamWorkspaceId) return
    try {
      await resendInvitation.mutateAsync({ invitationId, workspaceId: teamWorkspaceId })
      setStatusMessage('Invitation email resent.')
    } catch (error) {
      setStatusMessage(readErrorMessage(error))
    }
  }

  const handleCancelInvitation = async (invitationId: string) => {
    if (!teamWorkspaceId) return
    try {
      await cancelInvitation.mutateAsync({
        invitationId,
        workspaceId: teamWorkspaceId,
        organizationId: activeWorkgroup?.organizationId,
      })
      setStatusMessage('Pending invitation canceled.')
    } catch (error) {
      setStatusMessage(readErrorMessage(error))
    }
  }

  const handlePublicationLifecycle = async (
    publicationVersionId: string,
    action: 'archive' | 'retract'
  ) => {
    try {
      await updatePublicationLifecycle.mutateAsync({
        publicationVersionId,
        action,
        reason: `Updated from team management for ${activeWorkgroup?.name ?? 'team'}`,
      })
      await refetchActivity()
      setStatusMessage(action === 'archive' ? 'Publication archived.' : 'Publication retracted.')
    } catch (error) {
      setStatusMessage(readErrorMessage(error))
    }
  }

  const handlePublishTargetToggle = (workgroupId: string, checked: boolean) => {
    setPublishTargetWorkgroupIds((current) =>
      checked
        ? Array.from(new Set([...current, workgroupId]))
        : current.filter((item) => item !== workgroupId)
    )
  }

  const handlePublishTeamWorkflow = async () => {
    if (!teamWorkspaceId || !activeWorkgroupId || !selectedPublishWorkflow) return
    const title = publishTitle.trim() || selectedPublishWorkflow.name
    const description = publishDescription.trim()
    const targetWorkgroupIds =
      publishVisibility === 'selected_workgroups'
        ? publishTargetWorkgroupIds.length > 0
          ? publishTargetWorkgroupIds
          : [activeWorkgroupId]
        : []
    try {
      await publishWorkflow.mutateAsync({
        workflowId: selectedPublishWorkflow.id,
        workspaceId: teamWorkspaceId,
        title,
        description: description || undefined,
        visibility: publishVisibility,
        targetWorkgroupIds,
      })
      await refetchPublications()
      await refetchActivity()
      setPublishTitle('')
      setPublishDescription('')
      setPublishTargetWorkgroupIds([])
      setStatusMessage('Team canvas published to showcase.')
    } catch (error) {
      setStatusMessage(readErrorMessage(error))
    }
  }

  const handleAgentSkillToggle = async (skillId: string, enabled: boolean) => {
    if (!activeWorkgroupId) return
    try {
      await updateAgentSkill.mutateAsync({ workgroupId: activeWorkgroupId, skillId, enabled })
      setStatusMessage(enabled ? 'Agent skill enabled.' : 'Agent skill disabled.')
    } catch (error) {
      setStatusMessage(readErrorMessage(error))
    }
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
                Add existing user
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
            <Mail className='h-[15px] w-[15px] text-[var(--text-icon)]' />
            <div>
              <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                Send team invitation
              </h2>
              <p className='text-[12px] text-[var(--text-muted)]'>
                Email a new teammate. Accepting the invite grants team canvas access and joins this
                workgroup.
              </p>
            </div>
          </div>
          <div className='grid gap-2 p-4 md:grid-cols-[minmax(0,1fr)_140px_auto]'>
            <Input
              value={emailInvitationValue}
              onChange={(event) => setEmailInvitationValue(event.target.value)}
              placeholder='name@example.com'
              disabled={isBusy || !teamWorkspaceId}
            />
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as WorkgroupRole)}
              disabled={isBusy || !teamWorkspaceId}
              className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
            >
              <option value='member'>Member</option>
              <option value='admin'>Admin</option>
            </select>
            <Button
              variant='primary'
              onClick={() => void handleEmailInvitation()}
              disabled={!emailInvitationValue.trim() || !teamWorkspaceId || isBusy}
            >
              {inviteMember.isPending ? (
                <Loader className='mr-2 h-[14px] w-[14px]' animate />
              ) : null}
              Send invite
            </Button>
          </div>
          {!teamWorkspaceId && (
            <div className='border-[var(--border)] border-t px-4 py-3 text-[12px] text-[var(--text-muted)]'>
              Initialize the team canvas before sending a team invitation.
            </div>
          )}
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

        <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
          <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
            <Send className='h-[15px] w-[15px] text-[var(--text-icon)]' />
            <div>
              <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                Publish team canvas
              </h2>
              <p className='text-[12px] text-[var(--text-muted)]'>
                Create a showcase snapshot from a team workflow and choose the initial visibility.
              </p>
            </div>
          </div>
          <div className='grid gap-3 p-4'>
            {!teamWorkspaceId ? (
              <div className='text-[13px] text-[var(--text-muted)]'>
                Initialize the team canvas before publishing showcase versions.
              </div>
            ) : isLoadingTeamWorkflows ? (
              <div className='flex items-center gap-2 text-[13px] text-[var(--text-muted)]'>
                <Loader className='h-[14px] w-[14px]' animate />
                Loading team workflows...
              </div>
            ) : teamWorkflows.length === 0 ? (
              <div className='text-[13px] text-[var(--text-muted)]'>
                No workflows exist in the team canvas yet.
              </div>
            ) : (
              <>
                <div className='grid gap-2 md:grid-cols-[minmax(0,1fr)_180px]'>
                  <select
                    value={selectedPublishWorkflow?.id ?? ''}
                    onChange={(event) => setPublishWorkflowId(event.target.value)}
                    disabled={isBusy}
                    className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
                  >
                    {teamWorkflows.map((workflow) => (
                      <option key={workflow.id} value={workflow.id}>
                        {workflow.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={publishVisibility}
                    onChange={(event) =>
                      setPublishVisibility(
                        event.target.value as 'organization' | 'selected_workgroups'
                      )
                    }
                    disabled={isBusy}
                    className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
                  >
                    <option value='organization'>Organization visible</option>
                    <option value='selected_workgroups'>Selected teams</option>
                  </select>
                </div>
                <Input
                  value={publishTitle}
                  onChange={(event) => setPublishTitle(event.target.value)}
                  placeholder={`Title: ${selectedPublishWorkflow?.name ?? 'Team plan'}`}
                  disabled={isBusy}
                />
                <Input
                  value={publishDescription}
                  onChange={(event) => setPublishDescription(event.target.value)}
                  placeholder='Version note or review summary'
                  disabled={isBusy}
                />
                {publishVisibility === 'selected_workgroups' && (
                  <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                    <div className='mb-2 text-[12px] text-[var(--text-muted)]'>
                      Select teams that can see this showcase snapshot. If none are selected, only
                      the current team is targeted.
                    </div>
                    <div className='grid gap-2 md:grid-cols-2'>
                      {publishTargetWorkgroups.map((workgroup) => (
                        <div
                          key={workgroup.id}
                          className='flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[13px] text-[var(--text-body)]'
                        >
                          <span className='truncate'>
                            {workgroup.discipline.name} / {workgroup.name}
                          </span>
                          <Switch
                            checked={publishTargetWorkgroupIds.includes(workgroup.id)}
                            disabled={isBusy}
                            aria-label={`Toggle ${workgroup.name} showcase visibility`}
                            onCheckedChange={(checked) =>
                              handlePublishTargetToggle(workgroup.id, checked)
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className='flex items-center justify-between gap-3'>
                  <div className='text-[12px] text-[var(--text-muted)]'>
                    Publishing creates an immutable showcase version and supersedes older published
                    versions for this workflow.
                  </div>
                  <Button
                    variant='primary'
                    onClick={() => void handlePublishTeamWorkflow()}
                    disabled={isBusy || !selectedPublishWorkflow}
                  >
                    {publishWorkflow.isPending ? (
                      <Loader className='mr-2 h-[14px] w-[14px]' animate />
                    ) : (
                      <Send className='mr-2 h-[14px] w-[14px]' />
                    )}
                    Publish
                  </Button>
                </div>
              </>
            )}
          </div>
        </section>

        <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
          <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
            <Archive className='h-[15px] w-[15px] text-[var(--text-icon)]' />
            <div>
              <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                Team publications
              </h2>
              <p className='text-[12px] text-[var(--text-muted)]'>
                Review the latest showcase versions from this workgroup and manage their lifecycle.
              </p>
            </div>
          </div>
          <div className='divide-y divide-[var(--border)]'>
            {isLoadingPublications ? (
              <div className='flex items-center gap-2 px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                <Loader className='h-[14px] w-[14px]' animate />
                Loading publications...
              </div>
            ) : publications.length === 0 ? (
              <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                No showcase publications from this team yet.
              </div>
            ) : (
              publications.map((publication) => (
                <div
                  key={publication.id}
                  className='grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto]'
                >
                  <div className='min-w-0'>
                    <div className='flex min-w-0 items-center gap-2'>
                      <span className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                        {publication.title}
                      </span>
                      <span className='shrink-0 rounded-[8px] border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]'>
                        v{publication.versionNumber} · {formatPublicationStatus(publication.status)}
                      </span>
                    </div>
                    <div className='truncate text-[12px] text-[var(--text-muted)]'>
                      {publication.description?.trim() || 'No description'} ·{' '}
                      {formatPublicationDate(publication.publishedAt)}
                    </div>
                  </div>
                  <Button
                    variant='default'
                    className='h-[32px]'
                    onClick={() => void handlePublicationLifecycle(publication.id, 'archive')}
                    disabled={isBusy}
                  >
                    <Archive className='mr-2 h-[14px] w-[14px]' />
                    Archive
                  </Button>
                  <Button
                    variant='default'
                    className='h-[32px]'
                    onClick={() => void handlePublicationLifecycle(publication.id, 'retract')}
                    disabled={isBusy}
                  >
                    <EyeOff className='mr-2 h-[14px] w-[14px]' />
                    Retract
                  </Button>
                </div>
              ))
            )}
          </div>
          <div className='border-[var(--border)] border-t px-4 py-3'>
            <Button
              variant='default'
              className='h-[32px]'
              onClick={() => router.push(`/workspace/${workspaceId}/showcase`)}
            >
              Open showcase canvas
            </Button>
          </div>
        </section>

        <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
          <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
            <Sparkles className='h-[15px] w-[15px] text-[var(--text-icon)]' />
            <div>
              <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                Team Agent Skills
              </h2>
              <p className='text-[12px] text-[var(--text-muted)]'>
                Enable or disable skills available to the {agentSkillsData?.agent.name ?? 'team'}{' '}
                Copilot agent for this workgroup.
              </p>
            </div>
          </div>
          <div className='divide-y divide-[var(--border)]'>
            {!teamWorkspaceId ? (
              <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                Initialize the team canvas before binding skills to the team agent.
              </div>
            ) : isLoadingAgentSkills ? (
              <div className='flex items-center gap-2 px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                <Loader className='h-[14px] w-[14px]' animate />
                Loading agent skills...
              </div>
            ) : agentSkills.length === 0 ? (
              <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                No skills exist in the team canvas yet. Create skills in the team workspace, then
                return here to bind them to the agent.
              </div>
            ) : (
              agentSkills.map((skill) => (
                <div
                  key={skill.skillId}
                  className='grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]'
                >
                  <div className='min-w-0'>
                    <div className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                      {skill.name}
                    </div>
                    <div className='truncate text-[12px] text-[var(--text-muted)]'>
                      {skill.description?.trim() || 'No description'}
                    </div>
                  </div>
                  <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
                    {skill.enabled ? 'Enabled' : 'Disabled'}
                    <Switch
                      checked={skill.enabled}
                      disabled={isBusy}
                      onCheckedChange={(checked) =>
                        void handleAgentSkillToggle(skill.skillId, checked)
                      }
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
          <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
            <Activity className='h-[15px] w-[15px] text-[var(--text-icon)]' />
            <div>
              <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>Team activity</h2>
              <p className='text-[12px] text-[var(--text-muted)]'>
                Recent member, publication, canvas, and Agent Skill changes for this workgroup.
              </p>
            </div>
          </div>
          <div className='divide-y divide-[var(--border)]'>
            {isLoadingActivity ? (
              <div className='flex items-center gap-2 px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                <Loader className='h-[14px] w-[14px]' animate />
                Loading team activity...
              </div>
            ) : activity.length === 0 ? (
              <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                No team activity has been recorded yet.
              </div>
            ) : (
              activity.map((entry) => (
                <div
                  key={entry.id}
                  className='grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_160px]'
                >
                  <div className='min-w-0'>
                    <div className='flex min-w-0 items-center gap-2'>
                      <span className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                        {formatActivityAction(entry.action)}
                      </span>
                      {entry.resourceName && (
                        <span className='truncate text-[12px] text-[var(--text-muted)]'>
                          {entry.resourceName}
                        </span>
                      )}
                    </div>
                    <div className='truncate text-[12px] text-[var(--text-muted)]'>
                      {entry.description?.trim() || 'No additional details'} ·{' '}
                      {entry.actorName || entry.actorEmail || 'Unknown actor'}
                    </div>
                  </div>
                  <div className='text-[12px] text-[var(--text-muted)] md:text-right'>
                    {formatPublicationDate(entry.createdAt)}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
          <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
            <Mail className='h-[15px] w-[15px] text-[var(--text-icon)]' />
            <div>
              <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                Pending invitations
              </h2>
              <p className='text-[12px] text-[var(--text-muted)]'>
                Resend or cancel team canvas invites that have not been accepted yet.
              </p>
            </div>
          </div>
          <div className='divide-y divide-[var(--border)]'>
            {!teamWorkspaceId ? (
              <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                Initialize the team canvas before managing invitations.
              </div>
            ) : isLoadingPendingInvitations ? (
              <div className='flex items-center gap-2 px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                <Loader className='h-[14px] w-[14px]' animate />
                Loading invitations...
              </div>
            ) : pendingInvitations.length === 0 ? (
              <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                No pending team invitations.
              </div>
            ) : (
              pendingInvitations.map((invitation) => (
                <div
                  key={invitation.invitationId ?? invitation.email}
                  className='grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto]'
                >
                  <div className='min-w-0'>
                    <div className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                      {invitation.email}
                    </div>
                    <div className='truncate text-[12px] text-[var(--text-muted)]'>
                      {invitation.permissionType === 'admin' ? 'Admin' : 'Member'} access
                      {invitation.isExternal ? ' / external invite' : ''}
                    </div>
                  </div>
                  <Button
                    variant='default'
                    className='h-[32px]'
                    onClick={() =>
                      invitation.invitationId
                        ? void handleResendInvitation(invitation.invitationId)
                        : undefined
                    }
                    disabled={!invitation.invitationId || isBusy}
                  >
                    <RotateCcw className='mr-2 h-[14px] w-[14px]' />
                    Resend
                  </Button>
                  <Button
                    variant='default'
                    className='h-[32px]'
                    onClick={() =>
                      invitation.invitationId
                        ? void handleCancelInvitation(invitation.invitationId)
                        : undefined
                    }
                    disabled={!invitation.invitationId || isBusy}
                  >
                    <X className='mr-2 h-[14px] w-[14px]' />
                    Cancel
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
