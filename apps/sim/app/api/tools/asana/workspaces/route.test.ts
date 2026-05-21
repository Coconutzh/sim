/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckSessionOrInternalAuth,
  mockParseRequest,
  mockAuthorizeCredentialUse,
  mockRefreshAccessTokenIfNeeded,
} = vi.hoisted(() => ({
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockParseRequest: vi.fn(),
  mockAuthorizeCredentialUse: vi.fn(),
  mockRefreshAccessTokenIfNeeded: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@/lib/auth/credential-access', () => ({
  authenticateCredentialSelectorRequest: async (request: NextRequest) => {
    const auth = await mockCheckSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return Response.json({ error: auth.error || 'Authentication required' }, { status: 401 })
    }

    return null
  },
  authorizeCredentialUse: mockAuthorizeCredentialUse,
  credentialAccessErrorResponse: (result: { error?: string; status?: number }) =>
    Response.json({ error: result.error || 'Unauthorized' }, { status: result.status ?? 403 }),
}))

vi.mock('@/app/api/auth/oauth/utils', () => ({
  refreshAccessTokenIfNeeded: mockRefreshAccessTokenIfNeeded,
}))

import { POST } from '@/app/api/tools/asana/workspaces/route'

describe('POST /api/tools/asana/workspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: { body: { credential: 'credential-1', workflowId: 'workflow-1' } },
    })
    mockAuthorizeCredentialUse.mockResolvedValue({
      ok: true,
      credentialOwnerUserId: 'owner-1',
    })
    mockRefreshAccessTokenIfNeeded.mockResolvedValue(null)
  })

  it('authenticates before validating the selector body', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
    })

    const response = await POST(
      new NextRequest('http://localhost/api/tools/asana/workspaces', { method: 'POST' })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockAuthorizeCredentialUse).not.toHaveBeenCalled()
  })

  it('validates and authorizes credential use after request authentication', async () => {
    const request = new NextRequest('http://localhost/api/tools/asana/workspaces', {
      method: 'POST',
    })

    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'Could not retrieve access token',
      authRequired: true,
    })
    expect(mockCheckSessionOrInternalAuth).toHaveBeenCalledWith(request, {
      requireWorkflowId: false,
    })
    expect(mockParseRequest).toHaveBeenCalledWith(expect.any(Object), request, {})
    expect(mockAuthorizeCredentialUse).toHaveBeenCalledWith(request, {
      credentialId: 'credential-1',
      workflowId: 'workflow-1',
    })
    expect(mockCheckSessionOrInternalAuth.mock.invocationCallOrder[0]).toBeLessThan(
      mockParseRequest.mock.invocationCallOrder[0]
    )
  })
})
