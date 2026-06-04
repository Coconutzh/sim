import { createLogger } from '@sim/logger'
import { GoogleGenAI, type Part } from '@google/genai'
import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { env } from '@/lib/core/config/env'
import {
  type ImageAspectRatioValue,
  type ImageGenerationModelId,
  mapImageAspectRatioToProviderSize,
} from '@/lib/generated-media/image/image-generation-utils'
import type { UserFileLike } from '@/lib/core/utils/user-file'

const logger = createLogger('GeneratedImageProviders')

const ARK_BASE_URL = env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3'
const ARK_IMAGE_ENDPOINT = `${ARK_BASE_URL.replace(/\/$/, '')}/images/generations`

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

function getArkApiKey(): string {
  const apiKey = env.ARK_API_KEY
  if (!apiKey) {
    throw new Error('ARK_API_KEY is not configured')
  }
  return apiKey
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

async function generateImageWithGemini({
  model,
  prompt,
  aspectRatio,
  referenceContext,
}: GenerateImageWithProviderInput): Promise<GeneratedImageProviderResult> {
  const apiKey = getRotatingApiKey('gemini')
  const ai = new GoogleGenAI({ apiKey })
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

  const textSections = [...(referenceContext?.text ?? [])].filter((section) => section.trim().length > 0)
  const composedPrompt = [
    prompt,
    ...textSections.map((section, index) => `Reference context ${index + 1}:\n${section}`),
    `Use a ${aspectRatio} aspect ratio.`,
  ]
    .filter(Boolean)
    .join('\n\n')

  parts.push({ text: composedPrompt })

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

export async function generateImageWithProvider({
  model,
  prompt,
  aspectRatio,
  referenceContext,
}: GenerateImageWithProviderInput): Promise<GeneratedImageProviderResult> {
  if (model === 'gemini-3.1-flash-image-preview') {
    return generateImageWithGemini({
      model,
      prompt,
      aspectRatio,
      referenceContext,
    })
  }

  const promptWithReferenceText = [
    prompt,
    ...(referenceContext?.text ?? []).filter((section) => section.trim().length > 0),
  ]
    .filter(Boolean)
    .join('\n\n')
  const providerModel = JIMENG_PROVIDER_MODEL_MAP[model]
  if (!providerModel) {
    throw new Error(`Unsupported image model: ${model}`)
  }
  const apiKey = getArkApiKey()
  const response = await fetch(ARK_IMAGE_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
      keyLength: apiKey.length,
      keyFingerprint: getKeyFingerprint(apiKey),
      looksBase64Encoded: looksLikeBase64Value(apiKey),
      baseUrl: ARK_IMAGE_ENDPOINT,
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
