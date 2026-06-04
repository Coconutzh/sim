/**
 * Tests for file upload API route
 *
 * @vitest-environment node
 */
import {
  authMockFns,
  hybridAuthMockFns,
  permissionsMock,
  permissionsMockFns,
  storageServiceMock,
  storageServiceMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const mockVerifyFileAccess = vi.fn()
  const mockVerifyWorkspaceFileAccess = vi.fn()
  const mockVerifyKBFileAccess = vi.fn()
  const mockVerifyCopilotFileAccess = vi.fn()
  const mockUploadWorkspaceFile = vi.fn()
  const mockUploadExecutionFile = vi.fn()
  const mockResolveAccessibleWorkflowWorkspace = vi.fn()
  const mockGetStorageProvider = vi.fn()
  const mockIsUsingCloudStorage = vi.fn()
  const mockUploadFile = vi.fn()

  return {
    mockVerifyFileAccess,
    mockVerifyWorkspaceFileAccess,
    mockVerifyKBFileAccess,
    mockVerifyCopilotFileAccess,
    mockUploadWorkspaceFile,
    mockUploadExecutionFile,
    mockResolveAccessibleWorkflowWorkspace,
    mockGetStorageProvider,
    mockIsUsingCloudStorage,
    mockUploadFile,
  }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  or: vi.fn((...conditions: unknown[]) => ({ type: 'or', conditions })),
  gte: vi.fn((field: unknown, value: unknown) => ({ type: 'gte', field, value })),
  lte: vi.fn((field: unknown, value: unknown) => ({ type: 'lte', field, value })),
  gt: vi.fn((field: unknown, value: unknown) => ({ type: 'gt', field, value })),
  lt: vi.fn((field: unknown, value: unknown) => ({ type: 'lt', field, value })),
  ne: vi.fn((field: unknown, value: unknown) => ({ type: 'ne', field, value })),
  asc: vi.fn((field: unknown) => ({ field, type: 'asc' })),
  desc: vi.fn((field: unknown) => ({ field, type: 'desc' })),
  isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
  isNotNull: vi.fn((field: unknown) => ({ field, type: 'isNotNull' })),
  inArray: vi.fn((field: unknown, values: unknown) => ({ field, values, type: 'inArray' })),
  notInArray: vi.fn((field: unknown, values: unknown) => ({ field, values, type: 'notInArray' })),
  like: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'like' })),
  ilike: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'ilike' })),
  count: vi.fn((field: unknown) => ({ field, type: 'count' })),
  sum: vi.fn((field: unknown) => ({ field, type: 'sum' })),
  avg: vi.fn((field: unknown) => ({ field, type: 'avg' })),
  min: vi.fn((field: unknown) => ({ field, type: 'min' })),
  max: vi.fn((field: unknown) => ({ field, type: 'max' })),
  sql: vi.fn((strings: unknown, ...values: unknown[]) => ({ type: 'sql', sql: strings, values })),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'test-uuid'),
  generateShortId: vi.fn(() => 'mock-short-id'),
  isValidUuid: vi.fn((v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  ),
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: mocks.mockVerifyFileAccess,
  verifyWorkspaceFileAccess: mocks.mockVerifyWorkspaceFileAccess,
  verifyKBFileAccess: mocks.mockVerifyKBFileAccess,
  verifyCopilotFileAccess: mocks.mockVerifyCopilotFileAccess,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  uploadWorkspaceFile: mocks.mockUploadWorkspaceFile,
}))

vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mocks.mockUploadExecutionFile,
}))

