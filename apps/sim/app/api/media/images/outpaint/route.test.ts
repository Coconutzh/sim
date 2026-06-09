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

const { mockOutpaintWorkspaceImage } = vi.hoisted(() => ({
  mockOutpaintWorkspaceImage: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/generated-media/image/image-generation-service', () => ({
  outpaintWorkspaceImage: (...args: unknown[]) => mockOutpaintWorkspaceImage(...args),
}))

import { POST } from '@/app/api/media/images/outpaint/route'

describe('POST /api/media/images/outpaint', () => {
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
    mockOutpaintWorkspaceImage.mockResolvedValue({
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

  it('outpaints a workspace image without accepting a client-supplied model', async () => {
    const sourceImage = {
      id: 'source-1',
      name: 'source.png',
      url: '',
      key: 'workspace/source.png',
      size: 100,
      type: 'image/png',
    }
    const placement = {
      x: 120,
      y: 80,
      width: 320,
      height: 180,
      canvasWidth: 640,
      canvasHeight: 360,
    }
    const request = createMockRequest(
      'POST',
      {
        workspaceId: 'ws-1',
        sourceImage,
        resolution: '4K',
        targetAspectRatio: 'custom',
        customAspectRatio: { width: 2, height: 1 },
        placement,
        prompt: 'extend the background',
        model: 'jimeng-4.5',
      },
      {
        'content-type': 'application/json',
      },
      'http://localhost:3000/api/media/images/outpaint'
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockOutpaintWorkspaceImage).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      sourceImage,
      resolution: '4K',
      targetAspectRatio: 'custom',
      customAspectRatio: { width: 2, height: 1 },
      placement,
      prompt: 'extend the background',
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
