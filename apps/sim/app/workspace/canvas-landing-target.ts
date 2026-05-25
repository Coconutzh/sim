import type { Workspace } from '@/hooks/queries/workspace'

interface WorkgroupLandingSummary {
  id: string
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

  const recentCanvas = findWorkspace(localRecentWorkspaceId)
  if (recentCanvas) return recentCanvas

  const lastActiveCanvas = findWorkspace(lastActiveWorkspaceId)
  if (lastActiveCanvas) return lastActiveCanvas

  const defaultWorkgroup =
    workgroups.find((workgroup) => workgroup.id === defaultWorkgroupId) ?? workgroups[0]

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
