/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  hybridAuthMock,
  hybridAuthMockFns,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

const { mockGetPlatformContentServiceAvailability } = vi.hoisted(() => ({
  mockGetPlatformContentServiceAvailability: vi.fn(),
}))

vi.mock('@/lib/content-canvas/platform-service-config', () => ({
  getPlatformContentServiceAvailability: mockGetPlatformContentServiceAvailability,
  getPlatformContentServiceConfig: vi.fn(),
}))

const ORIGINAL_ENV = process.env
const MODEL_ENV_KEYS = [
  'CONTENT_TEXT_GEMINI_API_KEY',
  'CONTENT_TEXT_GEMINI_ENABLED_MODELS',
  'CONTENT_TEXT_GEMINI_DEFAULT_MODEL',
  'CONTENT_TEXT_GLM_API_KEY',
  'CONTENT_TEXT_GLM_ENABLED_MODELS',
  'CONTENT_TEXT_GLM_DEFAULT_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_API_KEY_1',
  'ZHIPU_API_KEY',
  'CONTENT_IMAGE_GEMINI_API_KEY',
  'CONTENT_IMAGE_ARK_API_KEY',
  'CONTENT_IMAGE_ARK_ENABLED_MODELS',
  'CONTENT_IMAGE_ARK_DEFAULT_MODEL',
  'CONTENT_AUDIO_API_KEY',
  'CONTENT_AUDIO_ENABLED_MODELS',
  'CONTENT_AUDIO_DEFAULT_MODEL',
  'EVOLINK_API_KEY',
  'CONTENT_VIDEO_API_KEY',
  'CONTENT_VIDEO_ENABLED_MODELS',
  'CONTENT_VIDEO_DEFAULT_MODEL',
  'DASHSCOPE_API_KEY',
] as const

function resetModelsEnv() {
  process.env = { ...ORIGINAL_ENV }
  for (const key of MODEL_ENV_KEYS) {
    process.env[key] = undefined
  }
}

describe('GET /api/content-canvas/models', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetModelsEnv()
    mockGetPlatformContentServiceAvailability.mockResolvedValue([])

    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: hybridAuthMock.AuthType.SESSION,
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      canWrite: true,
      exists: true,
      workspace: { id: 'ws-1', name: 'Test Workspace', ownerId: 'user-1' },
    })
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
  })

  it('returns env-configured models when no administrator configuration is available', async () => {
    process.env.CONTENT_TEXT_GEMINI_API_KEY = 'text-key'
    process.env.CONTENT_TEXT_GEMINI_ENABLED_MODELS = 'gemini-2.5-flash, gemini-2.5-pro'
    process.env.CONTENT_TEXT_GEMINI_DEFAULT_MODEL = 'gemini-2.5-pro'
    process.env.CONTENT_IMAGE_ARK_API_KEY = 'ark-key'
    process.env.CONTENT_IMAGE_ARK_ENABLED_MODELS = 'jimeng-4.5'

    const { GET } = await import('@/app/api/content-canvas/models/route')

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        undefined,
        'http://localhost:3000/api/content-canvas/models?workspaceId=ws-1'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: true })
    expect(body.models.text).toEqual({
      enabledModelIds: ['gemini-2.5-flash', 'gemini-2.5-pro'],
      defaultModelId: 'gemini-2.5-pro',
    })
    expect(body.models.image).toEqual({
      enabledModelIds: ['jimeng-4.5'],
      defaultModelId: 'jimeng-4.5',
    })
    expect(body.models.audio.enabledModelIds).toEqual([])
    expect(body.models.video.enabledModelIds).toEqual([])
    expect(JSON.stringify(body)).not.toContain('text-key')
    expect(JSON.stringify(body)).not.toContain('ark-key')
  })

  it('falls back to env-configured models when the managed configuration query fails', async () => {
    process.env.CONTENT_TEXT_GLM_API_KEY = 'glm-env-key'
    process.env.CONTENT_TEXT_GLM_ENABLED_MODELS = 'glm-4.7'
    mockGetPlatformContentServiceAvailability.mockRejectedValue(
      new Error('relation platform_model_service_config does not exist')
    )

    const { GET } = await import('@/app/api/content-canvas/models/route')
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        undefined,
        'http://localhost:3000/api/content-canvas/models?workspaceId=ws-1'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.models.text).toEqual({
      enabledModelIds: ['glm-4.7'],
      defaultModelId: 'glm-4.7',
    })
    expect(JSON.stringify(body)).not.toContain('glm-env-key')
  })

  it('uses managed models per capability while other capabilities fall back independently', async () => {
    process.env.CONTENT_TEXT_GEMINI_API_KEY = 'text-env-key'
    process.env.CONTENT_TEXT_GEMINI_ENABLED_MODELS = 'gemini-2.5-pro'
    process.env.CONTENT_IMAGE_ARK_API_KEY = 'image-env-key'
    process.env.CONTENT_IMAGE_ARK_ENABLED_MODELS = 'jimeng-4.5'
    process.env.CONTENT_AUDIO_API_KEY = 'audio-env-key'
    process.env.CONTENT_AUDIO_ENABLED_MODELS = 'suno-v4.5-beta'
    process.env.CONTENT_VIDEO_API_KEY = 'video-env-key'
    process.env.CONTENT_VIDEO_ENABLED_MODELS = 'wan2.7-i2v'
    mockGetPlatformContentServiceAvailability.mockResolvedValue([
      {
        capability: 'text',
        family: 'glm',
        providerId: 'zhipu',
        enabledModelIds: ['glm-4.7'],
        defaultModelId: 'glm-4.7',
        priority: 0,
      },
    ])

    const { GET } = await import('@/app/api/content-canvas/models/route')
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        undefined,
        'http://localhost:3000/api/content-canvas/models?workspaceId=ws-1'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.models).toEqual({
      text: { enabledModelIds: ['glm-4.7'], defaultModelId: 'glm-4.7' },
      image: { enabledModelIds: ['jimeng-4.5'], defaultModelId: 'jimeng-4.5' },
      audio: { enabledModelIds: ['suno-v4.5-beta'], defaultModelId: 'suno-v4.5-beta' },
      video: { enabledModelIds: ['wan2.7-i2v'], defaultModelId: 'wan2.7-i2v' },
    })
    expect(JSON.stringify(body)).not.toContain('env-key')
  })
})
