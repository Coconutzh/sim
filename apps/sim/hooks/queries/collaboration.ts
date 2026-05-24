import type { QueryClient } from '@tanstack/react-query'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { WorkspacesResponse } from '@/lib/api/contracts'
import {
  addWorkgroupMemberContract,
  archiveWorkgroupContract,
  type BatchAddWorkgroupMembersBody,
  batchAddWorkgroupMembersContract,
  type CopySelectionBody,
  copySelectionContract,
  createOrganizationWorkgroupContract,
  createPersonalWorkspaceContract,
  createTeamWorkspaceContract,
  type DeliverPublicationNotificationsBody,
  deliverOrganizationPublicationNotificationsContract,
  getCopilotAgentProfileContract,
  getPersonalWorkspaceContract,
  getPublicationContract,
  getPublicationTreeContract,
  getTeamWorkspaceContract,
  getWorkgroupMembersContract,
  listAgentProfilesContract,
  listDisciplinesContract,
  listMyWorkgroupsContract,
  listOrganizationAgentSkillPoliciesContract,
  listOrganizationAgentTemplatesContract,
  listOrganizationProjectNotificationCenterContract,
  listOrganizationPublicationNotificationInboxContract,
  listOrganizationPublicationsContract,
  listOrganizationWorkgroupActivityContract,
  listOrganizationWorkgroupsContract,
  listShowcasePublicationsContract,
  listWorkgroupActivityContract,
  listWorkgroupAgentSkillsContract,
  type MarkProjectNotificationCenterReadBody,
  type MarkPublicationNotificationInboxReadBody,
  markOrganizationProjectNotificationCenterReadContract,
  markOrganizationPublicationNotificationInboxReadContract,
  type ProjectAdminFailureScope,
  type ProjectNotificationCenterQuery,
  type PublicationNotificationInboxQuery,
  type PublicationSummary,
  type RecordProjectAdminFailureBody,
  recordProjectAdminFailureContract,
  removeWorkgroupMemberContract,
  setActiveWorkgroupContract,
  type UpdateOrganizationAgentSkillPolicyBody,
  type UpdateOrganizationAgentTemplateBody,
  type UpdatePublicationReviewBody,
  updateOrganizationAgentSkillPolicyContract,
  updateOrganizationAgentTemplateContract,
  updatePublicationDetailsContract,
  updatePublicationLifecycleContract,
  updatePublicationReviewContract,
  updatePublicationVisibilityContract,
  updateWorkgroupAgentSkillContract,
  updateWorkgroupMemberContract,
} from '@/lib/api/contracts/collaboration'
import { organizationKeys } from '@/hooks/queries/organization'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { type Workspace, workspaceKeys } from '@/hooks/queries/workspace'

