/**
 * @vitest-environment node
 */
import { hybridAuthMock, hybridAuthMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveOAuthAccountId, mockExecuteProviderRequest } = vi.hoisted(() => ({
  mockResolveOAuthAccountId: vi.fn(),
  mockExecuteProviderRequest: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/app/api/auth/oauth/utils', () => ({
  resolveOAuthAccountId: mockResolveOAuthAccountId,
  getServiceAccountToken: vi.fn(),
  refreshTokenIfNeeded: vi.fn(),
}))

vi.mock('@/providers', () => ({
  executeProviderRequest: mockExecuteProviderRequest,
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  assertPermissionsAllowed: vi.fn(),
  IntegrationNotAllowedError: class IntegrationNotAllowedError extends Error {},
  ProviderNotAllowedError: class ProviderNotAllowedError extends Error {},
}))

import { POST } from '@/app/api/providers/route'

describe('ProvidersAPI POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: {
        id: 'ws-visible',
        name: 'Visible Workspace',
        ownerId: 'user-1',
        organizationId: 'org-1',
        workspaceMode: 'organization',
        billedAccountUserId: 'user-1',
      },
    })
    mockResolveOAuthAccountId.mockResolvedValue({
      accountId: 'acct-1',
      workspaceId: 'ws-hidden',
      credentialType: 'oauth',
    })
  })

  it('hides foreign personal workspace vertex credential access', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess
      .mockResolvedValueOnce({
        exists: true,
        hasAccess: true,
        canWrite: true,
        workspace: {
          id: 'ws-visible',
          name: 'Visible Workspace',
          ownerId: 'user-1',
          organizationId: 'org-1',
          workspaceMode: 'organization',
          billedAccountUserId: 'user-1',
        },
      })
      .mockResolvedValueOnce({
        exists: true,
        hasAccess: false,
        canWrite: false,
        workspace: {
          id: 'ws-hidden',
          name: 'Hidden Workspace',
          ownerId: 'owner-2',
          organizationId: null,
          workspaceMode: 'personal',
          billedAccountUserId: 'owner-2',
        },
      })

    const request = new NextRequest('http://localhost:3000/api/providers', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'vertex',
        model: 'gemini-1.5-pro',
        workspaceId: 'ws-visible',
        vertexCredential: 'cred-hidden',
        messages: [{ role: 'user', content: 'hello' }],
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Vertex AI credential not found: cred-hidden',
    })
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('hides foreign personal workspace provider execution behind 404', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: {
        id: 'ws-hidden',
        name: 'Hidden Workspace',
        ownerId: 'owner-2',
        organizationId: null,
        workspaceMode: 'personal',
        billedAccountUserId: 'owner-2',
      },
    })

    const request = new NextRequest('http://localhost:3000/api/providers', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'openai',
        model: 'gpt-4.1',
        workspaceId: 'ws-hidden',
        messages: [{ role: 'user', content: 'hello' }],
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Workspace not found',
    })
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })
})
