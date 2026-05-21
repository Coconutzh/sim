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

const { mockPerformRestoreFolder } = vi.hoisted(() => ({
  mockPerformRestoreFolder: vi.fn(),
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/workflows/orchestration/folder-lifecycle', () => ({
  performRestoreFolder: mockPerformRestoreFolder,
}))

import { POST } from '@/app/api/folders/[id]/restore/route'

describe('POST /api/folders/[id]/restore', () => {
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
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockPerformRestoreFolder.mockResolvedValue({
      success: true,
      restoredItems: { folders: 1, workflows: 0 },
    })
  })

  it('restores folders for accessible workspaces', async () => {
    const response = await POST(
      createMockRequest('POST', { workspaceId: 'ws-1' }),
      { params: Promise.resolve({ id: 'folder-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      success: true,
      restoredItems: { folders: 1, workflows: 0 },
    })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'user-1')
  })

  it('returns 404 when stale personal rows no longer grant restore visibility', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-1', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(
      createMockRequest('POST', { workspaceId: 'ws-1' }),
      { params: Promise.resolve({ id: 'folder-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Folder not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})
