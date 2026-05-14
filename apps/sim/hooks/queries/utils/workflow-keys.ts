export type WorkflowQueryScope = 'active' | 'archived' | 'all'

export const workflowKeys = {
  all: ['workflows'] as const,
  lists: () => [...workflowKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined, scope: WorkflowQueryScope = 'active') =>
    [...workflowKeys.lists(), workspaceId ?? '', scope] as const,
  tracks: () => [...workflowKeys.all, 'tracks'] as const,
  trackList: (workspaceId: string | undefined) =>
    [...workflowKeys.tracks(), workspaceId ?? ''] as const,
  publications: () => [...workflowKeys.all, 'publication'] as const,
  publication: (workflowId: string | undefined) =>
    [...workflowKeys.publications(), workflowId ?? ''] as const,
  publishedWorkgroups: () => [...workflowKeys.all, 'publishedWorkgroups'] as const,
  publishedWorkgroupList: (workgroupId: string | undefined) =>
    [...workflowKeys.publishedWorkgroups(), workgroupId ?? ''] as const,
  deploymentVersions: () => [...workflowKeys.all, 'deploymentVersion'] as const,
  deploymentVersion: (workflowId: string | undefined, version: number | undefined) =>
    [...workflowKeys.deploymentVersions(), workflowId ?? '', version ?? 0] as const,
  state: (workflowId: string | undefined) =>
    [...workflowKeys.all, 'state', workflowId ?? ''] as const,
}
