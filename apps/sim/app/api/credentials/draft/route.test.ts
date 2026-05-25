/**
 * @vitest-environment node
 */
import { authMock, authMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseRequest } = vi.hoisted(() => ({
  mockParseRequest: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
    delete: vi.fn(() => ({ where: vi.fn() })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoUpdate: vi.fn() })) })),
  },
}))
vi.mock('@sim/db/schema', () => ({
  credential: { id: 'id', workspaceId: 'workspaceId' },
  credentialMember: {
    role: 'role',
    status: 'status',
    credentialId: 'credentialId',
    userId: 'userId',
  },
  pendingCredentialDraft: {
    userId: 'userId',
    expiresAt: 'expiresAt',
    providerId: 'providerId',
    workspaceId: 'workspaceId',
  },
}))
vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/api/server', () => ({ parseRequest: mockParseRequest }))
vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}))
vi.mock('@sim/utils/id', () => ({ generateId: vi.fn(() => 'draft-1') }))
vi.mock('@/lib/api/contracts/credentials', () => ({ createCredentialDraftContract: {} }))

import { POST } from '@/app/api/credentials/draft/route'

describe('/api/credentials/draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: {
        body: {
          workspaceId: 'ws-hidden',
          providerId: 'google',
          displayName: 'Draft',
          description: null,
          credentialId: null,
        },
      },
    })
  })

  it('hides foreign personal workspace credential drafts behind 404', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/credentials/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'ws-hidden',
          providerId: 'google',
          displayName: 'Draft',
        }),
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
  })
})
