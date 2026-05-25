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

const { mockRenameWorkspaceFile, mockDeleteWorkspaceFile } = vi.hoisted(() => ({
  mockRenameWorkspaceFile: vi.fn(),
  mockDeleteWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  FileConflictError: class FileConflictError extends Error {},
  renameWorkspaceFile: mockRenameWorkspaceFile,
  deleteWorkspaceFile: mockDeleteWorkspaceFile,
}))

import { DELETE, PATCH } from './route'

describe('/api/workspaces/[id]/files/[fileId]', () => {
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
    mockRenameWorkspaceFile.mockResolvedValue({ id: 'file-1', name: 'renamed.txt' })
  })

  it('renames files for accessible workspaces', async () => {
    const response = await PATCH(createMockRequest('PATCH', { name: 'renamed.txt' }), {
      params: Promise.resolve({ id: 'ws-owner', fileId: 'file-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.file).toEqual(expect.objectContaining({ id: 'file-1', name: 'renamed.txt' }))
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-owner', 'owner-1')
  })

  it('returns 404 when stale personal rows no longer grant file visibility', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-owner', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await DELETE(createMockRequest('DELETE'), {
      params: Promise.resolve({ id: 'ws-owner', fileId: 'file-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(mockDeleteWorkspaceFile).not.toHaveBeenCalled()
  })
})
