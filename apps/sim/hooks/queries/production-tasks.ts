import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreateProductionTaskBody,
  type CreateProductionTaskMessageBody,
  createProductionTaskContract,
  createProductionTaskMessageContract,
  listProductionTaskMessagesContract,
  listProductionTasksContract,
  markProductionTaskReadContract,
  type ProductionTaskScope,
  type ProductionTaskStatus,
  type ReviewProductionTaskBody,
  reviewProductionTaskContract,
  type SubmitProductionTaskBody,
  submitProductionTaskContract,
  type UpdateProductionTaskBody,
  updateProductionTaskContract,
} from '@/lib/api/contracts/production-tasks'

export interface ProductionTaskFilters {
  workflowId?: string
  scope?: ProductionTaskScope
  status?: ProductionTaskStatus
  limit?: number
}

export const productionTaskKeys = {
  all: ['production-tasks'] as const,
  lists: () => [...productionTaskKeys.all, 'list'] as const,
  list: (workspaceId?: string, filters?: ProductionTaskFilters) =>
    [...productionTaskKeys.lists(), workspaceId ?? '', filters ?? {}] as const,
  details: () => [...productionTaskKeys.all, 'detail'] as const,
  detail: (taskId?: string) => [...productionTaskKeys.details(), taskId ?? ''] as const,
  messages: (taskId?: string) => [...productionTaskKeys.detail(taskId), 'messages'] as const,
}

export function useProductionTasks(workspaceId?: string, filters?: ProductionTaskFilters) {
  return useQuery({
    queryKey: productionTaskKeys.list(workspaceId, filters),
    queryFn: ({ signal }) =>
      requestJson(listProductionTasksContract, {
        query: {
          workspaceId: workspaceId as string,
          workflowId: filters?.workflowId,
          scope: filters?.scope,
          status: filters?.status,
          limit: filters?.limit,
        },
        signal,
      }),
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useCreateProductionTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateProductionTaskBody) =>
      requestJson(createProductionTaskContract, { body }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: productionTaskKeys.lists() })
    },
  })
}

export function useUpdateProductionTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { taskId: string; body: UpdateProductionTaskBody }) =>
      requestJson(updateProductionTaskContract, {
        params: { taskId: variables.taskId },
        body: variables.body,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: productionTaskKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: productionTaskKeys.detail(variables.taskId),
      })
    },
  })
}

export function useSubmitProductionTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { taskId: string } & SubmitProductionTaskBody) =>
      requestJson(submitProductionTaskContract, {
        params: { taskId: variables.taskId },
        body: {
          workspaceId: variables.workspaceId,
          workflowId: variables.workflowId,
          nodeId: variables.nodeId,
          submissionNote: variables.submissionNote,
          attachments: variables.attachments,
        },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: productionTaskKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: productionTaskKeys.detail(variables.taskId),
      })
    },
  })
}

export function useReviewProductionTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { taskId: string } & ReviewProductionTaskBody) =>
      requestJson(reviewProductionTaskContract, {
        params: { taskId: variables.taskId },
        body: {
          action: variables.action,
          reviewNote: variables.reviewNote,
        },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: productionTaskKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: productionTaskKeys.detail(variables.taskId),
      })
    },
  })
}

export function useProductionTaskMessages(taskId?: string) {
  return useQuery({
    queryKey: productionTaskKeys.messages(taskId),
    queryFn: ({ signal }) =>
      requestJson(listProductionTaskMessagesContract, {
        params: { taskId: taskId as string },
        signal,
      }),
    enabled: Boolean(taskId),
    staleTime: 15 * 1000,
    refetchInterval: 15 * 1000,
  })
}

export function useCreateProductionTaskMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { taskId: string; body: CreateProductionTaskMessageBody }) =>
      requestJson(createProductionTaskMessageContract, {
        params: { taskId: variables.taskId },
        body: variables.body,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: productionTaskKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: productionTaskKeys.messages(variables.taskId),
      })
    },
  })
}

export function useMarkProductionTaskRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) =>
      requestJson(markProductionTaskReadContract, {
        params: { taskId },
        body: {},
      }),
    onSettled: (_data, _error, taskId) => {
      queryClient.invalidateQueries({ queryKey: productionTaskKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: productionTaskKeys.messages(taskId),
      })
    },
  })
}
