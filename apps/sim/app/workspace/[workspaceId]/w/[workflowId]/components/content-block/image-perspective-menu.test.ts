/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { ContentCanvasModelAvailabilitySnapshot } from '@/lib/api/contracts/content-canvas'
import {
  applyPerspectiveDrag,
  buildImagePerspectivePrompt,
  getImagePerspectiveModel,
  ImagePerspectiveMenu,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-perspective-menu'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function renderIntoDocument(element: ReactElement): {
  container: HTMLDivElement
  root: Root
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  return { container, root }
}

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

  it('uses standard lens wording when wide angle is disabled', () => {
    const prompt = buildImagePerspectivePrompt({
      rotation: 20,
      tilt: 2,
      zoom: -8,
      wideAngle: false,
    })

    expect(prompt).toContain('natural standard lens')
    expect(prompt).not.toContain('wide-angle lens')
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

  it('preserves rotation, tilt, and zoom when wide angle changes through drag state', () => {
    expect(
      applyPerspectiveDrag({ rotation: 12, tilt: -4, zoom: 9, wideAngle: true }, 0, 0)
    ).toEqual({
      rotation: 12,
      tilt: -4,
      zoom: 9,
      wideAngle: true,
    })
  })

  it('only updates checked state when wide angle is toggled', () => {
    const onCreateVariant = vi.fn()
    const onPointerDown = vi.fn()
    const onClick = vi.fn()
    const onChange = vi.fn()
    const { container, root } = renderIntoDocument(
      createElement(
        'div',
        { onPointerDown, onClick, onChange },
        createElement(
          StrictMode,
          null,
          createElement(ImagePerspectiveMenu, {
            workspaceId: 'workspace-1',
            sourceFile: {
              id: 'file-1',
              name: 'source.png',
              path: '/api/files/serve/source.png',
              key: 'workspace/source.png',
              size: 100,
              type: 'image/png',
            },
            availability: availability(['gemini-3-pro-image-preview']),
            onCreateVariant,
            onClose: vi.fn(),
          })
        )
      )
    )

    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(checkbox).not.toBeNull()
    expect(checkbox?.checked).toBe(false)

    act(() => {
      checkbox?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(checkbox?.checked).toBe(true)
    expect(onCreateVariant).not.toHaveBeenCalled()
    expect(onPointerDown).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
