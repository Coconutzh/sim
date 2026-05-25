/**
 * @vitest-environment node
 */
import { permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkInternalAuth: vi.fn(async () => ({
    success: true,
    userId: 'user-1',
    authType: 'internal_jwt',
  })),
  AuthType: {
    INTERNAL_JWT: 'internal_jwt',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

import { DELETE, GET, PUT } from '@/app/api/memory/[id]/route'

describe('Memory by id visibility', () => {
  const hiddenWorkspaceId = '7727ef3f-8cf6-4686-b063-2bb006a10785'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides foreign personal workspace memory detail behind 404', async () => {
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
      new NextRequest(
        `http://localhost:3000/api/memory/conversation-1?workspaceId=${hiddenWorkspaceId}`
      ),
      { params: Promise.resolve({ id: 'conversation-1' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: { message: 'Canvas not found' },
    })
  })

  it('hides foreign personal workspace memory update behind 404', async () => {
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

    const response = await PUT(
      new NextRequest('http://localhost:3000/api/memory/conversation-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: hiddenWorkspaceId,
          data: { role: 'assistant', content: 'updated' },
        }),
      }),
      { params: Promise.resolve({ id: 'conversation-1' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: { message: 'Canvas not found' },
    })
  })

  it('hides foreign personal workspace memory delete behind 404', async () => {
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

    const response = await DELETE(
      new NextRequest(
        `http://localhost:3000/api/memory/conversation-1?workspaceId=${hiddenWorkspaceId}`,
        {
          method: 'DELETE',
        }
      ),
      { params: Promise.resolve({ id: 'conversation-1' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: { message: 'Canvas not found' },
    })
  })
})
