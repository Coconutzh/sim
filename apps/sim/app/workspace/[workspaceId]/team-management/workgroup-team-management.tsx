'use client'

import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
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
import { Button, Input, Loader, Switch, Textarea } from '@/components/emcn'
import { isApiClientError } from '@/lib/api/client/errors'
import type {
  PublicationReviewState,
  PublicationRiskLevel,
} from '@/lib/api/contracts/collaboration'
import type {
  OrganizationInvitationResult,
  OrganizationInvitationResultStatus,
} from '@/lib/api/contracts/organization'
import { cn } from '@/lib/core/utils/cn'
import {
  useAddWorkgroupMember,
  useCreateTeamWorkspace,
  useMyWorkgroups,
  useOrganizationWorkgroups,
  useRemoveWorkgroupMember,
  useShowcasePublications,
  useTeamWorkspace,
  useUpdatePublicationLifecycle,
  useUpdatePublicationReview,
  useUpdatePublicationVisibility,
  useUpdateWorkgroupAgentSkill,
  useUpdateWorkgroupMember,
  useWorkgroupActivity,
  useWorkgroupAgentSkills,
  useWorkgroupMembers,
} from '@/hooks/queries/collaboration'
import {
  useCancelWorkspaceInvitation,
  usePendingInvitations,
  useUpdateWorkspacePermissions,
} from '@/hooks/queries/invitations'
import { useInviteMember } from '@/hooks/queries/organization'
import {
  useCreateWorkflow,
  usePublishWorkflow,
  useUpdateWorkflow,
  useWorkflows,
} from '@/hooks/queries/workflows'
import {
  useUpdateWorkspace,
  useWorkspacePermissionsQuery,
  useWorkspaceSettings,
} from '@/hooks/queries/workspace'

type WorkgroupRole = 'admin' | 'member'
type PublicationVisibility = 'organization' | 'selected_workgroups'
type ReviewStateDraft = PublicationReviewState | 'unreviewed'
type RiskLevelDraft = PublicationRiskLevel | 'unset'
type TeamManagementTab = 'members' | 'invites' | 'publications' | 'agent' | 'activity'
type TeamHealthTone = 'healthy' | 'warning' | 'loading'
type TeamWorkspaceRepairPermission = 'admin' | 'write'

interface PublicationTargetWorkgroup {
  id: string
  name: string
  disciplineName: string
}

const INVITATION_RESULT_STATUSES: OrganizationInvitationResultStatus[] = [
  'sent',
  'existing_member',
  'pending_invitation',
  'invalid_email',
  'failed',
]

const INVITATION_RESULT_LABELS: Record<OrganizationInvitationResultStatus, string> = {
  sent: '已创建',
  existing_member: '已是成员',
  pending_invitation: '已有邀请',
  invalid_email: '邮箱无效',
  failed: '失败',
}

const TEAM_MANAGEMENT_TABS: {
  id: TeamManagementTab
  label: string
  description: string
}[] = [
  {
    id: 'members',
    label: '成员',
    description: '权限与角色',
  },
  {
    id: 'invites',
    label: '邀请',
    description: '待处理邀请',
  },
  {
    id: 'publications',
    label: '发布',
    description: '成果展示',
  },
  {
    id: 'agent',
    label: 'Agent 技能',
    description: '团队助手',
  },
  {
    id: 'activity',
    label: '动态',
    description: '最近变更',
  },
]

interface PublicationVisibilityDraft {
  visibility: PublicationVisibility
  targetWorkgroupIds: string[]
}

interface PublicationReviewDraft {
  reviewState: ReviewStateDraft
  riskLevel: RiskLevelDraft
}

function roleLabel(role: WorkgroupRole) {
  return role === 'admin' ? '管理员' : '成员'
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
      return '已发布'
    case 'superseded':
      return '已替换'
    case 'archived':
      return '已归档'
    case 'retracted':
      return '已撤回'
    default:
      return status
  }
}

function formatPublicationReviewState(reviewState: string | null) {
  switch (reviewState) {
    case 'pending':
      return '待审核'
    case 'in_review':
      return '审核中'
    case 'approved':
      return '已通过'
    case 'changes_requested':
      return '需修改'
    case 'rejected':
      return '已拒绝'
    default:
      return '未审核'
  }
}

function formatPublicationRiskLevel(riskLevel: string | null) {
  switch (riskLevel) {
    case 'low':
      return '低风险'
    case 'medium':
      return '中风险'
    case 'high':
      return '高风险'
    case 'critical':
      return '严重风险'
    default:
      return '未设置风险'
  }
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function parseInvitationEmails(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,;]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
    )
  )
}

function getInvitationExpiryState(expiresAt?: string) {
  if (!expiresAt) return null
  const expiresAtTime = new Date(expiresAt).getTime()
  if (Number.isNaN(expiresAtTime)) return null

  const hoursRemaining = Math.ceil((expiresAtTime - Date.now()) / (60 * 60 * 1000))
  if (hoursRemaining <= 0) {
    return {
      label: 'Expired - resend or cancel',
      tone: 'danger',
    } as const
  }
  if (hoursRemaining <= 48) {
    return {
      label: `Expires in ${hoursRemaining}h`,
      tone: 'warning',
    } as const
  }
  return {
    label: `Expires ${formatPublicationDate(expiresAt)}`,
    tone: 'default',
  } as const
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isInvitationResultStatus(value: unknown): value is OrganizationInvitationResultStatus {
  return (
    typeof value === 'string' &&
    INVITATION_RESULT_STATUSES.includes(value as OrganizationInvitationResultStatus)
  )
}

function isOrganizationInvitationResult(value: unknown): value is OrganizationInvitationResult {
  if (!isRecord(value)) return false
  return (
    typeof value.email === 'string' &&
    isInvitationResultStatus(value.status) &&
    typeof value.message === 'string' &&
    (value.invitationId === undefined || typeof value.invitationId === 'string')
  )
}

function readInvitationResults(value: unknown): OrganizationInvitationResult[] {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.emailResults)) {
    return []
  }
  return value.data.emailResults.filter(isOrganizationInvitationResult)
}

function readInvitationResultsFromError(error: unknown): OrganizationInvitationResult[] {
  return isApiClientError(error) ? readInvitationResults(error.body) : []
}

