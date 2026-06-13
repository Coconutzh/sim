import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type DeleteHermesUserMemoryBody,
  deleteHermesUserMemoryContract,
  type ListHermesUserMemoriesQueryInput,
  listHermesUserMemoriesContract,
} from '@/lib/api/contracts/hermes-user-memories'

export const hermesUserMemoryKeys = {
  all: ['hermes-user-memories'] as const,
  organizations: () => [...hermesUserMemoryKeys.all, 'organizations'] as const,
  organization: (organizationId?: string) =>
    [...hermesUserMemoryKeys.organizations(), organizationId ?? ''] as const,
  lists: (organizationId?: string) =>
    [...hermesUserMemoryKeys.organization(organizationId), 'list'] as const,
  list: (organizationId?: string, query?: ListHermesUserMemoriesQueryInput) =>
    [...hermesUserMemoryKeys.lists(organizationId), query ?? {}] as const,
}

export function useHermesUserMemories(
  organizationId?: string,
  query: ListHermesUserMemoriesQueryInput = {}
) {
  return useQuery({
    queryKey: hermesUserMemoryKeys.list(organizationId, query),
    queryFn: ({ signal }) =>
      requestJson(listHermesUserMemoriesContract, {
        params: { id: organizationId as string },
        query,
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: 20 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useDeleteHermesUserMemory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: {
      memoryId: string
      organizationId: string
      body?: DeleteHermesUserMemoryBody
    }) =>
      requestJson(deleteHermesUserMemoryContract, {
        params: { id: variables.organizationId, memoryId: variables.memoryId },
        body: variables.body ?? {},
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: hermesUserMemoryKeys.lists(variables.organizationId),
      })
    },
  })
}
