import type { WorkgroupSummary } from '@/lib/api/contracts/collaboration'
import type { ProductionProjectPhase } from '@/lib/api/contracts/production-projects'
import { shouldReplaceProjectPrimaryWorkgroup } from '@/app/workspace/project-workgroup-routing'

interface BuildProjectWorkspaceEntriesInput {
  defaultWorkgroupId?: string | null
  fallbackWorkspaceId: string
  workgroups: WorkgroupSummary[]
}

export interface ProjectWorkspaceEntry {
  canManageProject: boolean
  disciplineName: string
  estimatedDueAt: string | null
  href: string
  id: string
  logoUrl: string | null
  memberCount: number
  name: string
  phases: ProductionProjectPhase[]
  primaryWorkgroupId: string
  primaryWorkgroupName: string
  projectStatus: 'active' | 'completed'
  role: 'admin' | 'member'
  taskStats: {
    completed: number
    total: number
    unfinished: number
  }
  teamCount: number
  teamWorkspaceId: string
}

export function buildProjectWorkspaceEntries({
  defaultWorkgroupId,
  fallbackWorkspaceId,
  workgroups,
}: BuildProjectWorkspaceEntriesInput): ProjectWorkspaceEntry[] {
  const entries = new Map<string, ProjectWorkspaceEntry>()
  const primaryWorkgroups = new Map<string, WorkgroupSummary>()

  for (const workgroup of workgroups) {
    const existing = entries.get(workgroup.organizationId)
    const currentPrimary = primaryWorkgroups.get(workgroup.organizationId)
    const shouldUseAsPrimary =
      !existing ||
      !currentPrimary ||
      shouldReplaceProjectPrimaryWorkgroup({
        candidate: workgroup,
        current: currentPrimary,
        defaultWorkgroupId,
      })

    if (shouldUseAsPrimary) {
      const href = workgroup.teamWorkspaceId
        ? `/workspace/${workgroup.teamWorkspaceId}/w`
        : `/workspace/${fallbackWorkspaceId}/home`

      entries.set(workgroup.organizationId, {
        canManageProject:
          workgroup.organization.canManageProject || existing?.canManageProject === true,
        disciplineName: workgroup.discipline.name,
        estimatedDueAt: workgroup.organization.estimatedDueAt,
        href,
        id: workgroup.organization.id,
        logoUrl: workgroup.organization.logo,
        memberCount: (existing?.memberCount ?? 0) + workgroup.memberCount,
        name: workgroup.organization.name,
        phases: workgroup.organization.phases,
        primaryWorkgroupId: workgroup.id,
        primaryWorkgroupName: workgroup.name,
        projectStatus: workgroup.organization.projectStatus,
        role: existing?.role === 'admin' || workgroup.role === 'admin' ? 'admin' : 'member',
        taskStats: workgroup.organization.taskStats,
        teamCount: (existing?.teamCount ?? 0) + 1,
        teamWorkspaceId: workgroup.teamWorkspaceId,
      })
      primaryWorkgroups.set(workgroup.organizationId, workgroup)
      continue
    }

    existing.teamCount += 1
    existing.memberCount += workgroup.memberCount
    existing.canManageProject =
      existing.canManageProject || workgroup.organization.canManageProject
    existing.role = existing.role === 'admin' || workgroup.role === 'admin' ? 'admin' : 'member'
  }

  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}
