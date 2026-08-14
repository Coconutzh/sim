/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetContentCanvasModelAvailabilityForRuntime, mockExecuteContentCanvasTextRequest } =
  vi.hoisted(() => ({
    mockGetContentCanvasModelAvailabilityForRuntime: vi.fn(),
    mockExecuteContentCanvasTextRequest: vi.fn(async () => ({ content: 'text resolver result' })),
  }))

vi.mock('@/lib/content-canvas/service-config', () => ({
  getContentCanvasModelAvailabilityForRuntime: mockGetContentCanvasModelAvailabilityForRuntime,
}))

vi.mock('@/lib/content-canvas/text-executor', () => ({
  executeContentCanvasTextRequest: mockExecuteContentCanvasTextRequest,
}))

import {
  executeLocalAgentModelRequest,
  resolveLocalAgentAuxiliaryModelConfig,
  resolveLocalCanvasAgentModelConfig,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/config'

function createAvailability(textModelId: string | null) {
  return {
    text: {
      enabledModelIds: textModelId ? [textModelId] : [],
      defaultModelId: textModelId,
    },
    image: { enabledModelIds: [], defaultModelId: null },
    audio: { enabledModelIds: [], defaultModelId: null },
    video: { enabledModelIds: [], defaultModelId: null },
  }
}

describe('local canvas agent model config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetContentCanvasModelAvailabilityForRuntime.mockResolvedValue(
      createAvailability('gemini-2.5-flash')
    )
  })

  it('uses the shared runtime default model and ignores unrelated legacy agent variables', async () => {
    process.env.CONTENT_CANVAS_ACTOR_PROVIDER = 'openai'
    process.env.CONTENT_CANVAS_ACTOR_MODEL = 'gpt-4.1-mini'
    process.env.LOCAL_COPILOT_MODEL = 'deepseek-chat'
    process.env.CONTENT_TEXT_GLM_API_KEY = 'legacy-key'

    await expect(resolveLocalCanvasAgentModelConfig()).resolves.toEqual({
      model: 'gemini-2.5-flash',
      mode: 'structured',
      useContentCanvasTextResolver: true,
    })
  })

  it('gives a configuration error when no text model is enabled', async () => {
    mockGetContentCanvasModelAvailabilityForRuntime.mockResolvedValue(createAvailability(null))

    await expect(resolveLocalCanvasAgentModelConfig()).rejects.toThrow(
      '尚未配置可用的画布文本模型与 API Key'
    )
  })

  it('accepts a text model returned by the legacy env fallback', async () => {
    process.env.CONTENT_TEXT_GLM_API_KEY = 'legacy-key'
    mockGetContentCanvasModelAvailabilityForRuntime.mockResolvedValue(createAvailability('glm-4.7'))

    await expect(resolveLocalCanvasAgentModelConfig()).resolves.toEqual({
      model: 'glm-4.7',
      mode: 'structured',
      useContentCanvasTextResolver: true,
    })
  })

  it('uses the managed canvas text executor for all local agent roles', async () => {
    const config = await resolveLocalCanvasAgentModelConfig()

    for (const role of ['planner', 'actor', 'verifier', 'summarizer'] as const) {
      await executeLocalAgentModelRequest(config, {
        role,
        workspaceId: 'workspace-1',
        systemPrompt: `${role} system`,
        prompt: `${role} prompt`,
      })
    }

    expect(mockExecuteContentCanvasTextRequest).toHaveBeenCalledTimes(4)
    expect(mockExecuteContentCanvasTextRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        model: 'gemini-2.5-flash',
      })
    )
  })

  it('routes visual understanding through the managed executor with the image attachment', async () => {
    const config = await resolveLocalCanvasAgentModelConfig()

    await executeLocalAgentModelRequest(config, {
      role: 'decision',
      workspaceId: 'workspace-1',
      systemPrompt: 'system',
      prompt: 'describe image',
      messages: [
        {
          role: 'user',
          content: null,
          parts: [
            { type: 'text', text: 'describe image' },
            { type: 'image', mimeType: 'image/png', data: 'ZmFrZQ==' },
          ],
        },
      ],
    })

    expect(mockExecuteContentCanvasTextRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        referenceImages: [{ mimeType: 'image/png', data: 'ZmFrZQ==' }],
      })
    )
  })

  it('uses the primary managed model for auxiliary requests', () => {
    const fallback = {
      model: 'gemini-2.5-flash',
      mode: 'structured' as const,
      useContentCanvasTextResolver: true,
    }

    expect(resolveLocalAgentAuxiliaryModelConfig({ fallback })).toBe(fallback)
  })
})
