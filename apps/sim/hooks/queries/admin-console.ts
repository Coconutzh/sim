import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput, ContractQueryInput } from '@/lib/api/contracts'
import {
  type AdminConsoleModelService,
  type AdminConsoleProviderKey,
  type AdminConsoleUser,
  type AdminConsoleUserDetail,
  type AdminConsoleUserMembershipsResponse,
  adminConsoleApplyCreditsContract,
  adminConsoleAuditEventsContract,
  adminConsoleCreateProviderKeyContract,
  adminConsoleCreateUserContract,
  adminConsoleGetUserContract,
  adminConsoleListModelServicesContract,
  adminConsoleListProviderKeysContract,
  adminConsoleListUsersContract,
  adminConsoleSetOrganizationMembershipContract,
  adminConsoleSetWorkgroupMembershipContract,
  adminConsoleUpdateProviderKeyContract,
  adminConsoleUpdateUserContract,
  adminConsoleUpsertModelServiceContract,
  adminConsoleUsageContract,
  adminConsoleUserMembershipsContract,
} from '@/lib/api/contracts/admin-console'

export type {
  AdminConsoleProviderKey,
  AdminConsoleModelService,
  AdminConsoleUser,
  AdminConsoleUserDetail,
  AdminConsoleUserMembershipsResponse,
}

export const adminConsoleKeys = {
  all: ['admin-console'] as const,
  users: () => [...adminConsoleKeys.all, 'users'] as const,
  userLists: () => [...adminConsoleKeys.users(), 'lists'] as const,
  userList: (query: ContractQueryInput<typeof adminConsoleListUsersContract>) =>
    [...adminConsoleKeys.userLists(), query] as const,
  userDetails: () => [...adminConsoleKeys.users(), 'details'] as const,
  userDetail: (id: string) => [...adminConsoleKeys.userDetails(), id] as const,
  userMemberships: (id: string) => [...adminConsoleKeys.users(), 'memberships', id] as const,
  providerKeys: () => [...adminConsoleKeys.all, 'provider-keys'] as const,
  providerKeyLists: () => [...adminConsoleKeys.providerKeys(), 'lists'] as const,
  providerKeyList: () => [...adminConsoleKeys.providerKeyLists()] as const,
  modelServices: () => [...adminConsoleKeys.all, 'model-services'] as const,
  modelServiceLists: () => [...adminConsoleKeys.modelServices(), 'lists'] as const,
  modelServiceList: () => [...adminConsoleKeys.modelServiceLists()] as const,
  usageLists: () => [...adminConsoleKeys.all, 'usage', 'lists'] as const,
  usageList: (query: ContractQueryInput<typeof adminConsoleUsageContract>) =>
    [...adminConsoleKeys.usageLists(), query] as const,
  auditEventLists: () => [...adminConsoleKeys.all, 'audit-events', 'lists'] as const,
  auditEventList: (query: ContractQueryInput<typeof adminConsoleAuditEventsContract>) =>
    [...adminConsoleKeys.auditEventLists(), query] as const,
}

export function useAdminConsoleUsers(
  query: ContractQueryInput<typeof adminConsoleListUsersContract>
) {
  return useQuery({
    queryKey: adminConsoleKeys.userList(query),
    queryFn: ({ signal }) => requestJson(adminConsoleListUsersContract, { query, signal }),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useAdminConsoleUser(id?: string) {
  return useQuery({
    queryKey: adminConsoleKeys.userDetail(id ?? ''),
    queryFn: ({ signal }) =>
      requestJson(adminConsoleGetUserContract, { params: { id: id as string }, signal }),
    enabled: Boolean(id),
    staleTime: 30 * 1000,
  })
}

export function useUpdateAdminConsoleUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      userId,
      ...body
    }: { userId: string } & ContractBodyInput<typeof adminConsoleUpdateUserContract>) =>
      requestJson(adminConsoleUpdateUserContract, {
        params: { id: userId },
        body,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: adminConsoleKeys.userLists() })
      queryClient.invalidateQueries({ queryKey: adminConsoleKeys.userDetail(variables.userId) })
      queryClient.invalidateQueries({ queryKey: adminConsoleKeys.auditEventLists() })
    },
  })
}

export function useCreateAdminConsoleUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (body: ContractBodyInput<typeof adminConsoleCreateUserContract>) =>
      requestJson(adminConsoleCreateUserContract, { body }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminConsoleKeys.userLists() })
      queryClient.invalidateQueries({ queryKey: adminConsoleKeys.auditEventLists() })
    },
  })
}

