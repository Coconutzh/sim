import { GoogleGenAI, type Part } from '@google/genai'
import { createLogger } from '@sim/logger'
import { resolveContentService } from '@/lib/content-canvas/service-config'
import type { UserFileLike } from '@/lib/core/utils/user-file'
import {
  type ImageAspectRatioValue,
  type ImageGenerationModelId,
  type ImageResolutionValue,
  mapImageAspectRatioToProviderSize,
} from '@/lib/generated-media/image/image-generation-utils'

const logger = createLogger('GeneratedImageProviders')
const EVOLINK_IMAGE_TASK_POLL_INTERVAL_MS = 1000
const EVOLINK_IMAGE_TASK_MAX_ATTEMPTS = 90
const EVOLINK_FILE_UPLOAD_BASE_URL = 'https://files-api.evolink.ai/api/v1'
const GEMINI_PRO_IMAGE_MODEL = 'gemini-3-pro-image' as const
const GEMINI_PRO_IMAGE_PREVIEW_MODEL = 'gemini-3-pro-image-preview' as const

const JIMENG_PROVIDER_MODEL_MAP: Partial<Record<ImageGenerationModelId, string>> = {
  'jimeng-4.0': 'doubao-seedream-4-0-250828',
  'jimeng-4.5': 'doubao-seedream-4-5-251128',
}

interface GenerateImageWithProviderInput {
  model: ImageGenerationModelId
  prompt: string
  aspectRatio: ImageAspectRatioValue
  resolution?: ImageResolutionValue
  referenceContext?: {
    text: string[]
    images: UserFileLike[]
  }
  abortSignal?: AbortSignal
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

function throwIfAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw new Error('Request was cancelled')
  }
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
  resolution,
  referenceContext,
}: Pick<
  GenerateImageWithProviderInput,
  'prompt' | 'aspectRatio' | 'resolution' | 'referenceContext'
>) {
  const textSections = [...(referenceContext?.text ?? [])].filter(
    (section) => section.trim().length > 0
  )
  return [
    prompt,
    ...textSections.map((section, index) => `Reference context ${index + 1}:\n${section}`),
    resolution ? `Use ${resolution} output resolution.` : null,
    `Use a ${aspectRatio} aspect ratio.`,
  ]
    .filter(Boolean)
    .join('\n\n')
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
    ...(Array.isArray(payload?.choices?.[0]?.message?.images)
      ? payload.choices[0].message.images
      : []),
    ...(Array.isArray(payload?.choices?.[0]?.message?.content)
      ? payload.choices[0].message.content
      : []),
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
          revisedPrompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined,
        }
      }
    }
  }

  return null
}

function getProviderErrorMessage(payload: Record<string, unknown>, fallback: string): string {
  return (
    (payload.error as { message?: string } | undefined)?.message ||
    (typeof payload.message === 'string' ? payload.message : undefined) ||
    fallback
  )
}

function getEvolinkFileUploadErrorMessage(
  payload: Record<string, unknown>,
  fallback: string
): string {
  return (
    getProviderErrorMessage(payload, '') ||
    (typeof payload.msg === 'string' ? payload.msg : undefined) ||
    fallback
  )
}

function isEvolinkCompatibleBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.endsWith('evolink.ai')
  } catch {
    return false
  }
}

function getCompatibleImageDataUrl(image: UserFileLike): string | null {
  if (image.base64 && image.type) {
    return `data:${image.type};base64,${image.base64}`
  }

  const url = image.url?.trim()
  if (url?.startsWith('data:image/')) {
    return url
  }

  return null
}

function getCompatibleImageFileName(image: UserFileLike): string | undefined {
  const name = image.name?.trim()
  if (name) return name

  const keyFileName = image.key?.split('/').pop()?.trim()
  if (keyFileName) return keyFileName

  if (image.type?.includes('jpeg') || image.type?.includes('jpg')) return 'reference.jpg'
  if (image.type?.includes('webp')) return 'reference.webp'
  if (image.type?.includes('gif')) return 'reference.gif'
  return 'reference.png'
}

function getUploadedEvolinkFileUrl(payload: Record<string, unknown>): string | null {
  const data = payload.data
  if (!data || typeof data !== 'object') return null
  const fileUrl = (data as Record<string, unknown>).file_url
  return typeof fileUrl === 'string' && fileUrl.trim().length > 0 ? fileUrl : null
}

async function uploadEvolinkBase64Image({
  apiKey,
  image,
  dataUrl,
  abortSignal,
}: {
  apiKey: string
  image: UserFileLike
  dataUrl: string
  abortSignal?: AbortSignal
}): Promise<string> {
  const response = await fetch(`${EVOLINK_FILE_UPLOAD_BASE_URL}/files/upload/base64`, {
    method: 'POST',
    signal: abortSignal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      base64_data: dataUrl,
      file_name: getCompatibleImageFileName(image),
      upload_path: 'sim-content-canvas',
    }),
  })

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(
      getEvolinkFileUploadErrorMessage(payload, `Evolink image upload failed (${response.status})`)
    )
  }

  const fileUrl = getUploadedEvolinkFileUrl(payload)
  if (!fileUrl) {
    throw new Error('Evolink image upload returned no file URL')
  }

  return fileUrl
}

