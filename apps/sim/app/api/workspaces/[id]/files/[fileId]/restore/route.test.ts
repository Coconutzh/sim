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

const { mockRestoreWorkspaceFile } = vi.hoisted(() => ({
  mockRestoreWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  FileConflictError: class FileConflictError extends Error {},
  restoreWorkspaceFile: mockRestoreWorkspaceFile,
}))

import { POST } from './route'

describe('/api/workspaces/[id]/files/[fileId]/restore', () => {
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
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
  })

  it('restores files for accessible workspaces', async () => {
    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ id: 'ws-owner', fileId: 'file-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ success: true })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-owner', 'owner-1')
    expect(mockRestoreWorkspaceFile).toHaveBeenCalledWith('ws-owner', 'file-1')
  })

  it('returns 404 when stale personal rows no longer grant restore visibility', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-owner', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ id: 'ws-owner', fileId: 'file-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(mockRestoreWorkspaceFile).not.toHaveBeenCalled()
  })
})
