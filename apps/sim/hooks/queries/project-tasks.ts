import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/emcn'
import { requestJson } from '@/lib/api/client/request'
import {
  archiveProjectTaskContract,
  type CreateProjectTaskBody,
  type CreateProjectTaskMessageBody,
  createProjectTaskContract,
  createProjectTaskMessageContract,
  getProjectTaskContract,
  type ListProjectTaskMessagesQueryInput,
  type ListProjectTasksQueryInput,
  listProjectTaskMessagesContract,
  listProjectTasksContract,
  type ProjectTaskEvent,
  type ProjectTaskEventsQueryInput,
  projectTaskEventsContract,
  type ReviewProjectTaskBody,
  reviewProjectTaskContract,
  type SubmitProjectTaskBody,
  submitProjectTaskContract,
  type UpdateProjectTaskBody,
  updateProjectTaskContract,
} from '@/lib/api/contracts/project-tasks'

const logger = createLogger('ProjectTaskQueries')

export const projectTaskKeys = {
  all: ['project-tasks'] as const,
  organizations: () => [...projectTaskKeys.all, 'organizations'] as const,
  lists: () => [...projectTaskKeys.organizations(), 'list'] as const,
  list: (organizationId?: string, query?: ListProjectTasksQueryInput) =>
    [...projectTaskKeys.lists(), organizationId ?? '', query ?? {}] as const,
  details: () => [...projectTaskKeys.all, 'detail'] as const,
  detail: (taskId?: string) => [...projectTaskKeys.details(), taskId ?? ''] as const,
  messages: () => [...projectTaskKeys.all, 'messages'] as const,
  messageList: (taskId?: string, query?: ListProjectTaskMessagesQueryInput) =>
    [...projectTaskKeys.messages(), taskId ?? '', query ?? {}] as const,
}

function invalidateProjectTaskQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  variables: { organizationId?: string; taskId?: string }
) {
  queryClient.invalidateQueries({ queryKey: projectTaskKeys.lists() })
  if (variables.taskId) {
    queryClient.invalidateQueries({ queryKey: projectTaskKeys.detail(variables.taskId) })
  }
}

export function useProjectTasks(params: {
  organizationId?: string
  query?: ListProjectTasksQueryInput
  enabled?: boolean
}) {
  return useQuery({
    queryKey: projectTaskKeys.list(params.organizationId, params.query),
    queryFn: ({ signal }) =>
      requestJson(listProjectTasksContract, {
        params: { id: params.organizationId as string },
        query: params.query as ListProjectTasksQueryInput,
        signal,
      }),
    enabled: Boolean(params.enabled ?? true) && Boolean(params.organizationId && params.query),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useProjectTask(taskId?: string) {
  return useQuery({
    queryKey: projectTaskKeys.detail(taskId),
    queryFn: ({ signal }) =>
      requestJson(getProjectTaskContract, {
        params: { taskId: taskId as string },
        signal,
      }),
    enabled: Boolean(taskId),
    staleTime: 30 * 1000,
  })
}

export function useCreateProjectTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { organizationId: string; body: CreateProjectTaskBody }) =>
      requestJson(createProjectTaskContract, {
        params: { id: variables.organizationId },
        body: variables.body,
      }),
    onSettled: (_data, _error, variables) => {
      invalidateProjectTaskQueries(queryClient, { organizationId: variables.organizationId })
    },
  })
}

export function useUpdateProjectTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { taskId: string; body: UpdateProjectTaskBody }) =>
      requestJson(updateProjectTaskContract, {
        params: { taskId: variables.taskId },
        body: variables.body,
      }),
    onSettled: (_data, _error, variables) => {
      invalidateProjectTaskQueries(queryClient, { taskId: variables.taskId })
    },
  })
}

export function useArchiveProjectTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { taskId: string }) =>
      requestJson(archiveProjectTaskContract, {
        params: { taskId: variables.taskId },
      }),
    onSettled: (_data, _error, variables) => {
      invalidateProjectTaskQueries(queryClient, { taskId: variables.taskId })
    },
  })
}

