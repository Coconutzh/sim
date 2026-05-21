/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseRequest, mockCheckSessionOrInternalAuth, mockGetFileMetadataById, mockVerifyFileAccess } = vi.hoisted(() => ({
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
vi.mock('@/lib/api/contracts/storage-transfer', () => ({ fileViewContract: {} }))
vi.mock('@/lib/uploads/config', () => ({ USE_BLOB_STORAGE: false }))

import { GET } from '@/app/api/files/view/[id]/route'

describe('/api/files/view/[id]', () => {
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
    })
  })

  it('hides foreign personal workspace file views behind 404', async () => {
    mockVerifyFileAccess.mockResolvedValueOnce(false)

    const response = await GET(new NextRequest('http://localhost:3000/api/files/view/file-1'), {
      params: Promise.resolve({ id: 'file-1' }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
  })
})