function summarizeInvitationResults(results: OrganizationInvitationResult[]) {
  const sentCount = results.filter((result) => result.status === 'sent').length
  const skippedCount = results.filter((result) =>
    ['existing_member', 'pending_invitation', 'invalid_email'].includes(result.status)
  ).length
  const failedCount = results.filter((result) => result.status === 'failed').length
  const parts = [
    sentCount > 0 ? `已创建 ${sentCount} 个` : null,
    skippedCount > 0 ? `跳过 ${skippedCount} 个` : null,
    failedCount > 0 ? `失败 ${failedCount} 个` : null,
  ].filter((part): part is string => !!part)
  return parts.length > 0 ? parts.join('，') : '暂无邀请结果'
}

function getInvitationResultClassName(status: OrganizationInvitationResultStatus) {
  if (status === 'sent') {
    return 'border-[var(--success)] bg-[var(--surface-2)] text-[var(--success)]'
  }
  if (status === 'failed' || status === 'invalid_email') {
    return 'border-[var(--error)] bg-[var(--surface-2)] text-[var(--text-error)]'
  }
  return 'border-[var(--caution)] bg-[var(--surface-2)] text-[var(--warning)]'
}

function formatActivityAction(action: string) {
  switch (action) {
    case 'member.invited':
      return '已添加成员'
    case 'member.role_changed':
      return '已更新角色'
    case 'member.removed':
      return '已移除成员'
    case 'publication.created':
      return '已发布成果'
    case 'publication.updated':
      return '已更新发布'
    case 'publication.archived':
      return '已归档发布'
    case 'publication.retracted':
      return '已撤回发布'
    case 'publication.restored':
      return '已恢复发布'
    case 'skill.updated':
      return '已更新 Agent 技能'
    case 'workspace.created':
      return '已初始化团队画布'
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
  const activeOrganizationId = activeWorkgroup?.organizationId
  const isAdmin = activeWorkgroup?.role === 'admin'
  const { data: organizationWorkgroupsData, isLoading: isLoadingOrganizationWorkgroups } =
    useOrganizationWorkgroups(isAdmin ? activeOrganizationId : undefined)
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
  const updatePublicationReview = useUpdatePublicationReview()
  const updatePublicationVisibility = useUpdatePublicationVisibility()
  const updateAgentSkill = useUpdateWorkgroupAgentSkill()
  const publishWorkflow = usePublishWorkflow()
  const createWorkflow = useCreateWorkflow()
  const updateWorkflow = useUpdateWorkflow()
  const updateWorkspace = useUpdateWorkspace()
  const updateWorkspacePermissions = useUpdateWorkspacePermissions()
  const cancelInvitation = useCancelWorkspaceInvitation()
  const [inviteValue, setInviteValue] = useState('')
  const [emailInvitationValue, setEmailInvitationValue] = useState('')
  const [emailInvitationResults, setEmailInvitationResults] = useState<
    OrganizationInvitationResult[]
  >([])
  const [inviteRole, setInviteRole] = useState<WorkgroupRole>('member')
  const [publishWorkflowId, setPublishWorkflowId] = useState('')
  const [publishTitle, setPublishTitle] = useState('')
  const [publishDescription, setPublishDescription] = useState('')
  const [publishVisibility, setPublishVisibility] = useState<PublicationVisibility>('organization')
  const [publishTargetWorkgroupIds, setPublishTargetWorkgroupIds] = useState<string[]>([])
  const [teamCanvasName, setTeamCanvasName] = useState('')
  const [activeTab, setActiveTab] = useState<TeamManagementTab>('members')
  const [publicationVisibilityDrafts, setPublicationVisibilityDrafts] = useState<
    Record<string, PublicationVisibilityDraft>
  >({})
  const [publicationReviewDrafts, setPublicationReviewDrafts] = useState<
    Record<string, PublicationReviewDraft>
  >({})
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const members = membersData?.members ?? []
  const teamWorkspaceId = teamWorkspaceData?.workspace.id ?? activeWorkgroup?.teamWorkspaceId
  const { data: teamWorkflows = [], isLoading: isLoadingTeamWorkflows } = useWorkflows(
    isAdmin && teamWorkspaceId ? teamWorkspaceId : undefined
  )
  const publishableTeamWorkflows = useMemo(
    () => teamWorkflows.filter((workflow) => workflow.track !== 'published'),
    [teamWorkflows]
  )
  const selectedPublishWorkflow =
    publishableTeamWorkflows.find((workflow) => workflow.id === publishWorkflowId) ??
    publishableTeamWorkflows[0]
  const publishTargetWorkgroups = useMemo<PublicationTargetWorkgroup[]>(
    () =>
      (organizationWorkgroupsData?.workgroups ?? []).map((workgroup) => ({
        id: workgroup.id,
        name: workgroup.name,
        disciplineName: workgroup.disciplineName,
      })),
    [organizationWorkgroupsData?.workgroups]
  )
  const isPublishTargetSelectionLoading =
    publishVisibility === 'selected_workgroups' && isLoadingOrganizationWorkgroups
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
  const { data: teamWorkspacePermissions, isLoading: isLoadingTeamWorkspacePermissions } =
    useWorkspacePermissionsQuery(isAdmin && teamWorkspaceId ? teamWorkspaceId : undefined)
  const publications = publicationsData?.publications ?? []
  const agentSkills = agentSkillsData?.skills ?? []
  const activity = activityData?.activity ?? []
  const emailInvitationEmails = parseInvitationEmails(emailInvitationValue)
  const emailInvitationResultSummary = useMemo(
    () => summarizeInvitationResults(emailInvitationResults),
    [emailInvitationResults]
  )
  const teamWorkspacePermissionUsers = teamWorkspacePermissions?.users ?? []
  const teamWorkspacePermissionByUserId = useMemo(
    () => new Map(teamWorkspacePermissionUsers.map((user) => [user.userId, user.permissionType])),
    [teamWorkspacePermissionUsers]
  )
  const permissionMismatches = teamWorkspacePermissions
    ? members.filter((member) => {
        const expectedPermission: TeamWorkspaceRepairPermission =
          member.role === 'admin' ? 'admin' : 'write'
        return teamWorkspacePermissionByUserId.get(member.userId) !== expectedPermission
      })
    : []
  const permissionRepairUpdates = permissionMismatches
    .filter((member) => {
      const expectedPermission: TeamWorkspaceRepairPermission =
        member.role === 'admin' ? 'admin' : 'write'
      const workspaceOwnerId = teamWorkspaceData?.workspace.ownerId
      const billedAccountUserId = teamWorkspaceData?.workspace.billedAccountUserId
      if (member.userId === workspaceOwnerId) return false
      if (member.userId === billedAccountUserId && expectedPermission !== 'admin') return false
      return true
    })
    .map((member) => ({
      userId: member.userId,
      permissions: (member.role === 'admin' ? 'admin' : 'write') as TeamWorkspaceRepairPermission,
    }))
  const needsCanvasRepair = !teamWorkspaceId
  const needsWorkflowRepair =
    Boolean(teamWorkspaceId) && !isLoadingTeamWorkflows && teamWorkflows.length === 0
  const needsPermissionRepair =
    Boolean(teamWorkspaceId) &&
    !isLoadingTeamWorkspacePermissions &&
    permissionRepairUpdates.length > 0
  const manualPermissionMismatchCount = Math.max(
    permissionMismatches.length - permissionRepairUpdates.length,
    0
  )
  const repairTargets = [
    needsCanvasRepair ? '初始化团队画布' : null,
    needsWorkflowRepair ? '创建默认画布' : null,
    needsPermissionRepair
      ? `同步 ${permissionRepairUpdates.length} 位成员权限`
      : null,
  ].filter(Boolean)
  const canRepairTeamHealth = repairTargets.length > 0
  const teamHealthRepairSummary = canRepairTeamHealth
    ? `可修复：${repairTargets.join('、')}`
    : manualPermissionMismatchCount > 0
      ? `${manualPermissionMismatchCount} 个所有者或计费账号权限需要人工确认`
      : '团队画布、默认画布和成员权限均正常'
  const latestPublication = useMemo(
    () =>
      publications.reduce<(typeof publications)[number] | null>((latest, publication) => {
        if (!latest) return publication
        return new Date(publication.publishedAt).getTime() > new Date(latest.publishedAt).getTime()
          ? publication
          : latest
      }, null),
    [publications]
  )
  const hasCurrentPublishedPublication = publications.some(
    (publication) => publication.status === 'published'
  )
  const teamHealthItems: Array<{
    id: string
    label: string
    detail: string
    tone: TeamHealthTone
  }> = [
    {
      id: 'canvas',
      label: '团队画布',
      detail: teamWorkspaceId
        ? '已初始化并绑定当前团队'
        : '尚未初始化',
      tone: teamWorkspaceId ? 'healthy' : 'warning',
    },
    {
      id: 'workflow',
      label: '默认画布',
      detail: !teamWorkspaceId
        ? '请先初始化团队画布'
        : isLoadingTeamWorkflows
          ? '正在检查团队画布'
          : teamWorkflows.length > 0
            ? `${teamWorkflows.length} 个画布可用`
            : '尚未创建默认画布',
      tone: !teamWorkspaceId
        ? 'warning'
        : isLoadingTeamWorkflows
          ? 'loading'
          : teamWorkflows.length > 0
            ? 'healthy'
            : 'warning',
    },
    {
      id: 'permissions',
      label: '成员权限',
      detail: !teamWorkspaceId
        ? '暂无团队画布权限可同步'
        : isLoadingTeamWorkspacePermissions
          ? '正在检查画布权限'
          : !teamWorkspacePermissions
            ? '无法检查画布权限'
            : permissionMismatches.length === 0
              ? '所有成员权限一致'
              : `${permissionMismatches.length} 位成员需要同步权限`,
      tone: !teamWorkspaceId
        ? 'warning'
        : isLoadingTeamWorkspacePermissions
          ? 'loading'
          : teamWorkspacePermissions && permissionMismatches.length === 0
            ? 'healthy'
            : 'warning',
    },
    {
      id: 'publication',
      label: '最近发布',
      detail: isLoadingPublications
        ? '正在检查成果版本'
        : latestPublication
          ? `v${latestPublication.versionNumber} ${formatPublicationStatus(
              latestPublication.status
            )}, ${formatPublicationReviewState(latestPublication.reviewState)}, ${formatPublicationRiskLevel(
              latestPublication.riskLevel
            )}.`
          : '当前团队尚未发布成果',
      tone: isLoadingPublications
        ? 'loading'
        : latestPublication &&
            hasCurrentPublishedPublication &&
            latestPublication.riskLevel !== 'critical'
          ? 'healthy'
          : 'warning',
    },
  ]
  const tabCounts: Record<TeamManagementTab, number> = {
    members: members.length,
    invites: pendingInvitations.length,
    publications: publications.length,
    agent: agentSkills.length,
    activity: activity.length,
  }
  const isBusy =
    addMember.isPending ||
    inviteMember.isPending ||
    updatePublicationLifecycle.isPending ||
    updatePublicationReview.isPending ||
    updatePublicationVisibility.isPending ||
    updateAgentSkill.isPending ||
    publishWorkflow.isPending ||
    createWorkflow.isPending ||
    updateWorkflow.isPending ||
    updateWorkspace.isPending ||
    updateWorkspacePermissions.isPending ||
    cancelInvitation.isPending ||
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
    try {
      const result = await createTeamWorkspace.mutateAsync({ workgroupId: activeWorkgroupId })
      const requestedName = teamCanvasName.trim()
      if (requestedName) {
        await Promise.all([
          requestedName !== result.workspace.name
            ? updateWorkspace.mutateAsync({ workspaceId: result.workspace.id, name: requestedName })
            : Promise.resolve(),
          result.defaultWorkflowId
            ? updateWorkflow.mutateAsync({
                workspaceId: result.workspace.id,
                workflowId: result.defaultWorkflowId,
                metadata: { name: requestedName },
              })
            : Promise.resolve(),
        ])
      }
      setTeamCanvasName('')
      setStatusMessage('团队画布已初始化')
      router.push(
        result.defaultWorkflowId
          ? `/workspace/${result.workspace.id}/w/${result.defaultWorkflowId}`
          : `/workspace/${result.workspace.id}/home`
      )
    } catch (error) {
      setStatusMessage(readErrorMessage(error))
    }
  }

  const handleRepairTeamHealth = async () => {
    if (!activeWorkgroupId) return

    const repaired: string[] = []
    let repairedWorkspaceId = teamWorkspaceId
    let initializedDefaultWorkflowId: string | null = null

    try {
      if (!repairedWorkspaceId) {
        const result = await createTeamWorkspace.mutateAsync({ workgroupId: activeWorkgroupId })
        repairedWorkspaceId = result.workspace.id
        initializedDefaultWorkflowId = result.defaultWorkflowId
        const requestedName = teamCanvasName.trim()
        if (requestedName) {
          await Promise.all([
            requestedName !== result.workspace.name
              ? updateWorkspace.mutateAsync({
                  workspaceId: result.workspace.id,
                  name: requestedName,
                })
              : Promise.resolve(),
            result.defaultWorkflowId
              ? updateWorkflow.mutateAsync({
                  workspaceId: result.workspace.id,
                  workflowId: result.defaultWorkflowId,
                  metadata: { name: requestedName },
                })
              : Promise.resolve(),
          ])
        }
        repaired.push('初始化团队画布')
      }

      if (
        repairedWorkspaceId &&
        teamWorkspaceId &&
        !initializedDefaultWorkflowId &&
        needsWorkflowRepair
      ) {
        await createWorkflow.mutateAsync({
          workspaceId: repairedWorkspaceId,
          name: '团队画布',
          description: `${activeWorkgroup?.name ?? '团队'} 的默认画布`,
          color: '#3972F6',
        })
        repaired.push('创建默认画布')
      }

      if (repairedWorkspaceId && needsPermissionRepair) {
        await updateWorkspacePermissions.mutateAsync({
          workspaceId: repairedWorkspaceId,
          organizationId: activeWorkgroup?.organizationId,
          updates: permissionRepairUpdates,
        })
        repaired.push(
          `同步 ${permissionRepairUpdates.length} 位成员权限`
        )
      }

      await refetchActivity()
      if (repairedWorkspaceId) setTeamCanvasName('')
      setStatusMessage(
        repaired.length > 0
          ? `健康检查已修复：${repaired.join('、')}`
          : '当前无需自动修复'
      )
    } catch (error) {
      setStatusMessage(readErrorMessage(error))
    }
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
    setStatusMessage('成员已加入团队')
  }

  const handleEmailInvitation = async () => {
    if (
      !activeWorkgroup?.organizationId ||
      !teamWorkspaceId ||
      emailInvitationEmails.length === 0
    ) {
      return
    }
    try {
      const result = await inviteMember.mutateAsync({
        orgId: activeWorkgroup.organizationId,
        emails: emailInvitationEmails,
        workspaceInvitations: [
          {
            workspaceId: teamWorkspaceId,
            permission: inviteRole === 'admin' ? 'admin' : 'write',
          },
        ],
      })
      const results = readInvitationResults(result)
      setEmailInvitationResults(results)
      if (results.length === 0 || results.every((item) => item.status === 'sent')) {
        setEmailInvitationValue('')
      }
      setStatusMessage(`邀请结果：${summarizeInvitationResults(results)}`)
    } catch (error) {
      const results = readInvitationResultsFromError(error)
      setEmailInvitationResults(results)
      setStatusMessage(
        results.length > 0
          ? `邀请结果：${summarizeInvitationResults(results)}`
          : readErrorMessage(error)
      )
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
      setStatusMessage('待处理邀请已取消')
    } catch (error) {
      setStatusMessage(readErrorMessage(error))
    }
  }

  const handlePublicationLifecycle = async (
    publicationVersionId: string,
    action: 'archive' | 'retract' | 'restore'
  ) => {
    try {
      await updatePublicationLifecycle.mutateAsync({
        publicationVersionId,
        action,
        reason: `Updated from team management for ${activeWorkgroup?.name ?? 'team'}`,
      })
      await refetchActivity()
      setStatusMessage(
        action === 'archive'
          ? 'Publication archived.'
          : action === 'restore'
            ? 'Publication restored as current.'
            : 'Publication retracted.'
      )
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

  const getPublicationVisibilityDraft = (publication: (typeof publications)[number]) =>
    publicationVisibilityDrafts[publication.id] ?? {
      visibility: publication.visibility,
      targetWorkgroupIds: publication.targetWorkgroupIds ?? [],
    }

  const handlePublicationVisibilityChange = (
    publicationId: string,
    visibility: PublicationVisibility
  ) => {
    setPublicationVisibilityDrafts((current) => ({
      ...current,
      [publicationId]: {
        visibility,
        targetWorkgroupIds: current[publicationId]?.targetWorkgroupIds ?? [],
      },
    }))
  }

  const handlePublicationTargetToggle = (
    publicationId: string,
    workgroupId: string,
    checked: boolean
  ) => {
    setPublicationVisibilityDrafts((current) => {
      const draft = current[publicationId] ?? {
        visibility: 'selected_workgroups' as PublicationVisibility,
        targetWorkgroupIds: [],
      }
      return {
        ...current,
        [publicationId]: {
          visibility: draft.visibility,
          targetWorkgroupIds: checked
            ? Array.from(new Set([...draft.targetWorkgroupIds, workgroupId]))
            : draft.targetWorkgroupIds.filter((item) => item !== workgroupId),
        },
      }
    })
  }

  const handleUpdatePublicationVisibility = async (publication: (typeof publications)[number]) => {
    if (!activeWorkgroupId) return
    const draft = getPublicationVisibilityDraft(publication)
    const targetWorkgroupIds =
      draft.visibility === 'selected_workgroups'
        ? draft.targetWorkgroupIds.length > 0
          ? draft.targetWorkgroupIds
          : [activeWorkgroupId]
        : []
    try {
      await updatePublicationVisibility.mutateAsync({
        publicationVersionId: publication.id,
        visibility: draft.visibility,
        targetWorkgroupIds,
        reason: `团队管理更新 ${activeWorkgroup?.name ?? '团队'} 的成果可见性`,
      })
      await refetchPublications()
      await refetchActivity()
      setPublicationVisibilityDrafts((current) => {
        const next = { ...current }
        delete next[publication.id]
        return next
      })
      setStatusMessage('成果可见性已更新')
    } catch (error) {
      setStatusMessage(readErrorMessage(error))
    }
  }

  const getPublicationReviewDraft = (publication: (typeof publications)[number]) =>
    publicationReviewDrafts[publication.id] ?? {
      reviewState: publication.reviewState ?? 'unreviewed',
      riskLevel: publication.riskLevel ?? 'unset',
    }

  const handlePublicationReviewDraftChange = (
    publicationId: string,
    patch: Partial<PublicationReviewDraft>
  ) => {
    setPublicationReviewDrafts((current) => {
      const existing = current[publicationId] ?? {
        reviewState: 'unreviewed' as ReviewStateDraft,
        riskLevel: 'unset' as RiskLevelDraft,
      }
      return {
        ...current,
        [publicationId]: { ...existing, ...patch },
      }
    })
  }

  const handleUpdatePublicationReview = async (publication: (typeof publications)[number]) => {
    const draft = getPublicationReviewDraft(publication)
    try {
      await updatePublicationReview.mutateAsync({
        publicationVersionId: publication.id,
        reviewState: draft.reviewState === 'unreviewed' ? null : draft.reviewState,
        riskLevel: draft.riskLevel === 'unset' ? null : draft.riskLevel,
        reason: `团队管理更新 ${activeWorkgroup?.name ?? '团队'} 的成果审核`,
      })
      await refetchPublications()
      await refetchActivity()
      setPublicationReviewDrafts((current) => {
        const next = { ...current }
        delete next[publication.id]
        return next
      })
      setStatusMessage('成果审核已更新')
    } catch (error) {
      setStatusMessage(readErrorMessage(error))
    }
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
      setStatusMessage('团队画布已发布到成果中心')
    } catch (error) {
      setStatusMessage(readErrorMessage(error))
    }
  }

  const handleAgentSkillToggle = async (skillId: string, enabled: boolean) => {
    if (!activeWorkgroupId) return
    try {
      await updateAgentSkill.mutateAsync({ workgroupId: activeWorkgroupId, skillId, enabled })
      setStatusMessage(enabled ? 'Agent 技能已启用' : 'Agent 技能已停用')
    } catch (error) {
      setStatusMessage(readErrorMessage(error))
    }
  }

  const handleRoleChange = async (userId: string, role: WorkgroupRole) => {
    if (!activeWorkgroupId) return
    await updateMember.mutateAsync({ workgroupId: activeWorkgroupId, userId, role })
    setStatusMessage('成员角色已更新')
  }

  const handleRemove = async (userId: string) => {
    if (!activeWorkgroupId) return
    await removeMember.mutateAsync({ workgroupId: activeWorkgroupId, userId })
    setStatusMessage('成员已移出团队')
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
          <h1 className='font-medium text-[18px] text-[var(--text-primary)]'>暂无可管理团队</h1>
          <p className='mt-2 text-[13px] text-[var(--text-muted)] leading-5'>
            加入项目团队后即可管理成员、邀请和团队画布。
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
            需要团队管理员权限
          </h1>
          <p className='mt-2 text-[13px] text-[var(--text-muted)] leading-5'>
            普通成员可以使用个人画布和团队画布；成员邀请、角色调整和团队画布初始化由团队管理员处理。
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
              团队管理
            </h1>
            <p className='mt-2 max-w-[520px] text-[13px] text-[var(--text-muted)] leading-5'>
              管理成员、邀请、团队画布和 Agent 技能。
            </p>
          </div>
          <div className='flex flex-col gap-2 sm:min-w-[280px]'>
            {!teamWorkspaceId && (
              <Input
                value={teamCanvasName}
                onChange={(event) => setTeamCanvasName(event.target.value)}
                placeholder={`${activeWorkgroup?.name ?? '团队'}画布名称`}
                disabled={isBusy}
              />
            )}
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
              {teamWorkspaceId ? '打开团队画布' : '初始化团队画布'}
            </Button>
          </div>
        </div>

        {statusMessage && (
          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[12px] text-[var(--text-body)]'>
            {statusMessage}
          </div>
        )}

        <div
          className='grid gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-2 sm:grid-cols-2 lg:grid-cols-5'
          role='tablist'
          aria-label='团队管理栏目'
        >
          {TEAM_MANAGEMENT_TABS.map((tab) => (
            <Button
              key={tab.id}
              type='button'
              variant='ghost'
              role='tab'
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'h-auto flex-col items-stretch justify-start rounded-[8px] border px-3 py-2 text-left transition-colors',
                activeTab === tab.id
                  ? 'border-[var(--brand-accent)] bg-[var(--surface-1)] shadow-subtle'
                  : 'border-transparent bg-transparent hover:border-[var(--border)] hover:bg-[var(--surface-1)]'
              )}
            >
              <span className='flex items-center justify-between gap-3'>
                <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                  {tab.label}
                </span>
                <span className='rounded-[8px] border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]'>
                  {tabCounts[tab.id]}
                </span>
              </span>
              <span className='mt-1 block text-[11px] text-[var(--text-muted)]'>
                {tab.description}
              </span>
            </Button>
          ))}
        </div>

        <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
          <div className='flex flex-col gap-3 border-[var(--border)] border-b px-4 py-3 md:flex-row md:items-start md:justify-between'>
            <div className='flex items-start gap-2'>
              <Activity className='mt-0.5 h-[15px] w-[15px] text-[var(--text-icon)]' />
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                  团队画布状态
                </h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  检查画布、默认工作流、成员权限和最近成果。
                </p>
                <p className='mt-1 text-[11px] text-[var(--text-muted)]'>
                  {teamHealthRepairSummary}
                </p>
              </div>
            </div>
            <Button
              className='h-[32px] shrink-0'
              onClick={() => void handleRepairTeamHealth()}
              disabled={!canRepairTeamHealth || isBusy}
            >
              {createTeamWorkspace.isPending ||
              createWorkflow.isPending ||
              updateWorkspacePermissions.isPending ? (
                <Loader className='mr-2 h-[14px] w-[14px]' animate />
              ) : (
                <RotateCcw className='mr-2 h-[14px] w-[14px]' />
              )}
              修复状态
            </Button>
          </div>
          <div className='grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-4'>
            {teamHealthItems.map((item) => (
              <div
                key={item.id}
                className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'
              >
                <div className='flex items-center gap-2'>
                  {item.tone === 'healthy' ? (
                    <CheckCircle2 className='h-[14px] w-[14px] text-[var(--success)]' />
                  ) : item.tone === 'loading' ? (
                    <Loader className='h-[14px] w-[14px] text-[var(--text-icon)]' animate />
                  ) : (
                    <AlertTriangle className='h-[14px] w-[14px] text-[var(--warning)]' />
                  )}
                  <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                    {item.label}
                  </span>
                </div>
                <p className='mt-2 text-[12px] text-[var(--text-muted)] leading-5'>{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {activeTab === 'members' && (
          <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
              <Mail className='h-[15px] w-[15px] text-[var(--text-icon)]' />
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                  添加已有用户
                </h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  输入账号邮箱或用户 ID，并选择团队角色。
                </p>
              </div>
            </div>
            <div className='grid gap-2 p-4 md:grid-cols-[minmax(0,1fr)_140px_auto]'>
              <Input
                value={inviteValue}
                onChange={(event) => setInviteValue(event.target.value)}
                placeholder='邮箱或用户 ID'
                disabled={isBusy}
              />
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as WorkgroupRole)}
                disabled={isBusy}
                className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
              >
                <option value='member'>成员</option>
                <option value='admin'>管理员</option>
              </select>
              <Button
                variant='primary'
                onClick={() => void handleInvite()}
                disabled={!inviteValue.trim() || isBusy}
              >
                {addMember.isPending ? <Loader className='mr-2 h-[14px] w-[14px]' animate /> : null}
                添加成员
              </Button>
            </div>
          </section>
        )}

        {activeTab === 'invites' && (
          <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
              <Mail className='h-[15px] w-[15px] text-[var(--text-icon)]' />
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                  创建团队邀请
                </h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  邀请成员加入当前团队，并自动获得团队画布权限。
                </p>
              </div>
            </div>
            <div className='grid gap-2 p-4 md:grid-cols-[minmax(0,1fr)_140px_auto]'>
              <div className='grid gap-1'>
                <Textarea
                  value={emailInvitationValue}
                  onChange={(event) => {
                    setEmailInvitationValue(event.target.value)
                    setEmailInvitationResults([])
                  }}
                  placeholder='name@example.com, teammate@example.com'
                  rows={3}
                  disabled={isBusy || !teamWorkspaceId}
                  className='min-h-[74px] text-[13px]'
                />
                <div className='text-[11px] text-[var(--text-muted)]'>
                  多个邮箱可用逗号、空格或换行分隔。
                  {emailInvitationEmails.length > 0
                    ? ` 已识别 ${emailInvitationEmails.length} 个收件人。`
                    : ''}
                </div>
              </div>
              <select
                value={inviteRole}
                onChange={(event) => {
                  setInviteRole(event.target.value as WorkgroupRole)
                  setEmailInvitationResults([])
                }}
                disabled={isBusy || !teamWorkspaceId}
                className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
              >
                <option value='member'>成员</option>
                <option value='admin'>管理员</option>
              </select>
              <Button
                variant='primary'
                onClick={() => void handleEmailInvitation()}
                disabled={emailInvitationEmails.length === 0 || !teamWorkspaceId || isBusy}
              >
                {inviteMember.isPending ? (
                  <Loader className='mr-2 h-[14px] w-[14px]' animate />
                ) : null}
                创建邀请
              </Button>
            </div>
            {emailInvitationResults.length > 0 && (
              <div className='border-[var(--border)] border-t px-4 py-3'>
                <div className='mb-2 flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
                  <AlertTriangle className='h-[13px] w-[13px]' />
                  批量结果：{emailInvitationResultSummary}
                </div>
                <div className='grid gap-2 md:grid-cols-2'>
                  {emailInvitationResults.map((result) => (
                    <div
                      key={`${result.email}-${result.status}`}
                      className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'
                    >
                      <div className='flex min-w-0 items-center justify-between gap-2'>
                        <span className='truncate font-medium text-[12px] text-[var(--text-primary)]'>
                          {result.email}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 rounded-[8px] border px-2 py-0.5 text-[11px]',
                            getInvitationResultClassName(result.status)
                          )}
                        >
                          {INVITATION_RESULT_LABELS[result.status]}
                        </span>
                      </div>
                      <div className='mt-1 text-[11px] text-[var(--text-muted)]'>
                        {result.message}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!teamWorkspaceId && (
              <div className='border-[var(--border)] border-t px-4 py-3 text-[12px] text-[var(--text-muted)]'>
                请先初始化团队画布，再发送团队邀请。
              </div>
            )}
          </section>
        )}

        {activeTab === 'members' && (
          <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
              <Users className='h-[15px] w-[15px] text-[var(--text-icon)]' />
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>团队成员</h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  管理员可调整角色或移除成员；最后一位管理员会被系统保护。
                </p>
              </div>
            </div>
            <div className='divide-y divide-[var(--border)]'>
              {isLoadingMembers ? (
                <div className='flex items-center gap-2 px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                  <Loader className='h-[14px] w-[14px]' animate />
                  正在加载成员...
                </div>
              ) : members.length === 0 ? (
                <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                  暂无团队成员。
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
                      <option value='member'>成员</option>
                      <option value='admin'>管理员</option>
                    </select>
                    <Button
                      variant='default'
                      className='h-[32px]'
                      onClick={() => void handleRemove(member.userId)}
                      disabled={isBusy}
                    >
                      <UserMinus className='mr-2 h-[14px] w-[14px]' />
                      移除
                    </Button>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {activeTab === 'publications' && (
          <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
              <Send className='h-[15px] w-[15px] text-[var(--text-icon)]' />
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                  发布团队成果
                </h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  从团队画布生成成果版本，并设置可见范围。
                </p>
              </div>
            </div>
            <div className='grid gap-3 p-4'>
              {!teamWorkspaceId ? (
                <div className='text-[13px] text-[var(--text-muted)]'>
                  请先初始化团队画布，再发布成果版本。
                </div>
              ) : isLoadingTeamWorkflows ? (
                <div className='flex items-center gap-2 text-[13px] text-[var(--text-muted)]'>
                  <Loader className='h-[14px] w-[14px]' animate />
                  正在加载团队画布...
                </div>
              ) : publishableTeamWorkflows.length === 0 ? (
                <div className='text-[13px] text-[var(--text-muted)]'>
                  团队画布中暂无工作流。
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
                      {publishableTeamWorkflows.map((workflow) => (
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
                      <option value='organization'>项目内可见</option>
                      <option value='selected_workgroups'>指定团队可见</option>
                    </select>
                  </div>
                  <Input
                    value={publishTitle}
                    onChange={(event) => setPublishTitle(event.target.value)}
                    placeholder={`标题：${selectedPublishWorkflow?.name ?? '团队方案'}`}
                    disabled={isBusy}
                  />
                  <Input
                    value={publishDescription}
                    onChange={(event) => setPublishDescription(event.target.value)}
                    placeholder='版本说明或审核摘要'
                    disabled={isBusy}
                  />
                  {publishVisibility === 'selected_workgroups' && (
                    <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                      <div className='mb-2 text-[12px] text-[var(--text-muted)]'>
                        选择可查看该成果版本的团队。未选择时，仅当前团队可见。
                      </div>
                      {isLoadingOrganizationWorkgroups ? (
                        <div className='flex items-center gap-2 text-[13px] text-[var(--text-muted)]'>
                          <Loader className='h-[14px] w-[14px]' animate />
                          正在加载项目团队...
                        </div>
                      ) : publishTargetWorkgroups.length === 0 ? (
                        <div className='text-[13px] text-[var(--text-muted)]'>
                          当前项目暂无可选团队。
                        </div>
                      ) : (
                        <div className='grid gap-2 md:grid-cols-2'>
                          {publishTargetWorkgroups.map((workgroup) => (
                            <div
                              key={workgroup.id}
                              className='flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[13px] text-[var(--text-body)]'
                            >
                              <span className='truncate'>
                                {workgroup.disciplineName} / {workgroup.name}
                              </span>
                              <Switch
                                checked={publishTargetWorkgroupIds.includes(workgroup.id)}
                                disabled={isBusy}
                                aria-label={`切换 ${workgroup.name} 成果可见性`}
                                onCheckedChange={(checked) =>
                                  handlePublishTargetToggle(workgroup.id, checked)
                                }
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className='flex items-center justify-between gap-3'>
                    <div className='text-[12px] text-[var(--text-muted)]'>
                      发布后会生成一个新的成果版本。
                    </div>
                    <Button
                      variant='primary'
                      onClick={() => void handlePublishTeamWorkflow()}
                      disabled={
                        isBusy || !selectedPublishWorkflow || isPublishTargetSelectionLoading
                      }
                    >
                      {publishWorkflow.isPending ? (
                        <Loader className='mr-2 h-[14px] w-[14px]' animate />
                      ) : (
                        <Send className='mr-2 h-[14px] w-[14px]' />
                      )}
                      发布
                    </Button>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {activeTab === 'publications' && (
          <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
              <Archive className='h-[15px] w-[15px] text-[var(--text-icon)]' />
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                  团队成果
                </h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  查看当前团队发布过的成果版本。
                </p>
              </div>
            </div>
            <div className='divide-y divide-[var(--border)]'>
              {isLoadingPublications ? (
                <div className='flex items-center gap-2 px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                  <Loader className='h-[14px] w-[14px]' animate />
                  正在加载成果...
                </div>
              ) : publications.length === 0 ? (
                <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                  当前团队尚未发布成果。
                </div>
              ) : (
                publications.map((publication) => {
                  const visibilityDraft = getPublicationVisibilityDraft(publication)
                  const reviewDraft = getPublicationReviewDraft(publication)
                  return (
                    <div key={publication.id} className='grid gap-3 px-4 py-3'>
                      <div className='grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]'>
                        <div className='min-w-0'>
                          <div className='flex min-w-0 items-center gap-2'>
                            <span className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                              {publication.title}
                            </span>
                            <span className='shrink-0 rounded-[8px] border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]'>
                              v{publication.versionNumber} ·{' '}
                              {formatPublicationStatus(publication.status)}
                            </span>
                          </div>
                          <div className='truncate text-[12px] text-[var(--text-muted)]'>
                            {publication.description?.trim() || '暂无说明'} ·{' '}
                            {formatPublicationDate(publication.publishedAt)}
                          </div>
                        </div>
                        <Button
                          variant='default'
                          className='h-[32px]'
                          onClick={() => void handlePublicationLifecycle(publication.id, 'restore')}
                          disabled={isBusy || publication.status === 'published'}
                        >
                          <RotateCcw className='mr-2 h-[14px] w-[14px]' />
                          设为当前
                        </Button>
                        <Button
                          variant='default'
                          className='h-[32px]'
                          onClick={() => void handlePublicationLifecycle(publication.id, 'archive')}
                          disabled={isBusy}
                        >
                          <Archive className='mr-2 h-[14px] w-[14px]' />
                          归档
                        </Button>
                        <Button
                          variant='default'
                          className='h-[32px]'
                          onClick={() => void handlePublicationLifecycle(publication.id, 'retract')}
                          disabled={isBusy}
                        >
                          <EyeOff className='mr-2 h-[14px] w-[14px]' />
                          撤回
                        </Button>
                      </div>

                      <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                        <div className='grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]'>
                          <select
                            value={visibilityDraft.visibility}
                            onChange={(event) =>
                              handlePublicationVisibilityChange(
                                publication.id,
                                event.target.value as PublicationVisibility
                              )
                            }
                            disabled={isBusy}
                            className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
                          >
                            <option value='organization'>项目内可见</option>
                            <option value='selected_workgroups'>指定团队可见</option>
                          </select>
                          <Button
                            variant='default'
                            className='h-[32px]'
                            onClick={() => void handleUpdatePublicationVisibility(publication)}
                            disabled={
                              isBusy ||
                              (visibilityDraft.visibility === 'selected_workgroups' &&
                                isLoadingOrganizationWorkgroups)
                            }
                          >
                            更新可见性
                          </Button>
                        </div>
                        {visibilityDraft.visibility === 'selected_workgroups' &&
                          (isLoadingOrganizationWorkgroups ? (
                            <div className='mt-3 flex items-center gap-2 text-[13px] text-[var(--text-muted)]'>
                              <Loader className='h-[14px] w-[14px]' animate />
                              正在加载项目团队...
                            </div>
                          ) : publishTargetWorkgroups.length === 0 ? (
                            <div className='mt-3 text-[13px] text-[var(--text-muted)]'>
                              当前项目暂无可选团队。
                            </div>
                          ) : (
                            <div className='mt-3 grid gap-2 md:grid-cols-2'>
                              {publishTargetWorkgroups.map((workgroup) => (
                                <div
                                  key={workgroup.id}
                                  className='flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[13px] text-[var(--text-body)]'
                                >
                                  <span className='truncate'>
                                    {workgroup.disciplineName} / {workgroup.name}
                                  </span>
                                  <Switch
                                    checked={visibilityDraft.targetWorkgroupIds.includes(
                                      workgroup.id
                                    )}
                                    disabled={isBusy}
                                    aria-label={`切换 ${workgroup.name} 发布可见性`}
                                    onCheckedChange={(checked) =>
                                      handlePublicationTargetToggle(
                                        publication.id,
                                        workgroup.id,
                                        checked
                                      )
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          ))}
                      </div>

                      <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                        <div className='mb-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-muted)]'>
                          <span>{formatPublicationReviewState(publication.reviewState)}</span>
                          <span>/</span>
                          <span>{formatPublicationRiskLevel(publication.riskLevel)}</span>
                        </div>
                        <div className='grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]'>
                          <select
                            value={reviewDraft.reviewState}
                            onChange={(event) =>
                              handlePublicationReviewDraftChange(publication.id, {
                                reviewState: event.target.value as ReviewStateDraft,
                              })
                            }
                            disabled={isBusy}
                            className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
                          >
                            <option value='unreviewed'>未审核</option>
                            <option value='pending'>待审核</option>
                            <option value='in_review'>审核中</option>
                            <option value='approved'>已通过</option>
                            <option value='changes_requested'>需修改</option>
                            <option value='rejected'>已拒绝</option>
                          </select>
                          <select
                            value={reviewDraft.riskLevel}
                            onChange={(event) =>
                              handlePublicationReviewDraftChange(publication.id, {
                                riskLevel: event.target.value as RiskLevelDraft,
                              })
                            }
                            disabled={isBusy}
                            className='h-[32px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
                          >
                            <option value='unset'>未设置风险</option>
                            <option value='low'>低风险</option>
                            <option value='medium'>中风险</option>
                            <option value='high'>高风险</option>
                            <option value='critical'>严重风险</option>
                          </select>
                          <Button
                            variant='default'
                            className='h-[32px]'
                            onClick={() => void handleUpdatePublicationReview(publication)}
                            disabled={isBusy}
                          >
                            更新审核
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <div className='border-[var(--border)] border-t px-4 py-3'>
              <Button
                variant='default'
                className='h-[32px]'
                onClick={() => router.push(`/workspace/${workspaceId}/showcase`)}
              >
                打开项目总览
              </Button>
            </div>
          </section>
        )}

        {activeTab === 'agent' && (
          <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
              <Sparkles className='h-[15px] w-[15px] text-[var(--text-icon)]' />
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                  团队 Agent 技能
                </h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  管理 {agentSkillsData?.agent.name ?? '团队'} 可使用的 Copilot 技能。
                </p>
              </div>
            </div>
            <div className='divide-y divide-[var(--border)]'>
              {!teamWorkspaceId ? (
                <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                  请先初始化团队画布，再绑定团队 Agent 技能。
                </div>
              ) : isLoadingAgentSkills ? (
                <div className='flex items-center gap-2 px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                  <Loader className='h-[14px] w-[14px]' animate />
                  正在加载 Agent 技能...
                </div>
              ) : agentSkills.length === 0 ? (
                <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                  团队画布中暂无技能。创建技能后，可在这里绑定到团队 Agent。
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
                        {skill.description?.trim() || '暂无说明'}
                      </div>
                    </div>
                    <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
                      {skill.enabled ? '已启用' : '已停用'}
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
        )}

        {activeTab === 'activity' && (
          <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
              <Activity className='h-[15px] w-[15px] text-[var(--text-icon)]' />
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                  团队动态
                </h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  查看成员、成果、画布和 Agent 技能的最近变更。
                </p>
              </div>
            </div>
            <div className='divide-y divide-[var(--border)]'>
              {isLoadingActivity ? (
                <div className='flex items-center gap-2 px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                  <Loader className='h-[14px] w-[14px]' animate />
                  正在加载团队动态...
                </div>
              ) : activity.length === 0 ? (
                <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                  暂无团队动态。
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
                        {entry.description?.trim() || '暂无详情'} ·{' '}
                        {entry.actorName || entry.actorEmail || '未知操作者'}
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
        )}

        {activeTab === 'invites' && (
          <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-3'>
              <Mail className='h-[15px] w-[15px] text-[var(--text-icon)]' />
              <div>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                  待处理邀请
                </h2>
                <p className='text-[12px] text-[var(--text-muted)]'>
                  管理尚未接受的团队邀请。
                </p>
              </div>
            </div>
            <div className='divide-y divide-[var(--border)]'>
              {!teamWorkspaceId ? (
                <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                  请先初始化团队画布，再管理邀请。
                </div>
              ) : isLoadingPendingInvitations ? (
                <div className='flex items-center gap-2 px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                  <Loader className='h-[14px] w-[14px]' animate />
                  正在加载邀请...
                </div>
              ) : pendingInvitations.length === 0 ? (
                <div className='px-4 py-6 text-[13px] text-[var(--text-muted)]'>
                  暂无待处理邀请。
                </div>
              ) : (
                pendingInvitations.map((invitation) => {
                  const expiryState = getInvitationExpiryState(invitation.expiresAt)
                  return (
                    <div
                      key={invitation.invitationId ?? invitation.email}
                      className='grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]'
                    >
                      <div className='min-w-0'>
                        <div className='flex min-w-0 flex-wrap items-center gap-2'>
                          <span className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                            {invitation.email}
                          </span>
                          {expiryState && (
                            <span
                              className={cn(
                                'shrink-0 rounded-[8px] border px-2 py-0.5 text-[11px]',
                                expiryState.tone === 'danger'
                                  ? 'border-[var(--error)] text-[var(--text-error)]'
                                  : expiryState.tone === 'warning'
                                    ? 'border-[var(--caution)] text-[var(--warning)]'
                                    : 'border-[var(--border)] text-[var(--text-muted)]'
                              )}
                            >
                              {expiryState.label}
                            </span>
                          )}
                        </div>
                        <div className='truncate text-[12px] text-[var(--text-muted)]'>
                          {invitation.permissionType === 'admin' ? '管理员' : '成员'}权限
                          {invitation.isExternal ? ' / 外部邀请' : ''}
                        </div>
                      </div>
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
                        取消
                      </Button>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
