import { getContentCanvasModelFamilyOptions, getContentCanvasModelOptions } from '@/lib/content-canvas/model-catalog'
import type { UserFileLike } from '@/lib/core/utils/user-file'

export const DEFAULT_VIDEO_MODEL = 'wan2.7-i2v' as const
export const DEFAULT_VIDEO_MODEL_FAMILY = 'wan2.7' as const
export const DEFAULT_VIDEO_FRAME_ASPECT_RATIO_PRESET = '16:9' as const
export const DEFAULT_VIDEO_RESOLUTION = '720P' as const
export const DEFAULT_VIDEO_DURATION_SECONDS = 5 as const

export const VIDEO_FRAME_ASPECT_RATIO_OPTIONS = [
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '1:1', label: '1:1' },
] as const

export const VIDEO_RESOLUTION_OPTIONS = [
  { id: '720P', label: '720P' },
  { id: '1080P', label: '1080P' },
] as const

export const VIDEO_MEDIA_TYPES = ['first_frame', 'last_frame'] as const

const VIDEO_SIZE_BY_PRESET = {
  '720P': {
    '16:9': '1280*720',
    '9:16': '720*1280',
    '1:1': '960*960',
  },
  '1080P': {
    '16:9': '1920*1080',
    '9:16': '1080*1920',
    '1:1': '1440*1440',
  },
} as const

export type VideoGenerationModelId = 'wan2.7-i2v' | 'wan2.6-t2v' | 'wan2.6-i2v-flash'
export type VideoModelFamily = 'wan2.7' | 'wan2.6'
export type VideoFrameAspectRatioPreset = (typeof VIDEO_FRAME_ASPECT_RATIO_OPTIONS)[number]['id']
export type VideoResolution = (typeof VIDEO_RESOLUTION_OPTIONS)[number]['id']
export type VideoMediaType = (typeof VIDEO_MEDIA_TYPES)[number]
export type VideoGenerationSize =
  (typeof VIDEO_SIZE_BY_PRESET)[VideoResolution][VideoFrameAspectRatioPreset]

export interface VideoMediaFileSlot<TFile = UserFileLike> {
  type: VideoMediaType
  file: TFile
}

export function getVideoGenerationModelOptions(
  enabledModelIds?: readonly string[]
): ReadonlyArray<{
  id: VideoGenerationModelId
  label: string
  description: string
}> {
  const options = getContentCanvasModelOptions('video') as Array<{
    id: VideoGenerationModelId
    label: string
    description: string
  }>
  if (!enabledModelIds) return options

  const enabledSet = new Set(enabledModelIds)
  return options.filter((option) => enabledSet.has(option.id))
}

export function getVideoGenerationModelFamilyOptions(
  enabledModelIds?: readonly string[]
): ReadonlyArray<{
  id: VideoModelFamily
  label: string
  description: string
}> {
  const options = getContentCanvasModelFamilyOptions('video').filter(
    (option): option is { id: VideoModelFamily; label: string; description: string } =>
      option.id === 'wan2.7' || option.id === 'wan2.6'
  )
  if (!enabledModelIds) return options

  const enabledModelFamilies = new Set(
    getVideoGenerationModelOptions(enabledModelIds).map((option) =>
      option.id === 'wan2.7-i2v' ? 'wan2.7' : 'wan2.6'
    )
  )
  return options.filter((option) => enabledModelFamilies.has(option.id))
}

export function getVideoFrameAspectRatioOptions() {
  return VIDEO_FRAME_ASPECT_RATIO_OPTIONS
}

export function getVideoResolutionOptions() {
  return VIDEO_RESOLUTION_OPTIONS
}

export function getVideoDurationOptions() {
  return Array.from({ length: 14 }, (_, index) => {
    const seconds = index + 2
    return { id: seconds, label: `${seconds}s` }
  })
}

export function isVideoFrameAspectRatioPreset(
  value: unknown
): value is VideoFrameAspectRatioPreset {
  return VIDEO_FRAME_ASPECT_RATIO_OPTIONS.some((option) => option.id === value)
}

export function isVideoModelFamily(value: unknown): value is VideoModelFamily {
  return value === 'wan2.7' || value === 'wan2.6'
}

export function getVideoModelFamilyFromModelId(model: VideoGenerationModelId): VideoModelFamily {
  return model === 'wan2.7-i2v' ? 'wan2.7' : 'wan2.6'
}

export function resolveVideoGenerationModelId({
  modelFamily,
  hasFirstFrame,
}: {
  modelFamily: VideoModelFamily
  hasFirstFrame: boolean
}): VideoGenerationModelId {
  if (modelFamily === 'wan2.7') return 'wan2.7-i2v'
  return hasFirstFrame ? 'wan2.6-i2v-flash' : 'wan2.6-t2v'
}

export function getVideoSizeForGeneration({
  aspectRatioPreset,
  resolution,
}: {
  aspectRatioPreset: VideoFrameAspectRatioPreset
  resolution: VideoResolution
}): VideoGenerationSize {
  return VIDEO_SIZE_BY_PRESET[resolution][aspectRatioPreset]
}

export function buildVideoGenerationSummary({
  modelFamily,
  aspectRatioPreset,
  resolution,
  durationSeconds,
  hasFirstFrame,
}: {
  modelFamily: VideoModelFamily
  aspectRatioPreset: VideoFrameAspectRatioPreset
  resolution: VideoResolution
  durationSeconds: number
  hasFirstFrame: boolean
}) {
  const modeLabel =
    modelFamily === 'wan2.7' ? '首尾帧' : hasFirstFrame ? '首帧参考' : '纯文本'
  return `${modeLabel} · ${aspectRatioPreset} · ${resolution} · ${durationSeconds}s`
}

export function getVideoMediaFileForType<TFile>(
  media: ReadonlyArray<VideoMediaFileSlot<TFile>> | null | undefined,
  type: VideoMediaType
) {
  return media?.find((item) => item.type === type)?.file ?? null
}

export function upsertVideoMediaFile<TFile>(
  media: ReadonlyArray<VideoMediaFileSlot<TFile>> | null | undefined,
  type: VideoMediaType,
  file: TFile
): Array<VideoMediaFileSlot<TFile>> {
  const nextMedia = [...(media ?? []).filter((item) => item.type !== type), { type, file }]
  return VIDEO_MEDIA_TYPES.flatMap((candidateType) => {
    const match = nextMedia.find((item) => item.type === candidateType)
    return match ? [match] : []
  })
}

export function removeVideoMediaFileForType<TFile>(
  media: ReadonlyArray<VideoMediaFileSlot<TFile>> | null | undefined,
  type: VideoMediaType
): Array<VideoMediaFileSlot<TFile>> {
  return [...(media ?? []).filter((item) => item.type !== type)]
}
