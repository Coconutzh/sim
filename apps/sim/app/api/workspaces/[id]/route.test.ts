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
  posthogServerMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockArchiveWorkspace } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockArchiveWorkspace: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  ;(chain as any).then = (resolve: (value: T) => unknown) => resolve(result)
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  },
}))

vi.mock('@sim/db/schema', () => schemaMock)
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/workspaces/lifecycle', () => ({
  archiveWorkspace: mockArchiveWorkspace,
}))

import { DELETE } from './route'

describe('DELETE /api/workspaces/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockArchiveWorkspace.mockResolvedValue({ archived: true })
  })

  it('blocks deleting an owner-only workspace when it is the last accessible workspace', async () => {
    permissionsMockFns.mockListAccessibleWorkspaceIds.mockResolvedValueOnce(['ws-owner'])
    mockDbSelect.mockReturnValueOnce(createSelectChain([{ name: 'Owner Workspace' }]))

    const response = await DELETE(createMockRequest('DELETE', { deleteTemplates: false }), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Cannot delete the only workspace' })
    expect(permissionsMockFns.mockListAccessibleWorkspaceIds).toHaveBeenCalledWith('owner-1')
    expect(mockArchiveWorkspace).not.toHaveBeenCalled()
  })

  it('allows deleting an owner-only workspace when another accessible workspace exists', async () => {
    permissionsMockFns.mockListAccessibleWorkspaceIds.mockResolvedValueOnce(['ws-owner', 'ws-team'])
    mockDbSelect
      .mockReturnValueOnce(createSelectChain([{ name: 'Owner Workspace' }]))
      .mockReturnValueOnce(createSelectChain([]))

    const response = await DELETE(createMockRequest('DELETE', { deleteTemplates: false }), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ success: true })
    expect(mockArchiveWorkspace).toHaveBeenCalledWith('ws-owner', {
      requestId: 'workspace-ws-owner',
    })
  })
})
