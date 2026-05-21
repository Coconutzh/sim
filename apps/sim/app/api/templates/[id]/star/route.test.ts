/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockDbSelect, mockDbTransaction } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbTransaction: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    transaction: mockDbTransaction,
  },
}))

import { DELETE, GET, POST } from './route'

describe('/api/templates/[id]/star', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
  })

  it('authenticates GET before validating route params', async () => {
    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/templates//star'),
      { params: Promise.resolve({ id: '' }) }
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('authenticates POST before validating route params', async () => {
    const response = await POST(
      createMockRequest('POST', undefined, {}, 'http://localhost:3000/api/templates//star'),
      { params: Promise.resolve({ id: '' }) }
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockDbSelect).not.toHaveBeenCalled()
    expect(mockDbTransaction).not.toHaveBeenCalled()
  })

  it('authenticates DELETE before validating route params', async () => {
    const response = await DELETE(
      createMockRequest('DELETE', undefined, {}, 'http://localhost:3000/api/templates//star'),
      { params: Promise.resolve({ id: '' }) }
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockDbSelect).not.toHaveBeenCalled()
    expect(mockDbTransaction).not.toHaveBeenCalled()
  })
})
