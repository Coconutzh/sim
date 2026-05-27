'use client'

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { useProviderModels } from '@/hooks/queries/providers'
import { type ProviderName, useProvidersStore } from '@/stores/providers'

const logger = createLogger('ProviderModelsLoader')

function useSyncProvider(provider: ProviderName, workspaceId?: string) {
  const setProviderModels = useProvidersStore((state) => state.setProviderModels)
  const setProviderLoading = useProvidersStore((state) => state.setProviderLoading)
  const setOpenRouterModelInfo = useProvidersStore((state) => state.setOpenRouterModelInfo)
  const { data, isLoading, isFetching, error } = useProviderModels(provider, workspaceId)

  useEffect(() => {
    setProviderLoading(provider, isLoading || isFetching)
  }, [provider, isLoading, isFetching, setProviderLoading])

  useEffect(() => {
    if (!data) return

    const syncProviderDefinitions = async () => {
      try {
        if (provider === 'ollama') {
          const { updateOllamaProviderModels } = await import('@/providers/client-model-sync')
          updateOllamaProviderModels(data.models)
        } else if (provider === 'vllm') {
          const { updateVLLMProviderModels } = await import('@/providers/client-model-sync')
          updateVLLMProviderModels(data.models)
        } else if (provider === 'openrouter') {
          const { updateOpenRouterProviderModels } = await import('@/providers/client-model-sync')
          updateOpenRouterProviderModels(data.models)
          if (data.modelInfo) {
            setOpenRouterModelInfo(data.modelInfo)
          }
        } else if (provider === 'fireworks') {
          const { updateFireworksProviderModels } = await import('@/providers/client-model-sync')
          updateFireworksProviderModels(data.models)
        }
      } catch (syncError) {
        logger.warn(`Failed to sync provider definitions for ${provider}`, syncError as Error)
      }
    }

    void syncProviderDefinitions()
    setProviderModels(provider, data.models)
  }, [provider, data, setProviderModels, setOpenRouterModelInfo])

  useEffect(() => {
    if (error) {
      logger.error(`Failed to load ${provider} models`, error)
    }
  }, [provider, error])
}

export function ProviderModelsLoader() {
  if (process.env.NEXT_PUBLIC_SIM_LOW_MEMORY_DEV === 'true') {
    return null
  }

  return <ProviderModelsLoaderInner />
}

function ProviderModelsLoaderInner() {
  const params = useParams()
  const workspaceId = params?.workspaceId as string | undefined

  useSyncProvider('base')
  useSyncProvider('ollama')
  useSyncProvider('vllm')
  useSyncProvider('openrouter')
  useSyncProvider('fireworks', workspaceId)
  return null
}
