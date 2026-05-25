/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckSessionOrInternalAuth,
  mockCheckWorkspaceAccess,
  mockGetUserUsageLogs,
  mockListAccessibleWorkspaceIds,
} = vi.hoisted(() => ({
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockGetUserUsageLogs: vi.fn(),
  mockListAccessibleWorkspaceIds: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  getUserUsageLogs: mockGetUserUsageLogs,
}))

vi.mock('@/lib/billing/credits/conversion', () => ({
  dollarsToCredits: vi.fn((value: number) => value * 100),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
  listAccessibleWorkspaceIds: mockListAccessibleWorkspaceIds,
}))

import { GET } from '@/app/api/users/me/usage-logs/route'

describe('GET /api/users/me/usage-logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
    })
    mockListAccessibleWorkspaceIds.mockResolvedValue(['ws-visible'])
    mockGetUserUsageLogs.mockResolvedValue({
      logs: [
        {
          id: 'log-1',
          createdAt: '2026-05-21T00:00:00.000Z',
          category: 'model',
          source: 'copilot',
          description: 'Visible log',
          cost: 1.25,
          workspaceId: 'ws-visible',
        },
      ],
      summary: {
        totalCost: 1.25,
        bySource: { copilot: 1.25 },
      },
      pagination: {
        hasMore: false,
      },
    })
  })

  it('hides hidden personal workspace filters behind 404 semantics', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/users/me/usage-logs?workspaceId=ws-hidden'
      )
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(mockGetUserUsageLogs).not.toHaveBeenCalled()
  })

  it('passes visible workspace ids so hidden personal workspace logs are filtered out', async () => {
    const response = await GET(createMockRequest('GET'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockListAccessibleWorkspaceIds).toHaveBeenCalledWith('user-1')
    expect(mockGetUserUsageLogs).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        visibleWorkspaceIds: ['ws-visible'],
      })
    )
    expect(data.summary.totalCostCredits).toBe(125)
    expect(data.summary.bySourceCredits).toEqual({ copilot: 125 })
  })
})
