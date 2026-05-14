import { createLogger } from '@sim/logger'
import { useQuery } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  getBaseProviderModelsContract,
  getFireworksProviderModelsContract,
  getOllamaProviderModelsContract,
  getOpenRouterProviderModelsContract,
  getVllmProviderModelsContract,
  type ProviderModelsResponse,
} from '@/lib/api/contracts/providers'
import type { ProviderName } from '@/stores/providers'

const logger = createLogger('ProviderModelsQuery')
const OPTIONAL_PROVIDER_MODEL_FALLBACKS = new Set<ProviderName>([
  'ollama',
  'vllm',
  'openrouter',
  'fireworks',
])

export const providerKeys = {
  all: ['provider-models'] as const,
  models: (provider: string, workspaceId?: string) =>
    [...providerKeys.all, provider, workspaceId ?? ''] as const,
}

function shouldReturnEmptyModels(provider: ProviderName, error: unknown): boolean {
  const status =
    isApiClientError(error) || (error && typeof error === 'object' && 'status' in error)
      ? Number((error as { status?: unknown }).status)
      : undefined

  return (
    OPTIONAL_PROVIDER_MODEL_FALLBACKS.has(provider) && Number.isFinite(status) && status === 404
  )
}

async function fetchProviderModels(
  provider: ProviderName,
  signal?: AbortSignal,
  workspaceId?: string
): Promise<ProviderModelsResponse> {
  try {
    const data = await requestProviderModels(provider, signal, workspaceId)
    const models: string[] = Array.isArray(data.models) ? data.models : []
    const uniqueModels = provider === 'openrouter' ? Array.from(new Set(models)) : models

    return {
      models: uniqueModels,
      modelInfo: data.modelInfo,
    }
  } catch (error) {
    if (shouldReturnEmptyModels(provider, error)) {
      logger.warn(`Skipping ${provider} models because the optional route is unavailable`, {
        status: isApiClientError(error) ? error.status : undefined,
      })
      return { models: [] }
    }

    logger.warn(`Failed to fetch ${provider} models`, {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    throw error
  }
}

async function requestProviderModels(
  provider: ProviderName,
  signal?: AbortSignal,
  workspaceId?: string
): Promise<ProviderModelsResponse> {
  switch (provider) {
    case 'base':
      return requestJson(getBaseProviderModelsContract, { signal })
    case 'ollama':
      return requestJson(getOllamaProviderModelsContract, { signal })
    case 'vllm':
      return requestJson(getVllmProviderModelsContract, { signal })
    case 'openrouter':
      return requestJson(getOpenRouterProviderModelsContract, { signal })
    case 'fireworks':
      return requestJson(getFireworksProviderModelsContract, {
        query: { workspaceId },
        signal,
      })
  }
}

export function useProviderModels(provider: ProviderName, workspaceId?: string) {
  return useQuery({
    queryKey: providerKeys.models(provider, workspaceId),
    queryFn: ({ signal }) => fetchProviderModels(provider, signal, workspaceId),
    staleTime: 5 * 60 * 1000,
  })
}
