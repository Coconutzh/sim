import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type HermesHealthQueryInput,
  hermesAdminHealthContract,
} from '@/lib/api/contracts/hermes-health'

export const hermesHealthKeys = {
  all: ['hermes-health'] as const,
  organizations: () => [...hermesHealthKeys.all, 'organizations'] as const,
  organization: (organizationId?: string) =>
    [...hermesHealthKeys.organizations(), organizationId ?? ''] as const,
  details: (organizationId?: string) =>
    [...hermesHealthKeys.organization(organizationId), 'detail'] as const,
  detail: (organizationId?: string, query?: HermesHealthQueryInput) =>
    [...hermesHealthKeys.details(organizationId), query ?? {}] as const,
}

export function useHermesHealth(
  organizationId?: string,
  query: HermesHealthQueryInput = { includeToolsets: true }
) {
  return useQuery({
    queryKey: hermesHealthKeys.detail(organizationId, query),
    queryFn: ({ signal }) =>
      requestJson(hermesAdminHealthContract, {
        params: { id: organizationId as string },
        query,
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: 15 * 1000,
    placeholderData: keepPreviousData,
  })
}
