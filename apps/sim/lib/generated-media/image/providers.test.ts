/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = process.env
const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    withMetadata: vi.fn(),
  },
}))

loggerMock.child.mockReturnValue(loggerMock)
loggerMock.withMetadata.mockReturnValue(loggerMock)

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => loggerMock),
}))

describe('generateImageWithProvider', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env = {
      ...originalEnv,
      CONTENT_IMAGE_ARK_API_KEY: 'test-ark-api-key',
    }
    process.env.ARK_API_KEY = undefined
    process.env.CONTENT_IMAGE_GEMINI_BASE_URL = undefined
    process.env.CONTENT_IMAGE_GEMINI_API_KEY = undefined
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env = originalEnv
  })

  it('calls Ark image generation with the full Seedream model id', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ b64_json: Buffer.from('fake-image').toString('base64') }],
      }),
    }) as typeof fetch

    const { generateImageWithProvider } = await import('@/lib/generated-media/image/providers')

    await generateImageWithProvider({
      model: 'jimeng-4.5',
      prompt: 'A bright poster image',
      aspectRatio: '16:9',
    })

    expect(global.fetch).toHaveBeenCalledWith(
      'https://ark.cn-beijing.volces.com/api/v3/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-ark-api-key',
        }),
      })
    )

    const requestInit = vi.mocked(global.fetch).mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      model: 'doubao-seedream-4-5-251128',
      prompt: 'A bright poster image',
      size: '2560x1440',
      response_format: 'b64_json',
    })
  })

  it('creates and polls an Evolink image task with Gemini image references', async () => {
    process.env.CONTENT_IMAGE_GEMINI_API_KEY = 'test-evolink-image-key'
    const imageBytes = Buffer.from('edited-image')
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-1',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'succeeded',
          data: {
            images: [{ url: 'https://cdn.example.com/generated.png' }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () =>
          imageBytes.buffer.slice(
            imageBytes.byteOffset,
            imageBytes.byteOffset + imageBytes.byteLength
          ),
      }) as typeof fetch

    const { generateImageWithProvider } = await import('@/lib/generated-media/image/providers')

    const result = await generateImageWithProvider({
      model: 'gemini-3-pro-image-preview',
      prompt: 'Create a side angle',
      aspectRatio: 'auto',
      referenceContext: {
        text: [],
        images: [
          {
            id: 'file-1',
            name: 'source.png',
            url: '',
            base64: Buffer.from('source-image').toString('base64'),
            key: 'source-key',
            size: 1024,
            type: 'image/png',
          },
        ],
      },
    })

    expect(result).toMatchObject({
      provider: 'gemini-compatible',
      providerModel: 'gemini-3-pro-image-preview',
      mimeType: 'image/png',
    })
    expect(result.buffer.toString()).toBe('edited-image')
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.evolink.ai/v1/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-evolink-image-key',
        }),
      })
    )

    const requestInit = vi.mocked(global.fetch).mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(requestInit.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'gemini-3-pro-image-preview',
      prompt: expect.stringContaining('Create a side angle'),
      size: 'auto',
    })
    expect(body.image_urls).toEqual([
      `data:image/png;base64,${Buffer.from('source-image').toString('base64')}`,
    ])
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.evolink.ai/v1/tasks/task-1',
      expect.objectContaining({
        method: 'GET',
      })
    )
    expect(global.fetch).toHaveBeenCalledWith(
      'https://cdn.example.com/generated.png',
      expect.objectContaining({})
    )
  })
})
