/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ContentCanvasModelAvailabilitySnapshot } from '@/lib/api/contracts/content-canvas'
import {
  applyPerspectiveDrag,
  buildImagePerspectivePrompt,
  getImagePerspectiveModel,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-perspective-menu'

function availability(enabledModelIds: string[]): ContentCanvasModelAvailabilitySnapshot {
  return {
    text: { enabledModelIds: [], defaultModelId: null },
    image: { enabledModelIds, defaultModelId: enabledModelIds[0] ?? null },
    audio: { enabledModelIds: [], defaultModelId: null },
    video: { enabledModelIds: [], defaultModelId: null },
  }
}

describe('image perspective menu helpers', () => {
  it('prefers the Nano Banana image-reference model when available', () => {
    expect(
      getImagePerspectiveModel(
        availability(['jimeng-4.5', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'])
      )
    ).toEqual({
      model: 'gemini-3-pro-image-preview',
      disabledReason: null,
    })
  })

  it('does not fallback to another image-reference model when the multi-angle model is unavailable', () => {
    expect(
      getImagePerspectiveModel(
        availability(['gemini-3-pro-image', 'gemini-3.1-flash-image-preview'])
      )
    ).toEqual({
      model: null,
      disabledReason: 'The multi-angle image model is not available in this workspace.',
    })
  })

  it('builds an AI redraw prompt with non-renderer precision language', () => {
    const prompt = buildImagePerspectivePrompt({
      rotation: 20,
      tilt: 2,
      zoom: -8,
      wideAngle: true,
    })

    expect(prompt).toContain('camera yaw/rotation: 20 degrees')
    expect(prompt).toContain('camera tilt/pitch: 2 degrees')
    expect(prompt).toContain('zoom/dolly: -8')
    expect(prompt).toContain('wide-angle lens')
    expect(prompt).toContain('not a CAD model or 3D renderer')
  })

  it('maps pointer deltas to clamped perspective values', () => {
    expect(
      applyPerspectiveDrag({ rotation: 0, tilt: 0, zoom: 0, wideAngle: false }, 200, -200)
    ).toEqual({
      rotation: 60,
      tilt: 45,
      zoom: 8,
      wideAngle: false,
    })
  })
})
