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
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCutoutWorkspaceImage } = vi.hoisted(() => ({
  mockCutoutWorkspaceImage: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/generated-media/image/image-generation-service', () => ({
  cutoutWorkspaceImage: (...args: unknown[]) => mockCutoutWorkspaceImage(...args),
}))

import { POST } from '@/app/api/media/images/cutout/route'

describe('POST /api/media/images/cutout', () => {
  beforeEach(() => {
    vi.clearAllMocks()

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
    mockCutoutWorkspaceImage.mockResolvedValue({
      file: {
        id: 'wf_123',
        name: 'generated-cutout.png',
        size: 12,
        type: 'image/png',
        key: 'workspace/ws-1/generated-cutout.png',
        url: '/api/files/serve/workspace/ws-1/generated-cutout.png?context=workspace',
        context: 'workspace',
      },
      metadata: {
        provider: 'gemini',
        providerModel: 'gemini-3-pro-image',
        hasAlpha: true,
        postProcessed: false,
      },
    })
  })

  it('cuts out a workspace image without accepting a client-supplied model', async () => {
    const sourceImage = {
      id: 'source-1',
      name: 'source.png',
      url: '',
      key: 'workspace/source.png',
      size: 100,
      type: 'image/png',
    }
    const request = createMockRequest(
      'POST',
      {
        workspaceId: 'ws-1',
        sourceImage,
        model: 'jimeng-4.5',
      },
      {
        'content-type': 'application/json',
      },
      'http://localhost:3000/api/media/images/cutout'
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockCutoutWorkspaceImage).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      sourceImage,
    })
    expect(body).toMatchObject({
      success: true,
      file: {
        type: 'image/png',
      },
      metadata: {
        providerModel: 'gemini-3-pro-image',
        hasAlpha: true,
        postProcessed: false,
      },
    })
  })

  it('returns the concrete cutout failure message instead of a generic server error', async () => {
    const sourceImage = {
      id: 'source-1',
      name: 'source.png',
      url: '',
      key: 'workspace/source.png',
      size: 100,
      type: 'image/png',
    }
    mockCutoutWorkspaceImage.mockRejectedValue(
      new Error(
        'Unable to generate a real transparent PNG. The model returned an opaque image and server post-processing could not derive an alpha mask.'
      )
    )

    const request = createMockRequest(
      'POST',
      {
        workspaceId: 'ws-1',
        sourceImage,
      },
      {
        'content-type': 'application/json',
      },
      'http://localhost:3000/api/media/images/cutout'
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      error:
        'Unable to generate a real transparent PNG. The model returned an opaque image and server post-processing could not derive an alpha mask.',
    })
  })
})
