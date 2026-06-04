import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  createCopilotSkillCardContract,
  type CreateCopilotSkillCardBody,
  deleteCopilotSkillCardContract,
  listOrganizationCopilotSkillCardsContract,
  listRuntimeCopilotSkillCardsContract,
  type OrganizationCopilotSkillCardsQuery,
  type UpdateCopilotSkillCardBody,
  updateCopilotSkillCardContract,
} from '@/lib/api/contracts/copilot-skill-cards'

export const copilotSkillCardKeys = {
  all: ['copilot-skill-cards'] as const,
  runtimeLists: () => [...copilotSkillCardKeys.all, 'runtime-list'] as const,
  runtimeList: (workspaceId?: string) =>
    [...copilotSkillCardKeys.runtimeLists(), workspaceId ?? ''] as const,
  organizationLists: () => [...copilotSkillCardKeys.all, 'organization-list'] as const,
  organizationList: (organizationId?: string, query?: OrganizationCopilotSkillCardsQuery) =>
    [...copilotSkillCardKeys.organizationLists(), organizationId ?? '', query ?? {}] as const,
  details: () => [...copilotSkillCardKeys.all, 'detail'] as const,
  detail: (cardId?: string) => [...copilotSkillCardKeys.details(), cardId ?? ''] as const,
}

export function useCopilotSkillCards(workspaceId?: string) {
  return useQuery({
    queryKey: copilotSkillCardKeys.runtimeList(workspaceId),
    queryFn: ({ signal }) =>
      requestJson(listRuntimeCopilotSkillCardsContract, {
        query: { workspaceId: workspaceId as string },
        signal,
      }),
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useOrganizationCopilotSkillCards(
  organizationId?: string,
  query: OrganizationCopilotSkillCardsQuery = {}
) {
  return useQuery({
    queryKey: copilotSkillCardKeys.organizationList(organizationId, query),
    queryFn: ({ signal }) =>
      requestJson(listOrganizationCopilotSkillCardsContract, {
        params: { id: organizationId as string },
        query,
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useCreateCopilotSkillCard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { organizationId: string; body: CreateCopilotSkillCardBody }) =>
      requestJson(createCopilotSkillCardContract, {
        params: { id: variables.organizationId },
        body: variables.body,
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: copilotSkillCardKeys.organizationLists() })
      queryClient.invalidateQueries({ queryKey: copilotSkillCardKeys.runtimeLists() })
    },
  })
}

export function useUpdateCopilotSkillCard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { cardId: string; body: UpdateCopilotSkillCardBody }) =>
      requestJson(updateCopilotSkillCardContract, {
        params: { cardId: variables.cardId },
        body: variables.body,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: copilotSkillCardKeys.organizationLists() })
      queryClient.invalidateQueries({ queryKey: copilotSkillCardKeys.runtimeLists() })
      queryClient.invalidateQueries({ queryKey: copilotSkillCardKeys.detail(variables.cardId) })
    },
  })
}

export function useDeleteCopilotSkillCard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (cardId: string) =>
      requestJson(deleteCopilotSkillCardContract, {
        params: { cardId },
      }),
    onSettled: (_data, _error, cardId) => {
      queryClient.invalidateQueries({ queryKey: copilotSkillCardKeys.organizationLists() })
      queryClient.invalidateQueries({ queryKey: copilotSkillCardKeys.runtimeLists() })
      queryClient.removeQueries({ queryKey: copilotSkillCardKeys.detail(cardId) })
    },
  })
}
