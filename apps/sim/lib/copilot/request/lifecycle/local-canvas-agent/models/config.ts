import { createLogger } from '@sim/logger'
import { getContentCanvasModelAvailabilityForRuntime } from '@/lib/content-canvas/service-config'
import { executeContentCanvasTextRequest } from '@/lib/content-canvas/text-executor'
import type {
  LocalAgentModelConfig,
  LocalAgentModelRequest,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import type { ProviderResponse } from '@/providers/types'

const logger = createLogger('LocalCanvasAgentModelConfig')

const CONTENT_CANVAS_TEXT_CONFIGURATION_ERROR = '平台管理员尚未配置画布文本模型与 API Key'

/** Resolves the Copilot model exclusively from administrator-managed canvas services. */
export async function resolveLocalCanvasAgentModelConfig(): Promise<LocalAgentModelConfig> {
  const availability = await getContentCanvasModelAvailabilityForRuntime()
  const model = availability.text.defaultModelId
  if (!model) {
    throw new Error(CONTENT_CANVAS_TEXT_CONFIGURATION_ERROR)
  }

  return {
    model,
    mode: 'structured',
    useContentCanvasTextResolver: true,
  }
}

/** Uses the configured canvas text model for auxiliary and visual understanding requests. */
export function resolveLocalAgentAuxiliaryModelConfig(params: {
  fallback: LocalAgentModelConfig
}): LocalAgentModelConfig {
  return params.fallback
}

function extractReferenceImages(request: LocalAgentModelRequest) {
  return (request.messages ?? []).flatMap((message) =>
    (message.parts ?? []).flatMap((part) =>
      part.type === 'image' ? [{ mimeType: part.mimeType, data: part.data }] : []
    )
  )
}

function extractReferenceText(request: LocalAgentModelRequest): string | undefined {
  const text = (request.messages ?? [])
    .flatMap((message) => [
      typeof message.content === 'string' ? message.content : '',
      ...(message.parts ?? []).flatMap((part) => (part.type === 'text' ? [part.text] : [])),
    ])
    .filter(Boolean)
    .join('\n')
    .trim()

  return text && text !== request.prompt.trim() ? text : undefined
}

export async function executeLocalAgentModelRequest(
  config: LocalAgentModelConfig,
  request: LocalAgentModelRequest
): Promise<ProviderResponse> {
  const startedAt = Date.now()
  try {
    if (!config.useContentCanvasTextResolver) {
      throw new Error('Local canvas agent must use the administrator-managed canvas text model')
    }

    const response = await executeContentCanvasTextRequest({
      workspaceId: request.workspaceId,
      model: config.model,
      systemPrompt: request.systemPrompt,
      prompt: request.prompt,
      referenceContextText: extractReferenceText(request),
      referenceImages: extractReferenceImages(request),
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
      elapsedMs: Date.now() - startedAt,
      finishReason: response.finishReason,
      tokens: response.tokens,
      responseChars: response.content?.length ?? 0,
      systemPromptChars: request.systemPrompt.length,
      promptChars: request.prompt.length,
      messageCount: request.messages?.length ?? 0,
    })
    return response
  } catch (error) {
    logger.warn('Local canvas agent model request failed', {
      workspaceId: request.workspaceId,
      role: request.role,
      model: config.model,
      useContentCanvasTextResolver: config.useContentCanvasTextResolver === true,
      elapsedMs: Date.now() - startedAt,
      systemPromptChars: request.systemPrompt.length,
      promptChars: request.prompt.length,
      messageCount: request.messages?.length ?? 0,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
