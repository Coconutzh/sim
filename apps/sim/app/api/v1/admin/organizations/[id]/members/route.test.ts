/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockParseRequest } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockParseRequest: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).leftJoin = vi.fn(() => chain)
  ;(chain as any).orderBy = vi.fn(() => Promise.resolve(result))
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  ;(chain as any).then = (resolve: (value: T) => unknown) => resolve(result)
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
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
    name: 'organization.name',
  },
  permissions: {
    entityType: 'permissions.entityType',
    entityId: 'permissions.entityId',
    userId: 'permissions.userId',
    createdAt: 'permissions.createdAt',
  },
  user: {
    id: 'user.id',
    name: 'user.name',
    email: 'user.email',
  },
  userStats: {
    currentPeriodCost: 'userStats.currentPeriodCost',
    currentUsageLimit: 'userStats.currentUsageLimit',
    lastActive: 'userStats.lastActive',
    billingBlocked: 'userStats.billingBlocked',
  },
  workspace: {
    id: 'workspace.id',
    ownerId: 'workspace.ownerId',
    organizationId: 'workspace.organizationId',
    createdAt: 'workspace.createdAt',
    archivedAt: 'workspace.archivedAt',
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
vi.mock('@/lib/billing/organizations/membership', () => ({
  addUserToOrganization: vi.fn(),
}))
vi.mock('@/lib/core/config/feature-flags', () => ({
  isBillingEnabled: true,
}))

import { GET } from './route'

describe('GET /api/v1/admin/organizations/[id]/members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParseRequest.mockResolvedValue({
      success: true,
      data: {
        params: { id: 'org-1' },
        query: { limit: 50, offset: 0 },
      },
    })
  })

  it('includes owner-only external workspace owners with synthetic ids', async () => {
    const createdAt = new Date('2026-05-21T00:00:00.000Z')
    mockDbSelect
      .mockReturnValueOnce(createSelectChain([{ id: 'org-1' }]))
      .mockReturnValueOnce(createSelectChain([{ id: 'ws-1', ownerId: 'external-1', createdAt }]))
      .mockReturnValueOnce(createSelectChain([]))
      .mockReturnValueOnce(createSelectChain([]))
      .mockReturnValueOnce(
        createSelectChain([
          {
            id: 'external-1',
            userId: 'external-1',
            organizationId: 'org-1',
            role: 'external',
            createdAt,
            userName: 'External Owner',
            userEmail: 'external@example.com',
            currentPeriodCost: '12.34',
            currentUsageLimit: '100',
            lastActive: createdAt,
            billingBlocked: false,
          },
        ])
      )

    const response = await GET(
      new Request('http://localhost/api/v1/admin/organizations/org-1/members') as any,
      {
        params: Promise.resolve({ id: 'org-1' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual([
      expect.objectContaining({
        id: 'external-external-1',
        userId: 'external-1',
        organizationId: 'org-1',
        role: 'external',
        userName: 'External Owner',
        userEmail: 'external@example.com',
      }),
    ])
    expect(data.pagination.total).toBe(1)
  })
})