export const collaborationKeys = {
  all: ['collaboration'] as const,
  disciplines: () => [...collaborationKeys.all, 'disciplines'] as const,
  agents: () => [...collaborationKeys.all, 'agents'] as const,
  me: () => [...collaborationKeys.all, 'me'] as const,
  organizations: () => [...collaborationKeys.all, 'organizations'] as const,
  organizationWorkgroupLists: () => [...collaborationKeys.organizations(), 'list'] as const,
  organizationWorkgroups: (organizationId?: string) =>
    [...collaborationKeys.organizationWorkgroupLists(), organizationId ?? ''] as const,
  organizationAgentTemplates: (organizationId?: string) =>
    [...collaborationKeys.organizations(), 'agent-templates', organizationId ?? ''] as const,
  organizationAgentSkills: (organizationId?: string, agentCode?: string) =>
    [
      ...collaborationKeys.organizations(),
      'agent-skills',
      organizationId ?? '',
      agentCode ?? '',
    ] as const,
  organizationPublicationLists: () =>
    [...collaborationKeys.organizations(), 'publications'] as const,
  organizationPublicationList: (organizationId?: string, filters?: PublicationFilters) =>
    [
      ...collaborationKeys.organizationPublicationLists(),
      organizationId ?? '',
      filters ?? {},
    ] as const,
  organizationPublicationNotificationInbox: (
    organizationId?: string,
    query?: PublicationNotificationInboxQuery
  ) =>
    [
      ...collaborationKeys.organizationPublicationLists(),
      organizationId ?? '',
      'notification-inbox',
      query ?? {},
    ] as const,
  organizationProjectNotificationCenter: (
    organizationId?: string,
    query?: ProjectNotificationCenterQuery
  ) =>
    [
      ...collaborationKeys.organizations(),
      organizationId ?? '',
      'project-notification-center',
      query ?? {},
    ] as const,
  workgroups: () => [...collaborationKeys.all, 'workgroups'] as const,
  workgroupLists: () => [...collaborationKeys.workgroups(), 'list'] as const,
  myWorkgroups: () => [...collaborationKeys.workgroupLists(), 'me'] as const,
  workgroupDetails: () => [...collaborationKeys.workgroups(), 'detail'] as const,
  workgroup: (workgroupId?: string) =>
    [...collaborationKeys.workgroupDetails(), workgroupId ?? ''] as const,
  members: (workgroupId?: string) =>
    [...collaborationKeys.workgroup(workgroupId), 'members'] as const,
  activity: (workgroupId?: string) =>
    [...collaborationKeys.workgroup(workgroupId), 'activity'] as const,
  organizationActivity: (organizationId?: string, filters?: OrganizationWorkgroupActivityFilters) =>
    [
      ...collaborationKeys.organizationWorkgroups(organizationId),
      'activity',
      filters ?? {},
    ] as const,
  agentSkills: (workgroupId?: string) =>
    [...collaborationKeys.workgroup(workgroupId), 'agent-skills'] as const,
  personalWorkspace: (workgroupId?: string) =>
    [...collaborationKeys.workgroup(workgroupId), 'personal-workspace'] as const,
  teamWorkspace: (workgroupId?: string) =>
    [...collaborationKeys.workgroup(workgroupId), 'team-workspace'] as const,
  publications: () => [...collaborationKeys.all, 'publications'] as const,
  publicationLists: () => [...collaborationKeys.publications(), 'list'] as const,
  publicationList: (workgroupId?: string, filters?: PublicationFilters) =>
    [...collaborationKeys.publicationLists(), workgroupId ?? '', filters ?? {}] as const,
  publicationDetails: () => [...collaborationKeys.publications(), 'detail'] as const,
  publication: (publicationVersionId?: string) =>
    [...collaborationKeys.publicationDetails(), publicationVersionId ?? ''] as const,
  publicationTree: (publicationVersionId?: string) =>
    [...collaborationKeys.publication(publicationVersionId), 'tree'] as const,
  agentProfiles: () => [...collaborationKeys.agents(), 'profile'] as const,
  agentProfile: (workspaceId?: string) =>
    [...collaborationKeys.agentProfiles(), workspaceId ?? ''] as const,
}

function invalidateActiveWorkgroupQueries(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: collaborationKeys.myWorkgroups() }),
    queryClient.invalidateQueries({ queryKey: collaborationKeys.workgroupDetails() }),
    queryClient.invalidateQueries({ queryKey: collaborationKeys.publicationLists() }),
    queryClient.invalidateQueries({ queryKey: collaborationKeys.organizationPublicationLists() }),
    queryClient.invalidateQueries({ queryKey: collaborationKeys.agentProfiles() }),
  ])
}

export interface PublicationFilters {
  disciplineCode?: string
  sourceWorkgroupId?: string
  agentCode?:
    | 'chief_director'
    | 'show_director'
    | 'stage_design'
    | 'visual'
    | 'broadcast_camera'
    | 'lighting_sound'
    | 'special_effects'
    | 'music'
    | 'props_costume'
    | 'production'
  limit?: number
  status?: 'draft' | 'published' | 'superseded' | 'archived' | 'retracted'
}

