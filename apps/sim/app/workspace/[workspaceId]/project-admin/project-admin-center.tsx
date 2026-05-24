'use client'

import type { ChangeEvent } from 'react'
import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Compass,
  Download,
  Network,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { buttonVariants, Loader } from '@/components/emcn'
import type {
  AgentProfile,
  Discipline,
  OrganizationWorkgroupActivityEntry,
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
  useOrganizationWorkgroupActivity,
  useOrganizationWorkgroups,
  useShowcasePublications,
} from '@/hooks/queries/collaboration'
import { useOrganizationRoster } from '@/hooks/queries/organization'
import { useWorkspaceSettings } from '@/hooks/queries/workspace'

const PUBLICATION_FILTERS = { limit: 100 } as const
const PROJECT_ACTIVITY_PAGE_SIZE = 12
const BATCH_IMPORT_IGNORED_CELLS = new Set([
  'email',
  'emails',
  'userid',
  'user',
  'id',
  'name',
  'role',
  'member',
  'admin',
  'team',
  'workgroup',
])
const PROJECT_ACTIVITY_ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'member.invited', label: 'Member added' },
  { value: 'member.role_changed', label: 'Role updated' },
  { value: 'member.removed', label: 'Member removed' },
  { value: 'publication.created', label: 'Published showcase' },
  { value: 'publication.updated', label: 'Updated publication' },
  { value: 'publication.archived', label: 'Archived publication' },
  { value: 'publication.retracted', label: 'Retracted publication' },
  { value: 'publication.restored', label: 'Restored publication' },
  { value: 'skill.updated', label: 'Agent skill updated' },
  { value: 'workspace.created', label: 'Team canvas initialized' },
] as const

interface BatchAssignmentResult {
  target: string
  status: 'assigned' | 'failed'
  message: string
}

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

function parseBatchAssignmentTargets(value: string) {
  const seen = new Set<string>()
  return value
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item.toLowerCase())) return false
      seen.add(item.toLowerCase())
      return true
    })
}

function mergeBatchAssignmentTargets(currentValue: string, additions: string[]) {
  return parseBatchAssignmentTargets([currentValue, ...additions].join('\n')).join('\n')
}

function cleanBatchImportCell(value: string) {
  return value
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
}

function getBatchImportCandidate(line: string) {
  const cells = line
    .split(/[,;\t]/)
    .map(cleanBatchImportCell)
    .filter(Boolean)
  if (cells.length === 0) return null

  const emailCell = cells.find((cell) => cell.includes('@'))
  if (emailCell) return emailCell

  return (
    cells.find((cell) => {
      const normalized = cell.toLowerCase().replace(/[\s_-]/g, '')
      return !BATCH_IMPORT_IGNORED_CELLS.has(normalized)
    }) ?? null
  )
}

