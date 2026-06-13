import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIDEO_ENHANCE_PARAMETERS,
  normalizeVideoEnhanceGenerationKind,
  normalizeVideoEnhanceGenerationStatus,
  normalizeVideoEnhanceParameters,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/video-enhance-utils'

describe('video-enhance-utils', () => {
  it('normalizes valid video enhancement parameters', () => {
    expect(
      normalizeVideoEnhanceParameters({
        resolution: '4k',
        frameRate: '90fps',
        slowMotion: '2x',
      })
    ).toEqual({
      resolution: '4k',
      frameRate: '90fps',
      slowMotion: '2x',
    })
  })

  it('falls back invalid video enhancement parameters without leaking unknown values', () => {
    expect(
      normalizeVideoEnhanceParameters({
        resolution: '720p',
        frameRate: '120fps',
        slowMotion: '4x',
      })
    ).toEqual(DEFAULT_VIDEO_ENHANCE_PARAMETERS)
  })

  it('normalizes video enhancement generation markers separately from image cutout', () => {
    expect(normalizeVideoEnhanceGenerationKind('video_enhance')).toBe('video_enhance')
    expect(normalizeVideoEnhanceGenerationKind('cutout')).toBeNull()
    expect(normalizeVideoEnhanceGenerationStatus('pending_config')).toBe('pending_config')
    expect(normalizeVideoEnhanceGenerationStatus('pending')).toBe('pending')
    expect(normalizeVideoEnhanceGenerationStatus('unknown')).toBeNull()
  })
})
