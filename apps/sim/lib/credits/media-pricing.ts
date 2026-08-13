import type { AudioGenerationModelId } from '@/lib/generated-media/audio/audio-generation-utils'
import type { ImageGenerationModelId } from '@/lib/generated-media/image/image-generation-utils'
import type {
  VideoGenerationModelId,
  VideoResolution,
} from '@/lib/generated-media/video/video-generation-utils'

export type CreditCapability = 'image' | 'audio' | 'video' | 'presentation'

const IMAGE_CREDITS: Record<ImageGenerationModelId, number> = {
  'jimeng-4.0': 12,
  'jimeng-4.5': 20,
  'gemini-3.1-flash-image-preview': 24,
  'gemini-3-pro-image': 42,
  'gemini-3-pro-image-preview': 42,
}

const AUDIO_CREDITS: Record<AudioGenerationModelId, number> = {
  'suno-v4-beta': 25,
  'suno-v4.5-beta': 35,
  'suno-v5-beta': 50,
}

const VIDEO_CREDITS_PER_SECOND: Record<VideoGenerationModelId, number> = {
  'wan2.6-t2v': 18,
  'wan2.6-i2v-flash': 22,
  'wan2.7-i2v': 34,
}

/** Returns the fixed, platform-controlled price for a single media request. */
export function getMediaCreditQuote(params: {
  capability: CreditCapability
  modelId: string
  durationSeconds?: number
  resolution?: VideoResolution
}): number {
  if (params.capability === 'image') {
    const credits = IMAGE_CREDITS[params.modelId as ImageGenerationModelId]
    if (credits) return credits
  }
  if (params.capability === 'audio') {
    const credits = AUDIO_CREDITS[params.modelId as AudioGenerationModelId]
    if (credits) return credits
  }
  if (params.capability === 'video') {
    const perSecond = VIDEO_CREDITS_PER_SECOND[params.modelId as VideoGenerationModelId]
    const duration = params.durationSeconds
    if (perSecond && duration && Number.isInteger(duration) && duration > 0) {
      return Math.ceil(perSecond * duration * (params.resolution === '1080P' ? 1.5 : 1))
    }
  }
  if (params.capability === 'presentation' && params.modelId === 'gpt-image-2') return 6
  throw new Error(`No platform credit price configured for ${params.capability}/${params.modelId}`)
}

export const MEDIA_CREDIT_PRICE_LIST = [
  ...Object.entries(IMAGE_CREDITS).map(([modelId, credits]) => ({
    capability: 'image',
    modelId,
    credits,
    unit: '每张',
  })),
  ...Object.entries(AUDIO_CREDITS).map(([modelId, credits]) => ({
    capability: 'audio',
    modelId,
    credits,
    unit: '每次',
  })),
  ...Object.entries(VIDEO_CREDITS_PER_SECOND).map(([modelId, credits]) => ({
    capability: 'video',
    modelId,
    credits,
    unit: '每秒（720P）',
  })),
] as const
