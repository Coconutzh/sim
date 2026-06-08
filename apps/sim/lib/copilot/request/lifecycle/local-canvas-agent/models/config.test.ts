/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = process.env
const { mockExecuteContentCanvasTextRequest, mockExecuteStructuredActorRequest } = vi.hoisted(
  () => ({
    mockExecuteContentCanvasTextRequest: vi.fn(async () => ({ content: 'text resolver result' })),
    mockExecuteStructuredActorRequest: vi.fn(async () => ({ content: 'actor result' })),
  })
)

vi.mock('@/lib/content-canvas/text-executor', () => ({
  executeContentCanvasTextRequest: mockExecuteContentCanvasTextRequest,
}))

vi.mock('@/providers', () => ({
  executeStructuredActorRequest: mockExecuteStructuredActorRequest,
}))

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV }
  process.env.CONTENT_TEXT_GEMINI_API_KEY = undefined
  process.env.CONTENT_TEXT_GEMINI_DEFAULT_MODEL = undefined
  process.env.CONTENT_TEXT_GEMINI_ENABLED_MODELS = undefined
  process.env.CONTENT_TEXT_GLM_API_KEY = undefined
  process.env.CONTENT_TEXT_GLM_DEFAULT_MODEL = undefined
  process.env.CONTENT_TEXT_GLM_ENABLED_MODELS = undefined
  process.env.CONTENT_CANVAS_ACTOR_PROVIDER = undefined
  process.env.CONTENT_CANVAS_ACTOR_MODEL = undefined
  process.env.CONTENT_CANVAS_ACTOR_MODE = undefined
  process.env.LOCAL_COPILOT_PROVIDER = undefined
  process.env.LOCAL_COPILOT_MODEL = undefined
  process.env.LOCAL_COPILOT_API_KEY = undefined
  process.env.OPENAI_API_KEY = undefined
  process.env.DEEPSEEK_API_KEY = undefined
}

describe('local canvas agent model config', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetEnv()
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
  })

  it('prefers explicit content-canvas text configuration before actor env', async () => {
    process.env.CONTENT_TEXT_GLM_API_KEY = 'glm-key'
    process.env.CONTENT_TEXT_GLM_ENABLED_MODELS = 'glm-4.7'
    process.env.CONTENT_TEXT_GLM_DEFAULT_MODEL = 'glm-4.7'
    process.env.CONTENT_CANVAS_ACTOR_PROVIDER = 'openai'
    process.env.CONTENT_CANVAS_ACTOR_MODEL = 'gpt-4.1-mini'

    const { resolveLocalCanvasAgentModelConfig } = await import(
      '@/lib/copilot/request/lifecycle/local-canvas-agent/models/config'
    )

    expect(resolveLocalCanvasAgentModelConfig()).toEqual({
      model: 'glm-4.7',
      mode: 'structured',
      useContentCanvasTextResolver: true,
    })
  })

  it('uses content-canvas actor env before legacy local copilot env', async () => {
    process.env.CONTENT_CANVAS_ACTOR_PROVIDER = 'openai'
    process.env.CONTENT_CANVAS_ACTOR_MODEL = 'gpt-4.1-mini'
    process.env.CONTENT_CANVAS_ACTOR_MODE = 'structured'
    process.env.OPENAI_API_KEY = 'openai-key'
    process.env.LOCAL_COPILOT_PROVIDER = 'deepseek'
    process.env.LOCAL_COPILOT_MODEL = 'deepseek-chat'
    process.env.DEEPSEEK_API_KEY = 'deepseek-key'

    const { resolveLocalCanvasAgentModelConfig } = await import(
      '@/lib/copilot/request/lifecycle/local-canvas-agent/models/config'
    )

    expect(resolveLocalCanvasAgentModelConfig()).toEqual({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      mode: 'structured',
      apiKey: 'openai-key',
    })
  })

  it('uses the same resolved model executor for all local agent roles', async () => {
    process.env.CONTENT_CANVAS_ACTOR_PROVIDER = 'deepseek'
    process.env.CONTENT_CANVAS_ACTOR_MODEL = 'deepseek-chat'
    process.env.DEEPSEEK_API_KEY = 'deepseek-key'
    const { executeLocalAgentModelRequest, resolveLocalCanvasAgentModelConfig } = await import(
      '@/lib/copilot/request/lifecycle/local-canvas-agent/models/config'
    )
    const config = resolveLocalCanvasAgentModelConfig()

    for (const role of ['planner', 'actor', 'verifier', 'summarizer'] as const) {
      await executeLocalAgentModelRequest(config, {
        role,
        workspaceId: 'workspace-1',
        systemPrompt: `${role} system`,
        prompt: `${role} prompt`,
      })
    }

    expect(mockExecuteStructuredActorRequest).toHaveBeenCalledTimes(4)
    expect(mockExecuteStructuredActorRequest).toHaveBeenCalledWith(
      'deepseek',
      expect.objectContaining({
        workspaceId: 'workspace-1',
        model: 'deepseek-chat',
        apiKey: 'deepseek-key',
      })
    )
  })

  it('routes multimodal role requests through the provider executor', async () => {
    process.env.CONTENT_TEXT_GEMINI_API_KEY = 'gemini-key'
    process.env.CONTENT_TEXT_GEMINI_ENABLED_MODELS = 'gemini-2.5-flash'
    process.env.CONTENT_TEXT_GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'
    const { executeLocalAgentModelRequest, resolveLocalCanvasAgentModelConfig } = await import(
      '@/lib/copilot/request/lifecycle/local-canvas-agent/models/config'
    )
    const config = resolveLocalCanvasAgentModelConfig()

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

    expect(mockExecuteContentCanvasTextRequest).not.toHaveBeenCalled()
    expect(mockExecuteStructuredActorRequest).toHaveBeenCalledWith(
      'google',
      expect.objectContaining({
        apiKey: 'gemini-key',
        model: 'gemini-2.5-flash',
        messages: [
          expect.objectContaining({
            parts: expect.arrayContaining([expect.objectContaining({ type: 'image' })]),
          }),
        ],
      })
    )
  })
})
