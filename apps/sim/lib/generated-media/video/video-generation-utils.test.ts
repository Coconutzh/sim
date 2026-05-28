import { describe, expect, it } from 'vitest'
import {
  buildVideoGenerationSummary,
  DEFAULT_VIDEO_DURATION_SECONDS,
  DEFAULT_VIDEO_FRAME_ASPECT_RATIO_PRESET,
  DEFAULT_VIDEO_MODEL,
  DEFAULT_VIDEO_MODEL_FAMILY,
  DEFAULT_VIDEO_RESOLUTION,
  getVideoDurationOptions,
  getVideoFrameAspectRatioOptions,
  getVideoGenerationModelFamilyOptions,
  getVideoGenerationModelOptions,
  getVideoMediaFileForType,
  getVideoSizeForGeneration,
  isVideoFrameAspectRatioPreset,
  resolveVideoGenerationModelId,
  upsertVideoMediaFile,
} from '@/lib/generated-media/video/video-generation-utils'

describe('video-generation-utils', () => {
  it('exposes Wan 2.6 and Wan 2.7 as the supported content-node video model families', () => {
    expect(DEFAULT_VIDEO_MODEL).toBe('wan2.7-i2v')
    expect(DEFAULT_VIDEO_MODEL_FAMILY).toBe('wan2.7')
    expect(getVideoGenerationModelFamilyOptions()).toEqual([
      expect.objectContaining({
        id: 'wan2.7',
        label: 'Wan 2.7',
      }),
      expect.objectContaining({
        id: 'wan2.6',
        label: 'Wan 2.6',
      }),
    ])
    expect(getVideoGenerationModelOptions()).toEqual([
      expect.objectContaining({
        id: 'wan2.7-i2v',
      }),
      expect.objectContaining({
        id: 'wan2.6-t2v',
      }),
      expect.objectContaining({
        id: 'wan2.6-i2v-flash',
      }),
    ])
  })

  it('returns the supported first/last-frame aspect ratio presets and defaults', () => {
    expect(DEFAULT_VIDEO_FRAME_ASPECT_RATIO_PRESET).toBe('16:9')
    expect(getVideoFrameAspectRatioOptions()).toEqual([
      { id: '16:9', label: '16:9' },
      { id: '9:16', label: '9:16' },
      { id: '1:1', label: '1:1' },
    ])
    expect(isVideoFrameAspectRatioPreset('16:9')).toBe(true)
    expect(isVideoFrameAspectRatioPreset('4:3')).toBe(false)
  })

  it('builds the settings summary shown in the video node footer for different models', () => {
    expect(DEFAULT_VIDEO_RESOLUTION).toBe('720P')
    expect(DEFAULT_VIDEO_DURATION_SECONDS).toBe(5)
    expect(
      buildVideoGenerationSummary({
        modelFamily: 'wan2.7',
        aspectRatioPreset: '16:9',
        resolution: '720P',
        durationSeconds: 5,
        hasFirstFrame: true,
      })
    ).toBe('首尾帧 · 16:9 · 720P · 5s')
    expect(
      buildVideoGenerationSummary({
        modelFamily: 'wan2.6',
        aspectRatioPreset: '9:16',
        resolution: '1080P',
        durationSeconds: 10,
        hasFirstFrame: false,
      })
    ).toBe('纯文本 · 9:16 · 1080P · 10s')
    expect(
      buildVideoGenerationSummary({
        modelFamily: 'wan2.6',
        aspectRatioPreset: '1:1',
        resolution: '720P',
        durationSeconds: 4,
        hasFirstFrame: true,
      })
    ).toBe('首帧参考 · 1:1 · 720P · 4s')
  })

  it('provides integer duration options from 2s through 15s', () => {
    expect(getVideoDurationOptions().at(0)).toEqual({ id: 2, label: '2s' })
    expect(getVideoDurationOptions().at(-1)).toEqual({ id: 15, label: '15s' })
  })

  it('resolves the concrete DashScope model from the selected model family and first-frame state', () => {
    expect(
      resolveVideoGenerationModelId({
        modelFamily: 'wan2.7',
        hasFirstFrame: false,
      })
    ).toBe('wan2.7-i2v')
    expect(
      resolveVideoGenerationModelId({
        modelFamily: 'wan2.6',
        hasFirstFrame: false,
      })
    ).toBe('wan2.6-t2v')
    expect(
      resolveVideoGenerationModelId({
        modelFamily: 'wan2.6',
        hasFirstFrame: true,
      })
    ).toBe('wan2.6-i2v-flash')
  })

  it('maps ratio and resolution to the legacy Wan 2.6 size parameter', () => {
    expect(
      getVideoSizeForGeneration({
        aspectRatioPreset: '16:9',
        resolution: '720P',
      })
    ).toBe('1280*720')
    expect(
      getVideoSizeForGeneration({
        aspectRatioPreset: '9:16',
        resolution: '1080P',
      })
    ).toBe('1080*1920')
    expect(
      getVideoSizeForGeneration({
        aspectRatioPreset: '1:1',
        resolution: '1080P',
      })
    ).toBe('1440*1440')
  })

  it('upserts first and last frame file snapshots without duplicating media slots', () => {
    const firstFrame = {
      id: 'wf-first',
      name: 'first.png',
      url: 'https://example.com/first.png',
      key: 'workspace/first.png',
      size: 123,
      type: 'image/png',
    }
    const lastFrame = {
      id: 'wf-last',
      name: 'last.png',
      url: 'https://example.com/last.png',
      key: 'workspace/last.png',
      size: 456,
      type: 'image/png',
    }

    const withFirst = upsertVideoMediaFile([], 'first_frame', firstFrame)
    const withBoth = upsertVideoMediaFile(withFirst, 'last_frame', lastFrame)
    const replacedFirst = upsertVideoMediaFile(withBoth, 'first_frame', {
      ...firstFrame,
      id: 'wf-first-2',
      key: 'workspace/first-2.png',
      url: 'https://example.com/first-2.png',
    })

    expect(getVideoMediaFileForType(replacedFirst, 'last_frame')).toMatchObject(lastFrame)
    expect(getVideoMediaFileForType(replacedFirst, 'first_frame')).toMatchObject({
      id: 'wf-first-2',
    })
    expect(replacedFirst).toHaveLength(2)
  })
})
