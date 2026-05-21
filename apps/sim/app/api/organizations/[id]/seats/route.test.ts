/**
 * @vitest-environment node
 */
import { authMock, authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@/lib/auth', () => authMock)

import { PUT } from './route'

describe('PUT /api/organizations/[id]/seats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com', name: 'User' },
    })
  })

  it('returns 401 before validating invalid params or body for unauthenticated seat updates', async () => {
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
