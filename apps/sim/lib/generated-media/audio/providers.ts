import { createLogger } from '@sim/logger'
import { resolveContentService } from '@/lib/content-canvas/service-config'
import type {
  AudioGenerationModelId,
  AudioGenerationParametersValue,
} from '@/lib/generated-media/audio/audio-generation-utils'

const logger = createLogger('GeneratedAudioProviders')
const EVOLINK_POLL_INTERVAL_MS = 1500

interface GenerateAudioWithProviderInput {
  model: AudioGenerationModelId
  prompt: string
  parameters: AudioGenerationParametersValue
  referenceContext?: {
    text: string[]
  }
}

export interface GeneratedAudioProviderResult {
  buffer: Buffer
  mimeType: string
  provider: 'evolink'
  providerModel: AudioGenerationModelId
  taskId: string
}

interface EvolinkTaskPayload {
  id?: string
  task_id?: string
  status?: string
  message?: string
  error?: string | { code?: string; message?: string; type?: string }
  results?: unknown
  data?: {
    id?: string
    task_id?: string
    status?: string
    message?: string
    error?: string | { code?: string; message?: string; type?: string }
    results?: unknown
  }
}

function getProviderErrorMessage(payload: EvolinkTaskPayload, fallback: string) {
  const errorMessage =
    typeof payload.error === 'object' && payload.error
      ? payload.error.message
      : typeof payload.error === 'string'
        ? payload.error
        : undefined
  const nestedErrorMessage =
    typeof payload.data?.error === 'object' && payload.data.error
      ? payload.data.error.message
      : typeof payload.data?.error === 'string'
        ? payload.data.error
        : undefined

  return (
    errorMessage ||
    payload.message ||
    nestedErrorMessage ||
    payload.data?.message ||
    fallback
  )
}

function getTaskId(payload: EvolinkTaskPayload) {
  const taskId = payload.id || payload.task_id || payload.data?.id || payload.data?.task_id
  if (!taskId) {
    throw new Error('EvoLink did not return a task id')
  }
  return taskId
}

function normalizeTaskStatus(status: string | undefined) {
  const normalized = status?.trim().toUpperCase()
  if (!normalized) return null
  if (normalized === 'SUCCESS' || normalized === 'SUCCEEDED' || normalized === 'COMPLETED') {
    return 'SUCCEEDED'
  }
  if (normalized === 'FAILED' || normalized === 'FAILURE') {
    return 'FAILED'
  }
  if (normalized === 'CANCELED' || normalized === 'CANCELLED') {
    return 'CANCELED'
  }
  return normalized
}

function getTaskStatus(payload: EvolinkTaskPayload) {
  return normalizeTaskStatus(payload.status || payload.data?.status)
}

function getAudioResultUrls(payload: EvolinkTaskPayload) {
  const candidates = [payload.results, payload.data?.results]

  return candidates.flatMap((candidate) => {
    if (!Array.isArray(candidate)) return []
    return candidate.flatMap((item) => {
      if (typeof item === 'string' && item.length > 0) return [item]
      if (item && typeof item === 'object') {
        const url = (item as { url?: unknown; audio_url?: unknown }).url
        if (typeof url === 'string' && url.length > 0) return [url]
        const audioUrl = (item as { url?: unknown; audio_url?: unknown }).audio_url
        if (typeof audioUrl === 'string' && audioUrl.length > 0) return [audioUrl]
      }
      return []
    })
  })
}

function buildEvolinkPayload({
  model,
  prompt,
  parameters,
  referenceContext,
}: GenerateAudioWithProviderInput) {
  const promptWithContext = [
    prompt,
    ...(referenceContext?.text ?? []).filter((section) => section.trim().length > 0),
  ]
    .filter(Boolean)
    .join('\n\n')

  const payload: Record<string, unknown> = {
    model,
    custom_mode: parameters.customMode,
    instrumental: parameters.instrumental,
    prompt: promptWithContext,
  }

  if (parameters.customMode) {
    if (parameters.style.trim()) payload.style = parameters.style.trim()
    if (parameters.title.trim()) payload.title = parameters.title.trim()
    if (parameters.negativeTags.trim()) payload.negative_tags = parameters.negativeTags.trim()
    if (parameters.vocalGender.trim()) payload.vocal_gender = parameters.vocalGender.trim()
  }

  return payload
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function generateAudioWithProvider({
  model,
  prompt,
  parameters,
  referenceContext,
}: GenerateAudioWithProviderInput): Promise<GeneratedAudioProviderResult> {
  const service = resolveContentService({ capability: 'audio', modelId: model })
  if (!service.apiKey) {
    throw new Error(`No API key configured for content-canvas audio model ${model}`)
  }

  const baseUrl = service.baseUrl.replace(/\/$/, '')
  const createEndpoint = `${baseUrl}/audios/generations`
  const tasksEndpoint = `${baseUrl}/tasks`
  const payload = buildEvolinkPayload({ model, prompt, parameters, referenceContext })

  const createResponse = await fetch(createEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${service.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const createPayload = (await createResponse.json().catch(() => ({}))) as EvolinkTaskPayload
  if (!createResponse.ok) {
    const errorMessage = getProviderErrorMessage(
      createPayload,
      `EvoLink audio request failed (${createResponse.status})`
    )
    logger.error('EvoLink audio task creation failed', {
      model,
      status: createResponse.status,
      error: errorMessage,
    })
    throw new Error(errorMessage)
  }

  const taskId = getTaskId(createPayload)
  let latestPayload = createPayload

  while (true) {
    const status = getTaskStatus(latestPayload)
    if (status === 'SUCCEEDED') break
    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error(getProviderErrorMessage(latestPayload, `EvoLink task ${status.toLowerCase()}`))
    }

    await sleep(EVOLINK_POLL_INTERVAL_MS)

    const pollResponse = await fetch(`${tasksEndpoint}/${taskId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${service.apiKey}`,
      },
    })
    latestPayload = (await pollResponse.json().catch(() => ({}))) as EvolinkTaskPayload

    if (!pollResponse.ok) {
      throw new Error(
        getProviderErrorMessage(latestPayload, `EvoLink task polling failed (${pollResponse.status})`)
      )
    }
  }

  const resultUrl = getAudioResultUrls(latestPayload)[0]
  if (!resultUrl) {
    throw new Error('EvoLink task succeeded but returned no audio result URL')
  }

  const downloadResponse = await fetch(resultUrl)
  if (!downloadResponse.ok) {
    throw new Error(`Failed to download generated audio (${downloadResponse.status})`)
  }

  return {
    buffer: Buffer.from(await downloadResponse.arrayBuffer()),
    mimeType: downloadResponse.headers.get('content-type') || 'audio/mpeg',
    provider: 'evolink',
    providerModel: model,
    taskId,
  }
}