export interface OrganizationWorkgroupActivityFilters {
  workgroupId?: string
  disciplineId?: string
  action?: string
  failureScope?: ProjectAdminFailureScope
  search?: string
  actor?: string
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}

export function useDisciplines() {
  return useQuery({
    queryKey: collaborationKeys.disciplines(),
    queryFn: ({ signal }) => requestJson(listDisciplinesContract, { signal }),
    staleTime: 10 * 60 * 1000,
  })
}

export function useAgentProfiles() {
  return useQuery({
    queryKey: collaborationKeys.agents(),
    queryFn: ({ signal }) => requestJson(listAgentProfilesContract, { signal }),
    staleTime: 10 * 60 * 1000,
  })
}

export function useMyWorkgroups(enabled = true) {
  return useQuery({
    queryKey: collaborationKeys.myWorkgroups(),
    queryFn: ({ signal }) => requestJson(listMyWorkgroupsContract, { signal }),
    enabled,
    staleTime: 30 * 1000,
  })
}

export function useSetActiveWorkgroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (workgroupId: string) =>
      requestJson(setActiveWorkgroupContract, { body: { workgroupId } }),
    onSettled: () => {
      return invalidateActiveWorkgroupQueries(queryClient)
    },
  })
}

export function useOrganizationWorkgroups(organizationId?: string) {
  return useQuery({
    queryKey: collaborationKeys.organizationWorkgroups(organizationId),
    queryFn: ({ signal }) =>
      requestJson(listOrganizationWorkgroupsContract, {
        params: { id: organizationId as string },
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useCreateWorkgroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { organizationId: string; name: string; disciplineId: string }) =>
      requestJson(createOrganizationWorkgroupContract, {
        params: { id: variables.organizationId },
        body: { name: variables.name, disciplineId: variables.disciplineId },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.organizationWorkgroups(variables.organizationId),
      })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.myWorkgroups() })
    },
  })
}

export function useOrganizationAgentTemplates(organizationId?: string) {
  return useQuery({
    queryKey: collaborationKeys.organizationAgentTemplates(organizationId),
    queryFn: ({ signal }) =>
      requestJson(listOrganizationAgentTemplatesContract, {
        params: { id: organizationId as string },
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useUpdateOrganizationAgentTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { organizationId: string } & UpdateOrganizationAgentTemplateBody) =>
      requestJson(updateOrganizationAgentTemplateContract, {
        params: { id: variables.organizationId },
        body: {
          agentCode: variables.agentCode,
          projectInstructions: variables.projectInstructions,
        },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.organizationAgentTemplates(variables.organizationId),
      })
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.organizationActivity(variables.organizationId),
      })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.agentProfiles() })
    },
  })
}

export function useOrganizationAgentSkillPolicies(organizationId?: string, agentCode?: string) {
  return useQuery({
    queryKey: collaborationKeys.organizationAgentSkills(organizationId, agentCode),
    queryFn: ({ signal }) =>
      requestJson(listOrganizationAgentSkillPoliciesContract, {
        params: { id: organizationId as string },
        query: { agentCode },
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useUpdateOrganizationAgentSkillPolicy() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { organizationId: string } & UpdateOrganizationAgentSkillPolicyBody) =>
      requestJson(updateOrganizationAgentSkillPolicyContract, {
        params: { id: variables.organizationId },
        body: {
          agentCode: variables.agentCode,
          skillId: variables.skillId,
          enabled: variables.enabled,
        },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.organizationAgentSkills(
          variables.organizationId,
          variables.agentCode
        ),
      })
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.organizationActivity(variables.organizationId),
      })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.agentProfiles() })
    },
  })
}

