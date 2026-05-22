/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockFetchLogDetail } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockFetchLogDetail: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))
vi.mock('@/lib/logs/fetch-log-detail', () => ({
  fetchLogDetail: mockFetchLogDetail,
}))
vi.mock('@/lib/api/server', () => ({
  parseRequest: vi.fn(async () => ({
    success: true,
    data: {
      params: { executionId: 'exec-1' },
      query: { workspaceId: 'ws-source-team' },
    },
  })),
}))

import { GET } from './route'

describe('GET /api/logs/by-execution/[executionId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'viewer-1' } })
  })

  it('loads details through the workspace-scoped log detail authorizer', async () => {
    mockFetchLogDetail.mockResolvedValueOnce({ id: 'log-1', executionId: 'exec-1' })

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/logs/by-execution/exec-1'),
      {
        params: Promise.resolve({ executionId: 'exec-1' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockFetchLogDetail).toHaveBeenCalledWith({
      userId: 'viewer-1',
      workspaceId: 'ws-source-team',
      lookupColumn: 'executionId',
      lookupValue: 'exec-1',
    })
    expect(data).toEqual({ data: { id: 'log-1', executionId: 'exec-1' } })
  })

  it('hides source workspace execution details when the authorizer rejects access', async () => {
    mockFetchLogDetail.mockResolvedValueOnce(null)

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/logs/by-execution/exec-1'),
      {
        params: Promise.resolve({ executionId: 'exec-1' }),
      }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
  })
})
