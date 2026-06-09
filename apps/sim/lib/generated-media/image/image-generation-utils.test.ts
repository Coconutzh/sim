import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMAGE_AI_MODEL,
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_PERSPECTIVE_MODEL,
  DEFAULT_IMAGE_REPAINT_MODEL,
  DEFAULT_IMAGE_REPAINT_RESOLUTION,
  getImageAspectRatioOptions,
  getImageGenerationModelOptions,
  getNearestSupportedImageAspectRatio,
  getResolvedImageAspectRatio,
  mapImageAspectRatioToProviderSize,
} from '@/lib/generated-media/image/image-generation-utils'

describe('image-generation-utils', () => {
  it('exposes the catalog-backed image model list and defaults to Jimeng 4.5', () => {
    expect(DEFAULT_IMAGE_AI_MODEL).toBe('jimeng-4.5')
    expect(DEFAULT_IMAGE_PERSPECTIVE_MODEL).toBe('gemini-3-pro-image-preview')
    expect(DEFAULT_IMAGE_REPAINT_MODEL).toBe('gemini-3-pro-image')
    expect(DEFAULT_IMAGE_REPAINT_RESOLUTION).toBe('2K')
    expect(getImageGenerationModelOptions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'jimeng-4.5' }),
        expect.objectContaining({ id: 'jimeng-4.0' }),
        expect.objectContaining({ id: 'gemini-3.1-flash-image-preview' }),
        expect.objectContaining({ id: 'gemini-3-pro-image' }),
        expect.objectContaining({ id: 'gemini-3-pro-image-preview' }),
      ])
    )
  })

  it('maps auto and fixed ratios to provider size hints', () => {
    expect(DEFAULT_IMAGE_ASPECT_RATIO).toBe('auto')
    expect(mapImageAspectRatioToProviderSize('auto')).toBe('4K')
    expect(mapImageAspectRatioToProviderSize('16:9')).toBe('2560x1440')
    expect(mapImageAspectRatioToProviderSize('3:2')).toBe('2496x1664')
  })

  it('uses a readable UTF-8 label for the automatic 4K aspect ratio option', () => {
    expect(getImageAspectRatioOptions().find((option) => option.id === 'auto')?.label).toBe(
      '自适应(4K)'
    )
  })

  it('finds the nearest supported ratio for existing images', () => {
    expect(getNearestSupportedImageAspectRatio(2048, 1152)).toBe('16:9')
    expect(getNearestSupportedImageAspectRatio(1536, 2048)).toBe('3:4')
    expect(getNearestSupportedImageAspectRatio(2520, 1080)).toBe('21:9')
  })

  it('prefers the inferred image ratio when the stored value is empty or default auto', () => {
    expect(
      getResolvedImageAspectRatio({
        storedAspectRatio: '',
        inferredAspectRatio: '4:3',
      })
    ).toBe('4:3')
    expect(
      getResolvedImageAspectRatio({
        storedAspectRatio: 'auto',
        inferredAspectRatio: '9:16',
      })
    ).toBe('9:16')
    expect(
      getResolvedImageAspectRatio({
        storedAspectRatio: '1:1',
        inferredAspectRatio: '9:16',
      })
    ).toBe('1:1')
  })
})
