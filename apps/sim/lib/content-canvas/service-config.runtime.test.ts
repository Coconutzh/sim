/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { logger, mockGetPlatformContentServiceAvailability, mockGetPlatformContentServiceConfig } =
  vi.hoisted(() => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    mockGetPlatformContentServiceAvailability: vi.fn(),
    mockGetPlatformContentServiceConfig: vi.fn(),
  }))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => logger),
}))

vi.mock('@/lib/content-canvas/platform-service-config', () => ({
  getPlatformContentServiceAvailability: mockGetPlatformContentServiceAvailability,
  getPlatformContentServiceConfig: mockGetPlatformContentServiceConfig,
}))

import {
  getContentCanvasModelAvailabilityForRuntime,
  resolveContentServiceForRuntime,
} from '@/lib/content-canvas/service-config'

const ORIGINAL_ENV = process.env
const CONTENT_SERVICE_ENV_KEYS = [
  'CONTENT_TEXT_GEMINI_BASE_URL',
  'CONTENT_TEXT_GEMINI_API_KEY',
  'CONTENT_TEXT_GEMINI_ENABLED_MODELS',
  'CONTENT_TEXT_GEMINI_DEFAULT_MODEL',
  'CONTENT_TEXT_GLM_BASE_URL',
  'CONTENT_TEXT_GLM_API_KEY',
  'CONTENT_TEXT_GLM_ENABLED_MODELS',
  'CONTENT_TEXT_GLM_DEFAULT_MODEL',
  'CONTENT_IMAGE_GEMINI_BASE_URL',
  'CONTENT_IMAGE_GEMINI_API_KEY',
  'CONTENT_IMAGE_GEMINI_ENABLED_MODELS',
  'CONTENT_IMAGE_GEMINI_DEFAULT_MODEL',
  'CONTENT_IMAGE_ARK_BASE_URL',
  'CONTENT_IMAGE_ARK_API_KEY',
  'CONTENT_IMAGE_ARK_ENABLED_MODELS',
  'CONTENT_IMAGE_ARK_DEFAULT_MODEL',
  'CONTENT_AUDIO_BASE_URL',
  'CONTENT_AUDIO_API_KEY',
  'CONTENT_AUDIO_ENABLED_MODELS',
  'CONTENT_AUDIO_DEFAULT_MODEL',
  'CONTENT_VIDEO_BASE_URL',
  'CONTENT_VIDEO_API_KEY',
  'CONTENT_VIDEO_ENABLED_MODELS',
  'CONTENT_VIDEO_DEFAULT_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_API_KEY_1',
  'GEMINI_API_KEY_2',
  'GEMINI_API_KEY_3',
  'ZHIPU_API_KEY',
  'ARK_API_KEY',
  'ARK_BASE_URL',
  'EVOLINK_API_KEY',
  'EVOLINK_BASE_URL',
  'DASHSCOPE_API_KEY',
  'DASHSCOPE_BASE_URL',
] as const

function resetContentServiceEnv() {
  process.env = { ...ORIGINAL_ENV }
  for (const key of CONTENT_SERVICE_ENV_KEYS) {
    delete process.env[key]
  }
}

