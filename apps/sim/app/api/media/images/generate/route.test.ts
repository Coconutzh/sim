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

const { mockGenerateWorkspaceImageFromPrompt } = vi.hoisted(() => ({
  mockGenerateWorkspaceImageFromPrompt: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/generated-media/image/image-generation-service', () => ({
  generateWorkspaceImageFromPrompt: (...args: unknown[]) =>
    mockGenerateWorkspaceImageFromPrompt(...args),
}))

import { POST } from '@/app/api/media/images/generate/route'

describe('POST /api/media/images/generate', () => {
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
    mockGenerateWorkspaceImageFromPrompt.mockResolvedValue({
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
        provider: 'jimeng',
        providerModel: 'seedream-4.5',
      },
    })
  })

  it('allows session-authenticated browser requests to generate and persist a workspace image', async () => {
    const request = createMockRequest(
      'POST',
      {
        workspaceId: 'ws-1',
        model: 'jimeng-4.5',
        prompt: 'A cinematic city skyline at dusk',
        aspectRatio: '16:9',
      },
      {
        'content-type': 'application/json',
      },
      'http://localhost:3000/api/media/images/generate'
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(hybridAuthMockFns.mockCheckSessionOrInternalAuth).toHaveBeenCalled()
    expect(mockGenerateWorkspaceImageFromPrompt).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      model: 'jimeng-4.5',
      prompt: 'A cinematic city skyline at dusk',
      aspectRatio: '16:9',
    })
    expect(body).toMatchObject({
      success: true,
      file: {
        id: 'wf_123',
        name: 'generated-image.png',
      },
    })
  })
})
