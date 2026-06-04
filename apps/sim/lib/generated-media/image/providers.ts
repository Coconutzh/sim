import { GoogleGenAI, type Part } from '@google/genai'
import { createLogger } from '@sim/logger'
import { resolveContentService } from '@/lib/content-canvas/service-config'
import type { UserFileLike } from '@/lib/core/utils/user-file'
import {
  type ImageAspectRatioValue,
  type ImageGenerationModelId,
  mapImageAspectRatioToProviderSize,
} from '@/lib/generated-media/image/image-generation-utils'

const logger = createLogger('GeneratedImageProviders')

const JIMENG_PROVIDER_MODEL_MAP: Partial<Record<ImageGenerationModelId, string>> = {
  'jimeng-4.0': 'doubao-seedream-4-0-250828',
  'jimeng-4.5': 'doubao-seedream-4-5-251128',
}

interface GenerateImageWithProviderInput {
  model: ImageGenerationModelId
  prompt: string
  aspectRatio: ImageAspectRatioValue
  referenceContext?: {
    text: string[]
    images: UserFileLike[]
  }
}

export interface GeneratedImageProviderResult {
  buffer: Buffer
  mimeType: string
  provider: string
  providerModel: string
  revisedPrompt?: string
}

function getKeyFingerprint(apiKey: string): string {
  if (apiKey.length <= 8) return `${apiKey.slice(0, 2)}***`
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
}

function looksLikeBase64Value(apiKey: string): boolean {
  return /^[A-Za-z0-9+/=]+$/.test(apiKey) && apiKey.includes('=')
}

function inferMimeTypeFromUrl(url: string | undefined): string {
  if (!url) return 'image/png'
  const lower = url.toLowerCase()
  if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg'
  if (lower.includes('.webp')) return 'image/webp'
  return 'image/png'
}

function buildImagePrompt({
  prompt,
  aspectRatio,
  referenceContext,
}: Pick<GenerateImageWithProviderInput, 'prompt' | 'aspectRatio' | 'referenceContext'>) {
  const textSections = [...(referenceContext?.text ?? [])].filter((section) => section.trim().length > 0)
  return [
    prompt,
    ...textSections.map((section, index) => `Reference context ${index + 1}:\n${section}`),
    `Use a ${aspectRatio} aspect ratio.`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function toCompatibleImageUrl(image: UserFileLike) {
  if (image.base64 && image.type) {
    return `data:${image.type};base64,${image.base64}`
  }

  const url = image.url?.trim()
  return url && url.length > 0 ? url : null
}

function decodeDataUrlImage(url: string) {
  const match = url.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null

  return {
    mimeType: match[1] || 'image/png',
    buffer: Buffer.from(match[2], 'base64'),
  }
}

function parseCompatibleImagePayload(payload: any): {
  buffer: Buffer
  mimeType: string
  revisedPrompt?: string
} | null {
  const candidateResults = [
    ...(Array.isArray(payload?.data) ? payload.data : []),
    ...(Array.isArray(payload?.images) ? payload.images : []),
    ...(Array.isArray(payload?.output) ? payload.output : []),
    ...(Array.isArray(payload?.choices?.[0]?.message?.images) ? payload.choices[0].message.images : []),
    ...(Array.isArray(payload?.choices?.[0]?.message?.content) ? payload.choices[0].message.content : []),
  ]

  for (const item of candidateResults) {
    if (!item || typeof item !== 'object') continue

    const directBase64 =
      typeof item.b64_json === 'string'
        ? item.b64_json
        : typeof item.image_base64 === 'string'
          ? item.image_base64
          : typeof item.base64 === 'string'
            ? item.base64
            : null
    if (directBase64) {
      return {
        buffer: Buffer.from(directBase64, 'base64'),
        mimeType:
          typeof item.mime_type === 'string'
            ? item.mime_type
            : typeof item.mimeType === 'string'
              ? item.mimeType
              : 'image/png',
        revisedPrompt:
          typeof item.revised_prompt === 'string'
            ? item.revised_prompt
            : typeof payload?.choices?.[0]?.message?.content === 'string'
              ? payload.choices[0].message.content
              : undefined,
      }
    }

    const dataUrl =
      typeof item.url === 'string'
        ? item.url
        : typeof item.image_url?.url === 'string'
          ? item.image_url.url
          : null
    if (dataUrl) {
      const decoded = decodeDataUrlImage(dataUrl)
      if (decoded) {
        return {
          buffer: decoded.buffer,
          mimeType: decoded.mimeType,
          revisedPrompt:
            typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined,
        }
      }
    }
  }

  return null
}

async function generateImageWithGeminiNative({
  model,
  prompt,
  aspectRatio,
  referenceContext,
}: GenerateImageWithProviderInput): Promise<GeneratedImageProviderResult> {
  const service = resolveContentService({ capability: 'image', modelId: model })
  if (!service.apiKey) {
    throw new Error(`No API key configured for content-canvas image model ${model}`)
  }

  const ai = new GoogleGenAI({ apiKey: service.apiKey })
  const parts: Part[] = []

  for (const image of referenceContext?.images ?? []) {
    if (!image.base64 || !image.type) continue
    parts.push({
      inlineData: {
        mimeType: image.type,
        data: image.base64,
      },
    })
  }

  parts.push({
    text: buildImagePrompt({ prompt, aspectRatio, referenceContext }),
  })

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: {
      responseModalities: ['IMAGE', 'TEXT'],
    },
  })

  const responseParts = response.candidates?.[0]?.content?.parts ?? []
  const imagePart = responseParts.find((part) => part.inlineData?.data)
  if (!imagePart?.inlineData?.data) {
    throw new Error('Gemini image request returned no image data')
  }

  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    mimeType: imagePart.inlineData.mimeType || 'image/png',
    provider: 'gemini',
    providerModel: model,
    revisedPrompt: responseParts
      .map((part) => part.text)
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join(' ')
      .trim() || undefined,
  }
}

