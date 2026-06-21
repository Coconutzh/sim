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
    vi.useRealTimers()
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
    expect(JSON.parse(String(requestInit.body))).not.toHaveProperty('image')
  })

  it('sends a single Ark image reference in the Seedream image field', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ b64_json: Buffer.from('fake-image').toString('base64') }],
      }),
    }) as typeof fetch

    const { generateImageWithProvider } = await import('@/lib/generated-media/image/providers')

    await generateImageWithProvider({
      model: 'jimeng-4.5',
      prompt: 'Use this product as reference',
      aspectRatio: '1:1',
      referenceContext: {
        text: [],
        images: [
          {
            id: 'file-1',
            name: 'product.png',
            url: 'https://cdn.example.com/product.png',
            key: 'product-key',
            size: 1024,
            type: 'image/png',
          },
        ],
      },
    })

    const requestInit = vi.mocked(global.fetch).mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      model: 'doubao-seedream-4-5-251128',
      prompt: 'Use this product as reference',
      size: '2048x2048',
      response_format: 'b64_json',
      image: 'https://cdn.example.com/product.png',
    })
  })

  it('sends multiple Ark image references in the Seedream image field', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ b64_json: Buffer.from('fake-image').toString('base64') }],
      }),
    }) as typeof fetch

    const { generateImageWithProvider } = await import('@/lib/generated-media/image/providers')
    const base64Reference = Buffer.from('source-image').toString('base64')

    await generateImageWithProvider({
      model: 'jimeng-4.0',
      prompt: 'Blend both references',
      aspectRatio: '4:3',
      referenceContext: {
        text: ['Keep the same palette'],
        images: [
          {
            id: 'file-1',
            name: 'source.png',
            url: '',
            base64: base64Reference,
            key: 'source-key',
            size: 1024,
            type: 'image/png',
          },
          {
            id: 'file-2',
            name: 'style.jpg',
            url: 'https://cdn.example.com/style.jpg',
            key: 'style-key',
            size: 2048,
            type: 'image/jpeg',
          },
        ],
      },
    })

    const requestInit = vi.mocked(global.fetch).mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      model: 'doubao-seedream-4-0-250828',
      prompt: 'Blend both references\n\nKeep the same palette',
      size: '2304x1728',
      response_format: 'b64_json',
      image: [`data:image/png;base64,${base64Reference}`, 'https://cdn.example.com/style.jpg'],
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
          data: {
            file_url: 'https://files.example.com/source.png',
          },
        }),
      })
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
      model: 'gemini-3-pro-image',
      prompt: 'Create a side angle',
      aspectRatio: 'auto',
      resolution: '2K',
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
      providerModel: 'gemini-3-pro-image',
      mimeType: 'image/png',
    })
    expect(result.buffer.toString()).toBe('edited-image')
    expect(global.fetch).toHaveBeenCalledWith(
      'https://files-api.evolink.ai/api/v1/files/upload/base64',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-evolink-image-key',
        }),
      })
    )
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.evolink.ai/v1/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-evolink-image-key',
        }),
      })
    )

    const uploadRequestInit = vi.mocked(global.fetch).mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(uploadRequestInit.body))).toMatchObject({
      base64_data: `data:image/png;base64,${Buffer.from('source-image').toString('base64')}`,
      file_name: 'source.png',
      upload_path: 'sim-content-canvas',
    })

    const requestInit = vi.mocked(global.fetch).mock.calls[1]?.[1] as RequestInit
    const body = JSON.parse(String(requestInit.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'gemini-3-pro-image',
      prompt: expect.stringContaining('Create a side angle'),
      size: 'auto',
      quality: '2K',
    })
    expect(body.prompt).toEqual(expect.stringContaining('Use 2K output resolution.'))
    expect(body.image_urls).toEqual(['https://files.example.com/source.png'])
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

  it('sends concrete Gemini Pro aspect ratio size with image references and resolution quality', async () => {
    process.env.CONTENT_IMAGE_GEMINI_API_KEY = 'test-evolink-image-key'
    const imageBytes = Buffer.from('edited-image')
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            file_url: 'https://files.example.com/source.png',
          },
        }),
      })
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

    await generateImageWithProvider({
      model: 'gemini-3-pro-image',
      prompt: 'Outpaint the image',
      aspectRatio: '16:9',
      resolution: '2K',
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

    const requestInit = vi.mocked(global.fetch).mock.calls[1]?.[1] as RequestInit
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      model: 'gemini-3-pro-image',
      size: '16:9',
      quality: '2K',
      image_urls: ['https://files.example.com/source.png'],
    })
  })

  it('falls back to Gemini 3 Pro Image preview when Evolink has no stable service', async () => {
    process.env.CONTENT_IMAGE_GEMINI_API_KEY = 'test-evolink-image-key'
    const imageBytes = Buffer.from('preview-edited-image')
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            file_url: 'https://files.example.com/stable-source.png',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            file_url: 'https://files.example.com/stable-mask.png',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: {
            message: "No available service for model 'gemini-3-pro-image', please try again later.",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            file_url: 'https://files.example.com/preview-source.png',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            file_url: 'https://files.example.com/preview-mask.png',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-preview',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'succeeded',
          data: {
            images: [{ url: 'https://cdn.example.com/preview-generated.png' }],
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
      model: 'gemini-3-pro-image',
      prompt: 'Repaint the masked area',
      aspectRatio: 'auto',
      resolution: '2K',
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
          {
            id: 'mask-1',
            name: 'mask.png',
            url: '',
            base64: Buffer.from('mask-image').toString('base64'),
            key: 'mask-key',
            size: 512,
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
    expect(result.buffer.toString()).toBe('preview-edited-image')
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Falling back to Gemini 3 Pro Image preview model',
      expect.objectContaining({
        model: 'gemini-3-pro-image',
        fallbackModel: 'gemini-3-pro-image-preview',
      })
    )

    const stableRequestInit = vi.mocked(global.fetch).mock.calls[2]?.[1] as RequestInit
    const stableBody = JSON.parse(String(stableRequestInit.body)) as Record<string, unknown>
    expect(stableBody).toMatchObject({
      model: 'gemini-3-pro-image',
      prompt: expect.stringContaining('Repaint the masked area'),
      size: 'auto',
      quality: '2K',
    })
    expect(stableBody.image_urls).toEqual([
      'https://files.example.com/stable-source.png',
      'https://files.example.com/stable-mask.png',
    ])

    const previewRequestInit = vi.mocked(global.fetch).mock.calls[5]?.[1] as RequestInit
    const previewBody = JSON.parse(String(previewRequestInit.body)) as Record<string, unknown>
    expect(previewBody).toMatchObject({
      model: 'gemini-3-pro-image-preview',
      prompt: expect.stringContaining('Repaint the masked area'),
      size: 'auto',
      quality: '2K',
    })
    expect(previewBody.image_urls).toEqual([
      'https://files.example.com/preview-source.png',
      'https://files.example.com/preview-mask.png',
    ])
  })

  it('falls back to Gemini 3 Pro Image preview when Evolink stable task reports invalid parameters', async () => {
    process.env.CONTENT_IMAGE_GEMINI_API_KEY = 'test-evolink-image-key'
    const imageBytes = Buffer.from('preview-after-invalid-params')
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            file_url: 'https://files.example.com/stable-source.png',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-invalid',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'failed',
          message:
            'Invalid parameters.\nPlease check that resolution, duration, prompt length, and other parameters are within the model supported range.',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            file_url: 'https://files.example.com/preview-source.png',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-preview',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'succeeded',
          data: {
            images: [{ url: 'https://cdn.example.com/preview-generated.png' }],
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
      model: 'gemini-3-pro-image',
      prompt: 'Cut out the subject',
      aspectRatio: '1:1',
      resolution: '2K',
      logContext: {
        tool: 'cutout',
        sourceBytes: 1024,
        maskBytes: 0,
        referenceBytes: 0,
      },
      referenceContext: {
        text: [],
        images: [
          {
            id: '',
            name: 'source.jpg',
            url: '',
            base64: Buffer.from('normalized-source-image').toString('base64'),
            key: 'source-key',
            size: 1024,
            type: 'image/jpeg',
          },
        ],
      },
    })

    expect(result).toMatchObject({
      provider: 'gemini-compatible',
      providerModel: 'gemini-3-pro-image-preview',
      mimeType: 'image/png',
    })
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Gemini compatible image task failed',
      expect.objectContaining({
        model: 'gemini-3-pro-image',
        taskId: 'task-invalid',
        status: 'failed',
        error: expect.stringContaining('Invalid parameters'),
        errorCategory: 'invalid_parameters',
        tool: 'cutout',
        size: '1:1',
        quality: '2K',
        imageUrlCount: 1,
        sourceBytes: 1024,
        maskBytes: 0,
        referenceBytes: 0,
      })
    )
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Falling back to Gemini 3 Pro Image preview model',
      expect.objectContaining({
        model: 'gemini-3-pro-image',
        fallbackModel: 'gemini-3-pro-image-preview',
        reason: expect.stringContaining('Invalid parameters'),
      })
    )
  })

  it('allows Pro Image compatible tasks to poll for five minutes before timing out', async () => {
    vi.useFakeTimers()
    process.env.CONTENT_IMAGE_GEMINI_API_KEY = 'test-evolink-image-key'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://api.evolink.ai/v1/images/generations') {
        return {
          ok: true,
          json: async () => ({
            task_id: 'task-slow',
          }),
        }
      }

      if (url === 'https://api.evolink.ai/v1/tasks/task-slow') {
        return {
          ok: true,
          json: async () => ({
            status: 'processing',
          }),
        }
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch
    global.fetch = fetchMock

    const { generateImageWithProvider } = await import('@/lib/generated-media/image/providers')

    const result = generateImageWithProvider({
      model: 'gemini-3-pro-image',
      prompt: 'Cut out the subject',
      aspectRatio: 'auto',
      resolution: '2K',
    })
    const rejection = expect(result).rejects.toThrow(
      'Gemini compatible image task task-slow for model gemini-3-pro-image did not complete within 300s'
    )

    await vi.runAllTimersAsync()

    await rejection
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === 'https://api.evolink.ai/v1/tasks/task-slow'
      )
    ).toHaveLength(301)
  })
})
