import { useMutation, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ContentCanvasModelAvailabilitySnapshot,
  type GenerateContentCanvasPresentationBody,
  type GenerateContentCanvasPresentationResponse,
  generateContentCanvasPresentationContract,
  getContentCanvasModelsContract,
} from '@/lib/api/contracts/content-canvas'

const CONTENT_CANVAS_MODEL_AVAILABILITY_STALE_TIME = 60 * 1000

export const contentCanvasKeys = {
  all: ['content-canvas'] as const,
  modelAvailabilityLists: () => [...contentCanvasKeys.all, 'model-availability'] as const,
  modelAvailability: (workspaceId?: string) =>
    [...contentCanvasKeys.modelAvailabilityLists(), workspaceId ?? ''] as const,
}

async function fetchContentCanvasModelAvailability(
  workspaceId: string,
  signal?: AbortSignal
): Promise<ContentCanvasModelAvailabilitySnapshot> {
  const response = await requestJson(getContentCanvasModelsContract, {
    query: { workspaceId },
    signal,
  })
  return response.models
}

export function useContentCanvasModelAvailability(workspaceId?: string) {
  const query = useQuery({
    queryKey: contentCanvasKeys.modelAvailability(workspaceId),
    queryFn: ({ signal }) => fetchContentCanvasModelAvailability(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: CONTENT_CANVAS_MODEL_AVAILABILITY_STALE_TIME,
  })

  return query.data ?? null
}

async function generateContentCanvasPresentation(
  body: GenerateContentCanvasPresentationBody,
  signal?: AbortSignal
): Promise<GenerateContentCanvasPresentationResponse> {
  return requestJson(generateContentCanvasPresentationContract, {
    body,
    signal,
  })
}

export function useGenerateContentCanvasPresentation() {
  return useMutation({
    mutationFn: (body: GenerateContentCanvasPresentationBody) =>
      generateContentCanvasPresentation(body),
  })
}
