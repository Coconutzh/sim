/**
 * @vitest-environment node
 */
import { permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/app/api/v1/auth', () => ({
  authenticateV1Request: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: vi.fn(),
  RateLimiter: vi.fn().mockImplementation(() => ({
    checkRateLimitWithSubscription: vi.fn(),
  })),
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn(() => 'req-1'),
}))

import { validateWorkspaceAccess } from '@/app/api/v1/middleware'

describe('validateWorkspaceAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'user-1', workspaceMode: 'organization' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
  })

  it('returns hidden 404 for a foreign personal workspace before permission lookup', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await validateWorkspaceAccess(
      {
        allowed: true,
        remaining: 10,
        limit: 10,
        resetAt: new Date('2024-01-01T00:00:00Z'),
      },
      'user-1',
      'ws-hidden'
    )

    expect(response?.status).toBe(404)
    await expect(response?.json()).resolves.toEqual({ error: 'Canvas not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('returns 403 for visible workspaces without write access', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')

    const response = await validateWorkspaceAccess(
      {
        allowed: true,
        remaining: 10,
        limit: 10,
        resetAt: new Date('2024-01-01T00:00:00Z'),
      },
      'user-1',
      'ws-1',
      'write'
    )

    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({ error: 'Access denied' })
  })
})
