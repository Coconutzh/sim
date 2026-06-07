import {
  type AudioGenerationModelId,
  type AudioGenerationParametersValue,
  DEFAULT_AUDIO_MODEL,
  DEFAULT_AUDIO_PARAMETERS,
  isAudioGenerationModel,
} from '@/lib/generated-media/audio/audio-generation-utils'
import {
  DEFAULT_VIDEO_DURATION_SECONDS,
  DEFAULT_VIDEO_RESOLUTION,
  type VideoResolution,
} from '@/lib/generated-media/video/video-generation-utils'

export interface VideoParametersValue {
  resolution: VideoResolution
  duration: number
  promptExtend: boolean
  watermark: boolean
}

export const DEFAULT_VIDEO_PARAMETERS: VideoParametersValue = {
  resolution: DEFAULT_VIDEO_RESOLUTION,
  duration: DEFAULT_VIDEO_DURATION_SECONDS,
  promptExtend: true,
  watermark: false,
}

function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

export function normalizeVideoResolution(value: unknown): VideoResolution {
  return value === '1080P' || value === '720P' ? value : DEFAULT_VIDEO_RESOLUTION
}

export function normalizeVideoDuration(value: unknown): number {
  return Math.max(2, Math.min(15, Math.round(coerceNumber(value, DEFAULT_VIDEO_DURATION_SECONDS))))
}

export function normalizeVideoParameters(value: unknown): VideoParametersValue {
  if (typeof value === 'string') {
    return normalizeVideoParameters(parseJsonString(value))
  }
  if (!value || typeof value !== 'object') {
    return DEFAULT_VIDEO_PARAMETERS
  }

  const candidate = value as Partial<VideoParametersValue>
  return {
    resolution: normalizeVideoResolution(candidate.resolution),
    duration: normalizeVideoDuration(candidate.duration),
    promptExtend: candidate.promptExtend ?? true,
    watermark: candidate.watermark ?? false,
  }
}

export function normalizeAudioModel(value: unknown): AudioGenerationModelId {
  return isAudioGenerationModel(value) ? value : DEFAULT_AUDIO_MODEL
}

export function normalizeAudioParameters(value: unknown): AudioGenerationParametersValue {
  if (typeof value === 'string') {
    return normalizeAudioParameters(parseJsonString(value))
  }
  if (!value || typeof value !== 'object') {
    return DEFAULT_AUDIO_PARAMETERS
  }

  const candidate = value as Partial<AudioGenerationParametersValue>
  return {
    customMode: candidate.customMode ?? DEFAULT_AUDIO_PARAMETERS.customMode,
    instrumental: candidate.instrumental ?? DEFAULT_AUDIO_PARAMETERS.instrumental,
    style: typeof candidate.style === 'string' ? candidate.style : '',
    title: typeof candidate.title === 'string' ? candidate.title : '',
    negativeTags: typeof candidate.negativeTags === 'string' ? candidate.negativeTags : '',
    vocalGender: typeof candidate.vocalGender === 'string' ? candidate.vocalGender : '',
  }
}
