import { db } from '@sim/db'
import { workspaceBYOKKeys } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { getPlatformProviderApiKey } from '@/lib/api-key/platform'
import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { env } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/feature-flags'
import { decryptSecret } from '@/lib/core/security/encryption'
import { getWorkspaceById } from '@/lib/workspaces/permissions/utils'
import { getHostedModels } from '@/providers/models'
import { PROVIDER_PLACEHOLDER_KEY } from '@/providers/utils'
import { useProvidersStore } from '@/stores/providers/store'
import type { BYOKProviderId } from '@/tools/types'

const logger = createLogger('BYOKKeys')

export type ApiKeySource =
  | 'provider-no-key-required'
  | 'workspace-byok'
  | 'request-api-key'
  | 'env-vllm-api-key'
  | 'env-fireworks-api-key'
  | 'env-azure-openai-api-key'
  | 'env-azure-anthropic-api-key'
  | 'env-zhipu-api-key'
  | 'env-cerebras-api-key'
  | 'hosted-rotating-key'
  | 'platform-provider-key'

export interface BYOKKeyResult {
  apiKey: string
  isBYOK: true
  source: 'workspace-byok'
}

export async function getBYOKKey(
  workspaceId: string | undefined | null,
  providerId: BYOKProviderId
): Promise<BYOKKeyResult | null> {
  if (!workspaceId) {
    return null
  }

  try {
    const activeWorkspace = await getWorkspaceById(workspaceId)
    if (!activeWorkspace) {
      return null
    }

    const result = await db
      .select({ encryptedApiKey: workspaceBYOKKeys.encryptedApiKey })
      .from(workspaceBYOKKeys)
      .where(
        and(
          eq(workspaceBYOKKeys.workspaceId, workspaceId),
          eq(workspaceBYOKKeys.providerId, providerId)
        )
      )
      .limit(1)

    if (!result.length) {
      return null
    }

    const { decrypted } = await decryptSecret(result[0].encryptedApiKey)
    return { apiKey: decrypted, isBYOK: true, source: 'workspace-byok' }
  } catch (error) {
    logger.error('Failed to get BYOK key', { workspaceId, providerId, error })
    return null
  }
}