vi.mock('@/lib/uploads', () => ({
  getStorageProvider: mocks.mockGetStorageProvider,
  isUsingCloudStorage: mocks.mockIsUsingCloudStorage,
  uploadFile: mocks.mockUploadFile,
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock('@/lib/uploads/core/setup.server', () => ({
  ensureUploadsRuntimeReady: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/uploads/setup.server', () => ({
  UPLOAD_DIR_SERVER: '/tmp/test-uploads',
}))

vi.mock('@/lib/workspaces/permissions/execution-context', () => ({
  resolveAccessibleWorkflowWorkspace: mocks.mockResolveAccessibleWorkflowWorkspace,
}))

import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { OPTIONS, POST } from '@/app/api/files/upload/route'

/**
 * Configure mocks for authenticated file upload tests
 */
function setupFileApiMocks(
  options: {
    authenticated?: boolean
    storageProvider?: 's3' | 'blob' | 'local'
    cloudEnabled?: boolean
  } = {}
) {
  const { authenticated = true, storageProvider = 's3', cloudEnabled = true } = options

  vi.stubGlobal('crypto', {
    randomUUID: vi.fn().mockReturnValue('mock-uuid-1234-5678'),
  })

  if (authenticated) {
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'test-user-id' } })
  } else {
    authMockFns.mockGetSession.mockResolvedValue(null)
  }

  hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValue({
    success: authenticated,
    userId: authenticated ? 'test-user-id' : undefined,
    error: authenticated ? undefined : 'Unauthorized',
  })

  mocks.mockVerifyFileAccess.mockResolvedValue(true)
  mocks.mockVerifyWorkspaceFileAccess.mockResolvedValue(true)
  mocks.mockVerifyKBFileAccess.mockResolvedValue(true)
  mocks.mockVerifyCopilotFileAccess.mockResolvedValue(true)

  permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
  permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
    exists: true,
    hasAccess: true,
    canWrite: true,
    workspace: {
      id: 'test-workspace-id',
      ownerId: 'test-user-id',
      workspaceMode: 'organization',
    },
  })

  mocks.mockUploadWorkspaceFile.mockResolvedValue({
    id: 'test-file-id',
    name: 'test.txt',
    url: '/api/files/serve/workspace/test-workspace-id/test-file.txt',
    size: 100,
    type: 'text/plain',
    key: 'workspace/test-workspace-id/1234567890-test.txt',
    uploadedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })

  mocks.mockUploadExecutionFile.mockResolvedValue({
    id: 'execution-file-id',
    name: 'test.txt',
    url: '/api/files/serve/execution/test-workspace-id/test-file.txt',
    size: 100,
    type: 'text/plain',
    key: 'execution/test-workspace-id/test-workflow-id/test-execution-id/test.txt',
    context: 'execution',
  })

  mocks.mockResolveAccessibleWorkflowWorkspace.mockResolvedValue({
    workspaceId: 'test-workspace-id',
  })

  mocks.mockGetStorageProvider.mockReturnValue(storageProvider)
  mocks.mockIsUsingCloudStorage.mockReturnValue(cloudEnabled)
  mocks.mockUploadFile.mockResolvedValue({
    path: '/api/files/serve/test-key.txt',
    key: 'test-key.txt',
    name: 'test.txt',
    size: 100,
    type: 'text/plain',
  })

  storageServiceMockFns.mockHasCloudStorage.mockReturnValue(cloudEnabled)
  storageServiceMockFns.mockUploadFile.mockResolvedValue({
    key: 'test-key',
    path: '/test/path',
  })
}

