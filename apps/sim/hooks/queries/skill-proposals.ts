import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  listSkillProposalsContract,
  publishSkillProposalContract,
  reviewSkillProposalContract,
  rollbackSkillRevisionContract,
  type SkillProposalListQueryInput,
  type SkillProposalPublishBody,
  type SkillProposalReviewBody,
  type SkillRollbackBody,
} from '@/lib/api/contracts/skill-proposals'
import { collaborationKeys } from '@/hooks/queries/collaboration'

export const skillProposalKeys = {
  all: ['skill-proposals'] as const,
  organizations: () => [...skillProposalKeys.all, 'organizations'] as const,
  organization: (organizationId?: string) =>
    [...skillProposalKeys.organizations(), organizationId ?? ''] as const,
  lists: (organizationId?: string) =>
    [...skillProposalKeys.organization(organizationId), 'list'] as const,
  list: (organizationId?: string, query?: SkillProposalListQueryInput) =>
    [...skillProposalKeys.lists(organizationId), query ?? {}] as const,
  details: (organizationId?: string) =>
    [...skillProposalKeys.organization(organizationId), 'detail'] as const,
  detail: (organizationId?: string, proposalId?: string) =>
    [...skillProposalKeys.details(organizationId), proposalId ?? ''] as const,
}

export function useSkillProposals(
  organizationId?: string,
  query: SkillProposalListQueryInput = {}
) {
  return useQuery({
    queryKey: skillProposalKeys.list(organizationId, query),
    queryFn: ({ signal }) =>
      requestJson(listSkillProposalsContract, {
        params: { id: organizationId as string },
        query,
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useReviewSkillProposal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: {
      organizationId: string
      proposalId: string
      body: SkillProposalReviewBody
    }) =>
      requestJson(reviewSkillProposalContract, {
        params: { id: variables.organizationId, proposalId: variables.proposalId },
        body: variables.body,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: skillProposalKeys.lists(variables.organizationId) })
      queryClient.invalidateQueries({
        queryKey: skillProposalKeys.detail(variables.organizationId, variables.proposalId),
      })
    },
  })
}

export function usePublishSkillProposal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: {
      organizationId: string
      proposalId: string
      body: SkillProposalPublishBody
    }) =>
      requestJson(publishSkillProposalContract, {
        params: { id: variables.organizationId, proposalId: variables.proposalId },
        body: variables.body,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: skillProposalKeys.lists(variables.organizationId) })
      queryClient.invalidateQueries({
        queryKey: skillProposalKeys.detail(variables.organizationId, variables.proposalId),
      })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.organizations() })
    },
  })
}

export function useRollbackSkillRevision() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { organizationId: string; skillId: string; body: SkillRollbackBody }) =>
      requestJson(rollbackSkillRevisionContract, {
        params: { id: variables.organizationId, skillId: variables.skillId },
        body: variables.body,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: skillProposalKeys.lists(variables.organizationId) })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.organizations() })
    },
  })
}