async function generateImageWithGeminiCompatible({
  model,
  prompt,
  aspectRatio,
  referenceContext,
}: GenerateImageWithProviderInput): Promise<GeneratedImageProviderResult> {
  const service = resolveContentService({ capability: 'image', modelId: model })
  if (!service.apiKey) {
    throw new Error(`No API key configured for content-canvas image model ${model}`)
  }

  const content = [
    {
      type: 'text',
      text: buildImagePrompt({ prompt, aspectRatio, referenceContext }),
    },
    ...(referenceContext?.images ?? [])
      .map((image) => toCompatibleImageUrl(image))
      .filter((value): value is string => Boolean(value))
      .map((url) => ({
        type: 'image_url',
        image_url: { url },
      })),
  ]

  const response = await fetch(`${service.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${service.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      modalities: ['text', 'image'],
      size: mapImageAspectRatioToProviderSize(aspectRatio),
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    }),
  })

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(
      (payload.error as { message?: string } | undefined)?.message ||
        (typeof payload.message === 'string' ? payload.message : undefined) ||
        `Gemini compatible image request failed (${response.status})`
    )
  }

  const result = parseCompatibleImagePayload(payload)
  if (!result) {
    throw new Error('Gemini compatible image request returned no image data')
  }

  return {
    buffer: result.buffer,
    mimeType: result.mimeType,
    provider: 'gemini-compatible',
    providerModel: model,
    revisedPrompt: result.revisedPrompt,
  }
}

async function generateImageWithArk({
  model,
  prompt,
  aspectRatio,
  referenceContext,
}: GenerateImageWithProviderInput): Promise<GeneratedImageProviderResult> {
  const service = resolveContentService({ capability: 'image', modelId: model })
  if (!service.apiKey) {
    throw new Error(`No API key configured for content-canvas image model ${model}`)
  }

  const providerModel = JIMENG_PROVIDER_MODEL_MAP[model]
  if (!providerModel) {
    throw new Error(`Unsupported image model: ${model}`)
  }

  const promptWithReferenceText = [
    prompt,
    ...(referenceContext?.text ?? []).filter((section) => section.trim().length > 0),
  ]
    .filter(Boolean)
    .join('\n\n')

  const endpoint = `${service.baseUrl.replace(/\/$/, '')}/images/generations`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${service.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: providerModel,
      prompt: promptWithReferenceText,
      size: mapImageAspectRatioToProviderSize(aspectRatio),
      response_format: 'b64_json',
    }),
  })

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const errorMessage =
      (payload.error as { message?: string } | undefined)?.message ||
      (typeof payload.message === 'string' ? payload.message : undefined) ||
      `Ark image request failed (${response.status})`
    logger.error('Ark image generation failed', {
      model,
      providerModel,
      status: response.status,
      error: errorMessage,
      keyLength: service.apiKey.length,
      keyFingerprint: getKeyFingerprint(service.apiKey),
      looksBase64Encoded: looksLikeBase64Value(service.apiKey),
      baseUrl: endpoint,
    })
    throw new Error(errorMessage)
  }

  const rawData = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray((payload.data as { data?: unknown[] } | undefined)?.data)
      ? ((payload.data as { data?: unknown[] }).data ?? [])
      : []
  const firstResult = rawData[0] as
    | { b64_json?: string; url?: string; revised_prompt?: string }
    | undefined

  if (!firstResult) {
    throw new Error('Image provider returned no image result')
  }

  if (firstResult.b64_json) {
    return {
      buffer: Buffer.from(firstResult.b64_json, 'base64'),
      mimeType: 'image/png',
      provider: 'ark',
      providerModel,
      revisedPrompt: firstResult.revised_prompt,
    }
  }

  if (!firstResult.url) {
    throw new Error('Image provider returned neither b64_json nor url')
  }

  const imageResponse = await fetch(firstResult.url)
  if (!imageResponse.ok) {
    throw new Error(`Failed to download generated image (${imageResponse.status})`)
  }

  return {
    buffer: Buffer.from(await imageResponse.arrayBuffer()),
    mimeType: imageResponse.headers.get('content-type') || inferMimeTypeFromUrl(firstResult.url),
    provider: 'ark',
    providerModel,
    revisedPrompt: firstResult.revised_prompt,
  }
}

export async function generateImageWithProvider(
  params: GenerateImageWithProviderInput
): Promise<GeneratedImageProviderResult> {
  const service = resolveContentService({ capability: 'image', modelId: params.model })

  if (params.model === 'gemini-3.1-flash-image-preview') {
    if (service.kind === 'openai-compatible') {
      return generateImageWithGeminiCompatible(params)
    }
    return generateImageWithGeminiNative(params)
  }

  return generateImageWithArk(params)
}