export function useAdminConsoleUserMemberships(userId?: string) {
  return useQuery({
    queryKey: adminConsoleKeys.userMemberships(userId ?? ''),
    queryFn: ({ signal }) =>
      requestJson(adminConsoleUserMembershipsContract, {
        params: { id: userId as string },
        signal,
      }),
    enabled: Boolean(userId),
    staleTime: 30 * 1000,
  })
}

export function useSetAdminConsoleOrganizationMembership() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      userId,
      ...body
    }: { userId: string } & ContractBodyInput<
      typeof adminConsoleSetOrganizationMembershipContract
    >) =>
      requestJson(adminConsoleSetOrganizationMembershipContract, {
        params: { id: userId },
        body,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: adminConsoleKeys.userMemberships(variables.userId),
      })
      queryClient.invalidateQueries({ queryKey: adminConsoleKeys.userDetail(variables.userId) })
      queryClient.invalidateQueries({ queryKey: adminConsoleKeys.auditEventLists() })
    },
  })
}

export function useSetAdminConsoleWorkgroupMembership() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      userId,
      ...body
    }: { userId: string } & ContractBodyInput<typeof adminConsoleSetWorkgroupMembershipContract>) =>
      requestJson(adminConsoleSetWorkgroupMembershipContract, {
        params: { id: userId },
        body,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: adminConsoleKeys.userMemberships(variables.userId),
      })
      queryClient.invalidateQueries({ queryKey: adminConsoleKeys.auditEventLists() })
    },
  })
}

export function useApplyAdminConsoleCredits() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      userId,
      ...body
    }: { userId: string } & ContractBodyInput<typeof adminConsoleApplyCreditsContract>) =>
      requestJson(adminConsoleApplyCreditsContract, {
        params: { id: userId },
        body,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: adminConsoleKeys.userLists() })
      queryClient.invalidateQueries({ queryKey: adminConsoleKeys.userDetail(variables.userId) })
      queryClient.invalidateQueries({ queryKey: adminConsoleKeys.auditEventLists() })
    },
  })
}

export function useAdminConsoleProviderKeys() {
  return useQuery({
    queryKey: adminConsoleKeys.providerKeyList(),
    queryFn: ({ signal }) => requestJson(adminConsoleListProviderKeysContract, { signal }),
    staleTime: 30 * 1000,
  })
}

export function useCreateAdminConsoleProviderKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (body: ContractBodyInput<typeof adminConsoleCreateProviderKeyContract>) =>
      requestJson(adminConsoleCreateProviderKeyContract, { body }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminConsoleKeys.providerKeyLists() })
      queryClient.invalidateQueries({ queryKey: adminConsoleKeys.auditEventLists() })
    },
  })
}

export function useUpdateAdminConsoleProviderKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      keyId,
      ...body
    }: { keyId: string } & ContractBodyInput<typeof adminConsoleUpdateProviderKeyContract>) =>
      requestJson(adminConsoleUpdateProviderKeyContract, {
        params: { id: keyId },
        body,
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminConsoleKeys.providerKeyLists() })
      queryClient.invalidateQueries({ queryKey: adminConsoleKeys.auditEventLists() })
    },
  })
}

export function useAdminConsoleModelServices() {
  return useQuery({
    queryKey: adminConsoleKeys.modelServiceList(),
    queryFn: ({ signal }) => requestJson(adminConsoleListModelServicesContract, { signal }),
    staleTime: 30 * 1000,
  })
}

export function useUpsertAdminConsoleModelService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (body: ContractBodyInput<typeof adminConsoleUpsertModelServiceContract>) =>
      requestJson(adminConsoleUpsertModelServiceContract, { body }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminConsoleKeys.modelServiceLists() })
    },
  })
}

export function useAdminConsoleUsage(query: ContractQueryInput<typeof adminConsoleUsageContract>) {
  return useQuery({
    queryKey: adminConsoleKeys.usageList(query),
    queryFn: ({ signal }) => requestJson(adminConsoleUsageContract, { query, signal }),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useAdminConsoleAuditEvents(
  query: ContractQueryInput<typeof adminConsoleAuditEventsContract>
) {
  return useQuery({
    queryKey: adminConsoleKeys.auditEventList(query),
    queryFn: ({ signal }) => requestJson(adminConsoleAuditEventsContract, { query, signal }),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}
