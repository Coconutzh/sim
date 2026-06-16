'use client'

import { useCallback, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import type { ProductionProjectPhase } from '@/lib/api/contracts/production-projects'
import {
  useCreatePersonalWorkspace,
  useCreateTeamWorkspace,
  useMyWorkgroups,
  useOrganizationWorkgroups,
  usePersonalWorkspace,
  useSetActiveWorkgroup,
  useTeamWorkspace,
} from '@/hooks/queries/collaboration'
import { useWorkflows } from '@/hooks/queries/workflows'
import {
  useWorkspaceCanvasCreationCapabilities,
  useWorkspaceSettings,
  useWorkspacesQuery,
} from '@/hooks/queries/workspace'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

const logger = createLogger('LiteCanvasNavigation')

function getWorkspaceEditorHref(workspaceId?: string, workflows?: WorkflowMetadata[]) {
  if (!workspaceId) return '#'
  const firstWorkflow =
    workflows?.find(
      (workflow) => workflow.workspaceId === workspaceId && workflow.track !== 'published'
    ) ?? workflows?.find((workflow) => workflow.track !== 'published')
  return firstWorkflow
    ? `/workspace/${workspaceId}/w/${firstWorkflow.id}`
    : `/workspace/${workspaceId}/home`
}

function isDirectorLikeProjectWorkgroup(workgroup: {
  discipline: { agentCode?: string | null; code?: string | null }
}) {
  return (
    workgroup.discipline.agentCode === 'chief_director' ||
    workgroup.discipline.agentCode === 'show_director' ||
    workgroup.discipline.code === 'chief_director' ||
    workgroup.discipline.code === 'show_director' ||
    workgroup.discipline.code === 'pmo'
  )
}

interface UseLiteCanvasNavigationProps {
  workspaceId: string
}

export interface ProjectWorkspaceEntry {
  canManageProject: boolean
  estimatedDueAt: string | null
  id: string
  name: string
  logoUrl: string | null
  primaryWorkgroupId: string
  primaryWorkgroupName: string
  phases: ProductionProjectPhase[]
  disciplineName: string
  role: 'admin' | 'member'
  teamWorkspaceId: string
  teamCount: number
  memberCount: number
  projectStatus: 'active' | 'completed'
  taskStats: {
    completed: number
    total: number
    unfinished: number
  }
  href: string
}

export interface CanvasContextSummary {
  detail: string
  kind: 'team' | 'personal' | 'project'
  label: string
}

export function useLiteCanvasNavigation({ workspaceId }: UseLiteCanvasNavigationProps) {
  const router = useRouter()
  const { data: workspaces = [], isLoading: isWorkspacesLoading } = useWorkspacesQuery(true)
  const { data: workspaceSettingsData } = useWorkspaceSettings(workspaceId)
  const { data: workgroupsData, isLoading: isWorkgroupsLoading } = useMyWorkgroups(true)
  const { data: canvasCreationCapabilities } = useWorkspaceCanvasCreationCapabilities(true)
  const { mutateAsync: setActiveWorkgroup, isPending: isSettingActiveWorkgroup } =
    useSetActiveWorkgroup()
  const { mutateAsync: createPersonalWorkspace, isPending: isCreatingPersonalWorkspace } =
    useCreatePersonalWorkspace()
  const { mutateAsync: createTeamWorkspace, isPending: isCreatingTeamWorkspace } =
    useCreateTeamWorkspace()

  const workgroups = workgroupsData?.workgroups ?? []
  const activeWorkspace = workspaces.find((workspace) => workspace.id === workspaceId)
  const currentWorkspaceWorkgroupId = workspaceSettingsData?.settings.workspace.workgroupId
  const activeWorkgroup =
    workgroups.find((workgroup) => workgroup.teamWorkspaceId === workspaceId) ??
    workgroups.find((workgroup) => workgroup.id === activeWorkspace?.workgroupId) ??
    workgroups.find((workgroup) => workgroup.id === currentWorkspaceWorkgroupId) ??
    workgroups.find((workgroup) => workgroup.id === workgroupsData?.defaultWorkgroupId) ??
    workgroups[0]
  const activeWorkgroupId = activeWorkgroup?.id

  const { data: personalWorkspaceData } = usePersonalWorkspace(activeWorkgroupId)
  const { data: teamWorkspaceData } = useTeamWorkspace(activeWorkgroupId)
  const { data: organizationWorkgroupsData } = useOrganizationWorkgroups(
    activeWorkgroup?.organizationId
  )

  const personalWorkspaceId = personalWorkspaceData?.workspace.id || workspaceId
  const teamWorkspaceId =
    teamWorkspaceData?.workspace.id || activeWorkgroup?.teamWorkspaceId || undefined
  const { data: personalWorkflows = [] } = useWorkflows(personalWorkspaceId, {
    enabled: Boolean(personalWorkspaceId),
  })
  const { data: teamWorkflows = [] } = useWorkflows(teamWorkspaceId, {
    enabled: Boolean(teamWorkspaceId),
  })

  const personalDraftWorkspaces = useMemo(
    () =>
      workspaces.filter((workspace) => {
        if (workspace.canvasScope !== 'personal') return false
        return !activeWorkgroupId || workspace.workgroupId === activeWorkgroupId
      }),
    [activeWorkgroupId, workspaces]
  )

  const activePersonalDraftWorkspace =
    personalDraftWorkspaces.find((workspace) => workspace.id === workspaceId) ??
    personalDraftWorkspaces.find((workspace) => workspace.id === personalWorkspaceId) ??
    personalDraftWorkspaces[0] ??
    null

  const isActiveWorkgroupAdmin = activeWorkgroup?.role === 'admin'
  const isProjectAdmin =
    organizationWorkgroupsData?.workgroups.some(
      (workgroup) =>
        workgroup.currentUserRole === 'org_admin' || workgroup.currentUserRole === 'project_admin'
    ) ?? false

  const canCreatePersonalCanvas = Boolean(
    activeWorkgroupId && canvasCreationCapabilities?.canCreatePersonalCanvas === true
  )
  const canInitializeTeamCanvas = Boolean(
    activeWorkgroupId &&
      isActiveWorkgroupAdmin &&
      !teamWorkspaceId &&
      canvasCreationCapabilities?.canCreateTeamCanvas !== false
  )

  const personalHref = getWorkspaceEditorHref(personalWorkspaceId, personalWorkflows)
  const teamHref = teamWorkspaceId ? getWorkspaceEditorHref(teamWorkspaceId, teamWorkflows) : '#'
  const teamScopedWorkspaceId = teamWorkspaceId || workspaceId
  const currentCanvasKind: CanvasContextSummary['kind'] =
    activeWorkspace?.canvasScope === 'personal'
      ? 'personal'
      : activeWorkspace?.canvasScope === 'team' || activeWorkspace?.id === teamWorkspaceId
        ? 'team'
        : 'project'
  const canvasContext: CanvasContextSummary = {
    kind: currentCanvasKind,
    label:
      currentCanvasKind === 'personal'
        ? '个人画布'
        : currentCanvasKind === 'team'
          ? '团队画布'
          : '项目工作区',
    detail:
      currentCanvasKind === 'personal'
        ? (activeWorkspace?.name ?? activePersonalDraftWorkspace?.name ?? '个人草稿')
        : activeWorkgroup
          ? `${activeWorkgroup.discipline.name} / ${activeWorkgroup.name}`
          : (activeWorkspace?.name ?? '团队画布'),
  }

  const projectEntries = useMemo<ProjectWorkspaceEntry[]>(() => {
    const groups = new Map<string, ProjectWorkspaceEntry>()
    for (const group of workgroups) {
      const existing = groups.get(group.organizationId)
      const isDefault = group.id === workgroupsData?.defaultWorkgroupId
      const existingWorkgroup = existing
        ? workgroups.find((workgroup) => workgroup.id === existing.primaryWorkgroupId)
        : undefined
      const existingIsDirectorLike = existingWorkgroup
        ? isDirectorLikeProjectWorkgroup(existingWorkgroup)
        : false
      const candidateIsDirectorLike = isDirectorLikeProjectWorkgroup(group)
      const shouldUseAsPrimary =
        !existing ||
        (existingIsDirectorLike && !candidateIsDirectorLike) ||
        (isDefault && existingIsDirectorLike === candidateIsDirectorLike)
      const href = group.teamWorkspaceId
        ? `/workspace/${group.teamWorkspaceId}/w`
        : `/workspace/${workspaceId}/home`
      if (shouldUseAsPrimary) {
        groups.set(group.organizationId, {
          canManageProject: group.organization.canManageProject,
          estimatedDueAt: group.organization.estimatedDueAt,
          id: group.organization.id,
          name: group.organization.name,
          logoUrl: group.organization.logo,
          primaryWorkgroupId: group.id,
          primaryWorkgroupName: group.name,
          phases: group.organization.phases,
          disciplineName: group.discipline.name,
          role: group.role,
          teamWorkspaceId: group.teamWorkspaceId,
          teamCount: existing ? existing.teamCount + 1 : 1,
          memberCount: existing ? existing.memberCount + group.memberCount : group.memberCount,
          projectStatus: group.organization.projectStatus,
          taskStats: group.organization.taskStats,
          href,
        })
        continue
      }
      existing.teamCount += 1
      existing.memberCount += group.memberCount
      existing.canManageProject = existing.canManageProject || group.organization.canManageProject
      existing.role = existing.role === 'admin' || group.role === 'admin' ? 'admin' : 'member'
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }, [workgroups, workgroupsData?.defaultWorkgroupId, workspaceId])

  const createPersonalCanvas = useCallback(
    async (name: string) => {
      if (!activeWorkgroupId) return
      try {
        const result = await createPersonalWorkspace({ workgroupId: activeWorkgroupId, name })
        router.push(
          result.defaultWorkflowId
            ? `/workspace/${result.workspace.id}/w/${result.defaultWorkflowId}`
            : `/workspace/${result.workspace.id}/home`
        )
      } catch (error) {
        logger.error('Failed to create low-memory personal draft canvas', {
          error: error instanceof Error ? error.message : 'Unknown error',
          workgroupId: activeWorkgroupId,
        })
        throw error
      }
    },
    [activeWorkgroupId, createPersonalWorkspace, router]
  )

  const initializeTeamCanvas = useCallback(async () => {
    if (!activeWorkgroupId || !canInitializeTeamCanvas) return
    try {
      const result = await createTeamWorkspace({ workgroupId: activeWorkgroupId })
      router.push(
        result.defaultWorkflowId
          ? `/workspace/${result.workspace.id}/w/${result.defaultWorkflowId}`
          : `/workspace/${result.workspace.id}/home`
      )
    } catch (error) {
      logger.error('Failed to initialize low-memory team canvas', {
        error: error instanceof Error ? error.message : 'Unknown error',
        workgroupId: activeWorkgroupId,
      })
      throw error
    }
  }, [activeWorkgroupId, canInitializeTeamCanvas, createTeamWorkspace, router])

  const switchWorkgroup = useCallback(
    async (targetWorkgroupId: string) => {
      if (!targetWorkgroupId || targetWorkgroupId === activeWorkgroupId) return
      const targetWorkgroup = workgroups.find((workgroup) => workgroup.id === targetWorkgroupId)
      if (!targetWorkgroup) return

      await setActiveWorkgroup(targetWorkgroupId)
      const targetPersonalWorkspace = workspaces.find(
        (workspace) =>
          workspace.canvasScope === 'personal' && workspace.workgroupId === targetWorkgroupId
      )
      const targetWorkspaceId =
        targetPersonalWorkspace?.id || targetWorkgroup.teamWorkspaceId || workspaceId
      router.push(`/workspace/${targetWorkspaceId}/home`)
    },
    [activeWorkgroupId, router, setActiveWorkgroup, workgroups, workspaces, workspaceId]
  )

  const openProjectWorkspace = useCallback(
    async (targetWorkgroupId: string) => {
      const targetWorkgroup = workgroups.find((workgroup) => workgroup.id === targetWorkgroupId)
      if (!targetWorkgroup) return

      await setActiveWorkgroup(targetWorkgroupId)
      if (targetWorkgroup.teamWorkspaceId) {
        router.push(`/workspace/${targetWorkgroup.teamWorkspaceId}/w`)
        return
      }

      const targetWorkspaceId =
        workspaces.find(
          (workspace) =>
            workspace.canvasScope === 'personal' && workspace.workgroupId === targetWorkgroupId
        )?.id || workspaceId
      router.push(`/workspace/${targetWorkspaceId}/home`)
    },
    [router, setActiveWorkgroup, workgroups, workspaces, workspaceId]
  )

  const openProjectTask = useCallback(
    async (targetWorkgroupId: string, taskId: string) => {
      const targetWorkgroup = workgroups.find((workgroup) => workgroup.id === targetWorkgroupId)
      if (!targetWorkgroup?.teamWorkspaceId) return

      await setActiveWorkgroup(targetWorkgroupId)
      router.push(
        `/workspace/${targetWorkgroup.teamWorkspaceId}/showcase?tab=tasks&taskId=${taskId}`
      )
    },
    [router, setActiveWorkgroup, workgroups]
  )

  return {
    activeWorkspace,
    activePersonalDraftWorkspace,
    activeWorkgroup,
    activeWorkgroupId,
    canCreatePersonalCanvas,
    canInitializeTeamCanvas,
    createPersonalCanvas,
    initializeTeamCanvas,
    isCreatingPersonalWorkspace,
    isCreatingTeamWorkspace,
    isLoading: isWorkspacesLoading || isWorkgroupsLoading,
    isProjectAdmin,
    isSettingActiveWorkgroup,
    canvasContext,
    personalDraftWorkspaces,
    personalHref,
    personalWorkspaceId,
    projectEntries,
    showcaseHref: `/workspace/${teamScopedWorkspaceId}/showcase`,
    splitHref: `/workspace/${teamScopedWorkspaceId}/split`,
    switchWorkgroup,
    openProjectWorkspace,
    openProjectTask,
    teamHref,
    teamManagementHref: `/workspace/${teamScopedWorkspaceId}/team-management`,
    teamWorkspaceId,
    projectAdminHref: `/workspace/${teamScopedWorkspaceId}/project-admin`,
    workgroups,
  }
}
