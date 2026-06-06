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

const ORIGINAL_ENV = process.env

function resetModelsEnv() {
  process.env = { ...ORIGINAL_ENV }
  delete process.env.CONTENT_TEXT_GEMINI_API_KEY
  delete process.env.CONTENT_TEXT_GEMINI_ENABLED_MODELS
  delete process.env.CONTENT_TEXT_GEMINI_DEFAULT_MODEL
  delete process.env.CONTENT_TEXT_GLM_API_KEY
  delete process.env.CONTENT_TEXT_GLM_ENABLED_MODELS
  delete process.env.CONTENT_TEXT_GLM_DEFAULT_MODEL
  delete process.env.ZHIPU_API_KEY
  delete process.env.CONTENT_IMAGE_ARK_API_KEY
  delete process.env.CONTENT_IMAGE_ARK_ENABLED_MODELS
  delete process.env.CONTENT_IMAGE_ARK_DEFAULT_MODEL
  delete process.env.CONTENT_AUDIO_API_KEY
  delete process.env.EVOLINK_API_KEY
  delete process.env.CONTENT_VIDEO_API_KEY
  delete process.env.DASHSCOPE_API_KEY
}

describe('GET /api/content-canvas/models', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetModelsEnv()

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

  it('returns only env-enabled content-canvas models and exposes sanitized defaults', async () => {
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
    expect(body).toMatchObject({
      success: true,
      models: {
        text: {
          defaultModelId: 'gemini-2.5-pro',
          enabledModelIds: ['gemini-2.5-flash', 'gemini-2.5-pro'],
        },
        image: {
          defaultModelId: 'jimeng-4.5',
          enabledModelIds: ['jimeng-4.5'],
        },
      },
    })
    expect(body.models.audio.enabledModelIds).toEqual([])
    expect(body.models.video.enabledModelIds).toEqual([])
    expect(JSON.stringify(body)).not.toContain('text-key')
    expect(JSON.stringify(body)).not.toContain('ark-key')
  })
})
