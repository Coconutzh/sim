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

const { mockEraseWorkspaceImage } = vi.hoisted(() => ({
  mockEraseWorkspaceImage: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/generated-media/image/image-generation-service', () => ({
  eraseWorkspaceImage: (...args: unknown[]) => mockEraseWorkspaceImage(...args),
}))

import { POST } from '@/app/api/media/images/erase/route'

describe('POST /api/media/images/erase', () => {
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
    mockEraseWorkspaceImage.mockResolvedValue({
      file: {
        id: 'wf_123',
        name: 'generated-image.png',
        size: 12,
        type: 'image/png',
        key: 'workspace/ws-1/generated-image.png',
        url: '/api/files/serve/workspace/ws-1/generated-image.png?context=workspace',
        context: 'workspace',
      },
      metadata: {
        provider: 'gemini',
        providerModel: 'gemini-3-pro-image',
      },
    })
  })

  it('erases a workspace image without accepting a client-supplied model', async () => {
    const sourceImage = {
      id: 'source-1',
      name: 'source.png',
      url: '',
      key: 'workspace/source.png',
      size: 100,
      type: 'image/png',
    }
    const maskImage = {
      id: '',
      name: 'mask.png',
      url: '',
      key: 'mask.png',
      size: 50,
      type: 'image/png',
      base64: Buffer.from('mask').toString('base64'),
    }
    const request = createMockRequest(
      'POST',
      {
        workspaceId: 'ws-1',
        resolution: '2K',
        sourceImage,
        maskImage,
        model: 'jimeng-4.5',
      },
      {
        'content-type': 'application/json',
      },
      'http://localhost:3000/api/media/images/erase'
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockEraseWorkspaceImage).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      resolution: '2K',
      sourceImage,
      maskImage,
    })
    expect(body).toMatchObject({
      success: true,
      file: {
        id: 'wf_123',
      },
      metadata: {
        providerModel: 'gemini-3-pro-image',
      },
    })
  })
})
