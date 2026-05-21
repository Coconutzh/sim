/**
 * @vitest-environment node
 */
import { permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGetBYOKKey } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetBYOKKey: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/api-key/byok', () => ({
  getBYOKKey: mockGetBYOKKey,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {},
}))

vi.mock('@/providers/utils', () => ({
  filterBlacklistedModels: vi.fn((models: string[]) => models),
  isProviderBlacklisted: vi.fn(() => false),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

import { GET } from '@/app/api/providers/fireworks/models/route'

describe('FireworksModelsAPI GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('hides foreign personal workspace BYOK model access', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: {
        id: 'ws-hidden',
        name: 'Hidden Workspace',
        ownerId: 'owner-2',
        organizationId: null,
        workspaceMode: 'personal',
        billedAccountUserId: 'owner-2',
      },
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/providers/fireworks/models?workspaceId=ws-hidden')
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ models: [] })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(mockGetBYOKKey).not.toHaveBeenCalled()
  })
})