export function useArchiveWorkgroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { workgroupId: string; organizationId?: string }) =>
      requestJson(archiveWorkgroupContract, {
        params: { workgroupId: variables.workgroupId },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.workgroupDetails() })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.myWorkgroups() })
      if (variables.organizationId) {
        queryClient.invalidateQueries({
          queryKey: collaborationKeys.organizationWorkgroups(variables.organizationId),
        })
        queryClient.invalidateQueries({
          queryKey: collaborationKeys.organizationActivity(variables.organizationId),
        })
      }
    },
  })
}

export function useWorkgroupMembers(workgroupId?: string) {
  return useQuery({
    queryKey: collaborationKeys.members(workgroupId),
    queryFn: ({ signal }) =>
      requestJson(getWorkgroupMembersContract, {
        params: { workgroupId: workgroupId as string },
        signal,
      }),
    enabled: Boolean(workgroupId),
    staleTime: 30 * 1000,
  })
}

export function useWorkgroupActivity(workgroupId?: string, limit = 10) {
  return useQuery({
    queryKey: [...collaborationKeys.activity(workgroupId), limit] as const,
    queryFn: ({ signal }) =>
      requestJson(listWorkgroupActivityContract, {
        params: { workgroupId: workgroupId as string },
        query: { limit },
        signal,
      }),
    enabled: Boolean(workgroupId),
    staleTime: 30 * 1000,
  })
}

export function fetchOrganizationWorkgroupActivity(
  organizationId: string,
  filters: OrganizationWorkgroupActivityFilters = {},
  signal?: AbortSignal
) {
  return requestJson(listOrganizationWorkgroupActivityContract, {
    params: { id: organizationId },
    query: filters,
    signal,
  })
}

export function useOrganizationWorkgroupActivity(
  organizationId?: string,
  filters: OrganizationWorkgroupActivityFilters = {}
) {
  return useQuery({
    queryKey: collaborationKeys.organizationActivity(organizationId, filters),
    queryFn: ({ signal }) =>
      fetchOrganizationWorkgroupActivity(organizationId as string, filters, signal),
    enabled: Boolean(organizationId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useAddWorkgroupMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: {
      workgroupId: string
      organizationId?: string
      userId?: string
      email?: string
      role: 'admin' | 'member'
    }) =>
      requestJson(addWorkgroupMemberContract, {
        params: { workgroupId: variables.workgroupId },
        body: { userId: variables.userId, email: variables.email, role: variables.role },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.members(variables.workgroupId) })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.activity(variables.workgroupId) })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.myWorkgroups() })
      if (variables.organizationId) {
        queryClient.invalidateQueries({
          queryKey: collaborationKeys.organizationActivity(variables.organizationId),
        })
        queryClient.invalidateQueries({
          queryKey: collaborationKeys.organizationWorkgroups(variables.organizationId),
        })
        queryClient.invalidateQueries({
          queryKey: organizationKeys.roster(variables.organizationId),
        })
      }
    },
  })
}

export function useBatchAddWorkgroupMembers() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: {
      workgroupId: string
      organizationId?: string
      targets: BatchAddWorkgroupMembersBody['targets']
      role: 'admin' | 'member'
    }) =>
      requestJson(batchAddWorkgroupMembersContract, {
        params: { workgroupId: variables.workgroupId },
        body: { targets: variables.targets, role: variables.role },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.members(variables.workgroupId) })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.activity(variables.workgroupId) })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.myWorkgroups() })
      if (variables.organizationId) {
        queryClient.invalidateQueries({
          queryKey: collaborationKeys.organizationActivity(variables.organizationId),
        })
        queryClient.invalidateQueries({
          queryKey: collaborationKeys.organizationWorkgroups(variables.organizationId),
        })
        queryClient.invalidateQueries({
          queryKey: organizationKeys.roster(variables.organizationId),
        })
      }
    },
  })
}

