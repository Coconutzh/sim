/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockParseRequest,
  mockCheckSessionOrInternalAuth,
  mockGetFileMetadataById,
  mockVerifyFileAccess,
} = vi.hoisted(() => ({
  mockParseRequest: vi.fn(),
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockGetFileMetadataById: vi.fn(),
  mockVerifyFileAccess: vi.fn(),
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))
vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))
vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataById: mockGetFileMetadataById,
}))
vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: mockVerifyFileAccess,
}))
vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}))
vi.mock('@/lib/api/contracts/storage-transfer', () => ({ fileExportContract: {} }))
vi.mock('@/lib/uploads/config', () => ({ USE_BLOB_STORAGE: false }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ downloadFile: vi.fn() }))
vi.mock('jszip', () => ({ default: vi.fn() }))
vi.mock('@sim/utils/errors', () => ({ toError: vi.fn((error: unknown) => error) }))

import { GET } from '@/app/api/files/export/[id]/route'

describe('/api/files/export/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParseRequest.mockResolvedValue({
      success: true,
      data: { params: { id: 'file-1' } },
    })
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
    })
    mockGetFileMetadataById.mockResolvedValue({
      id: 'file-1',
      key: 'ws-hidden/file.md',
      originalName: 'file.md',
      contentType: 'text/markdown',
      context: 'workspace',
    })
  })

  it('hides foreign personal workspace file exports behind 404', async () => {
    mockVerifyFileAccess.mockResolvedValueOnce(false)

    const response = await GET(new NextRequest('http://localhost:3000/api/files/export/file-1'), {
      params: Promise.resolve({ id: 'file-1' }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
  })

  it('authenticates before validating route params', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Authentication required',
    })

    const response = await GET(new NextRequest('http://localhost:3000/api/files/export/file-1'), {
      params: Promise.resolve({ id: 'file-1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockParseRequest).not.toHaveBeenCalled()
  })
})
