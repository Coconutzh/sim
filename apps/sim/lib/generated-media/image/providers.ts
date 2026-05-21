import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import {
  type ImageAspectRatioValue,
  type ImageGenerationModelId,
  mapImageAspectRatioToProviderSize,
} from '@/lib/generated-media/image/image-generation-utils'

const logger = createLogger('GeneratedImageProviders')

const ARK_BASE_URL = env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3'
const ARK_IMAGE_ENDPOINT = `${ARK_BASE_URL.replace(/\/$/, '')}/images/generations`

const JIMENG_PROVIDER_MODEL_MAP: Record<ImageGenerationModelId, string> = {
  'jimeng-4.0': 'doubao-seedream-4-0-250828',
  'jimeng-4.5': 'doubao-seedream-4-5-251128',
}

interface GenerateImageWithProviderInput {
  model: ImageGenerationModelId
  prompt: string
  aspectRatio: ImageAspectRatioValue
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

export async function generateImageWithProvider({
  model,
  prompt,
  aspectRatio,
}: GenerateImageWithProviderInput): Promise<GeneratedImageProviderResult> {
  const providerModel = JIMENG_PROVIDER_MODEL_MAP[model]
  const apiKey = getArkApiKey()
  const response = await fetch(ARK_IMAGE_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: providerModel,
      prompt,
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
