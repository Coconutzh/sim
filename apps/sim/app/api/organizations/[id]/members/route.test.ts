/**
 * @vitest-environment node
 */

import { authMock, authMockFns, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}))

const mockDbResults = vi.hoisted(() => ({ value: [] as any[] }))

function createChain() {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).leftJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(mockDbResults.value.shift() || []))
  ;(chain as any).then = (resolve: (value: unknown) => unknown) =>
    resolve(mockDbResults.value.shift() || [])
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect.mockImplementation(() => createChain()),
  },
}))

vi.mock('@sim/db/schema', () => schemaMock)
vi.mock('@/lib/auth', () => authMock)

import { GET } from './route'

describe('GET /api/organizations/[id]/members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbResults.value = []
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' },
    })
  })

  it('includes owner-only external workspace owners in the organization members response', async () => {
    const createdAt = new Date('2026-05-21T00:00:00.000Z')
    mockDbResults.value = [
      [{ role: 'owner' }],
      [{ id: 'ws-1', ownerId: 'external-1', createdAt }],
      [],
      [],
      [
        {
          id: 'external-1',
          userId: 'external-1',
          organizationId: 'org-1',
          role: 'external',
          createdAt,
          userName: 'External Owner',
          userEmail: 'external@example.com',
        },
      ],
    ]

    const request = Object.assign(
      new Request('http://localhost:3000/api/organizations/org-1/members'),
      { nextUrl: new URL('http://localhost:3000/api/organizations/org-1/members') }
    )

    const response = await GET(request as any, { params: Promise.resolve({ id: 'org-1' }) } as any)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      success: true,
      data: [
        {
          id: 'external-external-1',
          userId: 'external-1',
          organizationId: 'org-1',
          role: 'external',
          createdAt: createdAt.toISOString(),
          userName: 'External Owner',
          userEmail: 'external@example.com',
        },
      ],
      total: 1,
      userRole: 'owner',
      hasAdminAccess: true,
    })
  })

  it('returns synthetic external member ids for usage responses', async () => {
    const createdAt = new Date('2026-05-21T00:00:00.000Z')
    const billingPeriodStart = new Date('2026-05-01T00:00:00.000Z')
    const billingPeriodEnd = new Date('2026-06-01T00:00:00.000Z')
    mockDbResults.value = [
      [{ role: 'owner' }],
      [{ id: 'ws-1', ownerId: 'external-1', createdAt }],
      [],
      [],
      [
        {
          id: 'external-1',
          userId: 'external-1',
          organizationId: 'org-1',
          role: 'external',
          createdAt,
          userName: 'External Owner',
          userEmail: 'external@example.com',
          currentPeriodCost: 12.34,
          currentUsageLimit: 100,
          usageLimitUpdatedAt: createdAt,
        },
      ],
      [],
      [],
      [
        {
          id: 'external-1',
          userId: 'external-1',
          organizationId: 'org-1',
          role: 'external',
          createdAt,
          userName: 'External Owner',
          userEmail: 'external@example.com',
          currentPeriodCost: 12.34,
          currentUsageLimit: 100,
          usageLimitUpdatedAt: createdAt,
        },
      ],
      [{ periodStart: billingPeriodStart, periodEnd: billingPeriodEnd }],
    ]

    const request = Object.assign(
      new Request('http://localhost:3000/api/organizations/org-1/members?include=usage'),
      { nextUrl: new URL('http://localhost:3000/api/organizations/org-1/members?include=usage') }
    )

    const response = await GET(request as any, { params: Promise.resolve({ id: 'org-1' }) } as any)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      success: true,
      data: [
        {
          id: 'external-external-1',
          userId: 'external-1',
          organizationId: 'org-1',
          role: 'external',
          createdAt: createdAt.toISOString(),
          userName: 'External Owner',
          userEmail: 'external@example.com',
          currentPeriodCost: 12.34,
          currentUsageLimit: 100,
          usageLimitUpdatedAt: createdAt.toISOString(),
          billingPeriodStart: billingPeriodStart.toISOString(),
          billingPeriodEnd: billingPeriodEnd.toISOString(),
        },
      ],
      total: 1,
      userRole: 'owner',
      hasAdminAccess: true,
    })
  })
})