async function toCompatibleImageUrl({
  image,
  baseUrl,
  apiKey,
  abortSignal,
}: {
  image: UserFileLike
  baseUrl: string
  apiKey: string
  abortSignal?: AbortSignal
}): Promise<string | null> {
  const dataUrl = getCompatibleImageDataUrl(image)
  if (dataUrl) {
    if (isEvolinkCompatibleBaseUrl(baseUrl)) {
      return uploadEvolinkBase64Image({ apiKey, image, dataUrl, abortSignal })
    }
    return dataUrl
  }

  const url = image.url?.trim()
  return url && url.length > 0 ? url : null
}

function extractTaskId(payload: Record<string, unknown>): string | null {
  const data = payload.data
  if (typeof payload.task_id === 'string') return payload.task_id
  if (typeof payload.taskId === 'string') return payload.taskId
  if (typeof payload.id === 'string') return payload.id
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    if (typeof record.task_id === 'string') return record.task_id
    if (typeof record.taskId === 'string') return record.taskId
    if (typeof record.id === 'string') return record.id
  }
  return null
}

function getTaskStatus(payload: Record<string, unknown>): string | null {
  const status = payload.status
  if (typeof status === 'string') return status.toLowerCase()
  const data = payload.data
  if (data && typeof data === 'object') {
    const dataStatus = (data as Record<string, unknown>).status
    if (typeof dataStatus === 'string') return dataStatus.toLowerCase()
  }
  return null
}

function collectImageUrls(value: unknown, urls: string[] = []): string[] {
  if (!value) return urls
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) || value.startsWith('data:image/')) {
      urls.push(value)
    }
    return urls
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectImageUrls(item, urls)
    }
    return urls
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['url', 'image_url', 'imageUrl', 'origin_image_url']) {
      collectImageUrls(record[key], urls)
    }
    for (const key of [
      'images',
      'image_urls',
      'imageUrls',
      'output',
      'result',
      'results',
      'data',
    ]) {
      collectImageUrls(record[key], urls)
    }
  }
  return urls
}

function extractGeneratedImageUrl(payload: Record<string, unknown>): string | null {
  const resultFields = [
    payload.output,
    payload.result,
    payload.results,
    payload.images,
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>).output
      : undefined,
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>).result
      : undefined,
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>).results
      : undefined,
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>).images
      : undefined,
  ]

  for (const field of resultFields) {
    const [url] = collectImageUrls(field)
    if (url) return url
  }

  return collectImageUrls(payload)[0] ?? null
}

function isSuccessfulTaskStatus(status: string | null): boolean {
  return (
    status === 'succeeded' || status === 'success' || status === 'completed' || status === 'done'
  )
}

function isFailedTaskStatus(status: string | null): boolean {
  return status === 'failed' || status === 'failure' || status === 'error' || status === 'cancelled'
}

function isModelFallbackError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('not found') ||
    message.includes('unsupported') ||
    message.includes('invalid model') ||
    message.includes('unknown model') ||
    message.includes('no available service for model')
  )
}

function isGeminiProImageModel(model: ImageGenerationModelId): boolean {
  return model === GEMINI_PRO_IMAGE_MODEL || model === GEMINI_PRO_IMAGE_PREVIEW_MODEL
}

function buildGeminiCompatibleImageRequestBody({
  model,
  prompt,
  aspectRatio,
  resolution,
  referenceContext,
  imageUrls,
}: Pick<
  GenerateImageWithProviderInput,
  'model' | 'prompt' | 'aspectRatio' | 'resolution' | 'referenceContext'
> & {
  imageUrls: string[]
}): Record<string, unknown> {
  const requestBody: Record<string, unknown> = {
    model,
    prompt: buildImagePrompt({ prompt, aspectRatio, resolution, referenceContext }),
  }

  if (isGeminiProImageModel(model) && resolution) {
    requestBody.size = aspectRatio
    requestBody.quality = resolution
  } else {
    requestBody.size = resolution ?? aspectRatio
  }

  if (imageUrls.length > 0) {
    requestBody.image_urls = imageUrls
  }

  return requestBody
}

async function delay(ms: number, abortSignal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms)
    abortSignal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        reject(new Error('Request was cancelled'))
      },
      { once: true }
    )
  })
}

