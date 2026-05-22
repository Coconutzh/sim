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

const { mockDbSelect, mockGetApiKeyDisplayFormat } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockGetApiKeyDisplayFormat: vi.fn(),
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
  apiKey: {
    id: 'id',
    name: 'name',
    key: 'key',
    createdAt: 'createdAt',
    lastUsed: 'lastUsed',
    expiresAt: 'expiresAt',
    createdBy: 'createdBy',
    workspaceId: 'workspaceId',
    type: 'type',
  },
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/api-key/auth', () => ({
  createApiKey: vi.fn(),
  getApiKeyDisplayFormat: mockGetApiKeyDisplayFormat,
}))

import { DELETE, GET, POST } from '@/app/api/workspaces/[id]/api-keys/route'

describe('/api/workspaces/[id]/api-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' },
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-owner', ownerId: 'owner-1', workspaceMode: 'organization' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockGetApiKeyDisplayFormat.mockResolvedValue('sk-...1234')
    mockDbSelect.mockReturnValue(
      createSelectChain([
        {
          id: 'key-1',
          name: 'Primary',
          key: 'encrypted-key',
          createdAt: new Date('2026-05-21T00:00:00.000Z'),
          lastUsed: null,
          expiresAt: null,
          createdBy: 'owner-1',
        },
      ])
    )
  })

  it('lists keys for accessible workspaces', async () => {
    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.keys).toEqual([
      expect.objectContaining({
        id: 'key-1',
        name: 'Primary',
        displayKey: 'sk-...1234',
      }),
    ])
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-owner', 'owner-1')
    expect(mockGetApiKeyDisplayFormat).toHaveBeenCalledWith('encrypted-key')
  })

  it('does not list workspace API keys for read-only access', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Forbidden' })
    expect(mockDbSelect).not.toHaveBeenCalled()
    expect(mockGetApiKeyDisplayFormat).not.toHaveBeenCalled()
  })

  it('authenticates list requests before validating route params', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })

  it('authenticates create requests before validating route params or body', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await POST(createMockRequest('POST', {}), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })

  it('authenticates bulk delete requests before validating route params or body', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await DELETE(createMockRequest('DELETE', {}), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })

  it('returns 404 for stale foreign personal workspaces before admin checks', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-owner', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(
      createMockRequest('POST', { name: 'Primary', source: 'settings' }),
      {
        params: Promise.resolve({ id: 'ws-owner' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Workspace not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})
