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
    organizationId: 'organizationId',
    role: 'role',
    userId: 'userId',
  },
  organization: {
    id: 'id',
    name: 'name',
    slug: 'slug',
    logo: 'logo',
    metadata: 'metadata',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
}))

vi.mock('@/lib/auth', () => authMock)

import { GET, PUT } from './route'

describe('/api/organizations/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com', name: 'User' },
    })
    mockDbSelect.mockReturnValueOnce(createSelectChain([{ role: 'admin' }])).mockReturnValueOnce(
      createSelectChain([
        {
          id: 'org-1',
          name: 'Theater Project',
          slug: 'theater-project',
          logo: null,
          metadata: { location: 'Main Stage' },
          createdAt: new Date('2026-05-21T00:00:00.000Z'),
          updatedAt: new Date('2026-05-21T01:00:00.000Z'),
        },
      ])
    )
  })

  it('returns organization details for organization members', async () => {
    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'org-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      success: true,
      data: {
        id: 'org-1',
        name: 'Theater Project',
        slug: 'theater-project',
        logo: null,
        metadata: { location: 'Main Stage' },
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T01:00:00.000Z',
      },
      userRole: 'admin',
      hasAdminAccess: true,
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

  it('returns 401 before validating invalid params or body for unauthenticated updates', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const response = await PUT(createMockRequest('PUT', {}), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
