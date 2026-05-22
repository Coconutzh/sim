/**
 * @vitest-environment node
 */
import { authMock, authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockHasCredentialSetsAccess, mockParseRequest } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockHasCredentialSetsAccess: vi.fn(),
  mockParseRequest: vi.fn(),
}))

function createLimitChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

function createWhereResultChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).leftJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    transaction: vi.fn(),
  },
}))

vi.mock('@sim/db/schema', () => ({
  account: { userId: 'userId', providerId: 'providerId', accountId: 'accountId' },
  credentialSet: {
    id: 'id',
    name: 'name',
    organizationId: 'organizationId',
    providerId: 'providerId',
  },
  credentialSetMember: {
    id: 'id',
    credentialSetId: 'credentialSetId',
    userId: 'userId',
    status: 'status',
    joinedAt: 'joinedAt',
    createdAt: 'createdAt',
  },
  member: { userId: 'userId', organizationId: 'organizationId', role: 'role' },
  user: { id: 'id', name: 'name', email: 'email', image: 'image' },
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/api/server', () => ({ parseRequest: mockParseRequest }))
vi.mock('@/lib/billing', () => ({
  hasCredentialSetsAccess: mockHasCredentialSetsAccess,
}))
vi.mock('@/lib/webhooks/utils.server', () => ({
  syncAllWebhooksForCredentialSet: vi.fn(),
}))

import { GET } from '@/app/api/credential-sets/[id]/members/route'

describe('/api/credential-sets/[id]/members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com', name: 'User' },
    })
    mockHasCredentialSetsAccess.mockResolvedValue(true)
    mockParseRequest.mockResolvedValue({
      success: true,
      data: { params: { id: 'set-1' } },
    })
  })

  it('rejects member-list reads for non-admin organization members', async () => {
    mockDbSelect
      .mockReturnValueOnce(
        createLimitChain([
          {
            id: 'set-1',
            name: 'Shared',
            organizationId: 'org-1',
            providerId: 'slack',
          },
        ])
      )
      .mockReturnValueOnce(createLimitChain([{ role: 'member' }]))

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'set-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Admin or owner permissions required' })
    expect(mockDbSelect).toHaveBeenCalledTimes(2)
  })

  it('lists members for organization admins', async () => {
    mockDbSelect
      .mockReturnValueOnce(
        createLimitChain([
          {
            id: 'set-1',
            name: 'Shared',
            organizationId: 'org-1',
            providerId: 'slack',
          },
        ])
      )
      .mockReturnValueOnce(createLimitChain([{ role: 'admin' }]))
      .mockReturnValueOnce(
        createWhereResultChain([
          {
            id: 'member-1',
            userId: 'member-user',
            status: 'active',
            joinedAt: new Date('2026-05-21T00:00:00.000Z'),
            createdAt: new Date('2026-05-21T00:00:00.000Z'),
            userName: 'Member',
            userEmail: 'member@example.com',
            userImage: null,
          },
        ])
      )
      .mockReturnValueOnce(
        createWhereResultChain([
          { userId: 'member-user', providerId: 'slack', accountId: 'acct-1' },
        ])
      )

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'set-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.members).toEqual([
      expect.objectContaining({
        id: 'member-1',
        credentials: [{ providerId: 'slack', accountId: 'acct-1' }],
      }),
    ])
  })
})
