/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockParseRequest, mockRemoveExternalUserFromOrganizationWorkspaces } =
  vi.hoisted(() => ({
    mockDbSelect: vi.fn(),
    mockParseRequest: vi.fn(),
    mockRemoveExternalUserFromOrganizationWorkspaces: vi.fn(),
  }))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).leftJoin = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
        returning: vi.fn(),
      })),
    })),
  },
}))

vi.mock('@sim/db/schema', () => ({
  member: {
    id: 'member.id',
    userId: 'member.userId',
    organizationId: 'member.organizationId',
    role: 'member.role',
    createdAt: 'member.createdAt',
  },
  organization: {
    id: 'organization.id',
  },
  user: {
    id: 'user.id',
    name: 'user.name',
    email: 'user.email',
    createdAt: 'user.createdAt',
  },
  userStats: {
    currentPeriodCost: 'userStats.currentPeriodCost',
    currentUsageLimit: 'userStats.currentUsageLimit',
    lastActive: 'userStats.lastActive',
    billingBlocked: 'userStats.billingBlocked',
  },
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))
vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))
vi.mock('@/app/api/v1/admin/middleware', () => ({
  withAdminAuthParams: (handler: unknown) => handler,
}))
vi.mock('@/lib/core/config/feature-flags', () => ({
  isBillingEnabled: true,
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  removeUserFromOrganization: vi.fn(),
  removeExternalUserFromOrganizationWorkspaces: mockRemoveExternalUserFromOrganizationWorkspaces,
}))

import { DELETE, GET, PATCH } from './route'

describe('GET /api/v1/admin/organizations/[id]/members/[memberId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('supports synthetic external member ids', async () => {
    const createdAt = new Date('2026-05-21T00:00:00.000Z')
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        params: { id: 'org-1', memberId: 'external-external-1' },
      },
    })
    mockDbSelect
      .mockReturnValueOnce(createSelectChain([{ id: 'org-1' }]))
      .mockReturnValueOnce(createSelectChain([]))
      .mockReturnValueOnce(
        createSelectChain([
          {
            id: 'external-1',
            createdAt,
            userName: 'External User',
            userEmail: 'external@example.com',
            currentPeriodCost: '12.34',
            currentUsageLimit: '100',
            lastActive: createdAt,
            billingBlocked: false,
          },
        ])
      )

    const response = await GET(
      new Request(
        'http://localhost/api/v1/admin/organizations/org-1/members/external-external-1'
      ) as any,
      {
        params: Promise.resolve({ id: 'org-1', memberId: 'external-external-1' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual(
      expect.objectContaining({
        id: 'external-external-1',
        userId: 'external-1',
        organizationId: 'org-1',
        role: 'external',
        userName: 'External User',
      })
    )
  })
})

describe('PATCH /api/v1/admin/organizations/[id]/members/[memberId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects role edits for synthetic external members', async () => {
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        params: { id: 'org-1', memberId: 'external-external-1' },
        body: { role: 'member' },
      },
    })

    const response = await PATCH(
      new Request('http://localhost/api/v1/admin/organizations/org-1/members/external-external-1', {
        method: 'PATCH',
        body: JSON.stringify({ role: 'member' }),
      }) as any,
      {
        params: Promise.resolve({ id: 'org-1', memberId: 'external-external-1' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toEqual({
      code: 'BAD_REQUEST',
      message: 'Cannot update external canvas member role',
    })
  })
})

describe('DELETE /api/v1/admin/organizations/[id]/members/[memberId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes synthetic external members from organization workspaces', async () => {
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        params: { id: 'org-1', memberId: 'external-external-1' },
        query: { skipBillingLogic: false },
      },
    })
    mockDbSelect
      .mockReturnValueOnce(createSelectChain([{ id: 'org-1' }]))
      .mockReturnValueOnce(createSelectChain([]))
      .mockReturnValueOnce(createSelectChain([{ id: 'external-1' }]))
    mockRemoveExternalUserFromOrganizationWorkspaces.mockResolvedValueOnce({
      success: true,
      workspaceAccessRevoked: 2,
      permissionGroupsRevoked: 1,
      credentialMembershipsRevoked: 1,
      pendingInvitationsCancelled: 0,
    })

    const response = await DELETE(
      new Request('http://localhost/api/v1/admin/organizations/org-1/members/external-external-1', {
        method: 'DELETE',
      }) as any,
      {
        params: Promise.resolve({ id: 'org-1', memberId: 'external-external-1' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockRemoveExternalUserFromOrganizationWorkspaces).toHaveBeenCalledWith({
      userId: 'external-1',
      organizationId: 'org-1',
    })
    expect(data.data).toEqual(
      expect.objectContaining({
        success: true,
        memberId: 'external-external-1',
        userId: 'external-1',
        workspaceAccessRevoked: 2,
      })
    )
  })
})
