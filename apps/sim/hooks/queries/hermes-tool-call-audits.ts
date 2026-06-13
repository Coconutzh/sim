import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ListHermesToolCallAuditsQueryInput,
  listHermesToolCallAuditsContract,
} from '@/lib/api/contracts/hermes-tool-call-audits'

export const hermesToolCallAuditKeys = {
  all: ['hermes-tool-call-audits'] as const,
  organizations: () => [...hermesToolCallAuditKeys.all, 'organizations'] as const,
  organization: (organizationId?: string) =>
    [...hermesToolCallAuditKeys.organizations(), organizationId ?? ''] as const,
  lists: (organizationId?: string) =>
    [...hermesToolCallAuditKeys.organization(organizationId), 'list'] as const,
  list: (organizationId?: string, query?: ListHermesToolCallAuditsQueryInput) =>
    [...hermesToolCallAuditKeys.lists(organizationId), query ?? {}] as const,
}

export function useHermesToolCallAudits(
  organizationId?: string,
  query: ListHermesToolCallAuditsQueryInput = {}
) {
  return useQuery({
    queryKey: hermesToolCallAuditKeys.list(organizationId, query),
    queryFn: ({ signal }) =>
      requestJson(listHermesToolCallAuditsContract, {
        params: { id: organizationId as string },
        query,
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: 20 * 1000,
    placeholderData: keepPreviousData,
  })
}
