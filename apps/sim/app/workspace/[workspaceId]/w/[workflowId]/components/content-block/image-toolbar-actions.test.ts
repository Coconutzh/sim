/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { inferImageFileName } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-toolbar-actions'

describe('inferImageFileName', () => {
  it('prefers the canvas node name and preserves the original file extension', () => {
    expect(
      inferImageFileName({ name: 'generated-image (8).png', type: 'image/png' }, 'Image 17')
    ).toBe('Image 17.png')
  })

  it('does not append an extension when the canvas node name already has one', () => {
    expect(
      inferImageFileName({ name: 'generated-image.png', type: 'image/png' }, 'Hero.webp')
    ).toBe('Hero.webp')
  })

  it('keeps the original file name fallback for empty canvas node names', () => {
    expect(inferImageFileName({ name: 'generated-image.png', type: 'image/png' }, '')).toBe(
      'generated-image.png'
    )
  })

  it('sanitizes the canvas node name before appending a MIME-derived extension', () => {
    expect(inferImageFileName({ type: 'image/jpeg' }, 'Bad/Name:*')).toBe('Bad_Name__.jpg')
  })

  it('uses the key extension when the original file name has no extension', () => {
    expect(
      inferImageFileName(
        { name: 'generated-image', key: 'workspace/generated-image.webp' },
        'Image 17'
      )
    ).toBe('Image 17.webp')
  })
})
