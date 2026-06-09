import { createLogger } from '@sim/logger'
import {
  getContentCanvasModelAvailability,
  resolveContentService,
} from '@/lib/content-canvas/service-config'
import { executeContentCanvasTextRequest } from '@/lib/content-canvas/text-executor'
import type {
  LocalAgentModelConfig,
  LocalAgentModelRequest,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import { getEnv } from '@/lib/core/config/env'
import { executeStructuredActorRequest } from '@/providers'
import type { ProviderId, ProviderResponse } from '@/providers/types'
import { getProviderFromModel } from '@/providers/utils'

const logger = createLogger('LocalCanvasAgentModelConfig')

function normalizeProvider(value: string | undefined): ProviderId | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  return normalized ? (normalized as ProviderId) : null
}

function resolveActorApiKey(provider: ProviderId): string | undefined {
  const shared = getEnv('LOCAL_COPILOT_API_KEY')?.trim()
  if (shared) return shared
  if (provider === 'deepseek') return getEnv('DEEPSEEK_API_KEY')?.trim()
  if (provider === 'openai') return getEnv('OPENAI_API_KEY')?.trim()
  return undefined
}

function hasExplicitContentCanvasTextConfig(): boolean {
  return Boolean(
    getEnv('CONTENT_TEXT_GEMINI_API_KEY')?.trim() || getEnv('CONTENT_TEXT_GLM_API_KEY')?.trim()
  )
}

function resolveContentCanvasTextApiKey(model: string): string | undefined {
  try {
    return resolveContentService({ capability: 'text', modelId: model }).apiKey
  } catch {
    return undefined
  }
}

export function resolveLocalCanvasAgentModelConfig(): LocalAgentModelConfig {
  const contentCanvasAvailability = getContentCanvasModelAvailability()
  if (hasExplicitContentCanvasTextConfig() && contentCanvasAvailability.text.defaultModelId) {
    return {
      model: contentCanvasAvailability.text.defaultModelId,
      mode: 'structured',
      useContentCanvasTextResolver: true,
    }
  }

  const explicitProvider = normalizeProvider(getEnv('CONTENT_CANVAS_ACTOR_PROVIDER'))
  const explicitModel = getEnv('CONTENT_CANVAS_ACTOR_MODEL')?.trim()
  const explicitMode =
    getEnv('CONTENT_CANVAS_ACTOR_MODE') === 'tool-call' ? 'tool-call' : 'structured'

  if (explicitProvider && explicitModel) {
    return {
      provider: explicitProvider,
      model: explicitModel,
      mode: explicitMode,
      apiKey: resolveActorApiKey(explicitProvider),
    }
  }

  const legacyProvider = normalizeProvider(getEnv('LOCAL_COPILOT_PROVIDER'))
  const legacyModel = getEnv('LOCAL_COPILOT_MODEL')?.trim()
  const inferredProvider =
    legacyProvider ??
    (legacyModel ? normalizeProvider(getProviderFromModel(legacyModel) ?? undefined) : null)

  if (!legacyModel || !inferredProvider) {
    throw new Error(
      'Local canvas agent requires content-canvas text env, CONTENT_CANVAS_ACTOR_PROVIDER/MODEL, or LOCAL_COPILOT_MODEL with LOCAL_COPILOT_PROVIDER'
    )
  }

  return {
    provider: inferredProvider,
    model: legacyModel,
    mode: 'structured',
    apiKey: resolveActorApiKey(inferredProvider),
  }
}

export async function executeLocalAgentModelRequest(
  config: LocalAgentModelConfig,
  request: LocalAgentModelRequest
): Promise<ProviderResponse> {
  const startedAt = Date.now()
  try {
    if (config.useContentCanvasTextResolver && !request.messages?.length) {
      const response = await executeContentCanvasTextRequest({
        workspaceId: request.workspaceId,
        model: config.model,
        systemPrompt: request.systemPrompt,
        prompt: request.prompt,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        responseFormat: request.responseFormat,
        abortSignal: request.abortSignal,
      })
      logger.info('Local canvas agent model request completed', {
        workspaceId: request.workspaceId,
        role: request.role,
        model: config.model,
        provider: 'content-canvas-text',
        useContentCanvasTextResolver: true,
        elapsedMs: Date.now() - startedAt,
        finishReason: response.finishReason,
        tokens: response.tokens,
        responseChars: response.content?.length ?? 0,
      })
      return response
    }

    const provider =
      config.provider ?? normalizeProvider(getProviderFromModel(config.model) ?? undefined)
    if (!provider) {
      throw new Error('Local canvas agent model provider is not configured')
    }

    const response = await executeStructuredActorRequest(provider, {
      workspaceId: request.workspaceId,
      model: config.model,
      apiKey:
        config.apiKey ??
        (config.useContentCanvasTextResolver
          ? resolveContentCanvasTextApiKey(config.model)
          : undefined),
      systemPrompt: request.systemPrompt,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      responseFormat: request.responseFormat,
      abortSignal: request.abortSignal,
      messages: request.messages?.length
        ? request.messages
        : [{ role: 'user', content: request.prompt }],
    })
    logger.info('Local canvas agent model request completed', {
      workspaceId: request.workspaceId,
      role: request.role,
      model: config.model,
      provider,
      useContentCanvasTextResolver: config.useContentCanvasTextResolver === true,
      elapsedMs: Date.now() - startedAt,
      finishReason: response.finishReason,
      tokens: response.tokens,
      responseChars: response.content?.length ?? 0,
    })
    return response
  } catch (error) {
    logger.warn('Local canvas agent model request failed', {
      workspaceId: request.workspaceId,
      role: request.role,
      model: config.model,
      provider:
        config.provider ?? normalizeProvider(getProviderFromModel(config.model) ?? undefined),
      useContentCanvasTextResolver: config.useContentCanvasTextResolver === true,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
