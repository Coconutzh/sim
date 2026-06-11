import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreateProductionShowcaseItemBody,
  createProductionShowcaseItemContract,
  listProductionShowcaseItemsContract,
  type ProductionShowcaseCategory,
  withdrawProductionShowcaseItemContract,
} from '@/lib/api/contracts/production-showcase-items'

export interface ProductionShowcaseItemFilters {
  category?: ProductionShowcaseCategory
  includeWithdrawn?: boolean
  limit?: number
}

export const productionShowcaseItemKeys = {
  all: ['production-showcase-items'] as const,
  lists: () => [...productionShowcaseItemKeys.all, 'list'] as const,
  list: (workspaceId?: string, filters?: ProductionShowcaseItemFilters) =>
    [...productionShowcaseItemKeys.lists(), workspaceId ?? '', filters ?? {}] as const,
}

export function useProductionShowcaseItems(
  workspaceId?: string,
  filters?: ProductionShowcaseItemFilters
) {
  return useQuery({
    queryKey: productionShowcaseItemKeys.list(workspaceId, filters),
    queryFn: ({ signal }) =>
      requestJson(listProductionShowcaseItemsContract, {
        query: {
          workspaceId: workspaceId as string,
          category: filters?.category,
          includeWithdrawn: filters?.includeWithdrawn,
          limit: filters?.limit,
        },
        signal,
      }),
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useCreateProductionShowcaseItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateProductionShowcaseItemBody) =>
      requestJson(createProductionShowcaseItemContract, { body }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: productionShowcaseItemKeys.lists() })
    },
  })
}

export function useWithdrawProductionShowcaseItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { itemId: string; workspaceId: string }) =>
      requestJson(withdrawProductionShowcaseItemContract, {
        params: { itemId: variables.itemId },
        body: { workspaceId: variables.workspaceId },
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: productionShowcaseItemKeys.lists() })
    },
  })
}
