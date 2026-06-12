import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreateProductionShowcaseItemBody,
  createProductionShowcaseItemContract,
  getProductionShowcaseItemContract,
  listProductionShowcaseItemsContract,
  type ProductionShowcaseCategory,
  type UpdateProductionShowcaseItemBody,
  updateProductionShowcaseItemContract,
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
  details: () => [...productionShowcaseItemKeys.all, 'detail'] as const,
  detail: (itemId?: string, workspaceId?: string) =>
    [...productionShowcaseItemKeys.details(), itemId ?? '', workspaceId ?? ''] as const,
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

export function useProductionShowcaseItem(itemId?: string, workspaceId?: string) {
  return useQuery({
    queryKey: productionShowcaseItemKeys.detail(itemId, workspaceId),
    queryFn: ({ signal }) =>
      requestJson(getProductionShowcaseItemContract, {
        params: { itemId: itemId as string },
        query: { workspaceId: workspaceId as string },
        signal,
      }),
    enabled: Boolean(itemId && workspaceId),
    staleTime: 30 * 1000,
  })
}

export function useUpdateProductionShowcaseItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { itemId: string; body: UpdateProductionShowcaseItemBody }) =>
      requestJson(updateProductionShowcaseItemContract, {
        params: { itemId: variables.itemId },
        body: variables.body,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: productionShowcaseItemKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: productionShowcaseItemKeys.detail(variables.itemId, variables.body.workspaceId),
      })
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
