/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockGetSession, mockHasSSOAccess, mockRecordAudit, mockRegisterSSOProvider } =
  vi.hoisted(() => ({
    mockDbSelect: vi.fn(),
    mockGetSession: vi.fn(),
    mockHasSSOAccess: vi.fn(),
    mockRecordAudit: vi.fn(),
    mockRegisterSSOProvider: vi.fn(),
  }))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as { from: () => typeof chain }).from = vi.fn(() => chain)
  ;(chain as { where: () => typeof chain }).where = vi.fn(() => chain)
  ;(chain as { limit: () => Promise<T> }).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/audit', () => ({
  AuditAction: {
    ORGANIZATION_UPDATED: 'organization.updated',
  },
  AuditResourceType: {
    ORGANIZATION: 'organization',
  },
  recordAudit: mockRecordAudit,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
  member: {
    organizationId: 'member.organizationId',
    role: 'member.role',
    userId: 'member.userId',
  },
  organization: {
    id: 'organization.id',
    name: 'organization.name',
  },
  ssoProvider: {
    providerId: 'ssoProvider.providerId',
    organizationId: 'ssoProvider.organizationId',
    userId: 'ssoProvider.userId',
    oidcConfig: 'ssoProvider.oidcConfig',
  },
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      registerSSOProvider: mockRegisterSSOProvider,
    },
  },
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing', () => ({
  hasSSOAccess: mockHasSSOAccess,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {
    NEXT_PUBLIC_APP_URL: 'https://app.example.com',
    SSO_ENABLED: true,
  },
  getEnv: vi.fn((key: string) =>
    key === 'NEXT_PUBLIC_APP_URL' ? 'https://app.example.com' : undefined
  ),
  isFalsy: vi.fn((value: unknown) => value === false || value === 'false' || value === '0'),
  isTruthy: vi.fn((value: unknown) => value === true || value === 'true' || value === '1'),
}))

import { POST } from '@/app/api/auth/sso/register/route'

describe('POST /api/auth/sso/register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'admin@example.com', name: 'Project Admin' },
    })
    mockHasSSOAccess.mockResolvedValue(true)
    mockRegisterSSOProvider.mockResolvedValue({ providerId: 'theater-saml' })
    mockDbSelect
      .mockReturnValueOnce(createSelectChain([{ organizationId: 'org-1', role: 'admin' }]))
      .mockReturnValueOnce(createSelectChain([{ name: 'Theater Project' }]))
  })

  it('records an organization security settings audit for organization-scoped SSO', async () => {
    const response = await POST(
      createMockRequest('POST', {
        providerType: 'saml',
        providerId: 'theater-saml',
        issuer: 'https://idp.theater.example.com/metadata',
        domain: 'theater.example.com',
        orgId: 'org-1',
        entryPoint: 'https://idp.theater.example.com/sso',
        cert: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
      })
    )
    const data = await response.json()

    expect(response.status, JSON.stringify(data)).toBe(200)
    expect(data).toEqual({
      success: true,
      providerId: 'theater-saml',
      providerType: 'saml',
      message: 'SAML provider registered successfully',
    })
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        actorName: 'Project Admin',
        actorEmail: 'admin@example.com',
        action: 'organization.updated',
        resourceType: 'organization',
        resourceId: 'org-1',
        resourceName: 'Theater Project',
        description: 'Configured SAML SSO provider theater-saml',
        metadata: expect.objectContaining({
          organizationId: 'org-1',
          organizationEvent: 'organization.security_sso_configured',
          providerId: 'theater-saml',
          providerType: 'saml',
          domain: 'theater.example.com',
          issuer: 'https://idp.theater.example.com/metadata',
        }),
      })
    )
  })
})