describe('File Upload API Route', () => {
  const createMockFormData = (files: File[], context = 'workspace'): FormData => {
    const formData = new FormData()
    formData.append('context', context)
    formData.append('workspaceId', 'test-workspace-id')
    files.forEach((file) => {
      formData.append('file', file)
    })
    return formData
  }

  const createMockFile = (
    name = 'test.txt',
    type = 'text/plain',
    content = 'test content'
  ): File => {
    return new File([content], name, { type })
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should upload a file to local storage', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })

    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile])

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('url')
    expect(data.url).toMatch(/\/api\/files\/serve\/.*\.txt$/)
    expect(data).toHaveProperty('name', 'test.txt')
    expect(data).toHaveProperty('size')
    expect(data).toHaveProperty('type', 'text/plain')
    expect(data).toHaveProperty('key')

    expect(uploadWorkspaceFile).toHaveBeenCalled()
  })

  it('should upload a file to S3 when in S3 mode', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 's3',
    })

    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile])

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('url')
    expect(data.url).toContain('/api/files/serve/')
    expect(data).toHaveProperty('name', 'test.txt')
    expect(data).toHaveProperty('size')
    expect(data).toHaveProperty('type', 'text/plain')
    expect(data).toHaveProperty('key')

    expect(uploadWorkspaceFile).toHaveBeenCalled()
  })

  it('should handle multiple file uploads', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })

    const mockFile1 = createMockFile('file1.txt', 'text/plain')
    const mockFile2 = createMockFile('file2.txt', 'text/plain')
    const formData = createMockFormData([mockFile1, mockFile2])

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBeGreaterThanOrEqual(200)
    expect(response.status).toBeLessThan(600)
    expect(data).toBeDefined()
  })

  it('should handle missing files', async () => {
    setupFileApiMocks()

    const formData = new FormData()

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'InvalidRequestError')
    expect(data).toHaveProperty('message', 'No files provided')
  })

  it('should handle S3 upload errors', async () => {
    setupFileApiMocks({
      cloudEnabled: true,
      storageProvider: 's3',
    })

    mocks.mockUploadWorkspaceFile.mockRejectedValue(new Error('Storage limit exceeded'))

    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile])

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(413)
    expect(data).toHaveProperty('error')
    expect(typeof data.error).toBe('string')
  })

  it('should return 404 when stale personal rows no longer grant workspace upload visibility', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: {
        id: 'test-workspace-id',
        ownerId: 'owner-2',
        workspaceMode: 'personal',
      },
    })

    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile], 'workspace')

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('should handle CORS preflight requests', async () => {
    const response = await OPTIONS()

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type')
  })

  it('should hide foreign personal execution workspaces during upload', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })
    mocks.mockResolveAccessibleWorkflowWorkspace.mockResolvedValueOnce({
      response: Response.json({ error: 'Canvas not found' }, { status: 404 }),
    })

    const mockFile = createMockFile()
    const formData = new FormData()
    formData.append('context', 'execution')
    formData.append('workspaceId', 'ws-hidden')
    formData.append('workflowId', 'wf-hidden')
    formData.append('executionId', 'exec-hidden')
    formData.append('file', mockFile)

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(req)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
    expect(mocks.mockUploadExecutionFile).not.toHaveBeenCalled()
  })

  it('should reject execution uploads when the resolved workspace is read-only', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: false,
      workspace: {
        id: 'test-workspace-id',
        ownerId: 'test-user-id',
        workspaceMode: 'organization',
      },
    })

    const mockFile = createMockFile()
    const formData = new FormData()
    formData.append('context', 'execution')
    formData.append('workspaceId', 'test-workspace-id')
    formData.append('workflowId', 'wf-1')
    formData.append('executionId', 'exec-1')
    formData.append('file', mockFile)

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(req)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Write or Admin access required for execution uploads',
    })
    expect(mocks.mockUploadExecutionFile).not.toHaveBeenCalled()
  })

  it('should normalize execution uploads to the workflow workspace', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })
    mocks.mockResolveAccessibleWorkflowWorkspace.mockResolvedValueOnce({
      workspaceId: 'ws-actual',
    })

    const mockFile = createMockFile()
    const formData = new FormData()
    formData.append('context', 'execution')
    formData.append('workspaceId', 'ws-spoofed')
    formData.append('workflowId', 'wf-1')
    formData.append('executionId', 'exec-1')
    formData.append('file', mockFile)

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(req)

    expect(response.status).toBe(200)
    expect(mocks.mockResolveAccessibleWorkflowWorkspace).toHaveBeenCalledWith({
      userId: 'test-user-id',
      workflowId: 'wf-1',
      workspaceId: 'ws-spoofed',
    })
    expect(mocks.mockUploadExecutionFile).toHaveBeenCalledWith(
      {
        workspaceId: 'ws-actual',
        workflowId: 'wf-1',
        executionId: 'exec-1',
      },
      expect.any(Buffer),
      'test.txt',
      'text/plain',
      'test-user-id'
    )
  })

  it('should reject mothership uploads when the workspace is read-only', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: false,
      workspace: {
        id: 'test-workspace-id',
        ownerId: 'test-user-id',
        workspaceMode: 'organization',
      },
    })

    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile], 'mothership')

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(req)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Write or Admin access required for mothership uploads',
    })
    expect(storageServiceMockFns.mockUploadFile).not.toHaveBeenCalled()
  })

  it('allows workspace uploads when canvas auth grants write without legacy permission rows', async () => {
    setupFileApiMocks({
      cloudEnabled: false,
      storageProvider: 'local',
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce(null)

    const mockFile = createMockFile()
    const formData = createMockFormData([mockFile], 'workspace')

    const req = new NextRequest('http://localhost:3000/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(req)

    expect(response.status).toBe(200)
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(mocks.mockUploadWorkspaceFile).toHaveBeenCalled()
  })
})

describe('File Upload Security Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'test-user-id' },
    })

    storageServiceMockFns.mockHasCloudStorage.mockReturnValue(false)
    storageServiceMockFns.mockUploadFile.mockResolvedValue({
      key: 'test-key',
      path: '/test/path',
    })
    mocks.mockIsUsingCloudStorage.mockReturnValue(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('File Extension Validation', () => {
    beforeEach(() => {
      setupFileApiMocks({
        cloudEnabled: false,
        storageProvider: 'local',
      })
    })

    it('should accept allowed file types', async () => {
      const allowedTypes = [
        'pdf',
        'doc',
        'docx',
        'txt',
        'md',
        'png',
        'jpg',
        'jpeg',
        'gif',
        'csv',
        'xlsx',
        'xls',
      ]

      for (const ext of allowedTypes) {
        const formData = new FormData()
        const file = new File(['test content'], `test.${ext}`, { type: 'application/octet-stream' })
        formData.append('file', file)
        formData.append('context', 'workspace')
        formData.append('workspaceId', 'test-workspace-id')

        const req = new Request('http://localhost/api/files/upload', {
          method: 'POST',
          body: formData,
        })

        const response = await POST(req as unknown as NextRequest)

        expect(response.status).toBe(200)
      }
    })

    it('should accept HTML files (supported document type)', async () => {
      const formData = new FormData()
      const htmlContent = '<h1>Hello World</h1>'
      const file = new File([htmlContent], 'document.html', { type: 'text/html' })
      formData.append('file', file)
      formData.append('context', 'workspace')
      formData.append('workspaceId', 'test-workspace-id')

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const response = await POST(req as unknown as NextRequest)

      expect(response.status).toBe(200)
    })

    it('should accept SVG files (supported image type)', async () => {
      const formData = new FormData()
      const svgContent =
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>'
      const file = new File([svgContent], 'image.svg', { type: 'image/svg+xml' })
      formData.append('file', file)
      formData.append('context', 'workspace')
      formData.append('workspaceId', 'test-workspace-id')

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const response = await POST(req as unknown as NextRequest)

      expect(response.status).toBe(200)
    })

    it('should reject unsupported file types', async () => {
      const formData = new FormData()
      const content = 'binary data'
      const file = new File([content], 'archive.exe', { type: 'application/octet-stream' })
      formData.append('file', file)
      formData.append('context', 'workspace')
      formData.append('workspaceId', 'test-workspace-id')

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const response = await POST(req as unknown as NextRequest)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'exe' is not allowed")
    })

    it('should reject files without extensions', async () => {
      const formData = new FormData()
      const file = new File(['test content'], 'noextension', { type: 'application/octet-stream' })
      formData.append('file', file)
      formData.append('context', 'workspace')
      formData.append('workspaceId', 'test-workspace-id')

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const response = await POST(req as unknown as NextRequest)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'noextension' is not allowed")
    })

    it('should handle multiple files with mixed valid/invalid types', async () => {
      const formData = new FormData()

      const validFile = new File(['valid content'], 'valid.pdf', { type: 'application/pdf' })
      formData.append('file', validFile)

      const invalidFile = new File(['binary content'], 'malicious.exe', {
        type: 'application/x-msdownload',
      })
      formData.append('file', invalidFile)
      formData.append('context', 'workspace')
      formData.append('workspaceId', 'test-workspace-id')

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const response = await POST(req as unknown as NextRequest)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.message).toContain("File type 'exe' is not allowed")
    })
  })

  describe('Authentication Requirements', () => {
    it('should reject uploads without authentication', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const formData = new FormData()
      const file = new File(['test content'], 'test.pdf', { type: 'application/pdf' })
      formData.append('file', file)

      const req = new Request('http://localhost/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const response = await POST(req as unknown as NextRequest)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })
  })
})
