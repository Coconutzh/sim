/**
 * @vitest-environment node
 */
import {
  auditMock,
  authMock,
  authMockFns,
  createMockRequest,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockDbUpdate } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    update: mockDbUpdate,
    delete: vi.fn(),
  },
}))

vi.mock('@sim/db/schema', () => ({
  apiKey: {
    id: 'id',
    name: 'name',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    lastUsed: 'lastUsed',
    type: 'type',
    workspaceId: 'workspaceId',
  },
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

import { DELETE, PUT } from '@/app/api/workspaces/[id]/api-keys/[keyId]/route'

describe('/api/workspaces/[id]/api-keys/[keyId]', () => {
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
    mockDbSelect
      .mockReturnValueOnce(createSelectChain([{ id: 'key-1', name: 'Old Name' }]))
      .mockReturnValueOnce(createSelectChain([]))
    mockDbUpdate.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() =>
            Promise.resolve([
              {
                id: 'key-1',
                name: 'New Name',
                createdAt: new Date('2026-05-21T00:00:00.000Z'),
                updatedAt: new Date('2026-05-21T00:00:00.000Z'),
              },
            ])
          ),
        })),
      })),
    })
  })

  it('updates a key name for accessible workspaces', async () => {
    const response = await PUT(createMockRequest('PUT', { name: 'New Name' }), {
      params: Promise.resolve({ id: 'ws-owner', keyId: 'key-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.key).toEqual(
      expect.objectContaining({
        id: 'key-1',
        name: 'New Name',
      })
    )
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-owner', 'owner-1')
  })

  it('rejects key updates for read-only access before key lookup', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')

    const response = await PUT(createMockRequest('PUT', { name: 'New Name' }), {
      params: Promise.resolve({ id: 'ws-owner', keyId: 'key-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Forbidden' })
    expect(mockDbSelect).not.toHaveBeenCalled()
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('authenticates update requests before validating route params or body', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await PUT(createMockRequest('PUT', {}), {
      params: Promise.resolve({ id: '', keyId: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })

  it('authenticates delete requests before validating route params', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await DELETE(createMockRequest('DELETE'), {
      params: Promise.resolve({ id: '', keyId: '' }),
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

    const response = await DELETE(createMockRequest('DELETE'), {
      params: Promise.resolve({ id: 'ws-owner', keyId: 'key-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})
