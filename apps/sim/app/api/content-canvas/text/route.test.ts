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

const { mockGenerateContentCanvasText } = vi.hoisted(() => ({
  mockGenerateContentCanvasText: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/content-canvas/text-executor', () => ({
  generateContentCanvasText: (...args: unknown[]) => mockGenerateContentCanvasText(...args),
}))

describe('POST /api/content-canvas/text', () => {
  beforeEach(() => {
    vi.resetModules()
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
  })

  it('routes text generation through the server-only content-canvas executor', async () => {
    mockGenerateContentCanvasText.mockResolvedValue('generated content')

    const { POST } = await import('@/app/api/content-canvas/text/route')
    const response = await POST(
      createMockRequest(
        'POST',
        {
          workspaceId: 'ws-1',
          model: 'gemini-2.5-pro',
          prompt: 'Write a short post',
          referenceContextText: 'Referenced context',
          referenceImages: [{ mimeType: 'image/png', data: 'ZmFrZS1pbWFnZQ==' }],
        },
        undefined,
        'http://localhost:3000/api/content-canvas/text'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ content: 'generated content' })
    expect(mockGenerateContentCanvasText).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      model: 'gemini-2.5-pro',
      systemPrompt: expect.stringContaining('whiteboard-style text node'),
      prompt: 'Write a short post',
      referenceContextText: 'Referenced context',
      referenceImages: [{ mimeType: 'image/png', data: 'ZmFrZS1pbWFnZQ==' }],
    })
  })
})