export function useUpdateWorkgroupMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { workgroupId: string; userId: string; role: 'admin' | 'member' }) =>
      requestJson(updateWorkgroupMemberContract, {
        params: { workgroupId: variables.workgroupId, userId: variables.userId },
        body: { role: variables.role },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.members(variables.workgroupId) })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.activity(variables.workgroupId) })
    },
  })
}

export function useRemoveWorkgroupMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { workgroupId: string; userId: string }) =>
      requestJson(removeWorkgroupMemberContract, {
        params: { workgroupId: variables.workgroupId, userId: variables.userId },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.members(variables.workgroupId) })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.activity(variables.workgroupId) })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.myWorkgroups() })
    },
  })
}

export function useWorkgroupAgentSkills(workgroupId?: string) {
  return useQuery({
    queryKey: collaborationKeys.agentSkills(workgroupId),
    queryFn: ({ signal }) =>
      requestJson(listWorkgroupAgentSkillsContract, {
        params: { workgroupId: workgroupId as string },
        signal,
      }),
    enabled: Boolean(workgroupId),
    staleTime: 30 * 1000,
  })
}

export function useUpdateWorkgroupAgentSkill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { workgroupId: string; skillId: string; enabled: boolean }) =>
      requestJson(updateWorkgroupAgentSkillContract, {
        params: { workgroupId: variables.workgroupId },
        body: { skillId: variables.skillId, enabled: variables.enabled },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.agentSkills(variables.workgroupId),
      })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.activity(variables.workgroupId) })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.agentProfiles() })
    },
  })
}

export function usePersonalWorkspace(workgroupId?: string) {
  return useQuery({
    queryKey: collaborationKeys.personalWorkspace(workgroupId),
    queryFn: ({ signal }) =>
      requestJson(getPersonalWorkspaceContract, {
        params: { workgroupId: workgroupId as string },
        signal,
      }),
    enabled: Boolean(workgroupId),
    staleTime: 30 * 1000,
  })
}

export function useCreatePersonalWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { workgroupId: string; name: string }) =>
      requestJson(createPersonalWorkspaceContract, {
        params: { workgroupId: variables.workgroupId },
        body: { name: variables.name },
      }),
    onSuccess: (data, variables) => {
      const newWorkspace: Workspace = {
        ...data.workspace,
        canvasScope: 'personal',
        isInternalWorkspace: true,
        role: 'owner',
        permissions: 'admin',
        inviteMembersEnabled: false,
        inviteDisabledReason: null,
        inviteUpgradeRequired: false,
      }
      queryClient.setQueryData<WorkspacesResponse>(workspaceKeys.list('active'), (previous) => {
        if (!previous) {
          return { workspaces: [newWorkspace], lastActiveWorkspaceId: null, creationPolicy: null }
        }
        if (previous.workspaces.some((workspace) => workspace.id === newWorkspace.id)) {
          return previous
        }
        return { ...previous, workspaces: [newWorkspace, ...previous.workspaces] }
      })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.personalWorkspace(variables.workgroupId),
      })
    },
  })
}

export function useTeamWorkspace(workgroupId?: string) {
  return useQuery({
    queryKey: collaborationKeys.teamWorkspace(workgroupId),
    queryFn: ({ signal }) =>
      requestJson(getTeamWorkspaceContract, {
        params: { workgroupId: workgroupId as string },
        signal,
      }),
    enabled: Boolean(workgroupId),
    staleTime: 30 * 1000,
  })
}

