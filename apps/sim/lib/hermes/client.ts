import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'

const logger = createLogger('HermesClient')

export interface HermesChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export interface HermesChatCompletionParams {
  messages: HermesChatMessage[]
  model?: string
  sessionId?: string
  sessionKey?: string
  metadata?: Record<string, unknown>
  signal?: AbortSignal
}

export interface HermesChatCompletionResult {
  id?: string
  content: string
  raw: unknown
}

export interface HermesClientConfig {
  baseUrl: string
  apiKey: string
}

export class HermesClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'HermesClientError'
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

export function getHermesClientConfig(): HermesClientConfig | null {
  if (!env.HERMES_API_URL || !env.HERMES_API_KEY) return null
  return {
    baseUrl: trimTrailingSlash(env.HERMES_API_URL),
    apiKey: env.HERMES_API_KEY,
  }
}

function extractContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  const choices = record.choices
  if (!Array.isArray(choices)) return ''
  const first = choices[0]
  if (!first || typeof first !== 'object') return ''
  const message = (first as Record<string, unknown>).message
  if (!message || typeof message !== 'object') return ''
  const content = (message as Record<string, unknown>).content
  return typeof content === 'string' ? content : ''
}

export async function callHermesChatCompletion(
  params: HermesChatCompletionParams
): Promise<HermesChatCompletionResult> {
  const config = getHermesClientConfig()
  if (!config) {
    throw new HermesClientError('Hermes API is not configured')
  }

  try {
    const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        ...(params.sessionId ? { 'x-hermes-session-id': params.sessionId } : {}),
        ...(params.sessionKey ? { 'x-hermes-session-key': params.sessionKey } : {}),
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        metadata: params.metadata,
      }),
      signal: params.signal,
    })

    const raw = (await response.json().catch(() => ({}))) as unknown
    if (!response.ok) {
      const message =
        raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).error === 'string'
          ? ((raw as Record<string, unknown>).error as string)
          : 'Hermes API request failed'
      throw new HermesClientError(message, response.status)
    }

    const content = extractContent(raw)
    return {
      id:
        raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).id === 'string'
          ? ((raw as Record<string, unknown>).id as string)
          : undefined,
      content,
      raw,
    }
  } catch (error) {
    if (error instanceof HermesClientError) throw error
    const err = toError(error)
    logger.error('Hermes API request failed', { error: err.message })
    throw new HermesClientError(err.message)
  }
}
