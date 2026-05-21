/**
 * @vitest-environment node
 */
import { authMock, authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    ORG_MEMBER_REMOVED: 'ORG_MEMBER_REMOVED',
    ORG_MEMBER_ROLE_CHANGED: 'ORG_MEMBER_ROLE_CHANGED',
  },
  AuditResourceType: { ORGANIZATION: 'ORGANIZATION' },
  recordAudit: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
  })),
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: vi.fn(),
}))

vi.mock('@/lib/auth', () => authMock)

vi.mock('@/lib/auth/active-organization', () => ({
  setActiveOrganizationForCurrentSession: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  removeUserFromOrganization: vi.fn(),
  transferOrganizationOwnership: vi.fn(),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

import { parseRequest } from '@/lib/api/server'
import { POST } from './route'

describe('POST /api/organizations/[id]/transfer-ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' },
    })
  })

  it('authenticates before validating route params or body', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const response = await POST(createMockRequest('POST', {}), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(parseRequest).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