function extractBatchAssignmentTargetsFromImport(value: string) {
  const candidates = value
    .split(/\r?\n/)
    .map(getBatchImportCandidate)
    .filter((candidate): candidate is string => Boolean(candidate))
  return parseBatchAssignmentTargets(candidates.join('\n'))
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
    case 'publication.updated':
      return 'Updated publication'
    case 'publication.archived':
      return 'Archived publication'
    case 'publication.retracted':
      return 'Retracted publication'
    case 'publication.restored':
      return 'Restored publication'
    case 'skill.updated':
      return 'Agent skill updated'
    case 'workspace.created':
      return 'Team canvas initialized'
    default:
      return action
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function escapeCsvValue(value: string | null | undefined) {
  const normalized = value ?? ''
  if (!/[",\r\n]/.test(normalized)) return normalized
  return `"${normalized.replace(/"/g, '""')}"`
}

function downloadProjectActivityCsv(entries: OrganizationWorkgroupActivityEntry[]) {
  const rows = [
    ['Created at', 'Action', 'Team', 'Discipline', 'Resource', 'Description', 'Actor'],
    ...entries.map((entry) => [
      entry.createdAt,
      formatActivityAction(entry.action),
      entry.workgroupName ?? 'Project',
      entry.disciplineName ?? '',
      entry.resourceName ?? '',
      entry.description ?? '',
      entry.actorName || entry.actorEmail || 'Unknown actor',
    ]),
  ]
  const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `project-activity-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
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
  const [batchAssignmentValue, setBatchAssignmentValue] = useState('')
  const [batchAssignmentResults, setBatchAssignmentResults] = useState<BatchAssignmentResult[]>([])
  const [batchImportStatus, setBatchImportStatus] = useState<string | null>(null)
  const [activityTeamId, setActivityTeamId] = useState('')
  const [activityDisciplineId, setActivityDisciplineId] = useState('')
  const [activityAction, setActivityAction] = useState('')
  const [activitySearch, setActivitySearch] = useState('')
  const [activityActor, setActivityActor] = useState('')
  const [activityStartDate, setActivityStartDate] = useState('')
  const [activityEndDate, setActivityEndDate] = useState('')
  const [activityOffset, setActivityOffset] = useState(0)
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
  const batchAssignmentTargets = useMemo(
    () => parseBatchAssignmentTargets(batchAssignmentValue),
    [batchAssignmentValue]
  )
  const suggestedAssignmentMembers = useMemo(() => {
    if (!selectedAssignmentTeam?.teamWorkspaceId) return []
    return [...rosterMembers]
      .filter(
        (member) =>
          !member.workspaces.some(
            (workspaceAccess) =>
              workspaceAccess.workspaceId === selectedAssignmentTeam.teamWorkspaceId
          )
      )
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
  }, [rosterMembers, selectedAssignmentTeam?.teamWorkspaceId])
  const canBatchAssignMembers = Boolean(
    organizationId &&
      selectedAssignmentTeamId &&
      batchAssignmentTargets.length > 0 &&
      !addWorkgroupMember.isPending
  )
  const activityFilters = useMemo(
    () => ({
      limit: PROJECT_ACTIVITY_PAGE_SIZE,
      offset: activityOffset,
      workgroupId: activityTeamId || undefined,
      disciplineId: activityTeamId ? undefined : activityDisciplineId || undefined,
      action: activityAction || undefined,
      search: activitySearch.trim() || undefined,
      actor: activityActor.trim() || undefined,
      startDate: activityStartDate || undefined,
      endDate: activityEndDate || undefined,
    }),
    [
      activityAction,
      activityActor,
      activityDisciplineId,
      activityEndDate,
      activityOffset,
      activitySearch,
      activityStartDate,
      activityTeamId,
    ]
  )
  const { data: activityData, isLoading: isLoadingActivity } = useOrganizationWorkgroupActivity(
    isProjectAdmin ? organizationId : undefined,
    activityFilters
  )
  const projectActivity = activityData?.activity ?? []
  const hasPreviousActivityPage = activityOffset > 0
  const hasNextActivityPage = activityData?.nextOffset != null
  const activityRangeLabel =
    projectActivity.length > 0
      ? `Showing ${activityOffset + 1}-${activityOffset + projectActivity.length} of filtered project activity.`
      : 'No filtered project activity to show.'

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

  const handleBatchAssignMembers = async () => {
    if (!organizationId || !selectedAssignmentTeamId || batchAssignmentTargets.length === 0) return
    const results: BatchAssignmentResult[] = []
    for (const target of batchAssignmentTargets) {
      const rosterMember = rosterMembers.find(
        (member) => member.userId === target || member.email.toLowerCase() === target.toLowerCase()
      )
      const isEmail = target.includes('@')
      try {
        await addWorkgroupMember.mutateAsync({
          workgroupId: selectedAssignmentTeamId,
          organizationId,
          role: assignmentRole,
          ...(rosterMember
            ? { userId: rosterMember.userId }
            : isEmail
              ? { email: target }
              : { userId: target }),
        })
        results.push({ target, status: 'assigned', message: `Assigned as ${assignmentRole}` })
      } catch (error) {
        results.push({ target, status: 'failed', message: readErrorMessage(error) })
      }
    }
    setBatchAssignmentResults(results)
    const assignedCount = results.filter((result) => result.status === 'assigned').length
    setAssignmentStatus(
      `Batch assignment completed for ${selectedAssignmentTeam?.name ?? 'the selected team'}: ${assignedCount}/${results.length} assigned.`
    )
    if (assignedCount === results.length) setBatchAssignmentValue('')
  }

  const handleLoadSuggestedAssignments = () => {
    const suggestedTargets = suggestedAssignmentMembers.map((member) => member.email)
    setBatchAssignmentValue((currentValue) =>
      mergeBatchAssignmentTargets(currentValue, suggestedTargets)
    )
    setBatchAssignmentResults([])
    setBatchImportStatus(null)
    setAssignmentStatus(null)
  }

  const handleImportBatchAssignments = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const importedTargets = extractBatchAssignmentTargetsFromImport(await file.text())
      if (importedTargets.length === 0) {
        setBatchImportStatus(`No email or user ID targets found in ${file.name}.`)
        return
      }

      setBatchAssignmentValue((currentValue) =>
        mergeBatchAssignmentTargets(currentValue, importedTargets)
      )
      setBatchAssignmentResults([])
      setAssignmentStatus(null)
      setBatchImportStatus(`Imported ${importedTargets.length} target(s) from ${file.name}.`)
    } catch (error) {
      setBatchImportStatus(readErrorMessage(error))
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
                    setBatchAssignmentResults([])
                    setBatchImportStatus(null)
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
                    setBatchAssignmentResults([])
                    setBatchImportStatus(null)
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
              <div className='grid gap-2 border-[var(--border)] border-t pt-3'>
                <div>
                  <div className='font-medium text-[12px] text-[var(--text-primary)]'>
                    Batch assign
                  </div>
                  <p className='text-[11px] text-[var(--text-muted)]'>
                    Paste emails or user IDs separated by commas, spaces, or new lines. Batch uses
                    the selected team and role above.
                  </p>
                </div>
                <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <div>
                      <div className='font-medium text-[12px] text-[var(--text-primary)]'>
                        Suggested batch
                      </div>
                      <p className='text-[11px] text-[var(--text-muted)]'>
                        {selectedAssignmentTeam?.teamWorkspaceId
                          ? `${suggestedAssignmentMembers.length} roster member${
                              suggestedAssignmentMembers.length === 1 ? '' : 's'
                            } without ${selectedAssignmentTeam.name} team canvas access.`
                          : 'Selected team has no team canvas access map yet.'}
                      </p>
                    </div>
                    <button
                      type='button'
                      className={buttonVariants({ variant: 'default' })}
                      disabled={suggestedAssignmentMembers.length === 0}
                      onClick={handleLoadSuggestedAssignments}
                    >
                      Load suggestions
                    </button>
                  </div>
                  {suggestedAssignmentMembers.length > 0 && (
                    <div className='mt-2 truncate text-[11px] text-[var(--text-muted)]'>
                      {suggestedAssignmentMembers
                        .slice(0, 3)
                        .map((member) => member.name || member.email)
                        .join(', ')}
                      {suggestedAssignmentMembers.length > 3
                        ? ` +${suggestedAssignmentMembers.length - 3} more`
                        : ''}
                    </div>
                  )}
                </div>
                <textarea
                  value={batchAssignmentValue}
                  onChange={(event) => {
                    setBatchAssignmentValue(event.target.value)
                    setBatchAssignmentResults([])
                    setBatchImportStatus(null)
                    setAssignmentStatus(null)
                  }}
                  placeholder={'alice@example.com\nbob@example.com'}
                  className='min-h-[76px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[13px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-muted)]'
                />
                <div className='flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                  <div>
                    <div className='font-medium text-[12px] text-[var(--text-primary)]'>
                      Import from file
                    </div>
                    <p className='text-[11px] text-[var(--text-muted)]'>
                      Upload a CSV, TSV, or TXT file with email or user ID values.
                    </p>
                  </div>
                  <label className={buttonVariants({ variant: 'default' })}>
                    Choose file
                    <input
                      type='file'
                      accept='.csv,.tsv,.txt,text/csv,text/plain'
                      className='sr-only'
                      onChange={(event) => void handleImportBatchAssignments(event)}
                    />
                  </label>
                </div>
                {batchImportStatus && (
                  <div className='text-[11px] text-[var(--text-muted)]' aria-live='polite'>
                    {batchImportStatus}
                  </div>
                )}
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <span className='text-[11px] text-[var(--text-muted)]'>
                    {batchAssignmentTargets.length} unique target
                    {batchAssignmentTargets.length === 1 ? '' : 's'} parsed.
                  </span>
                  <button
                    type='button'
                    className={buttonVariants({ variant: 'primary' })}
                    disabled={!canBatchAssignMembers}
                    onClick={() => void handleBatchAssignMembers()}
                  >
                    {addWorkgroupMember.isPending ? (
                      <Loader className='mr-2 h-[14px] w-[14px]' animate />
                    ) : null}
                    Assign batch
                  </button>
                </div>
                {batchAssignmentResults.length > 0 && (
                  <div className='grid gap-2'>
                    {batchAssignmentResults.map((result) => (
                      <div
                        key={result.target}
                        className={cn(
                          'rounded-[8px] border px-3 py-2 text-[12px]',
                          result.status === 'assigned'
                            ? 'border-green-500/25 bg-green-500/10 text-green-700'
                            : 'border-red-500/25 bg-red-500/10 text-red-700'
                        )}
                      >
                        <span className='font-medium'>{result.target}</span> / {result.message}
                      </div>
                    ))}
                  </div>
                )}
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

          <div className='grid gap-5'>
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
                          {teamsWithoutCanvas.length} team
                          {teamsWithoutCanvas.length === 1 ? '' : 's'} missing team canvas
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
              <div className='grid gap-3 border-[var(--border)] border-b px-4 py-3'>
                <div className='flex items-center gap-2'>
                  <Activity className='h-[15px] w-[15px] text-[var(--text-icon)]' />
                  <div>
                    <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                      Project activity filters
                    </h2>
                    <p className='text-[12px] text-[var(--text-muted)]'>
                      Filter audit-backed activity by team, discipline, action, or actor/resource
                      text.
                    </p>
                  </div>
                </div>
                <div className='grid gap-2 md:grid-cols-2'>
                  <select
                    value={activityTeamId}
                    onChange={(event) => {
                      setActivityTeamId(event.target.value)
                      setActivityOffset(0)
                    }}
                    className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none'
                  >
                    <option value=''>All teams</option>
                    {organizationWorkgroups.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={activityDisciplineId}
                    onChange={(event) => {
                      setActivityDisciplineId(event.target.value)
                      setActivityOffset(0)
                    }}
                    disabled={Boolean(activityTeamId)}
                    className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none disabled:opacity-60'
                  >
                    <option value=''>All disciplines</option>
                    {disciplines.map((discipline) => (
                      <option key={discipline.id} value={discipline.id}>
                        {discipline.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={activityAction}
                    onChange={(event) => {
                      setActivityAction(event.target.value)
                      setActivityOffset(0)
                    }}
                    className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none'
                  >
                    {PROJECT_ACTIVITY_ACTION_OPTIONS.map((option) => (
                      <option key={option.value || 'all'} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={activitySearch}
                    onChange={(event) => {
                      setActivitySearch(event.target.value)
                      setActivityOffset(0)
                    }}
                    placeholder='Search actor, action, resource...'
                    className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-muted)]'
                  />
                  <input
                    value={activityActor}
                    onChange={(event) => {
                      setActivityActor(event.target.value)
                      setActivityOffset(0)
                    }}
                    placeholder='Exact actor email or name'
                    className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-muted)]'
                  />
                  <input
                    type='date'
                    value={activityStartDate}
                    max={activityEndDate || undefined}
                    onChange={(event) => {
                      setActivityStartDate(event.target.value)
                      setActivityOffset(0)
                    }}
                    className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none'
                    aria-label='Project activity start date'
                  />
                  <input
                    type='date'
                    value={activityEndDate}
                    min={activityStartDate || undefined}
                    onChange={(event) => {
                      setActivityEndDate(event.target.value)
                      setActivityOffset(0)
                    }}
                    className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none'
                    aria-label='Project activity end date'
                  />
                </div>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <span className='text-[11px] text-[var(--text-muted)]'>{activityRangeLabel}</span>
                  <div className='flex flex-wrap items-center gap-2'>
                    <button
                      type='button'
                      className={buttonVariants({ variant: 'default' })}
                      disabled={projectActivity.length === 0}
                      onClick={() => downloadProjectActivityCsv(projectActivity)}
                    >
                      <Download className='mr-2 h-[13px] w-[13px]' />
                      Export page
                    </button>
                    <button
                      type='button'
                      className={buttonVariants({ variant: 'default' })}
                      disabled={!hasPreviousActivityPage || isLoadingActivity}
                      onClick={() =>
                        setActivityOffset((currentOffset) =>
                          Math.max(0, currentOffset - PROJECT_ACTIVITY_PAGE_SIZE)
                        )
                      }
                    >
                      Previous
                    </button>
                    <button
                      type='button'
                      className={buttonVariants({ variant: 'default' })}
                      disabled={!hasNextActivityPage || isLoadingActivity}
                      onClick={() => {
                        if (activityData?.nextOffset != null) {
                          setActivityOffset(activityData.nextOffset)
                        }
                      }}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
              <div className='divide-y divide-[var(--border)]'>
                {isLoadingActivity ? (
                  <div className='flex items-center gap-2 px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                    <Loader className='h-[14px] w-[14px]' animate />
                    Loading project activity...
                  </div>
                ) : projectActivity.length === 0 ? (
                  <EmptyState>No activity matches the current project filters.</EmptyState>
                ) : (
                  projectActivity.map((entry) => (
                    <div key={entry.id} className='grid gap-2 px-4 py-3'>
                      <div className='flex min-w-0 items-center justify-between gap-2'>
                        <span className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                          {formatActivityAction(entry.action)}
                        </span>
                        <span className='shrink-0 text-[11px] text-[var(--text-muted)]'>
                          {formatDateTime(entry.createdAt)}
                        </span>
                      </div>
                      <div className='truncate text-[11px] text-[var(--text-muted)]'>
                        {entry.workgroupName ?? 'Project'}{' '}
                        {entry.disciplineName ? `/ ${entry.disciplineName}` : ''}
                      </div>
                      <div className='truncate text-[12px] text-[var(--text-muted)]'>
                        {entry.resourceName ? `${entry.resourceName} / ` : ''}
                        {entry.description?.trim() || 'No additional details'} by{' '}
                        {entry.actorName || entry.actorEmail || 'Unknown actor'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
