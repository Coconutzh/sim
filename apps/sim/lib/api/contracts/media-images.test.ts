/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  cutoutWorkspaceImageBodySchema,
  cutoutWorkspaceImageContract,
  eraseWorkspaceImageBodySchema,
  outpaintWorkspaceImageBodySchema,
  repaintWorkspaceImageBodySchema,
} from '@/lib/api/contracts/media-images'

const sourceImage = {
  id: 'source-1',
  name: 'source.png',
  url: '',
  key: 'workspace/source.png',
  size: 100,
  type: 'image/png',
}

describe('media image contracts', () => {
  it('validates cutout source image without a client model field', () => {
    const parsed = cutoutWorkspaceImageBodySchema.parse({
      workspaceId: 'ws-1',
      sourceImage,
      model: 'jimeng-4.5',
    })

    expect(parsed).toMatchObject({
      workspaceId: 'ws-1',
      sourceImage: {
        id: 'source-1',
      },
    })
    expect(cutoutWorkspaceImageContract.path).toBe('/api/media/images/cutout')
  })

  it('rejects cutout requests without a workspace file source key', () => {
    const result = cutoutWorkspaceImageBodySchema.safeParse({
      workspaceId: 'ws-1',
      sourceImage: {
        ...sourceImage,
        key: '',
      },
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['sourceImage', 'key'])
  })

  it('validates erase source image, mask image, and resolution', () => {
    const parsed = eraseWorkspaceImageBodySchema.parse({
      workspaceId: 'ws-1',
      sourceImage,
      maskImage: {
        id: '',
        name: 'erase-mask.png',
        url: '',
        key: 'erase-mask.png',
        size: 32,
        type: 'image/png',
        base64: Buffer.from('mask').toString('base64'),
      },
      resolution: '4K',
    })

    expect(parsed).toMatchObject({
      workspaceId: 'ws-1',
      resolution: '4K',
      sourceImage: {
        id: 'source-1',
      },
      maskImage: {
        name: 'erase-mask.png',
      },
    })
  })

  it('validates repaint source image, mask image, references, prompt, and resolution', () => {
    const parsed = repaintWorkspaceImageBodySchema.parse({
      workspaceId: 'ws-1',
      prompt: 'Replace the sign',
      sourceImage,
      maskImage: {
        id: '',
        name: 'repaint-mask.png',
        url: '',
        key: 'repaint-mask.png',
        size: 32,
        type: 'image/png',
        base64: Buffer.from('mask').toString('base64'),
      },
      referenceImages: [],
      resolution: '4K',
    })

    expect(parsed).toMatchObject({
      workspaceId: 'ws-1',
      prompt: 'Replace the sign',
      resolution: '4K',
      sourceImage: {
        id: 'source-1',
      },
      maskImage: {
        name: 'repaint-mask.png',
      },
      referenceImages: [],
    })
  })

  it('rejects erase requests with unsupported resolution', () => {
    const result = eraseWorkspaceImageBodySchema.safeParse({
      workspaceId: 'ws-1',
      sourceImage,
      maskImage: {
        id: '',
        name: 'erase-mask.png',
        url: '',
        key: 'erase-mask.png',
        size: 32,
        type: 'image/png',
        base64: Buffer.from('mask').toString('base64'),
      },
      resolution: '8K',
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['resolution'])
  })

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
