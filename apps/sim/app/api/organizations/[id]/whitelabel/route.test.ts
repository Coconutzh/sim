/**
 * @vitest-environment node
 */
import { authMock, authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as { from: () => typeof chain }).from = vi.fn(() => chain)
  ;(chain as { where: () => typeof chain }).where = vi.fn(() => chain)
  ;(chain as { limit: () => Promise<T> }).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  member: {
    id: 'id',
    organizationId: 'organizationId',
    role: 'role',
    userId: 'userId',
  },
  organization: {
    id: 'id',
    name: 'name',
    updatedAt: 'updatedAt',
    whitelabelSettings: 'whitelabelSettings',
  },
}))

vi.mock('@/lib/auth', () => authMock)

import { GET } from './route'

describe('GET /api/organizations/[id]/whitelabel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com', name: 'User' },
    })
    mockDbSelect.mockReturnValueOnce(createSelectChain([{ id: 'member-1' }])).mockReturnValueOnce(
      createSelectChain([
        {
          whitelabelSettings: {
            brandName: 'Theater Ops',
            primaryColor: '#123456',
          },
        },
      ])
    )
  })

  it('returns whitelabel settings for organization members', async () => {
    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'org-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      success: true,
      data: {
        brandName: 'Theater Ops',
        primaryColor: '#123456',
      },
    })
    expect(mockDbSelect).toHaveBeenCalledTimes(2)
  })

  it('returns 401 before validating invalid params for unauthenticated reads', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
