/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getImageMaskCanvasGeometry,
  getSourceImageMaskRect,
  type ImageMaskBounds,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-mask-drawing-utils'

const bounds = {
  left: 0,
  top: 0,
  width: 500,
  height: 250,
  sourceWidth: 2000,
  sourceHeight: 1000,
} satisfies ImageMaskBounds

describe('image mask drawing utils', () => {
  it('exports masks at source image dimensions instead of displayed dimensions', () => {
    expect(getImageMaskCanvasGeometry({ bounds, mode: 'export' })).toEqual({
      width: 2000,
      height: 1000,
      scaleX: 4,
      scaleY: 4,
    })
  })

  it('keeps display masks device-pixel-ratio aware without changing logical coordinates', () => {
    expect(getImageMaskCanvasGeometry({ bounds, mode: 'display', devicePixelRatio: 2 })).toEqual({
      width: 1000,
      height: 500,
      scaleX: 2,
      scaleY: 2,
    })
  })

  it('maps a displayed white mask rectangle to the same relative source image region', () => {
    expect(
      getSourceImageMaskRect({
        bounds,
        rect: {
          x: 125,
          y: 50,
          width: 100,
          height: 75,
        },
      })
    ).toEqual({
      x: 500,
      y: 200,
      width: 400,
      height: 300,
    })
  })
})
