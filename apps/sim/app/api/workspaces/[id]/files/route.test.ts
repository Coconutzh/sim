/**
 * @vitest-environment node
 */
import {
  auditMock,
  auditMockFns,
  authMockFns,
  permissionsMock,
  permissionsMockFns,
  posthogServerMock,
  posthogServerMockFns,
  workflowsApiUtilsMock,
  workflowsApiUtilsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUploadWorkspaceFile, FileConflictErrorImpl } = vi.hoisted(() => {
  class FileConflictErrorImpl extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'FileConflictError'
    }
  }

  return {
    mockUploadWorkspaceFile: vi.fn(),
    FileConflictErrorImpl,
  }
})

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  FileConflictError: FileConflictErrorImpl,
  listWorkspaceFiles: vi.fn(),
  uploadWorkspaceFile: mockUploadWorkspaceFile,
}))

vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)
vi.mock('@sim/audit', () => auditMock)

const WS = '7727ef3f-8cf6-4686-b063-2bb006a10785'

import { GET, POST } from '@/app/api/workspaces/[id]/files/route'

const params = (id = WS) => ({ params: Promise.resolve({ id }) })

describe('POST /api/workspaces/[id]/files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'User One', email: 'u@example.com' },
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: WS, ownerId: 'user-1', workspaceMode: 'organization' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    workflowsApiUtilsMockFns.mockGetWorkspaceMembershipAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      permission: 'read',
      canWrite: false,
    })
    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'wf_123',
      name: 'clip.mp4',
      size: 4,
      type: 'video/mp4',
      url: '/api/files/serve/s3/workspace/test/clip.mp4?context=workspace',
      key: 'workspace/test/clip.mp4',
      context: 'workspace',
    })
  })

  it('accepts raw binary fallback uploads with file metadata headers', async () => {
    const payload = new Uint8Array([0, 1, 2, 3])
    const request = new NextRequest(`http://localhost/api/workspaces/${WS}/files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'video/mp4',
        'X-Upload-File-Name': encodeURIComponent('clip.mp4'),
        'X-Upload-File-Size': String(payload.byteLength),
      },
      body: payload,
    })

    const response = await POST(request, params())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.file).toMatchObject({
      id: 'wf_123',
      name: 'clip.mp4',
      type: 'video/mp4',
      key: 'workspace/test/clip.mp4',
    })

    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      WS,
      'user-1',
      expect.any(Buffer),
      'clip.mp4',
      'video/mp4'
    )
    expect(posthogServerMockFns.mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'file_uploaded',
      expect.objectContaining({ workspace_id: WS, file_type: 'video/mp4' }),
      expect.any(Object)
    )
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalled()
  })

  it('rejects truncated raw binary uploads when declared size exceeds received bytes', async () => {
    const payload = new Uint8Array([0, 1, 2, 3])
    const request = new NextRequest(`http://localhost/api/workspaces/${WS}/files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'video/mp4',
        'X-Upload-File-Name': encodeURIComponent('clip.mp4'),
        'X-Upload-File-Size': '12',
      },
      body: payload,
    })

    const response = await POST(request, params())
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.success).toBe(false)
    expect(body.error).toContain('truncated')
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('returns 404 when stale personal access no longer grants workspace visibility', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: WS, ownerId: 'owner-2', workspaceMode: 'personal' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('write')

    const payload = new Uint8Array([0, 1, 2, 3])
    const request = new NextRequest(`http://localhost/api/workspaces/${WS}/files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'video/mp4',
        'X-Upload-File-Name': encodeURIComponent('clip.mp4'),
        'X-Upload-File-Size': String(payload.byteLength),
      },
      body: payload,
    })

    const response = await POST(request, params())
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('Canvas not found')
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('returns 404 for hidden personal workspace file listing', async () => {
    workflowsApiUtilsMockFns.mockGetWorkspaceMembershipAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      permission: null,
      canWrite: false,
    })

    const request = new NextRequest(`http://localhost/api/workspaces/${WS}/files`, {
      method: 'GET',
    })

    const response = await GET(request, params())
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('Canvas not found')
  })
})
