import type { Workspace } from '@/hooks/queries/workspace'
import { selectPreferredProjectWorkgroup } from '@/app/workspace/project-workgroup-routing'

interface WorkgroupLandingSummary {
  discipline?: {
    agentCode?: string | null
    code?: string | null
  } | null
  id: string
  organizationId?: string | null
  role?: string | null
  teamWorkspaceId?: string | null
}

interface SelectCanvasLandingTargetInput {
  workspaces: Workspace[]
  workgroups: WorkgroupLandingSummary[]
  defaultWorkgroupId: string | null
  localRecentWorkspaceId: string | null
  lastActiveWorkspaceId: string | null
}

/**
 * Chooses the canvas `/workspace` should open without exposing the legacy workspace model.
 */
export function selectCanvasLandingTarget({
  workspaces,
  workgroups,
  defaultWorkgroupId,
  localRecentWorkspaceId,
  lastActiveWorkspaceId,
}: SelectCanvasLandingTargetInput): Workspace | undefined {
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  const findWorkspace = (id: string | null | undefined) => (id ? workspaceById.get(id) : undefined)
  const findWorkgroupForWorkspace = (workspace?: Workspace) =>
    workspace
      ? workgroups.find(
          (workgroup) =>
            workgroup.teamWorkspaceId === workspace.id || workgroup.id === workspace.workgroupId
        )
      : undefined
  const normalizeProjectWorkspace = (workspace?: Workspace) => {
    if (!workspace) return undefined
    const workspaceWorkgroup = findWorkgroupForWorkspace(workspace)
    if (!workspaceWorkgroup?.organizationId) return workspace
    const preferredWorkgroup = selectPreferredProjectWorkgroup({
      defaultWorkgroupId,
      organizationId: workspaceWorkgroup.organizationId,
      workgroups,
    })
    if (!preferredWorkgroup || preferredWorkgroup.id === workspaceWorkgroup.id) return workspace
    return findWorkspace(preferredWorkgroup.teamWorkspaceId) ?? workspace
  }

  const recentCanvas = normalizeProjectWorkspace(findWorkspace(localRecentWorkspaceId))
  if (recentCanvas) return recentCanvas

  const lastActiveCanvas = normalizeProjectWorkspace(findWorkspace(lastActiveWorkspaceId))
  if (lastActiveCanvas) return lastActiveCanvas

  const storedDefaultWorkgroup =
    workgroups.find((workgroup) => workgroup.id === defaultWorkgroupId) ?? workgroups[0]
  const defaultWorkgroup =
    selectPreferredProjectWorkgroup({
      defaultWorkgroupId,
      organizationId: storedDefaultWorkgroup?.organizationId,
      workgroups,
    }) ?? storedDefaultWorkgroup

  const defaultTeamCanvas = findWorkspace(defaultWorkgroup?.teamWorkspaceId)
  if (defaultTeamCanvas) return defaultTeamCanvas

  const defaultPersonalCanvas = workspaces.find(
    (workspace) =>
      workspace.canvasScope === 'personal' && workspace.workgroupId === defaultWorkgroup?.id
  )
  if (defaultPersonalCanvas) return defaultPersonalCanvas

  return (
    workspaces.find((workspace) => workspace.canvasScope === 'team') ??
    workspaces.find((workspace) => workspace.canvasScope === 'personal') ??
    workspaces.find((workspace) => !workspace.isInternalWorkspace) ??
    workspaces[0]
  )
}
