/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckInternalAuth, mockParseRequest, mockResolveAccessibleWorkflowWorkspace } =
  vi.hoisted(() => ({
    mockCheckInternalAuth: vi.fn(),
    mockParseRequest: vi.fn(),
    mockResolveAccessibleWorkflowWorkspace: vi.fn(),
  }))

vi.mock('@/lib/auth/hybrid', () => ({
  checkInternalAuth: mockCheckInternalAuth,
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
  getValidationErrorMessage: vi.fn(),
}))

vi.mock('@/lib/api/contracts/tools/media/tts', () => ({
  ttsToolContract: {},
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: {
    uploadFile: vi.fn(),
  },
}))

vi.mock('@/lib/workspaces/permissions/execution-context', () => ({
  resolveAccessibleWorkflowWorkspace: mockResolveAccessibleWorkflowWorkspace,
}))

import { POST } from './route'

describe('tools tts route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckInternalAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: {
        body: {
          text: 'hello',
          voiceId: 'voice123',
          apiKey: 'key',
          workspaceId: 'ws-hidden',
          workflowId: 'wf-hidden',
          executionId: 'exec-1',
        },
      },
    })
  })

  it('hides foreign personal execution workspaces behind 404', async () => {
    mockResolveAccessibleWorkflowWorkspace.mockResolvedValueOnce({
      response: Response.json({ error: 'Canvas not found' }, { status: 404 }),
    })

    const response = await POST(
      new NextRequest('http://localhost/api/tools/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
  })
})