export async function getApiKeyWithBYOK(
  provider: string,
  model: string,
  workspaceId: string | undefined | null,
  userProvidedKey?: string
): Promise<{ apiKey: string; isBYOK: boolean; source: ApiKeySource }> {
  const isOllamaModel =
    provider === 'ollama' || useProvidersStore.getState().providers.ollama.models.includes(model)
  if (isOllamaModel) {
    return { apiKey: 'empty', isBYOK: false, source: 'provider-no-key-required' }
  }

  const isVllmModel =
    provider === 'vllm' || useProvidersStore.getState().providers.vllm.models.includes(model)
  if (isVllmModel) {
    if (userProvidedKey) {
      return { apiKey: userProvidedKey, isBYOK: false, source: 'request-api-key' }
    }
    if (env.VLLM_API_KEY) {
      return { apiKey: env.VLLM_API_KEY, isBYOK: false, source: 'env-vllm-api-key' }
    }
    return { apiKey: 'empty', isBYOK: false, source: 'provider-no-key-required' }
  }

  const isFireworksModel =
    provider === 'fireworks' ||
    useProvidersStore.getState().providers.fireworks.models.includes(model)
  if (isFireworksModel) {
    if (workspaceId) {
      const byokResult = await getBYOKKey(workspaceId, 'fireworks')
      if (byokResult) {
        logger.info('Using BYOK key for Fireworks', { model, workspaceId })
        return byokResult
      }
    }
    if (userProvidedKey) {
      return { apiKey: userProvidedKey, isBYOK: false, source: 'request-api-key' }
    }
    const platformKey = await getPlatformProviderApiKey('fireworks')
    if (platformKey) {
      return { apiKey: platformKey.apiKey, isBYOK: false, source: platformKey.source }
    }
    if (env.FIREWORKS_API_KEY) {
      return { apiKey: env.FIREWORKS_API_KEY, isBYOK: false, source: 'env-fireworks-api-key' }
    }
    throw new Error(`API key is required for Fireworks ${model}`)
  }

  const isBedrockModel = provider === 'bedrock' || model.startsWith('bedrock/')
  if (isBedrockModel) {
    return {
      apiKey: PROVIDER_PLACEHOLDER_KEY,
      isBYOK: false,
      source: 'provider-no-key-required',
    }
  }

  if (provider === 'azure-openai') {
    if (userProvidedKey) {
      return { apiKey: userProvidedKey, isBYOK: false, source: 'request-api-key' }
    }
    return {
      apiKey: env.AZURE_OPENAI_API_KEY || '',
      isBYOK: false,
      source: 'env-azure-openai-api-key',
    }
  }

  if (provider === 'azure-anthropic') {
    if (userProvidedKey) {
      return { apiKey: userProvidedKey, isBYOK: false, source: 'request-api-key' }
    }
    return {
      apiKey: env.AZURE_ANTHROPIC_API_KEY || '',
      isBYOK: false,
      source: 'env-azure-anthropic-api-key',
    }
  }

  const isOpenAIModel = provider === 'openai'
  const isClaudeModel = provider === 'anthropic'
  const isGeminiModel = provider === 'google'
  const isZhipuModel = provider === 'zhipu'
  const isMistralModel = provider === 'mistral'
  const isCerebrasModel = provider === 'cerebras'

  if (isZhipuModel) {
    if (workspaceId) {
      const byokResult = await getBYOKKey(workspaceId, 'zhipu')
      if (byokResult) {
        logger.info('Resolved Zhipu API key source', {
          model,
          workspaceId,
          source: byokResult.source,
          provider: 'zhipu',
        })
        return byokResult
      }
    }
    if (userProvidedKey) {
      logger.info('Resolved Zhipu API key source', {
        model,
        workspaceId,
        source: 'request-api-key',
        provider: 'zhipu',
      })
      return { apiKey: userProvidedKey, isBYOK: false, source: 'request-api-key' }
    }
    const platformKey = await getPlatformProviderApiKey('zhipu')
    if (platformKey) {
      logger.info('Resolved Zhipu API key source', {
        model,
        workspaceId,
        source: platformKey.source,
        provider: 'zhipu',
      })
      return { apiKey: platformKey.apiKey, isBYOK: false, source: platformKey.source }
    }
    if (env.ZHIPU_API_KEY) {
      logger.info('Resolved Zhipu API key source', {
        model,
        workspaceId,
        source: 'env-zhipu-api-key',
        envVar: 'ZHIPU_API_KEY',
        provider: 'zhipu',
      })
      return { apiKey: env.ZHIPU_API_KEY, isBYOK: false, source: 'env-zhipu-api-key' }
    }
    throw new Error(`API key is required for ${provider} ${model}`)
  }

  if (isCerebrasModel) {
    if (userProvidedKey) {
      return { apiKey: userProvidedKey, isBYOK: false, source: 'request-api-key' }
    }
    const platformKey = await getPlatformProviderApiKey('cerebras')
    if (platformKey) {
      return { apiKey: platformKey.apiKey, isBYOK: false, source: platformKey.source }
    }
    if (env.CEREBRAS_API_KEY) {
      return { apiKey: env.CEREBRAS_API_KEY, isBYOK: false, source: 'env-cerebras-api-key' }
    }
    throw new Error(`API key is required for ${provider} ${model}`)
  }

  const byokProviderId = isGeminiModel ? 'google' : (provider as BYOKProviderId)

  if (
    isHosted &&
    workspaceId &&
    (isOpenAIModel || isClaudeModel || isGeminiModel || isMistralModel)
  ) {
    const hostedModels = getHostedModels()
    const isModelHosted = hostedModels.some((m) => m.toLowerCase() === model.toLowerCase())

    logger.debug('BYOK check', { provider, model, workspaceId, isHosted, isModelHosted })

    if (isModelHosted || isMistralModel) {
      const byokResult = await getBYOKKey(workspaceId, byokProviderId)
      if (byokResult) {
        logger.info('Using BYOK key', { provider, model, workspaceId })
        return byokResult
      }
      logger.debug('No BYOK key found, falling back', { provider, model, workspaceId })

      if (isModelHosted) {
        try {
          const platformKey = await getPlatformProviderApiKey(isGeminiModel ? 'google' : provider)
          if (platformKey) {
            return { apiKey: platformKey.apiKey, isBYOK: false, source: platformKey.source }
          }
          const serverKey = getRotatingApiKey(isGeminiModel ? 'gemini' : provider)
          return { apiKey: serverKey, isBYOK: false, source: 'hosted-rotating-key' }
        } catch (_error) {
          if (userProvidedKey) {
            return { apiKey: userProvidedKey, isBYOK: false, source: 'request-api-key' }
          }
          throw new Error(`No API key available for ${provider} ${model}`)
        }
      }
    }
  }

  if (!userProvidedKey) {
    logger.debug('BYOK not applicable, no user key provided', {
      provider,
      model,
      workspaceId,
      isHosted,
    })
    throw new Error(`API key is required for ${provider} ${model}`)
  }

  return { apiKey: userProvidedKey, isBYOK: false, source: 'request-api-key' }
}
