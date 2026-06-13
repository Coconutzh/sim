import type { CaptureWorkspaceVideoFrameBody } from '@/lib/api/contracts/media-videos'
import { getVideoFrameCaptureFileName as getSharedVideoFrameCaptureFileName } from '@/lib/generated-media/video/video-frame-capture-utils'

export type VideoFrameCaptureMode = CaptureWorkspaceVideoFrameBody['mode']

export interface VideoFrameCaptureTimeResult {
  ok: boolean
  timeSeconds: number
  error: string | null
}

export function getCurrentVideoFrameTime(video: HTMLVideoElement | null): number {
  const currentTime = video?.currentTime ?? 0
  return Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0
}

export function getLastVideoFrameTime(video: HTMLVideoElement | null): VideoFrameCaptureTimeResult {
  const duration = video?.duration
  if (!Number.isFinite(duration) || !duration || duration <= 0) {
    return {
      ok: false,
      timeSeconds: 0,
      error: '视频时长尚未加载，无法截取尾帧。',
    }
  }

  return {
    ok: true,
    timeSeconds: Math.max(0, duration - 0.05),
    error: null,
  }
}

export function resolveVideoFrameCaptureTime(
  video: HTMLVideoElement | null,
  mode: VideoFrameCaptureMode
): VideoFrameCaptureTimeResult {
  if (mode === 'first') {
    return { ok: true, timeSeconds: 0, error: null }
  }

  if (mode === 'last') {
    return getLastVideoFrameTime(video)
  }

  return { ok: true, timeSeconds: getCurrentVideoFrameTime(video), error: null }
}

export function getVideoFrameCaptureFileName(
  sourceName: string | undefined,
  mode: VideoFrameCaptureMode
): string {
  return getSharedVideoFrameCaptureFileName(sourceName, mode)
}
