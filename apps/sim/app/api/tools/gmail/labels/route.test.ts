/**
 * @vitest-environment node
 */
import { permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockResolveOAuthAccountId } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockResolveOAuthAccountId: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/app/api/auth/oauth/utils', () => ({
  resolveOAuthAccountId: mockResolveOAuthAccountId,
  refreshAccessTokenIfNeeded: vi.fn(),
  getServiceAccountToken: vi.fn(),
  ServiceAccountTokenError: class ServiceAccountTokenError extends Error {},
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

import { GET } from '@/app/api/tools/gmail/labels/route'

describe('GmailLabelsAPI GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockResolveOAuthAccountId.mockResolvedValue({
      accountId: 'acct-1',
      workspaceId: 'ws-hidden',
      credentialType: 'oauth',
    })
  })

  it('hides foreign personal workspace credential labels access', async () => {
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

    const response = await GET(
      new NextRequest('http://localhost:3000/api/tools/gmail/labels?credentialId=cred123')
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Credential not found' })
  })
})
