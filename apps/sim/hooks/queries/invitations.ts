import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  acceptInvitationContract,
  type BatchInvitationResult as BatchInvitationResultContract,
  batchWorkspaceInvitationsContract,
  cancelInvitationContract,
  listMyPendingInvitationsContract,
  listWorkspaceInvitationsContract,
  type MyPendingInvitation,
  type PendingInvitationRow,
  rejectInvitationContract,
  removeWorkspaceMemberContract,
  resendInvitationContract,
} from '@/lib/api/contracts/invitations'
import { updateWorkspacePermissionsContract } from '@/lib/api/contracts/workspaces'
import { collaborationKeys } from '@/hooks/queries/collaboration'
import { workspaceCredentialKeys } from '@/hooks/queries/credentials'
import { organizationKeys } from '@/hooks/queries/organization'
import { workspaceKeys } from '@/hooks/queries/workspace'

export const invitationKeys = {
  all: ['invitations'] as const,
  lists: () => [...invitationKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...invitationKeys.lists(), workspaceId] as const,
  mine: () => [...invitationKeys.all, 'mine'] as const,
}

export type { PendingInvitationRow }
export type { MyPendingInvitation }

export interface WorkspaceInvitation {
  email: string
  permissionType: 'admin' | 'write' | 'read'
  isPendingInvitation: boolean
  isExternal: boolean
  invitationId?: string
  expiresAt?: string
  createdAt?: string
}

async function fetchPendingInvitations(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceInvitation[]> {
  const data = await requestJson(listWorkspaceInvitationsContract, { signal })

  return (
    data.invitations
      ?.filter(
        (inv: PendingInvitationRow) => inv.status === 'pending' && inv.workspaceId === workspaceId
      )
      .map((inv: PendingInvitationRow) => ({
        email: inv.email,
        permissionType: inv.permission,
        isPendingInvitation: true,
        isExternal: inv.membershipIntent === 'external',
        invitationId: inv.id,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
      })) || []
  )
}

/**
 * Fetches pending invitations for a workspace.
 * @param workspaceId - The workspace ID to fetch invitations for
 */
export function usePendingInvitations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: invitationKeys.list(workspaceId ?? ''),
    queryFn: ({ signal }) => fetchPendingInvitations(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useMyPendingInvitations() {
  return useQuery({
    queryKey: invitationKeys.mine(),
    queryFn: async ({ signal }) => {
      const data = await requestJson(listMyPendingInvitationsContract, { signal })
      return data.invitations
    },
    staleTime: 30 * 1000,
    refetchInterval: 10 * 1000,
  })
}

export function useAcceptMyInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (invitationId: string) => {
      return requestJson(acceptInvitationContract, {
        params: { id: invitationId },
        body: {},
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: invitationKeys.mine() })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.myWorkgroups() })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.workgroupLists() })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.agentProfiles() })
      queryClient.invalidateQueries({ queryKey: organizationKeys.all })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all })
    },
  })
}

export function useRejectMyInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (invitationId: string) => {
      return requestJson(rejectInvitationContract, {
        params: { id: invitationId },
        body: {},
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: invitationKeys.mine() })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.myWorkgroups() })
      queryClient.invalidateQueries({ queryKey: organizationKeys.all })
    },
  })
}

type BatchSendInvitationsParams = ContractBodyInput<typeof batchWorkspaceInvitationsContract> & {
  organizationId?: string | null
}

type BatchInvitationResult = Pick<BatchInvitationResultContract, 'successful' | 'failed'>

/**
 * Sends workspace invitations through the server-side batch endpoint.
 * Returns results for each invitation indicating success or failure.
 */
export function useBatchSendWorkspaceInvitations() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      invitations,
    }: BatchSendInvitationsParams): Promise<BatchInvitationResult> => {
      const result = await requestJson(batchWorkspaceInvitationsContract, {
        body: {
          workspaceId,
          invitations,
        },
      })

      return {
        successful: result.successful ?? [],
        failed: result.failed ?? [],
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: invitationKeys.list(variables.workspaceId),
      })
      if (variables.organizationId) {
        queryClient.invalidateQueries({
          queryKey: organizationKeys.roster(variables.organizationId),
        })
        queryClient.invalidateQueries({
          queryKey: organizationKeys.billing(variables.organizationId),
        })
      }
    },
  })
}

interface CancelInvitationParams {
  invitationId: string
  workspaceId: string
  organizationId?: string | null
}

/**
 * Cancels a pending workspace invitation.
 * Invalidates the invitation list cache on success.
 */
export function useCancelWorkspaceInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ invitationId }: CancelInvitationParams) => {
      return requestJson(cancelInvitationContract, {
        params: { id: invitationId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: invitationKeys.list(variables.workspaceId),
      })
      if (variables.organizationId) {
        queryClient.invalidateQueries({
          queryKey: organizationKeys.roster(variables.organizationId),
        })
        queryClient.invalidateQueries({
          queryKey: organizationKeys.billing(variables.organizationId),
        })
      }
    },
  })
}

interface ResendInvitationParams {
  invitationId: string
  workspaceId: string
}

/**
 * Resends a pending workspace invitation email.
 * Invalidates the invitation list cache on success.
 */
export function useResendWorkspaceInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ invitationId }: ResendInvitationParams) => {
      return requestJson(resendInvitationContract, {
        params: { id: invitationId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: invitationKeys.list(variables.workspaceId),
      })
    },
  })
}

type RemoveMemberParams = ContractBodyInput<typeof removeWorkspaceMemberContract> & {
  userId: string
  organizationId?: string | null
}

/**
 * Removes a member from a workspace.
 * Invalidates the workspace permissions cache on success.
 */
export function useRemoveWorkspaceMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, workspaceId }: RemoveMemberParams) => {
      return requestJson(removeWorkspaceMemberContract, {
        params: { id: userId },
        body: { workspaceId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.permissions(variables.workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.members(variables.workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.all,
      })
      if (variables.organizationId) {
        queryClient.invalidateQueries({
          queryKey: organizationKeys.roster(variables.organizationId),
        })
      }
    },
  })
}

type LeaveWorkspaceParams = ContractBodyInput<typeof removeWorkspaceMemberContract> & {
  userId: string
}

/**
 * Allows the current user to leave a workspace.
 * Invalidates both permissions and workspace list caches on success.
 */
export function useLeaveWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, workspaceId }: LeaveWorkspaceParams) => {
      return requestJson(removeWorkspaceMemberContract, {
        params: { id: userId },
        body: { workspaceId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.permissions(variables.workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.all,
      })
    },
  })
}

type UpdatePermissionsParams = {
  workspaceId: string
  organizationId?: string
} & ContractBodyInput<typeof updateWorkspacePermissionsContract>

export function useUpdateWorkspacePermissions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, updates }: UpdatePermissionsParams) => {
      return requestJson(updateWorkspacePermissionsContract, {
        params: { id: workspaceId },
        body: { updates },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.permissions(variables.workspaceId),
      })
      if (variables.organizationId) {
        queryClient.invalidateQueries({
          queryKey: organizationKeys.roster(variables.organizationId),
        })
      }
    },
  })
}
