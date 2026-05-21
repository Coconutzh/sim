/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckSessionOrInternalAuth,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockCheckDocumentWriteAccess,
} = vi.hoisted(() => ({
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockCheckDocumentWriteAccess: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

vi.mock('@/app/api/knowledge/utils', () => ({
  checkDocumentAccess: vi.fn(),
  checkDocumentWriteAccess: mockCheckDocumentWriteAccess,
}))

vi.mock('@/lib/api/server', () => ({
  isZodError: vi.fn(() => false),
  parseRequest: vi.fn(),
}))

vi.mock('@/lib/knowledge/chunks/service', () => ({
  batchChunkOperation: vi.fn(),
  createChunk: vi.fn(),
  queryChunks: vi.fn(),
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@/providers/utils', () => ({
  calculateCost: vi.fn(),
}))

import { POST } from './route'

describe('POST /api/knowledge/[id]/documents/[documentId]/chunks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
    })
  })

  it('rejects published workflow readers from creating chunks', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      accessSource: 'published',
      workflow: { id: 'workflow-1', workspaceId: 'ws-1' },
    })

    const response = await POST(
      new NextRequest('http://localhost/api/knowledge/kb-1/documents/doc-1/chunks', {
        method: 'POST',
        body: JSON.stringify({
          workflowId: 'workflow-1',
          content: 'Chunk content',
        }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'kb-1', documentId: 'doc-1' }) }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' })
    expect(mockCheckDocumentWriteAccess).not.toHaveBeenCalled()
  })

  it('hides foreign personal workflows behind not found during chunk creation', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
    })

    const response = await POST(
      new NextRequest('http://localhost/api/knowledge/kb-1/documents/doc-1/chunks', {
        method: 'POST',
        body: JSON.stringify({
          workflowId: 'workflow-foreign',
          content: 'Chunk content',
        }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'kb-1', documentId: 'doc-1' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Workflow not found' })
    expect(mockCheckDocumentWriteAccess).not.toHaveBeenCalled()
  })
})