describe('content-canvas runtime service config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetContentServiceEnv()
    mockGetPlatformContentServiceAvailability.mockResolvedValue([])
    mockGetPlatformContentServiceConfig.mockResolvedValue(null)
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
  })

  it('resolves text, image, audio, and video from legacy env when managed config is absent', async () => {
    process.env.CONTENT_TEXT_GLM_BASE_URL = 'https://env-text.example.com/v1'
    process.env.CONTENT_TEXT_GLM_API_KEY = 'env-text-key'
    process.env.CONTENT_IMAGE_ARK_BASE_URL = 'https://env-image.example.com/v1'
    process.env.CONTENT_IMAGE_ARK_API_KEY = 'env-image-key'
    process.env.CONTENT_AUDIO_BASE_URL = 'https://env-audio.example.com/v1'
    process.env.CONTENT_AUDIO_API_KEY = 'env-audio-key'
    process.env.CONTENT_VIDEO_BASE_URL = 'https://env-video.example.com/v1'
    process.env.CONTENT_VIDEO_API_KEY = 'env-video-key'

    await expect(
      Promise.all([
        resolveContentServiceForRuntime({ capability: 'text', modelId: 'glm-4.7' }),
        resolveContentServiceForRuntime({ capability: 'image', modelId: 'jimeng-4.5' }),
        resolveContentServiceForRuntime({ capability: 'audio', modelId: 'suno-v4.5-beta' }),
        resolveContentServiceForRuntime({ capability: 'video', modelId: 'wan2.7-i2v' }),
      ])
    ).resolves.toEqual([
      {
        kind: 'openai-compatible',
        baseUrl: 'https://env-text.example.com/v1',
        apiKey: 'env-text-key',
        modelId: 'glm-4.7',
      },
      {
        kind: 'ark-image',
        baseUrl: 'https://env-image.example.com/v1',
        apiKey: 'env-image-key',
        modelId: 'jimeng-4.5',
      },
      {
        kind: 'evolink-audio',
        baseUrl: 'https://env-audio.example.com/v1',
        apiKey: 'env-audio-key',
        modelId: 'suno-v4.5-beta',
      },
      {
        kind: 'dashscope-video',
        baseUrl: 'https://env-video.example.com/v1',
        apiKey: 'env-video-key',
        modelId: 'wan2.7-i2v',
      },
    ])
  })

  it('keeps managed provider, base URL, and API keys ahead of env configuration', async () => {
    process.env.CONTENT_TEXT_GLM_BASE_URL = 'https://env.example.com/v1'
    process.env.CONTENT_TEXT_GLM_API_KEY = 'env-key'
    mockGetPlatformContentServiceConfig.mockResolvedValue({
      kind: 'openai-compatible',
      baseUrl: 'https://managed.example.com/v1',
      apiKey: 'managed-primary-key',
      apiKeys: [
        { apiKey: 'managed-primary-key', keyId: 'key-1' },
        { apiKey: 'managed-backup-key', keyId: 'key-2' },
      ],
      modelId: 'glm-4.7',
      providerId: 'zhipu',
    })

    await expect(
      resolveContentServiceForRuntime({ capability: 'text', modelId: 'glm-4.7' })
    ).resolves.toEqual({
      kind: 'openai-compatible',
      baseUrl: 'https://managed.example.com/v1',
      apiKey: 'managed-primary-key',
      apiKeys: [
        { apiKey: 'managed-primary-key', keyId: 'key-1' },
        { apiKey: 'managed-backup-key', keyId: 'key-2' },
      ],
      modelId: 'glm-4.7',
      providerId: 'zhipu',
    })
  })

  it('falls back after a managed config read failure without logging API keys', async () => {
    process.env.CONTENT_TEXT_GLM_API_KEY = 'env-secret-key'
    mockGetPlatformContentServiceConfig.mockRejectedValue(new Error('failed near managed-secret'))

    await expect(
      resolveContentServiceForRuntime({ capability: 'text', modelId: 'glm-4.7' })
    ).resolves.toMatchObject({
      apiKey: 'env-secret-key',
      modelId: 'glm-4.7',
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to read managed content service; using legacy environment fallback',
      { capability: 'text', modelId: 'glm-4.7' }
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('env-secret-key')
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('managed-secret')
  })

  it('falls back to executable env models when managed availability cannot be read', async () => {
    process.env.CONTENT_TEXT_GEMINI_API_KEY = 'env-gemini-key'
    process.env.CONTENT_TEXT_GEMINI_ENABLED_MODELS = 'gemini-2.5-flash'
    mockGetPlatformContentServiceAvailability.mockRejectedValue(new Error('missing table'))

    await expect(getContentCanvasModelAvailabilityForRuntime()).resolves.toMatchObject({
      text: {
        enabledModelIds: ['gemini-2.5-flash'],
        defaultModelId: 'gemini-2.5-flash',
      },
    })
    await expect(
      resolveContentServiceForRuntime({ capability: 'text', modelId: 'gemini-2.5-flash' })
    ).resolves.toMatchObject({
      apiKey: 'env-gemini-key',
      modelId: 'gemini-2.5-flash',
    })
  })
})
