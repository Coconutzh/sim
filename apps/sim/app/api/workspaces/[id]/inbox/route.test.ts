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
  ;(chain as any).groupBy = vi.fn(() => Promise.resolve(result))
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
  mothershipInboxTask: {
    workspaceId: 'workspaceId',
    status: 'status',
  },
  workspace: {
    id: 'id',
    inboxEnabled: 'inboxEnabled',
    inboxAddress: 'inboxAddress',
  },
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/billing/core/subscription', () => ({
  hasInboxAccess: mockHasInboxAccess,
}))

import { GET, PATCH } from './route'

describe('GET /api/workspaces/[id]/inbox', () => {
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
    mockDbSelect
      .mockReturnValueOnce(createSelectChain([{ inboxEnabled: true, inboxAddress: 'ops@sim.ai' }]))
      .mockReturnValueOnce(
        createSelectChain([
          { status: 'completed', count: 3 },
          { status: 'processing', count: 1 },
        ])
      )
  })

  it('returns inbox configuration for accessible workspaces', async () => {
    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      enabled: true,
      address: 'ops@sim.ai',
      taskStats: {
        total: 4,
        completed: 3,
        processing: 1,
        failed: 0,
      },
    })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-owner', 'owner-1')
  })

  it('returns 401 before validating invalid params for unauthenticated inbox reads', async () => {
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

  it('returns 401 before validating invalid params or body for unauthenticated inbox updates', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const response = await PATCH(createMockRequest('PATCH', {}), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('returns 404 when stale personal rows no longer grant inbox visibility', async () => {
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
    expect(mockDbSelect).not.toHaveBeenCalled()
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
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('returns 404 for hidden personal workspaces on inbox updates', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-owner', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await PATCH(createMockRequest('PATCH', { enabled: false }), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
  })
})
