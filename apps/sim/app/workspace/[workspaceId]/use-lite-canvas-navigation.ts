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
      (workgroup) => workgroup.currentUserRole === 'org_admin'
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

  return {
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
    personalDraftWorkspaces,
    personalHref,
    personalWorkspaceId,
    showcaseHref: `/workspace/${teamScopedWorkspaceId}/showcase`,
    splitHref: `/workspace/${teamScopedWorkspaceId}/split`,
    switchWorkgroup,
    teamHref,
    teamManagementHref: `/workspace/${teamScopedWorkspaceId}/team-management`,
    teamWorkspaceId,
    projectAdminHref: `/workspace/${teamScopedWorkspaceId}/project-admin`,
    workgroups,
  }
}
