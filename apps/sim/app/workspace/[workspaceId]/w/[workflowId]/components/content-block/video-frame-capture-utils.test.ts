import { describe, expect, it } from 'vitest'
import {
  getCurrentVideoFrameTime,
  getLastVideoFrameTime,
  getVideoFrameCaptureFileName,
  resolveVideoFrameCaptureTime,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/video-frame-capture-utils'

function createVideo(value: { currentTime?: number; duration?: number }): HTMLVideoElement {
  return value as HTMLVideoElement
}

describe('video frame capture utils', () => {
  it('falls back to zero for unavailable current frame times', () => {
    expect(getCurrentVideoFrameTime(null)).toBe(0)
    expect(getCurrentVideoFrameTime(createVideo({ currentTime: Number.NaN }))).toBe(0)
    expect(resolveVideoFrameCaptureTime(createVideo({ currentTime: 1.25 }), 'current')).toEqual({
      ok: true,
      timeSeconds: 1.25,
      error: null,
    })
  })

  it('clamps the last frame capture time before the video duration', () => {
    expect(getLastVideoFrameTime(createVideo({ duration: 5.1 }))).toEqual({
      ok: true,
      timeSeconds: 5.05,
      error: null,
    })
    expect(getLastVideoFrameTime(createVideo({ duration: 0.02 }))).toEqual({
      ok: true,
      timeSeconds: 0,
      error: null,
    })
  })

  it('rejects last frame capture when metadata has not loaded', () => {
    const result = resolveVideoFrameCaptureTime(createVideo({ duration: Number.NaN }), 'last')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('视频时长尚未加载')
  })

  it('generates stable frame capture file names', () => {
    expect(getVideoFrameCaptureFileName('source.mp4', 'current')).toBe('source-frame-current.jpg')
    expect(getVideoFrameCaptureFileName('clip.with.dots.mov', 'last')).toBe(
      'clip.with.dots-frame-last.jpg'
    )
    expect(getVideoFrameCaptureFileName('', 'first')).toBe('video-frame-first.jpg')
  })
})
