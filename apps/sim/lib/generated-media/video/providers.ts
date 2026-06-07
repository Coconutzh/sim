import { createLogger } from '@sim/logger'
import { resolveContentService } from '@/lib/content-canvas/service-config'
import { ensureAbsoluteUrl, isLocalhostUrl } from '@/lib/core/utils/urls'
import type { UserFileLike } from '@/lib/core/utils/user-file'
import {
  getVideoMediaFileForType,
  getVideoSizeForGeneration,
  type VideoFrameAspectRatioPreset,
  type VideoGenerationModelId,
  type VideoMediaType,
  type VideoResolution,
} from '@/lib/generated-media/video/video-generation-utils'
import { isInternalFileUrl } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'

const logger = createLogger('GeneratedVideoProviders')
const DASHSCOPE_POLL_INTERVAL_MS = 1500

interface GenerateVideoWithProviderInput {
  model: VideoGenerationModelId
  prompt: string
  media: Array<{
    type: VideoMediaType
    file: UserFileLike
  }>
  parameters: {
    aspectRatioPreset: VideoFrameAspectRatioPreset
    resolution: VideoResolution
    duration: number
    promptExtend: boolean
    watermark: boolean
  }
  abortSignal?: AbortSignal
}

export interface GeneratedVideoProviderResult {
  buffer: Buffer
  mimeType: string
  provider: 'dashscope'
  providerModel: VideoGenerationModelId
  taskId: string
  revisedPrompt?: string
}

interface DashScopeTaskPayload {
  output?: {
    task_id?: string
    task_status?: string
    video_url?: string
    video_urls?: Array<{ url?: string }>
    results?: Array<{ url?: string }>
    orig_prompt?: string
    revised_prompt?: string
    refined_prompt?: string
    message?: string
    code?: string
  }
  request_id?: string
  message?: string
  code?: string
}

function getProviderErrorMessage(payload: DashScopeTaskPayload, fallback: string) {
  return (
    payload.output?.message || payload.message || payload.output?.code || payload.code || fallback
  )
}

function getTaskId(payload: DashScopeTaskPayload) {
  const taskId = payload.output?.task_id
  if (!taskId) {
    throw new Error('DashScope did not return a task id')
  }
  return taskId
}

function getVideoUrl(payload: DashScopeTaskPayload) {
  return (
    payload.output?.video_url ||
    payload.output?.video_urls?.find((item) => item.url)?.url ||
    payload.output?.results?.find((item) => item.url)?.url ||
    null
  )
}

function getRevisedPrompt(payload: DashScopeTaskPayload) {
  return (
    payload.output?.revised_prompt || payload.output?.refined_prompt || payload.output?.orig_prompt
  )
}

function isPrivateHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return true
  if (normalized === '0.0.0.0') return true
  if (normalized.endsWith('.local')) return true
  if (/^10\.\d+\.\d+\.\d+$/.test(normalized)) return true
  if (/^192\.168\.\d+\.\d+$/.test(normalized)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(normalized)) return true
  return false
}

function arrayBufferToBase64(buffer: Buffer) {
  return buffer.toString('base64')
}

function getImageMimeType(file: UserFileLike) {
  if (file.type?.startsWith('image/')) {
    return file.type
  }

  const normalizedName = `${file.name ?? ''} ${file.url ?? ''}`.toLowerCase()
  if (normalizedName.includes('.webp')) return 'image/webp'
  if (normalizedName.includes('.jpg') || normalizedName.includes('.jpeg')) return 'image/jpeg'
  return 'image/png'
}

async function resolveDashScopeImageInput(file: UserFileLike) {
  const originalUrl = file.url?.trim()
  if (!originalUrl) {
    throw new Error('Frame images must have a valid URL before sending to DashScope.')
  }

  if (originalUrl.startsWith('data:image/')) {
    return originalUrl
  }

  const absoluteUrl = ensureAbsoluteUrl(originalUrl)

  let parsedUrl: URL
  try {
    parsedUrl = new URL(absoluteUrl)
  } catch {
    throw new Error('Frame images must have valid HTTP or HTTPS URLs before sending to DashScope.')
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('DashScope only supports HTTP or HTTPS image URLs for first and last frames.')
  }

  if (!isLocalhostUrl(parsedUrl.toString()) && !isPrivateHostname(parsedUrl.hostname)) {
    return parsedUrl.toString()
  }

  const fileBuffer = await downloadFileFromUrl(
    isInternalFileUrl(originalUrl) ? originalUrl : absoluteUrl
  )

  return `data:${getImageMimeType(file)};base64,${arrayBufferToBase64(fileBuffer)}`
}

