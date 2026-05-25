/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckInternalAuth,
  mockParseRequest,
  mockCheckWorkspaceAccess,
  mockGetUserEntityPermissions,
  mockUploadWorkspaceFile,
} = vi.hoisted(() => ({
  mockCheckInternalAuth: vi.fn(),
  mockParseRequest: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockUploadWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkInternalAuth: mockCheckInternalAuth,
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@/lib/api/contracts/tools/file', () => ({
  fileManageContract: {},
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))

vi.mock('@/lib/core/config/redis', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
}))

vi.mock('@/lib/core/utils/urls', () => ({
  ensureAbsoluteUrl: (value: string) => value,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: vi.fn(),
  getWorkspaceFileByName: vi.fn(),
  updateWorkspaceFileContent: vi.fn(),
  uploadWorkspaceFile: mockUploadWorkspaceFile,
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  getFileExtension: vi.fn(() => 'txt'),
  getMimeTypeFromExtension: vi.fn(() => 'text/plain'),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

import { POST } from './route'

describe('tools file manage route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckInternalAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: {
        query: {},
        body: {
          operation: 'write',
          workspaceId: 'ws-1',
          fileName: 'notes.txt',
          content: 'hello',
        },
      },
    })
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1' },
    })
    mockGetUserEntityPermissions.mockResolvedValue('write')
    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'file-1',
      name: 'notes.txt',
      url: '/api/files/serve/blob/file-1',
    })
  })

  it('hides foreign personal workspace file writes behind 404', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden' },
    })
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        query: {},
        body: {
          operation: 'write',
          workspaceId: 'ws-hidden',
          fileName: 'notes.txt',
          content: 'hello',
        },
      },
    })

    const response = await POST(
      new NextRequest('http://localhost/api/tools/file/manage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'write', workspaceId: 'ws-hidden' }),
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Canvas not found',
    })
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })
})
