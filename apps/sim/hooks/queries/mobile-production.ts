import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getMobileProjectContract,
  listMobileProjectsContract,
  type MobileTaskFilter,
} from '@/lib/api/contracts/mobile-production'
import {
  type CreateProductionTaskBody,
  createProductionTaskContract,
  getProductionTaskContract,
} from '@/lib/api/contracts/production-tasks'
import { productionTaskKeys } from '@/hooks/queries/production-tasks'

const MOBILE_STALE_TIME = 20 * 1000
const MOBILE_REFRESH_INTERVAL = 30 * 1000

export const mobileProductionKeys = {
  all: ['mobile-production'] as const,
  projects: () => [...mobileProductionKeys.all, 'projects'] as const,
  projectLists: () => [...mobileProductionKeys.projects(), 'list'] as const,
  projectList: () => [...mobileProductionKeys.projectLists()] as const,
  projectDetails: () => [...mobileProductionKeys.projects(), 'detail'] as const,
  projectDetail: (workspaceId?: string, taskFilter?: MobileTaskFilter) =>
    [...mobileProductionKeys.projectDetails(), workspaceId ?? '', taskFilter ?? 'all'] as const,
  taskDetails: () => [...mobileProductionKeys.all, 'tasks', 'detail'] as const,
  taskDetail: (workspaceId?: string, taskId?: string) =>
    [...mobileProductionKeys.taskDetails(), workspaceId ?? '', taskId ?? ''] as const,
}

export function useMobileProjects() {
  return useQuery({
    queryKey: mobileProductionKeys.projectList(),
    queryFn: ({ signal }) => requestJson(listMobileProjectsContract, { signal }),
    staleTime: MOBILE_STALE_TIME,
    refetchInterval: MOBILE_REFRESH_INTERVAL,
    refetchOnWindowFocus: true,
  })
}

export function useMobileProject(workspaceId?: string, taskFilter?: MobileTaskFilter) {
  return useQuery({
    queryKey: mobileProductionKeys.projectDetail(workspaceId, taskFilter),
    queryFn: ({ signal }) =>
      requestJson(getMobileProjectContract, {
        params: { workspaceId: workspaceId as string },
        query: { taskFilter, limit: 50, offset: 0 },
        signal,
      }),
    enabled: Boolean(workspaceId),
    staleTime: MOBILE_STALE_TIME,
    refetchInterval: MOBILE_REFRESH_INTERVAL,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  })
}

export function useMobileProductionTask(workspaceId?: string, taskId?: string) {
  return useQuery({
    queryKey: mobileProductionKeys.taskDetail(workspaceId, taskId),
    queryFn: ({ signal }) =>
      requestJson(getProductionTaskContract, {
        params: { taskId: taskId as string },
        query: { workspaceId: workspaceId as string },
        signal,
      }),
    enabled: Boolean(workspaceId && taskId),
    staleTime: MOBILE_STALE_TIME,
    refetchOnWindowFocus: true,
  })
}

export function useCreateMobileProductionTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateProductionTaskBody) =>
      requestJson(createProductionTaskContract, { body }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: mobileProductionKeys.projectLists() })
      queryClient.invalidateQueries({
        queryKey: mobileProductionKeys.projectDetails(),
      })
      queryClient.invalidateQueries({
        queryKey: productionTaskKeys.list(variables.workspaceId),
      })
    },
  })
}
