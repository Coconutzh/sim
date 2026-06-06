import { createLogger } from '@sim/logger'
import type { Message, ProviderRequest, ProviderResponse } from '@/providers/types'

const logger = createLogger('GoogleEvolinkFallback')
const EVOLINK_GEMINI_BASE_URL = (
  process.env.EVOLINK_GEMINI_BASE_URL || 'https://direct.evolink.ai/v1'
).replace(/\/$/, '')
const EVOLINK_GEMINI_CHAT_ENDPOINT = `${EVOLINK_GEMINI_BASE_URL}/chat/completions`

type EvolinkChatContentPart =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'image_url'
      image_url: {
        url: string
      }
    }

type EvolinkChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | EvolinkChatContentPart[]
}

function isNativeGoogleApiKey(apiKey: string | undefined): boolean {
  return typeof apiKey === 'string' && apiKey.trim().startsWith('AIza')
}

function canUseEvolinkGeminiFallback(request: ProviderRequest): boolean {
  return (
    request.model.startsWith('gemini-') &&
    !!request.apiKey &&
    !request.stream &&
    !request.tools?.length &&
    !request.responseFormat
  )
}

function toDataUrl(mimeType: string, data: string) {
  return `data:${mimeType};base64,${data}`
}

function toEvolinkChatMessage(message: Message): EvolinkChatMessage | null {
  if (message.role === 'tool' || message.role === 'function') {
    return null
  }

  const role = message.role === 'assistant' ? 'assistant' : message.role
  if (role !== 'system' && role !== 'user' && role !== 'assistant') {
    return null
  }

  if (message.parts?.length) {
    const content = message.parts
      .map((part) => {
        if (part.type === 'text') {
          return part.text
            ? ({
                type: 'text',
                text: part.text,
              } satisfies EvolinkChatContentPart)
            : null
        }

        return part.data
          ? ({
              type: 'image_url',
              image_url: {
                url: toDataUrl(part.mimeType, part.data),
              },
            } satisfies EvolinkChatContentPart)
          : null
      })
      .filter((part): part is EvolinkChatContentPart => Boolean(part))

    if (content.length > 0) {
      return {
        role,
        content,
      }
    }
  }

  if (message.content) {
    return {
      role,
      content: message.content,
    }
  }

  return null
}

function parseEvolinkAssistantContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }

      if (
        part &&
        typeof part === 'object' &&
        'text' in part &&
        typeof part.text === 'string'
      ) {
        return part.text
      }

      return ''
    })
    .join('')
}

function getFallbackErrorMessage(payload: any, fallback: string) {
  return payload?.error?.message || payload?.message || fallback
}

export function shouldPreferEvolinkGeminiTransport(request: ProviderRequest): boolean {
  return canUseEvolinkGeminiFallback(request) && !isNativeGoogleApiKey(request.apiKey)
}

export function buildEvolinkChatMessages(request: ProviderRequest): EvolinkChatMessage[] {
  const messages: Message[] = []

  if (request.systemPrompt) {
    messages.push({
      role: 'system',
      content: request.systemPrompt,
    })
  }

  if (request.context) {
    messages.push({
      role: 'user',
      content: request.context,
    })
  }

  if (request.messages?.length) {
    messages.push(...request.messages)
  }

  return messages
    .map((message) => toEvolinkChatMessage(message))
    .filter((message): message is EvolinkChatMessage => Boolean(message))
}

export function isRetryableGoogleAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()

  return (
    message.includes('api key') ||
    message.includes('api_key') ||
    message.includes('authentication') ||
    message.includes('unauthorized') ||
    message.includes('permission denied') ||
    message.includes('credential')
  )
}

export async function executeEvolinkGeminiFallback(
  request: ProviderRequest
): Promise<ProviderResponse> {
  if (!request.apiKey) {
    throw new Error('API key is required for Evolink Gemini fallback')
  }

  const payload: Record<string, unknown> = {
    model: request.model,
    messages: buildEvolinkChatMessages(request),
  }

  if (request.temperature !== undefined) {
    payload.temperature = request.temperature
  }

  if (request.maxTokens != null) {
    payload.max_tokens = request.maxTokens
  }

  const response = await fetch(EVOLINK_GEMINI_CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: request.abortSignal,
  })

  const responsePayload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      getFallbackErrorMessage(
        responsePayload,
        `Evolink Gemini fallback failed (${response.status})`
      )
    )
  }

  const content = parseEvolinkAssistantContent(responsePayload?.choices?.[0]?.message?.content)
  if (!content) {
    logger.warn('Evolink Gemini fallback returned no assistant text', {
      model: request.model,
    })
  }

  return {
    content,
    model: request.model,
    tokens: {
      input: responsePayload?.usage?.prompt_tokens,
      output: responsePayload?.usage?.completion_tokens,
      total: responsePayload?.usage?.total_tokens,
    },
  }
}
