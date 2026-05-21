/**
 * @vitest-environment node
 */
import { permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckSessionOrInternalAuth } = vi.hoisted(() => ({
  mockCheckSessionOrInternalAuth: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { withMcpAuth } from '@/lib/mcp/middleware'

function createHandler() {
  return withMcpAuth('read')(
    async (_request: NextRequest, context: { workspaceId: string; userId: string }) =>
      NextResponse.json({
        ok: true,
        workspaceId: context.workspaceId,
        userId: context.userId,
      })
  )
}

describe('withMcpAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      userName: 'User',
      userEmail: 'user@example.com',
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'user-1', workspaceMode: 'organization' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')
  })

  it('hides foreign personal workspaces behind 404', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const handler = createHandler()
    const response = await handler(
      new NextRequest('http://localhost:3000/api/mcp/servers?workspaceId=ws-hidden'),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Workspace not found',
    })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('keeps visible but insufficient MCP permission at 403', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce(null)

    const handler = createHandler()
    const response = await handler(
      new NextRequest('http://localhost:3000/api/mcp/servers?workspaceId=ws-1'),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Insufficient permissions',
    })
  })
})
