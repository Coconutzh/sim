import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getJobStatusContract, type JobStatusResponse } from '@/lib/api/contracts/common'

export const asyncJobKeys = {
  all: ['async-job'] as const,
  details: () => [...asyncJobKeys.all, 'detail'] as const,
  detail: (jobId?: string) => [...asyncJobKeys.details(), jobId ?? ''] as const,
}

async function fetchAsyncJob(jobId: string, signal?: AbortSignal): Promise<JobStatusResponse> {
  return requestJson(getJobStatusContract, { params: { jobId }, signal })
}

/** Polls a task until it enters a terminal state. */
export function useAsyncJob(jobId?: string) {
  return useQuery({
    queryKey: asyncJobKeys.detail(jobId),
    queryFn: ({ signal }) => fetchAsyncJob(jobId as string, signal),
    enabled: Boolean(jobId),
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.status === 'completed' || query.state.data?.status === 'failed'
        ? false
        : 1000,
  })
}
