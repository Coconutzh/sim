/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetTableById, mockRestoreTable } = vi.hoisted(() => ({
  mockGetTableById: vi.fn(),
  mockRestoreTable: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/table', () => ({
  getTableById: mockGetTableById,
  restoreTable: mockRestoreTable,
  TableConflictError: class TableConflictError extends Error {},
}))

import { POST } from '@/app/api/table/[tableId]/restore/route'

describe('POST /api/table/[tableId]/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
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
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetTableById.mockResolvedValue({
      id: 'table-1',
      name: 'Table',
      workspaceId: 'ws-1',
    })
    mockRestoreTable.mockResolvedValue(undefined)
  })

  it('restores tables for accessible workspaces', async () => {
    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ tableId: 'table-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ success: true })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'user-1')
  })

  it('returns 404 when stale personal rows no longer grant table visibility', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-1', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ tableId: 'table-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Table not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})
