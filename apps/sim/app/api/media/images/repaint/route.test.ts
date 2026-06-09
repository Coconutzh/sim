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

const { mockRepaintWorkspaceImage } = vi.hoisted(() => ({
  mockRepaintWorkspaceImage: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/generated-media/image/image-generation-service', () => ({
  repaintWorkspaceImage: (...args: unknown[]) => mockRepaintWorkspaceImage(...args),
}))

import { POST } from '@/app/api/media/images/repaint/route'

describe('POST /api/media/images/repaint', () => {
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
    mockRepaintWorkspaceImage.mockResolvedValue({
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

  it('repaints a workspace image without accepting a client-supplied model', async () => {
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
    const referenceImages = [
      {
        id: 'ref-1',
        name: 'ref.png',
        url: '',
        key: 'workspace/ref.png',
        size: 80,
        type: 'image/png',
      },
    ]
    const request = createMockRequest(
      'POST',
      {
        workspaceId: 'ws-1',
        prompt: 'Change the sign',
        resolution: '2K',
        sourceImage,
        maskImage,
        referenceImages,
        model: 'jimeng-4.5',
      },
      {
        'content-type': 'application/json',
      },
      'http://localhost:3000/api/media/images/repaint'
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockRepaintWorkspaceImage).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      prompt: 'Change the sign',
      resolution: '2K',
      sourceImage,
      maskImage,
      referenceImages,
    })
    expect(body).toMatchObject({
      success: true,
      metadata: {
        providerModel: 'gemini-3-pro-image',
      },
    })
  })
})
