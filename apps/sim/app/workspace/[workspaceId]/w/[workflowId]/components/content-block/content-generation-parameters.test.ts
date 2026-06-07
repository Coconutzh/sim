/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIDEO_PARAMETERS,
  normalizeAudioParameters,
  normalizeVideoDuration,
  normalizeVideoParameters,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-generation-parameters'

describe('content generation parameter normalization', () => {
  it('parses persisted video parameter JSON strings', () => {
    expect(
      normalizeVideoParameters(
        JSON.stringify({
          resolution: '1080P',
          duration: 8,
          promptExtend: false,
          watermark: true,
        })
      )
    ).toEqual({
      resolution: '1080P',
      duration: 8,
      promptExtend: false,
      watermark: true,
    })
  })

  it('falls back for invalid video parameter strings', () => {
    expect(normalizeVideoParameters('{bad json')).toEqual(DEFAULT_VIDEO_PARAMETERS)
  })

  it('clamps video duration to provider bounds', () => {
    expect(normalizeVideoDuration('1')).toBe(2)
    expect(normalizeVideoDuration(99)).toBe(15)
    expect(normalizeVideoDuration('8.4')).toBe(8)
  })

  it('parses persisted audio parameter JSON strings', () => {
    expect(
      normalizeAudioParameters(
        JSON.stringify({
          customMode: true,
          instrumental: true,
          style: 'electronic pop',
          title: 'Spring Launch',
          negativeTags: 'metal',
          vocalGender: 'female',
        })
      )
    ).toEqual({
      customMode: true,
      instrumental: true,
      style: 'electronic pop',
      title: 'Spring Launch',
      negativeTags: 'metal',
      vocalGender: 'female',
    })
  })
})
