'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Compass, Network, ShieldCheck, Sparkles, Users } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { buttonVariants, Loader } from '@/components/emcn'
import type {
  AgentProfile,
  Discipline,
  PublicationSummary,
  WorkgroupAdminSummary,
} from '@/lib/api/contracts/collaboration'
import { cn } from '@/lib/core/utils/cn'
import {
  useAddWorkgroupMember,
  useAgentProfiles,
  useCreateWorkgroup,
  useDisciplines,
  useMyWorkgroups,
  useOrganizationWorkgroups,
  useShowcasePublications,
} from '@/hooks/queries/collaboration'
import { useOrganizationRoster } from '@/hooks/queries/organization'
import { useWorkspaceSettings } from '@/hooks/queries/workspace'

const PUBLICATION_FILTERS = { limit: 100 } as const

function formatAgentCode(agentCode: string) {
  return agentCode
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getAgentName(agentCode: string, agents: AgentProfile[]) {
  return agents.find((agent) => agent.code === agentCode)?.name ?? formatAgentCode(agentCode)
}

function getActiveWorkgroup(
  workgroups: NonNullable<ReturnType<typeof useMyWorkgroups>['data']>['workgroups'],
  workspaceId: string,
  currentWorkspaceWorkgroupId?: string | null,
  defaultWorkgroupId?: string | null
) {
  return (
    workgroups.find((workgroup) => workgroup.teamWorkspaceId === workspaceId) ??
    workgroups.find((workgroup) => workgroup.id === currentWorkspaceWorkgroupId) ??
    workgroups.find((workgroup) => workgroup.id === defaultWorkgroupId) ??
    workgroups[0]
  )
}

function buildDisciplineRows(
  disciplines: Discipline[],
  teams: WorkgroupAdminSummary[],
  agents: AgentProfile[],
  publications: PublicationSummary[]
) {
  return disciplines.map((discipline) => {
    const disciplineTeams = teams.filter((team) => team.disciplineId === discipline.id)
    const disciplinePublications = publications.filter(
      (publication) => publication.sourceDiscipline.code === discipline.code
    )
    const currentPublicationCount = disciplinePublications.filter(
      (publication) => publication.status === 'published'
    ).length
    const riskCount = disciplinePublications.filter(
      (publication) => publication.riskLevel === 'critical'
    ).length
    return {
      discipline,
      agentName: getAgentName(discipline.agentCode, agents),
      teamCount: disciplineTeams.length,
      memberCount: disciplineTeams.reduce((sum, team) => sum + team.memberCount, 0),
      currentPublicationCount,
      riskCount,
    }
  })
}

function StatCard({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string
  value: string | number
  detail: string
  tone?: 'default' | 'warning'
}) {
  return (
    <div
      className={cn(
        'rounded-[8px] border bg-[var(--surface-1)] p-4',
        tone === 'warning' ? 'border-amber-500/30' : 'border-[var(--border)]'
      )}
    >
      <div className='text-[12px] text-[var(--text-muted)]'>{label}</div>
      <div className='mt-2 font-medium text-[24px] text-[var(--text-primary)]'>{value}</div>
      <div className='mt-1 text-[12px] text-[var(--text-muted)]'>{detail}</div>
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>{children}</div>
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

export function ProjectAdminCenter() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const createWorkgroup = useCreateWorkgroup()
  const addWorkgroupMember = useAddWorkgroupMember()
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDisciplineId, setNewTeamDisciplineId] = useState('')
  const [createTeamStatus, setCreateTeamStatus] = useState<string | null>(null)
  const [assignmentTeamId, setAssignmentTeamId] = useState('')
  const [selectedRosterUserId, setSelectedRosterUserId] = useState('')
  const [assignmentValue, setAssignmentValue] = useState('')
  const [assignmentRole, setAssignmentRole] = useState<'member' | 'admin'>('member')
  const [assignmentStatus, setAssignmentStatus] = useState<string | null>(null)
  const { data: workgroupsData, isLoading: isLoadingMyWorkgroups } = useMyWorkgroups()
  const { data: workspaceSettingsData } = useWorkspaceSettings(workspaceId)
  const workgroups = workgroupsData?.workgroups ?? []
  const currentWorkspaceWorkgroupId = workspaceSettingsData?.settings.workspace.workgroupId
  const activeWorkgroup = getActiveWorkgroup(
    workgroups,
    workspaceId,
    currentWorkspaceWorkgroupId,
    workgroupsData?.defaultWorkgroupId
  )
  const organizationId = activeWorkgroup?.organizationId
  const activeWorkgroupId = activeWorkgroup?.id
  const { data: organizationWorkgroupsData, isLoading: isLoadingOrganizationWorkgroups } =
    useOrganizationWorkgroups(organizationId)
  const { data: organizationRoster, isLoading: isLoadingOrganizationRoster } =
    useOrganizationRoster(organizationId)
  const { data: disciplinesData, isLoading: isLoadingDisciplines } = useDisciplines()
  const { data: agentsData, isLoading: isLoadingAgents } = useAgentProfiles()
  const { data: publicationsData, isLoading: isLoadingPublications } = useShowcasePublications(
    activeWorkgroupId,
    PUBLICATION_FILTERS
  )

  const organizationWorkgroups = organizationWorkgroupsData?.workgroups ?? []
  const rosterMembers = organizationRoster?.members ?? []
  const disciplines = disciplinesData?.disciplines ?? []
  const agents = agentsData?.agents ?? []
  const publications = publicationsData?.publications ?? []
  const isProjectAdmin = organizationWorkgroups.some(
    (workgroup) => workgroup.currentUserRole === 'org_admin'
  )
  const isLoading =
    isLoadingMyWorkgroups ||
    isLoadingOrganizationWorkgroups ||
    isLoadingDisciplines ||
    isLoadingAgents ||
    isLoadingPublications

  const disciplineRows = useMemo(
    () => buildDisciplineRows(disciplines, organizationWorkgroups, agents, publications),
    [agents, disciplines, organizationWorkgroups, publications]
  )
  const teamsWithoutCanvas = organizationWorkgroups.filter((team) => !team.teamWorkspaceId)
  const totalMembers = organizationWorkgroups.reduce((sum, team) => sum + team.memberCount, 0)
  const currentPublicationCount = publications.filter(
    (publication) => publication.status === 'published'
  ).length
  const criticalPublicationCount = publications.filter(
    (publication) => publication.riskLevel === 'critical'
  ).length
  const unreviewedPublicationCount = publications.filter(
    (publication) => !publication.reviewState || publication.reviewState === 'pending'
  ).length
  const selectedNewTeamDisciplineId = newTeamDisciplineId || disciplines[0]?.id || ''
  const selectedNewTeamDiscipline = disciplines.find(
    (discipline) => discipline.id === selectedNewTeamDisciplineId
  )
  const selectedAssignmentTeamId = assignmentTeamId || organizationWorkgroups[0]?.id || ''
  const selectedAssignmentTeam = organizationWorkgroups.find(
    (team) => team.id === selectedAssignmentTeamId
  )
  const selectedRosterMember = rosterMembers.find(
    (member) => member.userId === selectedRosterUserId
  )
  const canCreateTeam = Boolean(
    organizationId &&
      selectedNewTeamDisciplineId &&
      newTeamName.trim() &&
      !createWorkgroup.isPending
  )
  const canAssignMember = Boolean(
    organizationId &&
      selectedAssignmentTeamId &&
      assignmentValue.trim() &&
      !addWorkgroupMember.isPending
  )

  const handleCreateTeam = async () => {
    if (!organizationId || !selectedNewTeamDisciplineId || !newTeamName.trim()) return
    try {
      const result = await createWorkgroup.mutateAsync({
        organizationId,
        name: newTeamName.trim(),
        disciplineId: selectedNewTeamDisciplineId,
      })
      setNewTeamName('')
      setCreateTeamStatus(
        `Created ${result.workgroup.name} for ${
          selectedNewTeamDiscipline?.name ?? 'the selected discipline'
        }.`
      )
    } catch (error) {
      setCreateTeamStatus(readErrorMessage(error))
    }
  }

  const handleAssignMember = async () => {
    if (!organizationId || !selectedAssignmentTeamId || !assignmentValue.trim()) return
    const trimmed = assignmentValue.trim()
    const isEmail = trimmed.includes('@')
    try {
      await addWorkgroupMember.mutateAsync({
        workgroupId: selectedAssignmentTeamId,
        organizationId,
        role: assignmentRole,
        ...(selectedRosterMember
          ? { userId: selectedRosterMember.userId }
          : isEmail
            ? { email: trimmed }
            : { userId: trimmed }),
      })
      setAssignmentValue('')
      setSelectedRosterUserId('')
      setAssignmentStatus(
        `Assigned ${trimmed} to ${selectedAssignmentTeam?.name ?? 'the selected team'} as ${
          assignmentRole
        }.`
      )
    } catch (error) {
      setAssignmentStatus(readErrorMessage(error))
    }
  }

  if (isLoading) {
    return (
      <div className='flex h-full items-center justify-center bg-[var(--bg)] text-[13px] text-[var(--text-muted)]'>
        <Loader className='mr-2 h-[15px] w-[15px]' animate />
        Loading project admin center...
      </div>
    )
  }

  if (!organizationId || !activeWorkgroup) {
    return (
      <div className='h-full overflow-auto bg-[var(--bg)] p-6'>
        <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-6'>
          <h1 className='font-medium text-[18px] text-[var(--text-primary)]'>Project admin</h1>
          <p className='mt-2 text-[13px] text-[var(--text-muted)]'>
            Join or create a workgroup before opening the project admin center.
          </p>
        </div>
      </div>
    )
  }

  if (!isProjectAdmin) {
    return (
      <div className='h-full overflow-auto bg-[var(--bg)] p-6'>
        <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-6'>
          <div className='flex items-center gap-2'>
            <ShieldCheck className='h-[18px] w-[18px] text-[var(--text-icon)]' />
            <h1 className='font-medium text-[18px] text-[var(--text-primary)]'>Project admin</h1>
          </div>
          <p className='mt-2 max-w-[680px] text-[13px] text-[var(--text-muted)]'>
            Project admin center is reserved for organization owners and admins. Team admins can
            continue using Team management for their own workgroup.
          </p>
          <Link
            className={cn(buttonVariants({ variant: 'primary' }), 'mt-4')}
            href={`/workspace/${activeWorkgroup.teamWorkspaceId || workspaceId}/team-management`}
          >
            Open team management
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className='h-full overflow-auto bg-[var(--bg)]'>
      <div className='mx-auto grid w-full max-w-[1180px] gap-5 p-6'>
        <header className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-5'>
          <div className='flex flex-wrap items-start justify-between gap-4'>
            <div>
              <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
                <ShieldCheck className='h-[15px] w-[15px]' />
                Phase 10 admin operations
              </div>
              <h1 className='mt-2 font-medium text-[22px] text-[var(--text-primary)]'>
                Project admin center
              </h1>
              <p className='mt-2 max-w-[760px] text-[13px] text-[var(--text-muted)]'>
                Project-level overview for disciplines, teams, members, Agent mapping, and visible
                showcase governance, with controlled admin actions added one slice at a time.
              </p>
            </div>
            <Link
              className={buttonVariants({ variant: 'default' })}
              href={`/workspace/${activeWorkgroup.teamWorkspaceId || workspaceId}/showcase`}
            >
              Open showcase canvas
            </Link>
          </div>
        </header>

        <section className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
          <StatCard
            label='Disciplines covered'
            value={`${disciplineRows.filter((row) => row.teamCount > 0).length}/${disciplines.length}`}
            detail='Disciplines with at least one team'
          />
          <StatCard
            label='Teams'
            value={organizationWorkgroups.length}
            detail={`${totalMembers} total workgroup memberships`}
          />
          <StatCard
            label='Current publications'
            value={currentPublicationCount}
            detail={`${publications.length} visible showcase versions loaded`}
          />
          <StatCard
            label='Governance alerts'
            value={
              criticalPublicationCount + unreviewedPublicationCount + teamsWithoutCanvas.length
            }
            detail={`${criticalPublicationCount} critical, ${unreviewedPublicationCount} unreviewed, ${teamsWithoutCanvas.length} missing canvas`}
            tone={
              criticalPublicationCount + unreviewedPublicationCount + teamsWithoutCanvas.length > 0
                ? 'warning'
                : 'default'
            }
          />
        </section>

        <section className='grid gap-5 xl:grid-cols-2'>
          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
              <Users className='h-[15px] w-[15px] text-[var(--text-icon)]' />
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                  Create project team
                </h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  Organization admins can create a discipline team with its team canvas and default
                  workflow graph.
                </p>
              </div>
            </div>
            <div className='grid gap-2 p-4 md:grid-cols-[minmax(0,1fr)_220px_auto] xl:grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_220px_auto]'>
              <input
                value={newTeamName}
                onChange={(event) => {
                  setNewTeamName(event.target.value)
                  setCreateTeamStatus(null)
                }}
                placeholder='Team name, e.g. Lighting show control'
                className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[13px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-muted)]'
              />
              <select
                value={selectedNewTeamDisciplineId}
                onChange={(event) => {
                  setNewTeamDisciplineId(event.target.value)
                  setCreateTeamStatus(null)
                }}
                className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
              >
                {disciplines.length === 0 ? (
                  <option value=''>No discipline available</option>
                ) : (
                  disciplines.map((discipline) => (
                    <option key={discipline.id} value={discipline.id}>
                      {discipline.name}
                    </option>
                  ))
                )}
              </select>
              <button
                type='button'
                className={buttonVariants({ variant: 'primary' })}
                disabled={!canCreateTeam}
                onClick={() => void handleCreateTeam()}
              >
                {createWorkgroup.isPending ? (
                  <Loader className='mr-2 h-[14px] w-[14px]' animate />
                ) : null}
                Create team
              </button>
            </div>
            {createTeamStatus && (
              <div
                className='border-[var(--border)] border-t px-4 py-3 text-[12px] text-[var(--text-muted)]'
                aria-live='polite'
              >
                {createTeamStatus}
              </div>
            )}
          </div>

          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
              <Users className='h-[15px] w-[15px] text-[var(--text-icon)]' />
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                  Assign project member
                </h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  Pick from the organization roster, or enter an existing user email or ID.
                </p>
              </div>
            </div>
            <div className='grid gap-2 p-4'>
              <select
                value={selectedRosterUserId}
                onChange={(event) => {
                  const userId = event.target.value
                  const member = rosterMembers.find((item) => item.userId === userId)
                  setSelectedRosterUserId(userId)
                  setAssignmentValue(member?.email ?? '')
                  setAssignmentStatus(null)
                }}
                className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
              >
                <option value=''>
                  {isLoadingOrganizationRoster ? 'Loading organization roster...' : 'Manual entry'}
                </option>
                {rosterMembers.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name || member.email} / {member.email}
                  </option>
                ))}
              </select>
              <div className='grid gap-2 md:grid-cols-[minmax(0,1fr)_160px_130px_auto] xl:grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_160px_130px_auto]'>
                <input
                  value={assignmentValue}
                  onChange={(event) => {
                    setAssignmentValue(event.target.value)
                    setSelectedRosterUserId('')
                    setAssignmentStatus(null)
                  }}
                  placeholder='User email or ID'
                  className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[13px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-muted)]'
                />
                <select
                  value={selectedAssignmentTeamId}
                  onChange={(event) => {
                    setAssignmentTeamId(event.target.value)
                    setAssignmentStatus(null)
                  }}
                  className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
                >
                  {organizationWorkgroups.length === 0 ? (
                    <option value=''>No team available</option>
                  ) : (
                    organizationWorkgroups.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))
                  )}
                </select>
                <select
                  value={assignmentRole}
                  onChange={(event) => {
                    setAssignmentRole(event.target.value as 'member' | 'admin')
                    setAssignmentStatus(null)
                  }}
                  className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
                >
                  <option value='member'>Member</option>
                  <option value='admin'>Team admin</option>
                </select>
                <button
                  type='button'
                  className={buttonVariants({ variant: 'primary' })}
                  disabled={!canAssignMember}
                  onClick={() => void handleAssignMember()}
                >
                  {addWorkgroupMember.isPending ? (
                    <Loader className='mr-2 h-[14px] w-[14px]' animate />
                  ) : null}
                  Assign
                </button>
              </div>
              <div className='text-[11px] text-[var(--text-muted)]'>
                {rosterMembers.length} organization member{rosterMembers.length === 1 ? '' : 's'}{' '}
                available for project team assignment.
              </div>
            </div>
            {assignmentStatus && (
              <div
                className='border-[var(--border)] border-t px-4 py-3 text-[12px] text-[var(--text-muted)]'
                aria-live='polite'
              >
                {assignmentStatus}
              </div>
            )}
          </div>
        </section>

        <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
          <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
            <Network className='h-[15px] w-[15px] text-[var(--text-icon)]' />
            <div>
              <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                Discipline and Agent coverage
              </h2>
              <p className='text-[12px] text-[var(--text-muted)]'>
                Discipline-level coverage after project team and member operations.
              </p>
            </div>
          </div>
          <div className='divide-y divide-[var(--border)]'>
            {disciplineRows.length === 0 ? (
              <EmptyState>No discipline definitions are available.</EmptyState>
            ) : (
              disciplineRows.map((row) => (
                <div
                  key={row.discipline.id}
                  className='grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]'
                >
                  <div className='min-w-0'>
                    <div className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                      {row.discipline.name}
                    </div>
                    <div className='truncate text-[12px] text-[var(--text-muted)]'>
                      {row.discipline.code}
                    </div>
                  </div>
                  <div className='min-w-0'>
                    <div className='flex items-center gap-2 text-[13px] text-[var(--text-body)]'>
                      <Sparkles className='h-[14px] w-[14px] text-[var(--text-icon)]' />
                      <span className='truncate'>{row.agentName}</span>
                    </div>
                    <div className='text-[12px] text-[var(--text-muted)]'>
                      {row.teamCount} team{row.teamCount === 1 ? '' : 's'} / {row.memberCount}{' '}
                      member{row.memberCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className='flex flex-wrap items-center gap-2 md:justify-end'>
                    <span className='rounded-[8px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
                      {row.currentPublicationCount} current
                    </span>
                    {row.riskCount > 0 && (
                      <span className='rounded-[8px] border border-red-500/30 px-2 py-1 text-[11px] text-red-500'>
                        {row.riskCount} critical
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className='grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.6fr)]'>
          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
              <Users className='h-[15px] w-[15px] text-[var(--text-icon)]' />
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>Teams</h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  Organization-level team inventory with current member counts.
                </p>
              </div>
            </div>
            <div className='divide-y divide-[var(--border)]'>
              {organizationWorkgroups.length === 0 ? (
                <EmptyState>No teams have been created for this organization.</EmptyState>
              ) : (
                organizationWorkgroups.map((team) => (
                  <div
                    key={team.id}
                    className='grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto]'
                  >
                    <div className='min-w-0'>
                      <div className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                        {team.name}
                      </div>
                      <div className='truncate text-[12px] text-[var(--text-muted)]'>
                        {team.disciplineName} / {getAgentName(team.agentCode, agents)}
                      </div>
                    </div>
                    <span className='rounded-[8px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
                      {team.memberCount} member{team.memberCount === 1 ? '' : 's'}
                    </span>
                    {team.teamWorkspaceId ? (
                      <Link
                        className={cn(
                          buttonVariants({ size: 'sm', variant: 'default' }),
                          'h-[30px]'
                        )}
                        href={`/workspace/${team.teamWorkspaceId}/team-management`}
                      >
                        Manage
                      </Link>
                    ) : (
                      <span className='rounded-[8px] border border-amber-500/30 px-2 py-1 text-[11px] text-amber-500'>
                        Needs canvas
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
              <Compass className='h-[15px] w-[15px] text-[var(--text-icon)]' />
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                  Governance watchlist
                </h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  First read-only pass over risks, review gaps, and canvas setup.
                </p>
              </div>
            </div>
            <div className='grid gap-3 p-4'>
              {criticalPublicationCount === 0 &&
              unreviewedPublicationCount === 0 &&
              teamsWithoutCanvas.length === 0 ? (
                <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-muted)]'>
                  No project-level watchlist items in the currently visible data.
                </div>
              ) : (
                <>
                  {criticalPublicationCount > 0 && (
                    <div className='rounded-[8px] border border-red-500/30 bg-red-500/10 p-3'>
                      <div className='flex items-center gap-2 text-[13px] text-red-500'>
                        <AlertTriangle className='h-[14px] w-[14px]' />
                        {criticalPublicationCount} critical-risk showcase version
                        {criticalPublicationCount === 1 ? '' : 's'}
                      </div>
                    </div>
                  )}
                  {unreviewedPublicationCount > 0 && (
                    <div className='rounded-[8px] border border-amber-500/30 bg-amber-500/10 p-3'>
                      <div className='flex items-center gap-2 text-[13px] text-amber-500'>
                        <AlertTriangle className='h-[14px] w-[14px]' />
                        {unreviewedPublicationCount} publication
                        {unreviewedPublicationCount === 1 ? '' : 's'} pending review
                      </div>
                    </div>
                  )}
                  {teamsWithoutCanvas.length > 0 && (
                    <div className='rounded-[8px] border border-amber-500/30 bg-amber-500/10 p-3'>
                      <div className='flex items-center gap-2 text-[13px] text-amber-500'>
                        <AlertTriangle className='h-[14px] w-[14px]' />
                        {teamsWithoutCanvas.length} team{teamsWithoutCanvas.length === 1 ? '' : 's'}
                        missing team canvas
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
