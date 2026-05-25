/**
 * @vitest-environment node
 */

import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSessionMock,
  getUserUsageDataMock,
  recordAuditMock,
  removeExternalUserFromOrganizationWorkspacesMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getUserUsageDataMock: vi.fn(),
  recordAuditMock: vi.fn(),
  removeExternalUserFromOrganizationWorkspacesMock: vi.fn(),
}))

const mockDbResults = vi.hoisted(() => ({ value: [] as unknown[] }))

function createChain() {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(mockDbResults.value.shift() || []))
  return chain
}

vi.mock('@sim/audit', () => ({
  AuditAction: { ORG_MEMBER_REMOVED: 'ORG_MEMBER_REMOVED' },
  AuditResourceType: { ORGANIZATION: 'ORGANIZATION' },
  recordAudit: recordAuditMock,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => createChain()),
  },
}))

vi.mock('@sim/db/schema', () => ({
  member: {
    id: 'member.id',
    organizationId: 'member.organizationId',
    role: 'member.role',
    userId: 'member.userId',
  },
  user: {
    createdAt: 'user.createdAt',
    email: 'user.email',
    id: 'user.id',
    name: 'user.name',
  },
  userStats: {
    currentPeriodCost: 'userStats.currentPeriodCost',
    currentUsageLimit: 'userStats.currentUsageLimit',
    lastPeriodCost: 'userStats.lastPeriodCost',
    usageLimitUpdatedAt: 'userStats.usageLimitUpdatedAt',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
  })),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ kind: 'and', args })),
  eq: vi.fn((left, right) => ({ kind: 'eq', left, right })),
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/lib/auth/active-organization', () => ({
  setActiveOrganizationForCurrentSession: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage', () => ({
  getUserUsageData: getUserUsageDataMock,
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  removeExternalUserFromOrganizationWorkspaces: removeExternalUserFromOrganizationWorkspacesMock,
  removeUserFromOrganization: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/seats', () => ({
  reduceOrganizationSeatsByOne: vi.fn(),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

import { parseRequest } from '@/lib/api/server'
import { DELETE, GET, PUT } from '@/app/api/organizations/[id]/members/[memberId]/route'

describe('GET /api/organizations/[id]/members/[memberId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbResults.value = []
    getSessionMock.mockResolvedValue({
      user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' },
    })
    vi.mocked(parseRequest).mockResolvedValue({
      success: true,
      data: {
        params: { id: 'org-1', memberId: 'external-external-1' },
        query: { include: undefined },
      },
    } as never)
  })

  it('returns details for synthetic external roster members', async () => {
    const createdAt = new Date('2026-05-21T00:00:00.000Z')
    mockDbResults.value = [
      [{ role: 'owner' }],
      [],
      [
        {
          id: 'external-1',
          createdAt,
          userName: 'External User',
          userEmail: 'external@example.com',
        },
      ],
    ]

    const response = await GET(
      new Request('http://localhost:3000/api/organizations/org-1/members/external-external-1'),
      {
        params: Promise.resolve({ id: 'org-1', memberId: 'external-external-1' }),
      } as any
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      success: true,
      data: {
        id: 'external-external-1',
        userId: 'external-1',
        organizationId: 'org-1',
        role: 'external',
        createdAt: createdAt.toISOString(),
        userName: 'External User',
        userEmail: 'external@example.com',
      },
      userRole: 'owner',
      hasAdminAccess: true,
    })
  })

  it('authenticates before validating route params', async () => {
    getSessionMock.mockResolvedValue(null)

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: '', memberId: '' }),
    } as any)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(parseRequest).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/organizations/[id]/members/[memberId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbResults.value = []
    getSessionMock.mockResolvedValue({
      user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' },
    })
    vi.mocked(parseRequest).mockResolvedValue({
      success: true,
      data: {
        params: { id: 'org-1', memberId: 'external-external-1' },
        query: { shouldReduceSeats: undefined },
      },
    } as never)
    removeExternalUserFromOrganizationWorkspacesMock.mockResolvedValue({
      success: true,
      workspaceAccessRevoked: 1,
      permissionGroupsRevoked: 0,
      credentialMembershipsRevoked: 0,
      pendingInvitationsCancelled: 0,
    })
  })

  it('strips the synthetic external member prefix before removing organization workspace access', async () => {
    mockDbResults.value = [
      [{ role: 'owner' }],
      [],
      [{ id: 'external-1', email: 'external@example.com', name: 'External User' }],
    ]

    const response = await DELETE(
      createMockRequest(
        'DELETE',
        'http://localhost:3000/api/organizations/org-1/members/external-external-1'
      ),
      {
        params: Promise.resolve({ id: 'org-1', memberId: 'external-external-1' }),
      } as any
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(removeExternalUserFromOrganizationWorkspacesMock).toHaveBeenCalledWith({
      userId: 'external-1',
      organizationId: 'org-1',
    })
    expect(data.success).toBe(true)
    expect(recordAuditMock).toHaveBeenCalled()
  })

  it('authenticates before validating route params', async () => {
    getSessionMock.mockResolvedValue(null)

    const response = await DELETE(createMockRequest('DELETE'), {
      params: Promise.resolve({ id: '', memberId: '' }),
    } as any)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(parseRequest).not.toHaveBeenCalled()
  })
})

describe('PUT /api/organizations/[id]/members/[memberId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbResults.value = []
    getSessionMock.mockResolvedValue({
      user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' },
    })
    vi.mocked(parseRequest).mockResolvedValue({
      success: true,
      data: {
        params: { id: 'org-1', memberId: 'external-external-1' },
        body: { role: 'member' },
      },
    } as never)
  })

  it('rejects role updates for synthetic external canvas members', async () => {
    const response = await PUT(createMockRequest('PUT'), {
      params: Promise.resolve({ id: 'org-1', memberId: 'external-external-1' }),
    } as any)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Cannot update external canvas member role' })
  })

  it('authenticates before validating route params or body', async () => {
    getSessionMock.mockResolvedValue(null)

    const response = await PUT(createMockRequest('PUT', {}), {
      params: Promise.resolve({ id: '', memberId: '' }),
    } as any)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(parseRequest).not.toHaveBeenCalled()
  })
})
