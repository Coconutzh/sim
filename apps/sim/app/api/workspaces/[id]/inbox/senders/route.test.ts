/**
 * @vitest-environment node
 */
import {
  authMock,
  authMockFns,
  createMockRequest,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockHasInboxAccess } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockHasInboxAccess: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).orderBy = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
  mothershipInboxAllowedSender: {
    id: 'id',
    email: 'email',
    label: 'label',
    createdAt: 'createdAt',
    workspaceId: 'workspaceId',
  },
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/billing/core/subscription', () => ({
  hasInboxAccess: mockHasInboxAccess,
}))

import { DELETE, GET, POST } from './route'

describe('GET /api/workspaces/[id]/inbox/senders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' },
    })
    mockHasInboxAccess.mockResolvedValue(true)
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-owner', ownerId: 'owner-1', workspaceMode: 'organization' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
    permissionsMockFns.mockGetUsersWithPermissions.mockResolvedValue([
      {
        userId: 'owner-1',
        email: 'owner@example.com',
        name: 'Owner',
        image: null,
        permissionType: 'admin',
        isExternal: false,
      },
      {
        userId: 'member-1',
        email: 'member@example.com',
        name: 'Member',
        image: null,
        permissionType: 'write',
        isExternal: false,
      },
    ])
    mockDbSelect.mockReturnValue(
      createSelectChain([
        {
          id: 'sender-1',
          email: 'allowed@example.com',
          label: 'VIP',
          createdAt: new Date('2026-05-21T00:00:00.000Z'),
        },
      ])
    )
  })

  it('includes the workspace owner in auto-allowed senders without an explicit permission row', async () => {
    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.workspaceMembers).toEqual([
      { email: 'owner@example.com', name: 'Owner', isAutoAllowed: true },
      { email: 'member@example.com', name: 'Member', isAutoAllowed: true },
    ])
    expect(permissionsMockFns.mockGetUsersWithPermissions).toHaveBeenCalledWith('ws-owner')
  })

  it('returns 401 before validating invalid params for unauthenticated sender reads', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('returns 401 before validating invalid params or body for unauthenticated sender creates', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const response = await POST(createMockRequest('POST', {}), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('returns 401 before validating invalid params or body for unauthenticated sender deletes', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const response = await DELETE(createMockRequest('DELETE', {}), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('hides foreign personal workspaces when stale permission rows no longer grant access', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-owner', ownerId: 'owner-2', workspaceMode: 'personal' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('admin')

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(permissionsMockFns.mockGetUsersWithPermissions).not.toHaveBeenCalled()
  })

  it('returns 404 for hidden personal workspaces before checking plan access', async () => {
    mockHasInboxAccess.mockResolvedValueOnce(false)
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-owner', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
  })

  it('returns 404 for hidden personal workspaces when adding senders', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-owner', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(createMockRequest('POST', { email: 'x@example.com' }), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
  })

  it('returns 404 for hidden personal workspaces when deleting senders', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-owner', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await DELETE(createMockRequest('DELETE', { senderId: 'sender-1' }), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
  })
})
