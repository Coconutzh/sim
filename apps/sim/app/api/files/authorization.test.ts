/**
 * @vitest-environment node
 */
import { permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetFileMetadataByKey, mockGetFileMetadata, mockInferContextFromKey } = vi.hoisted(
  () => ({
    mockGetFileMetadataByKey: vi.fn(),
    mockGetFileMetadata: vi.fn(),
    mockInferContextFromKey: vi.fn(),
  })
)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataByKey: mockGetFileMetadataByKey,
}))

vi.mock('@/lib/uploads', () => ({
  getFileMetadata: mockGetFileMetadata,
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  inferContextFromKey: mockInferContextFromKey,
}))

vi.mock('@/executor/constants', () => ({
  isUuid: vi.fn(() => true),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    })),
  },
}))

import { verifyFileAccess, verifyFileWriteAccess } from '@/app/api/files/authorization'

describe('verifyFileAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInferContextFromKey.mockImplementation((key: string) => {
      if (key.startsWith('execution/')) return 'execution'
      if (key.startsWith('chat/')) return 'chat'
      return 'workspace'
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'user-1', workspaceMode: 'organization' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')
    mockGetFileMetadataByKey.mockResolvedValue(null)
    mockGetFileMetadata.mockResolvedValue({})
  })

  it('denies workspace files when a stale foreign personal workspace is hidden', async () => {
    mockGetFileMetadataByKey.mockResolvedValueOnce({
      workspaceId: 'ws-hidden',
      userId: 'owner-2',
      deletedAt: null,
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const granted = await verifyFileAccess('ws-hidden/file.txt', 'user-1')

    expect(granted).toBe(false)
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('denies execution files when a foreign personal workspace is hidden', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const granted = await verifyFileAccess('execution/ws-hidden/wf-1/exec-1/output.json', 'user-1')

    expect(granted).toBe(false)
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('denies chat files when a foreign personal workspace is hidden', async () => {
    mockGetFileMetadata.mockResolvedValueOnce({ workspaceId: 'ws-hidden' })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const granted = await verifyFileAccess('chat/file-1', 'user-1')

    expect(granted).toBe(false)
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('prioritizes workspace visibility over uploader ownership for regular files', async () => {
    mockGetFileMetadata.mockResolvedValueOnce({ userId: 'user-1', workspaceId: 'ws-hidden' })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const granted = await verifyFileAccess('legacy-upload.txt', 'user-1', {}, 'general')

    expect(granted).toBe(false)
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('denies workspace file writes for read-only workspace members', async () => {
    mockGetFileMetadata.mockResolvedValueOnce({ workspaceId: 'ws-1' })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: false,
      workspace: { id: 'ws-1', ownerId: 'owner-1', workspaceMode: 'organization' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')

    const granted = await verifyFileWriteAccess('ws-1/file.txt', 'user-1')

    expect(granted).toBe(false)
  })

  it('allows workspace file writes from canvas-boundary write access without legacy permission rows', async () => {
    mockGetFileMetadataByKey.mockReset()
    mockGetFileMetadataByKey.mockResolvedValue({
      workspaceId: 'team-ws-1',
      userId: 'user-1',
      deletedAt: null,
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockReset()
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: {
        id: 'team-ws-1',
        ownerId: 'team-admin',
        workgroupId: 'workgroup-1',
        workspaceMode: 'organization',
      },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce(null)

    const granted = await verifyFileWriteAccess('team-ws-1/file.txt', 'user-1', {}, 'workspace')

    expect(granted).toBe(true)
  })

  it('allows writes for owner-scoped regular uploads without workspace metadata', async () => {
    mockGetFileMetadata.mockResolvedValueOnce({ userId: 'user-1' })

    const granted = await verifyFileWriteAccess('legacy-upload.txt', 'user-1', {}, 'general')

    expect(granted).toBe(true)
  })
})
