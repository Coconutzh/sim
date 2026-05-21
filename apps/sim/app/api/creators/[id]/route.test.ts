/**
 * @vitest-environment node
 */
import { authMock, authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({
  db: {},
}))
vi.mock('@/lib/auth', () => authMock)

import { DELETE } from '@/app/api/creators/[id]/route'

describe('DELETE /api/creators/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue(null)
  })

  it('authenticates before validating route params', async () => {
    const response = await DELETE(createMockRequest('DELETE'), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
  })
})
