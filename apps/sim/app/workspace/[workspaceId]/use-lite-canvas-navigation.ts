'use client'

import { useCallback, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
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
import {
  buildProjectWorkspaceEntries,
  type ProjectWorkspaceEntry,
} from '@/app/workspace/[workspaceId]/lite-canvas-projects'
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

interface UseLiteCanvasNavigationProps {
  workspaceId: string
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
    return buildProjectWorkspaceEntries({
      defaultWorkgroupId: workgroupsData?.defaultWorkgroupId,
      fallbackWorkspaceId: workspaceId,
      workgroups,
    })
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