async function buildDashScopePayload({
  model,
  prompt,
  media,
  parameters,
}: GenerateVideoWithProviderInput) {
  if (model === 'wan2.7-i2v') {
    return {
      model,
      input: {
        prompt,
        media: await Promise.all(
          media.map(async (item) => ({
            type: item.type,
            url: await resolveDashScopeImageInput(item.file),
          }))
        ),
      },
      parameters: {
        resolution: parameters.resolution,
        duration: parameters.duration,
        prompt_extend: parameters.promptExtend,
        watermark: parameters.watermark,
      },
    }
  }

  const size = getVideoSizeForGeneration({
    aspectRatioPreset: parameters.aspectRatioPreset,
    resolution: parameters.resolution,
  })

  if (model === 'wan2.6-t2v') {
    return {
      model,
      input: {
        prompt,
      },
      parameters: {
        size,
        duration: parameters.duration,
        prompt_extend: parameters.promptExtend,
        shot_type: 'single',
        watermark: parameters.watermark,
      },
    }
  }

  const firstFrameFile = getVideoMediaFileForType(media, 'first_frame')
  if (!firstFrameFile) {
    throw new Error('wan2.6-i2v-flash requires a first_frame image.')
  }

  return {
    model,
    input: {
      prompt,
      img_url: await resolveDashScopeImageInput(firstFrameFile),
    },
    parameters: {
      size,
      duration: parameters.duration,
      prompt_extend: parameters.promptExtend,
      shot_type: 'single',
      watermark: parameters.watermark,
      audio: true,
    },
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function abortableSleep(ms: number, abortSignal?: AbortSignal) {
  if (!abortSignal) {
    await sleep(ms)
    return
  }
  if (abortSignal.aborted) throw new Error('Request was cancelled')
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms)
    const abort = () => {
      clearTimeout(timeout)
      reject(new Error('Request was cancelled'))
    }
    abortSignal.addEventListener('abort', abort, { once: true })
  })
}

function throwIfAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw new Error('Request was cancelled')
  }
}

export async function generateVideoWithProvider({
  model,
  prompt,
  media,
  parameters,
  abortSignal,
}: GenerateVideoWithProviderInput): Promise<GeneratedVideoProviderResult> {
  throwIfAborted(abortSignal)
  const service = resolveContentService({ capability: 'video', modelId: model })
  if (!service.apiKey) {
    throw new Error(`No API key configured for content-canvas video model ${model}`)
  }

  const baseUrl = service.baseUrl.replace(/\/$/, '')
  const createEndpoint = `${baseUrl}/services/aigc/video-generation/video-synthesis`
  const tasksEndpoint = `${baseUrl}/tasks`
  const payload = await buildDashScopePayload({
    model,
    prompt,
    media,
    parameters,
  })

  const createResponse = await fetch(createEndpoint, {
    method: 'POST',
    signal: abortSignal,
    headers: {
      Authorization: `Bearer ${service.apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(payload),
  })

  const createPayload = (await createResponse.json().catch(() => ({}))) as DashScopeTaskPayload
  if (!createResponse.ok) {
    const errorMessage = getProviderErrorMessage(
      createPayload,
      `DashScope video request failed (${createResponse.status})`
    )
    logger.error('DashScope video task creation failed', {
      model,
      status: createResponse.status,
      error: errorMessage,
    })
    throw new Error(errorMessage)
  }

  const taskId = getTaskId(createPayload)
  let latestPayload = createPayload

  while (true) {
    const status = latestPayload.output?.task_status
    if (status === 'SUCCEEDED') break
    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error(
        getProviderErrorMessage(
          latestPayload,
          `DashScope task ${status?.toLowerCase() ?? 'failed'}`
        )
      )
    }

    await abortableSleep(DASHSCOPE_POLL_INTERVAL_MS, abortSignal)

    const pollResponse = await fetch(`${tasksEndpoint}/${taskId}`, {
      method: 'GET',
      signal: abortSignal,
      headers: {
        Authorization: `Bearer ${service.apiKey}`,
      },
    })
    latestPayload = (await pollResponse.json().catch(() => ({}))) as DashScopeTaskPayload

    if (!pollResponse.ok) {
      throw new Error(
        getProviderErrorMessage(
          latestPayload,
          `DashScope task polling failed (${pollResponse.status})`
        )
      )
    }
  }

  const videoUrl = getVideoUrl(latestPayload)
  if (!videoUrl) {
    throw new Error('DashScope task succeeded but returned no video URL')
  }

  throwIfAborted(abortSignal)
  const downloadResponse = await fetch(videoUrl, { signal: abortSignal })
  if (!downloadResponse.ok) {
    throw new Error(`Failed to download generated video (${downloadResponse.status})`)
  }

  return {
    buffer: Buffer.from(await downloadResponse.arrayBuffer()),
    mimeType: downloadResponse.headers.get('content-type') || 'video/mp4',
    provider: 'dashscope',
    providerModel: model,
    taskId,
    revisedPrompt: getRevisedPrompt(latestPayload),
  }
}
