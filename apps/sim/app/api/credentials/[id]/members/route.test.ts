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

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

function createJoinedSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock('@sim/db/schema', () => ({
  credential: { id: 'id', workspaceId: 'workspaceId' },
  credentialMember: {
    id: 'id',
    credentialId: 'credentialId',
    userId: 'userId',
    role: 'role',
    status: 'status',
    joinedAt: 'joinedAt',
  },
  user: { id: 'id', name: 'name', email: 'email' },
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { DELETE, GET, POST } from '@/app/api/credentials/[id]/members/route'

describe('/api/credentials/[id]/members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com', name: 'User' },
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'user-1', workspaceMode: 'organization' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
  })

  it('lists members for accessible credentials', async () => {
    mockDbSelect
      .mockReturnValueOnce(createSelectChain([{ id: 'cred-1', workspaceId: 'ws-1' }]))
      .mockReturnValueOnce(createSelectChain([{ role: 'admin', status: 'active' }]))
      .mockReturnValueOnce(
        createJoinedSelectChain([
          {
            id: 'member-1',
            userId: 'user-1',
            role: 'admin',
            status: 'active',
            joinedAt: new Date('2026-05-21T00:00:00.000Z'),
            userName: 'User',
            userEmail: 'user@example.com',
          },
        ])
      )

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'cred-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.members).toHaveLength(1)
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'user-1')
  })

  it('does not list credential members for non-admin credential members', async () => {
    mockDbSelect
      .mockReturnValueOnce(createSelectChain([{ id: 'cred-1', workspaceId: 'ws-1' }]))
      .mockReturnValueOnce(createSelectChain([{ role: 'member', status: 'active' }]))

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'cred-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Admin access required' })
    expect(mockDbSelect).toHaveBeenCalledTimes(2)
  })

  it('returns 404 when stale personal rows no longer grant credential visibility', async () => {
    mockDbSelect.mockReturnValueOnce(createSelectChain([{ id: 'cred-1', workspaceId: 'ws-1' }]))
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-1', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(createMockRequest('POST', { userId: 'user-2', role: 'viewer' }), {
      params: Promise.resolve({ id: 'cred-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('returns 404 when stale personal rows no longer grant credential-member read visibility', async () => {
    mockDbSelect.mockReturnValueOnce(createSelectChain([{ id: 'cred-1', workspaceId: 'ws-1' }]))
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-1', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'cred-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('returns 404 when stale personal rows no longer grant credential-member revoke visibility', async () => {
    mockDbSelect.mockReturnValueOnce(createSelectChain([{ id: 'cred-1', workspaceId: 'ws-1' }]))
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-1', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await DELETE(
      createMockRequest('DELETE', undefined, undefined, 'http://localhost/api/credentials/cred-1/members?userId=user-2'),
      {
        params: Promise.resolve({ id: 'cred-1' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})
