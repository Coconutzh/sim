import { resolveContentServiceForRuntime } from '@/lib/content-canvas/service-config'
import { executeProviderRequest } from '@/providers'
import type { Message, ProviderRequest, ProviderResponse } from '@/providers/types'
import { getProviderFromModel } from '@/providers/utils'

export interface ContentCanvasReferenceImage {
  mimeType: string
  data: string
}

interface ExecuteContentCanvasTextInput {
  workspaceId: string
  model: string
  systemPrompt: string
  prompt: string
  referenceContextText?: string
  referenceImages?: ContentCanvasReferenceImage[]
  temperature?: number
  maxTokens?: number
  responseFormat?: ProviderRequest['responseFormat']
  abortSignal?: AbortSignal
}

function buildPrompt(prompt: string, referenceContextText?: string) {
  return [prompt.trim(), referenceContextText?.trim()].filter(Boolean).join('\n\n')
}

function buildNativeGoogleMessage(params: {
  prompt: string
  referenceContextText?: string
  referenceImages?: ContentCanvasReferenceImage[]
}): Message {
  const content = buildPrompt(params.prompt, params.referenceContextText)
  const parts =
    params.referenceImages && params.referenceImages.length > 0
      ? [
          { type: 'text' as const, text: content },
          ...params.referenceImages.map((image) => ({
            type: 'image' as const,
            mimeType: image.mimeType,
            data: image.data,
          })),
        ]
      : undefined

  return {
    role: 'user',
    content,
    parts,
  }
}

function buildCompatibleMessages(params: {
  systemPrompt: string
  prompt: string
  referenceContextText?: string
  referenceImages?: ContentCanvasReferenceImage[]
}) {
  const content = buildPrompt(params.prompt, params.referenceContextText)
  const userContent =
    params.referenceImages && params.referenceImages.length > 0
      ? [
          { type: 'text', text: content },
          ...params.referenceImages.map((image) => ({
            type: 'image_url',
            image_url: {
              url: `data:${image.mimeType};base64,${image.data}`,
            },
          })),
        ]
      : content

  return [
    {
      role: 'system',
      content: params.systemPrompt,
    },
    {
      role: 'user',
      content: userContent,
    },
  ]
}

function assertProviderResponse(response: unknown): ProviderResponse {
  if (!response || typeof response !== 'object' || !('content' in response)) {
    throw new Error('Content canvas text generation did not return a non-streaming response')
  }
  return response as ProviderResponse
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function getRecordValue(record: Record<string, unknown>, key: string): unknown {
  return record[key]
}

function getStringRecordValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = getRecordValue(record, key)
  return typeof value === 'string' ? value : undefined
}

function extractCompatibleContent(payload: unknown): string {
  if (!isRecord(payload)) return ''

  const choices = getRecordValue(payload, 'choices')
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined
  const message = isRecord(firstChoice) ? getRecordValue(firstChoice, 'message') : undefined
  const content = isRecord(message) ? getRecordValue(message, 'content') : undefined

  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'string'
          ? part
          : isRecord(part)
            ? (getStringRecordValue(part, 'text') ?? '')
            : ''
      )
      .join('')
      .trim()
  }
  return ''
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const error = getRecordValue(payload, 'error')
  if (isRecord(error)) {
    const errorMessage = getStringRecordValue(error, 'message')
    if (errorMessage) return errorMessage
  }
  return getStringRecordValue(payload, 'message')
}

function getUsageTokenCount(payload: unknown, key: string): number | undefined {
  if (!isRecord(payload)) return undefined
  const usage = getRecordValue(payload, 'usage')
  if (!isRecord(usage)) return undefined
  const value = getRecordValue(usage, key)
  return typeof value === 'number' ? value : undefined
}

export async function executeContentCanvasTextRequest(
  params: ExecuteContentCanvasTextInput
): Promise<ProviderResponse> {
  const service = await resolveContentServiceForRuntime({
    capability: 'text',
    modelId: params.model,
  })

  if (!service.apiKey) {
    const fallbackProvider = getProviderFromModel(params.model)
    if (!fallbackProvider) {
      throw new Error(`No API key configured for content-canvas text model ${params.model}`)
    }

    return assertProviderResponse(
      await executeProviderRequest(fallbackProvider, {
        workspaceId: params.workspaceId,
        model: params.model,
        systemPrompt: params.systemPrompt,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        responseFormat: params.responseFormat,
        abortSignal: params.abortSignal,
        messages: [
          buildNativeGoogleMessage({
            prompt: params.prompt,
            referenceContextText: params.referenceContextText,
            referenceImages: params.referenceImages,
          }),
        ],
      })
    )
  }

  if (service.kind === 'google-native') {
    const response = assertProviderResponse(
      await executeProviderRequest('google', {
        workspaceId: params.workspaceId,
        model: params.model,
        apiKey: service.apiKey,
        systemPrompt: params.systemPrompt,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        responseFormat: params.responseFormat,
        abortSignal: params.abortSignal,
        messages: [
          buildNativeGoogleMessage({
            prompt: params.prompt,
            referenceContextText: params.referenceContextText,
            referenceImages: params.referenceImages,
          }),
        ],
      })
    )
    return response
  }

  const response = await fetch(`${service.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    signal: params.abortSignal,
    headers: {
      Authorization: `Bearer ${service.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      response_format: params.responseFormat
        ? {
            type: 'json_schema',
            json_schema: {
              name: params.responseFormat.name,
              schema: params.responseFormat.schema,
              strict: params.responseFormat.strict ?? true,
            },
          }
        : undefined,
      messages: buildCompatibleMessages({
        systemPrompt: params.systemPrompt,
        prompt: params.prompt,
        referenceContextText: params.referenceContextText,
        referenceImages: params.referenceImages,
      }),
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload) || 'Content canvas text request failed')
  }

  const content = extractCompatibleContent(payload)
  const finishReason = payload?.choices?.[0]?.finish_reason
  const reasoningTokens =
    payload?.usage?.completion_tokens_details?.reasoning_tokens ??
    payload?.usage?.completion_tokens_details?.reasoningTokens
  return {
    content,
    model: params.model,
    finishReason: typeof finishReason === 'string' ? finishReason : undefined,
    tokens: {
      input: getUsageTokenCount(payload, 'prompt_tokens'),
      output: getUsageTokenCount(payload, 'completion_tokens'),
      total: getUsageTokenCount(payload, 'total_tokens'),
      ...(typeof reasoningTokens === 'number' ? { reasoning: reasoningTokens } : {}),
    },
  }
}

export async function generateContentCanvasText(
  params: ExecuteContentCanvasTextInput
): Promise<string> {
  const response = await executeContentCanvasTextRequest(params)
  const content = response.content?.trim()
  if (!content) {
    throw new Error(`Content canvas text generation returned no content for ${params.model}`)
  }
  return content
}
