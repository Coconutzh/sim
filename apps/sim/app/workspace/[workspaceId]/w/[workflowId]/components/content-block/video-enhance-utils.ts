import type { EnhanceWorkspaceVideoBody } from '@/lib/api/contracts/media-videos'

export type VideoEnhanceResolution = EnhanceWorkspaceVideoBody['resolution']
export type VideoEnhanceFrameRate = EnhanceWorkspaceVideoBody['frameRate']
export type VideoEnhanceSlowMotion = EnhanceWorkspaceVideoBody['slowMotion']
export type VideoEnhanceGenerationKind = 'video_enhance'
export type VideoEnhanceGenerationStatus = 'pending_config' | 'pending' | 'complete' | 'error'

export interface VideoEnhanceParametersValue {
  resolution: VideoEnhanceResolution
  frameRate: VideoEnhanceFrameRate
  slowMotion: VideoEnhanceSlowMotion
}

export const DEFAULT_VIDEO_ENHANCE_PARAMETERS: VideoEnhanceParametersValue = {
  resolution: '1080p',
  frameRate: 'source',
  slowMotion: 'source',
}

export const VIDEO_ENHANCE_RESOLUTION_OPTIONS: ReadonlyArray<{
  id: VideoEnhanceResolution
  label: string
}> = [
  { id: '1080p', label: '1080p' },
  { id: '2k', label: '2k' },
  { id: '4k', label: '4k' },
]

export const VIDEO_ENHANCE_FRAME_RATE_OPTIONS: ReadonlyArray<{
  id: VideoEnhanceFrameRate
  label: string
}> = [
  { id: 'source', label: '自适应（原帧数）' },
  { id: '30fps', label: '30fps' },
  { id: '60fps', label: '60fps' },
  { id: '90fps', label: '90fps' },
]

export const VIDEO_ENHANCE_SLOW_MOTION_OPTIONS: ReadonlyArray<{
  id: VideoEnhanceSlowMotion
  label: string
}> = [
  { id: 'source', label: '自适应（原速）' },
  { id: '2x', label: '2x' },
]

function isVideoEnhanceResolution(value: unknown): value is VideoEnhanceResolution {
  return value === '1080p' || value === '2k' || value === '4k'
}

function isVideoEnhanceFrameRate(value: unknown): value is VideoEnhanceFrameRate {
  return value === 'source' || value === '30fps' || value === '60fps' || value === '90fps'
}

function isVideoEnhanceSlowMotion(value: unknown): value is VideoEnhanceSlowMotion {
  return value === 'source' || value === '2x'
}

export function normalizeVideoEnhanceParameters(value: unknown): VideoEnhanceParametersValue {
  if (!value || typeof value !== 'object') {
    return DEFAULT_VIDEO_ENHANCE_PARAMETERS
  }

  const candidate = value as Partial<Record<keyof VideoEnhanceParametersValue, unknown>>
  return {
    resolution: isVideoEnhanceResolution(candidate.resolution)
      ? candidate.resolution
      : DEFAULT_VIDEO_ENHANCE_PARAMETERS.resolution,
    frameRate: isVideoEnhanceFrameRate(candidate.frameRate)
      ? candidate.frameRate
      : DEFAULT_VIDEO_ENHANCE_PARAMETERS.frameRate,
    slowMotion: isVideoEnhanceSlowMotion(candidate.slowMotion)
      ? candidate.slowMotion
      : DEFAULT_VIDEO_ENHANCE_PARAMETERS.slowMotion,
  }
}

export function normalizeVideoEnhanceGenerationStatus(
  value: unknown
): VideoEnhanceGenerationStatus | null {
  return value === 'pending_config' ||
    value === 'pending' ||
    value === 'complete' ||
    value === 'error'
    ? value
    : null
}

export function normalizeVideoEnhanceGenerationKind(
  value: unknown
): VideoEnhanceGenerationKind | null {
  return value === 'video_enhance' ? value : null
}
