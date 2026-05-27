/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/lib/core/config/env', () => ({
  env: {
    ARK_API_KEY: 'test-ark-api-key',
    ARK_BASE_URL: 'https://ark.cn-beijing.volces.com/api/v3',
  },
}))

import { generateImageWithProvider } from '@/lib/generated-media/image/providers'

describe('generateImageWithProvider', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('calls Ark image generation with the full Seedream model id', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ b64_json: Buffer.from('fake-image').toString('base64') }],
      }),
    }) as typeof fetch

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
})
