import { useMutation, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreateProductionProjectBody,
  createProductionProjectContract,
  type UpdateProductionProjectBody,
  updateProductionProjectContract,
} from '@/lib/api/contracts/production-projects'
import { collaborationKeys } from '@/hooks/queries/collaboration'
import { workspaceKeys } from '@/hooks/queries/workspace'

export const productionProjectKeys = {
  all: ['production-projects'] as const,
  details: () => [...productionProjectKeys.all, 'detail'] as const,
  detail: (organizationId?: string) =>
    [...productionProjectKeys.details(), organizationId ?? ''] as const,
}

export function useCreateProductionProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateProductionProjectBody) =>
      requestJson(createProductionProjectContract, { body }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.myWorkgroups() })
      queryClient.invalidateQueries({ queryKey: collaborationKeys.organizationWorkgroupLists() })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
    },
  })
}

export function useUpdateProductionProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { organizationId: string } & UpdateProductionProjectBody) => {
      const { organizationId, ...body } = variables
      return requestJson(updateProductionProjectContract, {
        params: { organizationId },
        body,
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.myWorkgroups() })
      queryClient.invalidateQueries({
        queryKey: collaborationKeys.organizationWorkgroups(variables.organizationId),
      })
      queryClient.invalidateQueries({
        queryKey: productionProjectKeys.detail(variables.organizationId),
      })
    },
  })
}
