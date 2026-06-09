/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { outpaintWorkspaceImageBodySchema } from '@/lib/api/contracts/media-images'

const sourceImage = {
  id: 'source-1',
  name: 'source.png',
  url: '',
  key: 'workspace/source.png',
  size: 100,
  type: 'image/png',
}

describe('media image contracts', () => {
  it('validates outpaint placement, resolution, and custom aspect ratio', () => {
    const parsed = outpaintWorkspaceImageBodySchema.parse({
      workspaceId: 'ws-1',
      sourceImage,
      resolution: '2K',
      targetAspectRatio: 'custom',
      customAspectRatio: { width: 21, height: 9 },
      placement: {
        x: 80,
        y: 40,
        width: 320,
        height: 180,
        canvasWidth: 640,
        canvasHeight: 360,
      },
      prompt: 'extend both sides',
    })

    expect(parsed).toMatchObject({
      workspaceId: 'ws-1',
      resolution: '2K',
      targetAspectRatio: 'custom',
      customAspectRatio: { width: 21, height: 9 },
      placement: {
        x: 80,
        canvasWidth: 640,
      },
    })
  })

  it('rejects custom outpaint ratio without customAspectRatio', () => {
    const result = outpaintWorkspaceImageBodySchema.safeParse({
      workspaceId: 'ws-1',
      sourceImage,
      resolution: '2K',
      targetAspectRatio: 'custom',
      placement: {
        x: 80,
        y: 40,
        width: 320,
        height: 180,
        canvasWidth: 640,
        canvasHeight: 360,
      },
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['customAspectRatio'])
  })

  it('rejects placements that put the source image outside the target canvas', () => {
    const result = outpaintWorkspaceImageBodySchema.safeParse({
      workspaceId: 'ws-1',
      sourceImage,
      resolution: '2K',
      targetAspectRatio: '16:9',
      placement: {
        x: 400,
        y: 40,
        width: 320,
        height: 180,
        canvasWidth: 640,
        canvasHeight: 360,
      },
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues.some((issue) => issue.path[0] === 'placement')).toBe(true)
  })
})