async function generateImageWithGeminiNative({
  model,
  prompt,
  aspectRatio,
  resolution,
  referenceContext,
  abortSignal,
}: GenerateImageWithProviderInput): Promise<GeneratedImageProviderResult> {
  throwIfAborted(abortSignal)
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
    text: buildImagePrompt({ prompt, aspectRatio, resolution, referenceContext }),
  })

  const config: {
    responseModalities: string[]
    imageConfig?: { imageSize: ImageResolutionValue }
  } = {
    responseModalities: ['IMAGE', 'TEXT'],
    ...(resolution ? { imageConfig: { imageSize: resolution } } : {}),
  }

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config,
  })
  throwIfAborted(abortSignal)

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
    revisedPrompt:
      responseParts
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
  resolution,
  referenceContext,
  abortSignal,
}: GenerateImageWithProviderInput): Promise<GeneratedImageProviderResult> {
  throwIfAborted(abortSignal)
  const service = resolveContentService({ capability: 'image', modelId: model })
  if (!service.apiKey) {
    throw new Error(`No API key configured for content-canvas image model ${model}`)
  }
  const apiKey = service.apiKey

  const baseUrl = service.baseUrl.replace(/\/$/, '')
  const imageUrls = (
    await Promise.all(
      (referenceContext?.images ?? []).map((image) =>
        toCompatibleImageUrl({
          image,
          baseUrl,
          apiKey,
          abortSignal,
        })
      )
    )
  ).filter((value): value is string => Boolean(value))
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    signal: abortSignal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(
      buildGeminiCompatibleImageRequestBody({
        model,
        prompt,
        aspectRatio,
        resolution,
        referenceContext,
        imageUrls,
      })
    ),
  })

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(
      getProviderErrorMessage(
        payload,
        `Gemini compatible image request failed (${response.status})`
      )
    )
  }

  const immediateResult = parseCompatibleImagePayload(payload)
  if (immediateResult) {
    return {
      buffer: immediateResult.buffer,
      mimeType: immediateResult.mimeType,
      provider: 'gemini-compatible',
      providerModel: model,
      revisedPrompt: immediateResult.revisedPrompt,
    }
  }

  const taskId = extractTaskId(payload)
  if (!taskId) {
    throw new Error('Gemini compatible image request returned no task id')
  }

  let imageUrl: string | null = null
  let taskPayload: Record<string, unknown> = payload
  for (let attempt = 0; attempt < EVOLINK_IMAGE_TASK_MAX_ATTEMPTS; attempt++) {
    throwIfAborted(abortSignal)
    if (attempt > 0) {
      await delay(EVOLINK_IMAGE_TASK_POLL_INTERVAL_MS, abortSignal)
    }

    const taskResponse = await fetch(`${baseUrl}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      signal: abortSignal,
      headers: {
        Authorization: `Bearer ${service.apiKey}`,
      },
    })
    taskPayload = (await taskResponse.json().catch(() => ({}))) as Record<string, unknown>
    if (!taskResponse.ok) {
      throw new Error(
        getProviderErrorMessage(
          taskPayload,
          `Gemini compatible image task request failed (${taskResponse.status})`
        )
      )
    }

    const status = getTaskStatus(taskPayload)
    const generatedImageUrl = extractGeneratedImageUrl(taskPayload)
    if (generatedImageUrl && (isSuccessfulTaskStatus(status) || !status)) {
      imageUrl = generatedImageUrl
      break
    }
    if (isFailedTaskStatus(status)) {
      throw new Error(getProviderErrorMessage(taskPayload, 'Gemini compatible image task failed'))
    }
  }

  if (!imageUrl) {
    throw new Error('Gemini compatible image task did not complete in time')
  }

  throwIfAborted(abortSignal)
  const imageResponse = await fetch(imageUrl, { signal: abortSignal })
  if (!imageResponse.ok) {
    throw new Error(`Failed to download generated image (${imageResponse.status})`)
  }

  return {
    buffer: Buffer.from(await imageResponse.arrayBuffer()),
    mimeType: imageResponse.headers.get('content-type') || inferMimeTypeFromUrl(imageUrl),
    provider: 'gemini-compatible',
    providerModel: model,
    revisedPrompt:
      typeof taskPayload.revised_prompt === 'string' ? taskPayload.revised_prompt : undefined,
  }
}

async function generateImageWithArk({
  model,
  prompt,
  aspectRatio,
  referenceContext,
  abortSignal,
}: GenerateImageWithProviderInput): Promise<GeneratedImageProviderResult> {
  throwIfAborted(abortSignal)
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
    signal: abortSignal,
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

  throwIfAborted(abortSignal)
  const imageResponse = await fetch(firstResult.url, { signal: abortSignal })
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

  if (
    params.model === 'gemini-3.1-flash-image-preview' ||
    params.model === GEMINI_PRO_IMAGE_MODEL ||
    params.model === GEMINI_PRO_IMAGE_PREVIEW_MODEL
  ) {
    try {
      if (service.kind === 'openai-compatible') {
        return await generateImageWithGeminiCompatible(params)
      }
      return await generateImageWithGeminiNative(params)
    } catch (error) {
      if (params.model !== GEMINI_PRO_IMAGE_MODEL || !isModelFallbackError(error)) {
        throw error
      }
      logger.warn('Falling back to Gemini 3 Pro Image preview model', {
        model: params.model,
        fallbackModel: GEMINI_PRO_IMAGE_PREVIEW_MODEL,
      })
      const fallbackParams: GenerateImageWithProviderInput = {
        ...params,
        model: GEMINI_PRO_IMAGE_PREVIEW_MODEL,
      }
      if (service.kind === 'openai-compatible') {
        return generateImageWithGeminiCompatible(fallbackParams)
      }
      return generateImageWithGeminiNative(fallbackParams)
    }
  }

  return generateImageWithArk(params)
}
