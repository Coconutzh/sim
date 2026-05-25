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

const { mockUpdateWorkspaceFileContent } = vi.hoisted(() => ({
  mockUpdateWorkspaceFileContent: vi.fn(),
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  updateWorkspaceFileContent: mockUpdateWorkspaceFileContent,
}))

import { PUT } from './route'

describe('/api/workspaces/[id]/files/[fileId]/content', () => {
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
    mockUpdateWorkspaceFileContent.mockResolvedValue({ id: 'file-1', name: 'notes.txt' })
  })

  it('updates file content for accessible workspaces', async () => {
    const response = await PUT(createMockRequest('PUT', { content: 'hello', encoding: 'utf-8' }), {
      params: Promise.resolve({ id: 'ws-owner', fileId: 'file-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.file).toEqual(expect.objectContaining({ id: 'file-1', name: 'notes.txt' }))
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-owner', 'owner-1')
  })

  it('returns 404 when stale personal rows no longer grant file-content visibility', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-owner', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await PUT(createMockRequest('PUT', { content: 'hello', encoding: 'utf-8' }), {
      params: Promise.resolve({ id: 'ws-owner', fileId: 'file-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(mockUpdateWorkspaceFileContent).not.toHaveBeenCalled()
  })
})