export function useCreateTeamWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { workgroupId: string }) =>
      requestJson(createTeamWorkspaceContract, {
        params: { workgroupId: variables.workgroupId },
      }),
    onSuccess: (data, variables) => {
      const newWorkspace: Workspace = {
        ...data.workspace,
        canvasScope: 'team',
        isInternalWorkspace: true,
        role: 'admin',
        permissions: 'admin',
        inviteMembersEnabled: true,
        inviteDisabledReason: null,
        inviteUpgradeRequired: false,
      }
      queryClient.setQueryData<WorkspacesResponse>(workspaceKeys.list('active'), (previous) => {
        if (!previous) {
          return { workspaces: [newWorkspace], lastActiveWorkspaceId: null, creationPolicy: null }
        }
        if (previous.workspaces.some((workspace) => workspace.id === newWorkspace.id)) {
          return previous
        }
        return { ...previous, workspaces: [newWorkspace, ...previous.workspaces] }
      })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.myWorkgroups() })
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.teamWorkspace(variables.workgroupId),
      })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.activity(variables.workgroupId) })
    },
  })
}

export function useShowcasePublications(workgroupId?: string, filters?: PublicationFilters) {
  return useQuery({
    queryKey: collaborationKeys.publicationList(workgroupId, filters),
    queryFn: ({ signal }) =>
      requestJson(listShowcasePublicationsContract, {
        params: { workgroupId: workgroupId as string },
        query: filters ?? {},
        signal,
      }),
    enabled: Boolean(workgroupId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useOrganizationPublications(organizationId?: string, filters?: PublicationFilters) {
  return useQuery({
    queryKey: collaborationKeys.organizationPublicationList(organizationId, filters),
    queryFn: ({ signal }) =>
      requestJson(listOrganizationPublicationsContract, {
        params: { id: organizationId as string },
        query: filters ?? {},
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function usePublicationNotificationInbox(
  organizationId?: string,
  query: PublicationNotificationInboxQuery = {}
) {
  return useQuery({
    queryKey: collaborationKeys.organizationPublicationNotificationInbox(organizationId, query),
    queryFn: ({ signal }) =>
      requestJson(listOrganizationPublicationNotificationInboxContract, {
        params: { id: organizationId as string },
        query,
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useMarkPublicationNotificationInboxRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (
      variables: { organizationId: string } & MarkPublicationNotificationInboxReadBody
    ) =>
      requestJson(markOrganizationPublicationNotificationInboxReadContract, {
        params: { id: variables.organizationId },
        body: {
          notificationId: variables.notificationId,
          markAll: variables.markAll,
        },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.organizationPublicationNotificationInbox(
          variables.organizationId
        ),
      })
    },
  })
}

export function useProjectNotificationCenter(
  organizationId?: string,
  query: ProjectNotificationCenterQuery = {}
) {
  return useQuery({
    queryKey: collaborationKeys.organizationProjectNotificationCenter(organizationId, query),
    queryFn: ({ signal }) =>
      requestJson(listOrganizationProjectNotificationCenterContract, {
        params: { id: organizationId as string },
        query,
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useMarkProjectNotificationCenterRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { organizationId: string } & MarkProjectNotificationCenterReadBody) =>
      requestJson(markOrganizationProjectNotificationCenterReadContract, {
        params: { id: variables.organizationId },
        body: {
          notificationId: variables.notificationId,
          markAll: variables.markAll,
          kind: variables.kind,
        },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.organizationProjectNotificationCenter(variables.organizationId),
      })
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.organizationPublicationNotificationInbox(
          variables.organizationId
        ),
      })
    },
  })
}

export function useDeliverPublicationNotifications() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { organizationId: string } & DeliverPublicationNotificationsBody) => {
      const body: DeliverPublicationNotificationsBody = { channel: variables.channel }
      if (variables.projectName) body.projectName = variables.projectName
      if (variables.emailRecipients) body.emailRecipients = variables.emailRecipients
      if (variables.webhookUrl) body.webhookUrl = variables.webhookUrl
      return requestJson(deliverOrganizationPublicationNotificationsContract, {
        params: { id: variables.organizationId },
        body,
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.organizationActivity(variables.organizationId),
      })
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.organizationPublicationNotificationInbox(
          variables.organizationId
        ),
      })
    },
  })
}

export function useRecordProjectAdminFailureAudit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { organizationId: string } & RecordProjectAdminFailureBody) =>
      requestJson(recordProjectAdminFailureContract, {
        params: { id: variables.organizationId },
        body: {
          scope: variables.scope,
          operation: variables.operation,
          target: variables.target,
          message: variables.message,
        },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.organizationActivity(variables.organizationId),
      })
    },
  })
}

