/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = process.env
const CONTENT_CANVAS_ENV_KEYS = [
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
  'ZHIPU_API_KEY',
  'ARK_API_KEY',
  'ARK_BASE_URL',
  'EVOLINK_API_KEY',
  'EVOLINK_BASE_URL',
  'DASHSCOPE_API_KEY',
  'DASHSCOPE_BASE_URL',
] as const

function resetContentCanvasEnv() {
  process.env = { ...ORIGINAL_ENV }

  for (const key of CONTENT_CANVAS_ENV_KEYS) {
    process.env[key] = undefined
  }
}

describe('content-canvas service config', () => {
  beforeEach(() => {
    vi.resetModules()
    resetContentCanvasEnv()
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
  })

  it('centralizes model catalog metadata and content-reference capability lookup', async () => {
    const {
      getContentCanvasModel,
      getContentCanvasModelsByCapability,
      getContentReferenceCapability,
    } = await import('@/lib/content-canvas/model-catalog')

    expect(getContentCanvasModelsByCapability('text').map((model) => model.id)).toEqual(
      expect.arrayContaining([
        'gemini-3.1-flash-lite-preview',
        'gemini-2.5-flash',
        'glm-4.7-flash',
        'glm-4.7',
      ])
    )

    expect(getContentCanvasModel('wan2.7-i2v')).toMatchObject({
      id: 'wan2.7-i2v',
      capability: 'video',
      family: 'wan2.7',
      serviceKind: 'dashscope-video',
    })

    expect(
      getContentReferenceCapability({
        targetVariant: 'text',
        model: 'gemini-3.1-flash-lite-preview',
      })
    ).toMatchObject({
      targetVariant: 'text',
      allowedSourceVariants: expect.arrayContaining(['image', 'text']),
    })

    expect(
      getContentReferenceCapability({
        targetVariant: 'text',
        model: 'glm-4.7-flash',
      })
    ).toMatchObject({
      targetVariant: 'text',
      allowedSourceVariants: ['text', 'video'],
    })

    expect(
      getContentReferenceCapability({
        targetVariant: 'image',
        model: 'jimeng-4.5',
      })
    ).toMatchObject({
      targetVariant: 'image',
      allowedSourceVariants: ['text', 'image'],
      supportedRoles: ['text_context', 'image_reference'],
    })
  })

  it('uses built-in family defaults when enabled/default env values are empty or invalid', async () => {
    process.env.CONTENT_TEXT_GEMINI_API_KEY = 'content-gemini-key'
    process.env.CONTENT_TEXT_GEMINI_ENABLED_MODELS = ''
    process.env.CONTENT_TEXT_GEMINI_DEFAULT_MODEL = ''
    process.env.CONTENT_TEXT_GLM_API_KEY = 'content-glm-key'
    process.env.CONTENT_TEXT_GLM_ENABLED_MODELS = 'glm-4.7, glm-4.6'
    process.env.CONTENT_TEXT_GLM_DEFAULT_MODEL = 'glm-does-not-exist'

    const { getContentServiceConfig } = await import('@/lib/content-canvas/service-config')

    expect(getContentServiceConfig({ capability: 'text', family: 'gemini' })).toMatchObject({
      kind: 'google-native',
      enabledModelIds: [
        'gemini-3.1-flash-lite-preview',
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-3.1-pro-preview',
      ],
      defaultModelId: 'gemini-3.1-flash-lite-preview',
    })

    expect(getContentServiceConfig({ capability: 'text', family: 'glm' })).toMatchObject({
      kind: 'openai-compatible',
      enabledModelIds: ['glm-4.7', 'glm-4.6'],
      defaultModelId: 'glm-4.7',
    })
  })

  it('routes Gemini text to compatible transport when content baseUrl is configured', async () => {
    process.env.CONTENT_TEXT_GEMINI_BASE_URL = 'https://gateway.example.com/v1'
    process.env.CONTENT_TEXT_GEMINI_API_KEY = 'gateway-key'

    const { resolveContentService } = await import('@/lib/content-canvas/service-config')

    expect(resolveContentService({ capability: 'text', modelId: 'gemini-2.5-pro' })).toMatchObject({
      kind: 'openai-compatible',
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'gateway-key',
      modelId: 'gemini-2.5-pro',
    })
  })

  it('falls back to legacy native Gemini env when new content-canvas text env is absent', async () => {
    process.env.GEMINI_API_KEY = 'legacy-gemini-key'

    const { resolveContentService } = await import('@/lib/content-canvas/service-config')

    expect(
      resolveContentService({
        capability: 'text',
        modelId: 'gemini-3.1-flash-lite-preview',
      })
    ).toMatchObject({
      kind: 'google-native',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'legacy-gemini-key',
      modelId: 'gemini-3.1-flash-lite-preview',
    })
  })

  it('routes image Gemini through Evolink when the image-specific key is configured', async () => {
    process.env.CONTENT_IMAGE_GEMINI_API_KEY = 'evolink-image-key'

    const { resolveContentService } = await import('@/lib/content-canvas/service-config')

    expect(
      resolveContentService({
        capability: 'image',
        modelId: 'gemini-3.1-flash-image-preview',
      })
    ).toMatchObject({
      kind: 'openai-compatible',
      baseUrl: 'https://api.evolink.ai/v1',
      apiKey: 'evolink-image-key',
      modelId: 'gemini-3.1-flash-image-preview',
    })
  })
})
