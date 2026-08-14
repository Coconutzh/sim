/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = process.env
const { mockExecuteProviderRequest, mockGetPlatformContentServiceConfig } = vi.hoisted(() => ({
  mockExecuteProviderRequest: vi.fn(),
  mockGetPlatformContentServiceConfig: vi.fn(),
}))

vi.mock('@/providers', () => ({
  executeProviderRequest: (...args: unknown[]) => mockExecuteProviderRequest(...args),
}))

vi.mock('@/lib/content-canvas/platform-service-config', () => ({
  getPlatformContentServiceConfig: mockGetPlatformContentServiceConfig,
}))

function resetExecutorEnv() {
  process.env = { ...ORIGINAL_ENV }
  process.env.CONTENT_TEXT_GEMINI_BASE_URL = undefined
  process.env.CONTENT_TEXT_GEMINI_API_KEY = undefined
  process.env.CONTENT_TEXT_GLM_BASE_URL = undefined
  process.env.CONTENT_TEXT_GLM_API_KEY = undefined
  process.env.GEMINI_API_KEY = undefined
  process.env.GEMINI_API_KEY_1 = undefined
  process.env.ZHIPU_API_KEY = undefined
}

describe('content-canvas text executor', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetExecutorEnv()
    mockGetPlatformContentServiceConfig.mockResolvedValue(null)
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    vi.unstubAllGlobals()
  })

  it('routes Gemini text through the configured compatible gateway and preserves reference images', async () => {
    process.env.CONTENT_TEXT_GEMINI_BASE_URL = 'https://gateway.example.com/v1'
    process.env.CONTENT_TEXT_GEMINI_API_KEY = 'gateway-key'
    const abortController = new AbortController()

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'compatible result' } }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { generateContentCanvasText } = await import('@/lib/content-canvas/text-executor')

    await expect(
      generateContentCanvasText({
        workspaceId: 'ws-1',
        model: 'gemini-2.5-pro',
        systemPrompt: 'System prompt',
        prompt: 'Write a caption',
        abortSignal: abortController.signal,
        referenceContextText: 'Referenced canvas context',
        referenceImages: [{ mimeType: 'image/png', data: 'ZmFrZS1pbWFnZQ==' }],
      })
    ).resolves.toBe('compatible result')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        signal: abortController.signal,
        headers: expect.objectContaining({
          Authorization: 'Bearer gateway-key',
        }),
        body: expect.stringContaining('data:image/png;base64,ZmFrZS1pbWFnZQ=='),
      })
    )
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('routes Gemini text through the native Google provider when no compatible baseUrl is configured', async () => {
    process.env.GEMINI_API_KEY = 'legacy-gemini-key'
    const abortController = new AbortController()
    mockExecuteProviderRequest.mockResolvedValue({
      content: 'native result',
      model: 'gemini-3.1-flash-lite-preview',
    })

    const { generateContentCanvasText } = await import('@/lib/content-canvas/text-executor')

    await expect(
      generateContentCanvasText({
        workspaceId: 'ws-1',
        model: 'gemini-3.1-flash-lite-preview',
        systemPrompt: 'System prompt',
        prompt: 'Write a caption',
        abortSignal: abortController.signal,
        referenceContextText: 'Referenced canvas context',
        referenceImages: [{ mimeType: 'image/png', data: 'ZmFrZS1pbWFnZQ==' }],
      })
    ).resolves.toBe('native result')

    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      'google',
      expect.objectContaining({
        workspaceId: 'ws-1',
        model: 'gemini-3.1-flash-lite-preview',
        apiKey: 'legacy-gemini-key',
        abortSignal: abortController.signal,
        messages: [
          expect.objectContaining({
            parts: [
              expect.objectContaining({ type: 'text' }),
              expect.objectContaining({ type: 'image', mimeType: 'image/png' }),
            ],
          }),
        ],
      })
    )
  })

  it('routes GLM text through the compatible transport only', async () => {
    process.env.CONTENT_TEXT_GLM_API_KEY = 'glm-key'

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'glm result' } }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { generateContentCanvasText } = await import('@/lib/content-canvas/text-executor')

    await expect(
      generateContentCanvasText({
        workspaceId: 'ws-1',
        model: 'glm-4.7',
        systemPrompt: 'System prompt',
        prompt: 'Write a caption',
      })
    ).resolves.toBe('glm result')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer glm-key',
        }),
      })
    )
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('uses managed text transport and credentials ahead of env configuration', async () => {
    process.env.CONTENT_TEXT_GLM_BASE_URL = 'https://env.example.com/v1'
    process.env.CONTENT_TEXT_GLM_API_KEY = 'env-key'
    mockGetPlatformContentServiceConfig.mockResolvedValue({
      kind: 'openai-compatible',
      baseUrl: 'https://managed.example.com/v1',
      apiKey: 'managed-key',
      apiKeys: [{ apiKey: 'managed-key', keyId: 'key-1' }],
      modelId: 'glm-4.7',
      providerId: 'zhipu',
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'managed result' } }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { generateContentCanvasText } = await import('@/lib/content-canvas/text-executor')

    await expect(
      generateContentCanvasText({
        workspaceId: 'ws-1',
        model: 'glm-4.7',
        systemPrompt: 'System prompt',
        prompt: 'Write a caption',
      })
    ).resolves.toBe('managed result')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://managed.example.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer managed-key',
        }),
      })
    )
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('env-key')
  })
})