export function useSubmitProjectTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { taskId: string; body: SubmitProjectTaskBody }) =>
      requestJson(submitProjectTaskContract, {
        params: { taskId: variables.taskId },
        body: variables.body,
      }),
    onSettled: (_data, _error, variables) => {
      invalidateProjectTaskQueries(queryClient, { taskId: variables.taskId })
    },
  })
}

export function useReviewProjectTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { taskId: string; body: ReviewProjectTaskBody }) =>
      requestJson(reviewProjectTaskContract, {
        params: { taskId: variables.taskId },
        body: variables.body,
      }),
    onSettled: (_data, _error, variables) => {
      invalidateProjectTaskQueries(queryClient, { taskId: variables.taskId })
    },
  })
}

export function useProjectTaskMessages(params: {
  taskId?: string
  query?: ListProjectTaskMessagesQueryInput
  enabled?: boolean
}) {
  return useQuery({
    queryKey: projectTaskKeys.messageList(params.taskId, params.query),
    queryFn: ({ signal }) =>
      requestJson(listProjectTaskMessagesContract, {
        params: { taskId: params.taskId as string },
        query: params.query ?? {},
        signal,
      }),
    enabled: Boolean(params.enabled ?? true) && Boolean(params.taskId),
    staleTime: 15 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useCreateProjectTaskMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (variables: { taskId: string; body: CreateProjectTaskMessageBody }) =>
      requestJson(createProjectTaskMessageContract, {
        params: { taskId: variables.taskId },
        body: variables.body,
      }),
    onSettled: (_data, _error, variables) => {
      invalidateProjectTaskQueries(queryClient, { taskId: variables.taskId })
      queryClient.invalidateQueries({ queryKey: projectTaskKeys.messages() })
    },
  })
}

function buildProjectTaskEventsUrl(query: ProjectTaskEventsQueryInput): string {
  const params = new URLSearchParams()
  params.set('organizationId', query.organizationId)
  params.set('scope', query.scope ?? 'self')
  if (query.workgroupId) params.set('workgroupId', query.workgroupId)
  return `${projectTaskEventsContract.path}?${params.toString()}`
}

function readProjectTaskEvent(data: string): ProjectTaskEvent | null {
  try {
    const parsed = JSON.parse(data) as ProjectTaskEvent
    if (!parsed.taskId || !parsed.organizationId || !parsed.type) return null
    return parsed
  } catch (error) {
    logger.warn('Failed to parse project task event', { error })
    return null
  }
}

function notifyProjectTaskEvent(event: ProjectTaskEvent) {
  if (event.type === 'approved') {
    toast.success('任务已通过审核')
    return
  }
  if (event.type === 'rejected') {
    toast.error('任务已被驳回')
    return
  }
  if (event.type === 'submitted') {
    toast.success('任务已提交审核')
    return
  }
  if (event.type === 'created') {
    toast.success('收到新的项目任务')
    return
  }
  if (event.type === 'message_created') {
    toast.success('任务收到新消息')
    return
  }
  if (event.type === 'due_reminder') {
    toast.error('任务 DDL 即将到期')
  }
}

export function useProjectTaskEvents(params: {
  query?: ProjectTaskEventsQueryInput
  enabled?: boolean
  showToast?: boolean
}) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!params.enabled || !params.query?.organizationId) return

    const source = new EventSource(buildProjectTaskEventsUrl(params.query))
    const handleProjectTaskEvent = (message: MessageEvent<string>) => {
      const event = readProjectTaskEvent(message.data)
      if (!event) return

      queryClient.invalidateQueries({ queryKey: projectTaskKeys.lists() })
      queryClient.invalidateQueries({ queryKey: projectTaskKeys.detail(event.taskId) })
      queryClient.invalidateQueries({ queryKey: projectTaskKeys.messages() })
      if (params.showToast ?? true) notifyProjectTaskEvent(event)
    }

    source.addEventListener('project_task', handleProjectTaskEvent)
    source.onerror = (error) => {
      logger.warn('Project task event stream error', { error })
    }

    return () => {
      source.removeEventListener('project_task', handleProjectTaskEvent)
      source.close()
    }
  }, [params.enabled, params.query, params.showToast, queryClient])
}