export function usePublication(publicationVersionId?: string) {
  return useQuery({
    queryKey: collaborationKeys.publication(publicationVersionId),
    queryFn: ({ signal }) =>
      requestJson(getPublicationContract, {
        params: { publicationVersionId: publicationVersionId as string },
        signal,
      }),
    enabled: Boolean(publicationVersionId),
    staleTime: 60 * 1000,
  })
}

export function usePublicationTree(publicationVersionId?: string) {
  return useQuery({
    queryKey: collaborationKeys.publicationTree(publicationVersionId),
    queryFn: ({ signal }) =>
      requestJson(getPublicationTreeContract, {
        params: { publicationVersionId: publicationVersionId as string },
        signal,
      }),
    enabled: Boolean(publicationVersionId),
    staleTime: 60 * 1000,
  })
}

export function useUpdatePublicationLifecycle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: {
      publicationVersionId: string
      action: 'archive' | 'retract' | 'restore'
      reason?: string
    }) =>
      requestJson(updatePublicationLifecycleContract, {
        params: { publicationVersionId: variables.publicationVersionId },
        body: { action: variables.action, reason: variables.reason },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.publicationLists() })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.organizationPublicationLists() })
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.publication(variables.publicationVersionId),
      })
    },
  })
}

export function useUpdatePublicationVisibility() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: {
      publicationVersionId: string
      visibility: 'organization' | 'selected_workgroups'
      targetWorkgroupIds?: string[]
      reason?: string
    }) =>
      requestJson(updatePublicationVisibilityContract, {
        params: { publicationVersionId: variables.publicationVersionId },
        body: {
          visibility: variables.visibility,
          targetWorkgroupIds: variables.targetWorkgroupIds ?? [],
          reason: variables.reason,
        },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.publicationLists() })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.organizationPublicationLists() })
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.publication(variables.publicationVersionId),
      })
    },
  })
}

export function useUpdatePublicationDetails() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: {
      publicationVersionId: string
      title: string
      description: string | null
      reason?: string
    }) =>
      requestJson(updatePublicationDetailsContract, {
        params: { publicationVersionId: variables.publicationVersionId },
        body: {
          title: variables.title,
          description: variables.description,
          reason: variables.reason,
        },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.publicationLists() })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.organizationPublicationLists() })
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.publication(variables.publicationVersionId),
      })
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.publicationTree(variables.publicationVersionId),
      })
    },
  })
}

export function useUpdatePublicationReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { publicationVersionId: string } & UpdatePublicationReviewBody) =>
      requestJson(updatePublicationReviewContract, {
        params: { publicationVersionId: variables.publicationVersionId },
        body: {
          reviewState: variables.reviewState,
          riskLevel: variables.riskLevel,
          reviewerUserId: variables.reviewerUserId,
          reason: variables.reason,
        },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.publicationLists() })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.organizationPublicationLists() })
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.publication(variables.publicationVersionId),
      })
    },
  })
}

export function useCopilotAgentProfile(workspaceId?: string) {
  return useQuery({
    queryKey: collaborationKeys.agentProfile(workspaceId),
    queryFn: ({ signal }) =>
      requestJson(getCopilotAgentProfileContract, {
        query: { workspaceId: workspaceId as string },
        signal,
      }),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

export function useCopySelection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { workflowId: string; body: CopySelectionBody }) =>
      requestJson(copySelectionContract, {
        params: { id: variables.workflowId },
        body: variables.body,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workflowKeys.state(variables.body.target.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: workflowKeys.list(variables.body.target.workspaceId),
      })
    },
  })
}

export type { PublicationSummary }
