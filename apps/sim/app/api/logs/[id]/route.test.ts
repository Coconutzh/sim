/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMock, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchLogDetail } = vi.hoisted(() => ({
  mockFetchLogDetail: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/lib/logs/fetch-log-detail', () => ({
  fetchLogDetail: mockFetchLogDetail,
}))
vi.mock('@/lib/api/server', () => ({
  parseRequest: vi.fn(async () => ({
    success: true,
    data: {
      params: { id: 'log-1' },
      query: { workspaceId: 'ws-source-team' },
    },
  })),
}))

import { GET } from './route'

describe('GET /api/logs/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'viewer-1',
    })
  })

  it('loads details through the workspace-scoped log detail authorizer', async () => {
    mockFetchLogDetail.mockResolvedValueOnce({ id: 'log-1', executionId: 'exec-1' })

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/logs/log-1'),
      {
        params: Promise.resolve({ id: 'log-1' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockFetchLogDetail).toHaveBeenCalledWith({
      userId: 'viewer-1',
      workspaceId: 'ws-source-team',
      lookupColumn: 'id',
      lookupValue: 'log-1',
    })
    expect(data).toEqual({ data: { id: 'log-1', executionId: 'exec-1' } })
  })

  it('hides source workspace log details when the authorizer rejects access', async () => {
    mockFetchLogDetail.mockResolvedValueOnce(null)

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/logs/log-1'),
      {
        params: Promise.resolve({ id: 'log-1' }),
      }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
  })
})
