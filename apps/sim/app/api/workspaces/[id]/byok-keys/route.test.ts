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

const { mockDbSelect, mockDecryptSecret, mockEncryptSecret } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockEncryptSecret: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).orderBy = vi.fn(() => Promise.resolve(result))
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
  workspaceBYOKKeys: {
    id: 'id',
    workspaceId: 'workspaceId',
    providerId: 'providerId',
    encryptedApiKey: 'encryptedApiKey',
    createdBy: 'createdBy',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
  encryptSecret: mockEncryptSecret,
}))

import { DELETE, GET, POST } from '@/app/api/workspaces/[id]/byok-keys/route'

describe('/api/workspaces/[id]/byok-keys', () => {
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
    mockDecryptSecret.mockResolvedValue({ decrypted: 'sk-test-secret-1234' })
    mockEncryptSecret.mockResolvedValue({ encrypted: 'encrypted-value' })
    mockDbSelect.mockReturnValue(
      createSelectChain([
        {
          id: 'byok-1',
          providerId: 'openai',
          encryptedApiKey: 'encrypted-key',
          createdBy: 'owner-1',
          createdAt: new Date('2026-05-21T00:00:00.000Z'),
          updatedAt: new Date('2026-05-21T00:00:00.000Z'),
        },
      ])
    )
  })

  it('lists masked keys for accessible workspaces', async () => {
    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.keys).toEqual([
      expect.objectContaining({
        id: 'byok-1',
        providerId: 'openai',
        maskedKey: 'sk-tes...1234',
      }),
    ])
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-owner', 'owner-1')
    expect(mockDecryptSecret).toHaveBeenCalledWith('encrypted-key')
  })

  it('does not list BYOK key metadata for read-only access', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Only workspace admins can view BYOK keys' })
    expect(mockDbSelect).not.toHaveBeenCalled()
    expect(mockDecryptSecret).not.toHaveBeenCalled()
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

  it('authenticates upsert requests before validating route params or body', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await POST(createMockRequest('POST', {}), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })

  it('authenticates delete requests before validating route params or body', async () => {
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
      createMockRequest('POST', { providerId: 'openai', apiKey: 'sk-test-secret-1234' }),
      {
        params: Promise.resolve({ id: 'ws-owner' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Workspace not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(mockEncryptSecret).not.toHaveBeenCalled()
  })
})
