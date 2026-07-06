// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  VideoFrameAspectRatioPreset,
  VideoModelFamily,
  VideoResolution,
} from '@/lib/generated-media/video/video-generation-utils'
import { useVideoContentAiSession } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-video-content-ai-session'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { mockRequestJson } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

interface UploadedFileValue {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
}

interface HookProps {
  blockId: string
  workspaceId?: string
  prompt: string
  modelFamily: VideoModelFamily
  aspectRatioPreset: VideoFrameAspectRatioPreset
  resolution: VideoResolution
  durationSeconds: number
  firstFrameFile: UploadedFileValue | null
  lastFrameFile: UploadedFileValue | null
  referenceContextText?: string
  onChangeFile: (value: UploadedFileValue | null) => void
  onGenerationComplete?: () => void
  onGenerationError?: (message: string) => void
}

type HookValue = ReturnType<typeof useVideoContentAiSession>

interface HarnessProps extends HookProps {
  onHook: (hook: HookValue) => void
}

const firstFrameFile = {
  id: 'file-first',
  name: 'first.png',
  path: 'https://example.com/first.png',
  key: 'workspace/first.png',
  size: 123,
  type: 'image/png',
}

const lastFrameFile = {
  id: 'file-last',
  name: 'last.png',
  path: 'https://example.com/last.png',
  key: 'workspace/last.png',
  size: 456,
  type: 'image/png',
}

function HookHarness({ onHook, ...props }: HarnessProps) {
  const hook = useVideoContentAiSession(props)
  onHook(hook)
  return null
}

function renderHarness(overrides: Partial<HookProps> = {}): {
  root: Root
  container: HTMLDivElement
  getHook: () => HookValue
  rerender: (nextOverrides: Partial<HookProps>) => void
} {
  let current: HookValue | null = null
  let props: HookProps = {
    blockId: 'video-1',
    workspaceId: 'workspace-1',
    prompt: 'Generate a cinematic transition',
    modelFamily: 'wan2.7',
    aspectRatioPreset: '16:9',
    resolution: '720P',
    durationSeconds: 5,
    firstFrameFile: null,
    lastFrameFile: null,
    onChangeFile: vi.fn(),
    ...overrides,
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const render = () => {
    root.render(<HookHarness {...props} onHook={(hook) => (current = hook)} />)
  }
  act(render)

  return {
    root,
    container,
    getHook: () => {
      if (!current) throw new Error('Hook not rendered')
      return current
    },
    rerender: (nextOverrides) => {
      props = { ...props, ...nextOverrides }
      act(render)
    },
  }
}

describe('useVideoContentAiSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequestJson.mockResolvedValue({
      file: {
        id: 'generated-video',
        name: 'generated.mp4',
        url: 'https://example.com/generated.mp4',
        key: 'workspace/generated.mp4',
        size: 789,
        type: 'video/mp4',
        context: 'workspace',
      },
    })
  })

  it('keeps validation errors visible until an input changes', async () => {
    const harness = renderHarness({ firstFrameFile, lastFrameFile: null })

    await act(async () => {
      await harness.getHook().submitPrompt()
    })

    expect(harness.getHook().error).toContain('Wan 2.7')
    expect(mockRequestJson).not.toHaveBeenCalled()

    harness.rerender({ prompt: 'Generate a different transition' })

    expect(harness.getHook().error).toBeNull()
    act(() => harness.root.unmount())
    harness.container.remove()
  })

  it('sends both first and last frame media for Wan 2.7', async () => {
    const harness = renderHarness({ firstFrameFile, lastFrameFile })

    await act(async () => {
      await harness.getHook().submitPrompt()
    })

    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.objectContaining({
          model: 'wan2.7-i2v',
          media: [
            expect.objectContaining({ type: 'first_frame' }),
            expect.objectContaining({ type: 'last_frame' }),
          ],
        }),
      })
    )
    act(() => harness.root.unmount())
    harness.container.remove()
  })

  it('includes text reference context in the submitted video prompt', async () => {
    const harness = renderHarness({
      firstFrameFile,
      lastFrameFile,
      referenceContextText:
        'Referenced canvas context:\n\n- Text: Script\nA paper boat crosses the frame.',
    })

    await act(async () => {
      await harness.getHook().submitPrompt()
    })

    const request = mockRequestJson.mock.calls[0]?.[1]
    expect(request.body.prompt).toContain('Generate a cinematic transition')
    expect(request.body.prompt).toContain('A paper boat crosses the frame.')
    act(() => harness.root.unmount())
    harness.container.remove()
  })

  it('preserves Wan 2.6 text-only generation when no first frame is selected', async () => {
    const harness = renderHarness({ modelFamily: 'wan2.6' })

    await act(async () => {
      await harness.getHook().submitPrompt()
    })

    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.objectContaining({
          model: 'wan2.6-t2v',
          media: [],
        }),
      })
    )
    act(() => harness.root.unmount())
    harness.container.remove()
  })

  it('calls the generation complete callback after writing the generated file', async () => {
    const onChangeFile = vi.fn()
    const onGenerationComplete = vi.fn()
    const harness = renderHarness({
      modelFamily: 'wan2.6',
      onChangeFile,
      onGenerationComplete,
    })

    await act(async () => {
      await harness.getHook().submitPrompt()
    })

    expect(onChangeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'generated-video',
        path: 'https://example.com/generated.mp4',
      })
    )
    expect(onGenerationComplete).toHaveBeenCalledTimes(1)
    act(() => harness.root.unmount())
    harness.container.remove()
  })

  it('calls the generation error callback when the async request fails', async () => {
    const onGenerationError = vi.fn()
    mockRequestJson.mockRejectedValueOnce(new Error('Provider timed out'))
    const harness = renderHarness({
      modelFamily: 'wan2.6',
      onGenerationError,
    })

    await act(async () => {
      await harness.getHook().submitPrompt()
    })

    expect(harness.getHook().error).toBe('Provider timed out')
    expect(onGenerationError).toHaveBeenCalledWith('Provider timed out')
    act(() => harness.root.unmount())
    harness.container.remove()
  })
})
