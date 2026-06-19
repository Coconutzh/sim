/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  isToolbarDerivedImageNode,
  normalizeImageGenerationKind,
  shouldShowImageComposer,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-generation-kind-utils'

describe('image-generation-kind-utils', () => {
  it('shows the image composer for ordinary image nodes without a derived generation kind', () => {
    expect(shouldShowImageComposer({ variant: 'image', generationKind: null })).toBe(true)
    expect(shouldShowImageComposer({ variant: 'image', generationKind: undefined })).toBe(true)
    expect(shouldShowImageComposer({ variant: 'image', generationKind: 'generated' })).toBe(true)
  })

  it('hides the image composer for toolbar-derived image generation kinds', () => {
    expect(shouldShowImageComposer({ variant: 'image', generationKind: 'cutout' })).toBe(false)
    expect(shouldShowImageComposer({ variant: 'image', generationKind: 'image_outpaint' })).toBe(
      false
    )
    expect(
      shouldShowImageComposer({ variant: 'image', generationKind: 'video_frame_capture' })
    ).toBe(false)
    expect(shouldShowImageComposer({ variant: 'image', generationKind: 'image_crop' })).toBe(false)
    expect(shouldShowImageComposer({ variant: 'image', generationKind: 'image_perspective' })).toBe(
      false
    )
    expect(shouldShowImageComposer({ variant: 'image', generationKind: 'image_repaint' })).toBe(
      false
    )
    expect(shouldShowImageComposer({ variant: 'image', generationKind: 'image_erase' })).toBe(false)
  })

  it('hides the image composer during image toolbar interactions', () => {
    expect(
      shouldShowImageComposer({
        variant: 'image',
        generationKind: null,
        isImageToolActive: true,
      })
    ).toBe(false)
  })

  it('hides the image composer for legacy toolbar-derived references', () => {
    expect(
      shouldShowImageComposer({
        variant: 'image',
        generationKind: null,
        hasLegacyToolbarDerivedReference: true,
      })
    ).toBe(false)
  })

  it('does not change non-image composer gating', () => {
    expect(shouldShowImageComposer({ variant: 'text', generationKind: null })).toBe(false)
    expect(shouldShowImageComposer({ variant: 'video', generationKind: null })).toBe(false)
    expect(shouldShowImageComposer({ variant: 'audio', generationKind: null })).toBe(false)
  })

  it('normalizes only known toolbar-derived image generation kinds', () => {
    expect(normalizeImageGenerationKind('cutout')).toBe('cutout')
    expect(normalizeImageGenerationKind('image_outpaint')).toBe('image_outpaint')
    expect(normalizeImageGenerationKind('video_frame_capture')).toBe('video_frame_capture')
    expect(normalizeImageGenerationKind('image_crop')).toBe('image_crop')
    expect(normalizeImageGenerationKind('video_enhance')).toBeNull()
    expect(isToolbarDerivedImageNode({ variant: 'video', generationKind: 'image_outpaint' })).toBe(
      false
    )
  })
})
