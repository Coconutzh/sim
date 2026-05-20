/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockParseRequest,
  mockCheckSessionOrInternalAuth,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockCheckKnowledgeBaseWriteAccess,
  mockDbSelect,
} = vi.hoisted(() => ({
  mockParseRequest: vi.fn(),
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockCheckKnowledgeBaseWriteAccess: vi.fn(),
  mockDbSelect: vi.fn(),
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

vi.mock('@/app/api/knowledge/utils', () => ({
  checkKnowledgeBaseWriteAccess: mockCheckKnowledgeBaseWriteAccess,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@/lib/knowledge/documents/service', () => ({
  createDocumentRecords: vi.fn(),
  deleteDocument: vi.fn(),
  getProcessingConfig: vi.fn(() => ({ maxConcurrentDocuments: 8, batchSize: 20 })),
  processDocumentsWithQueue: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    DOCUMENT_UPDATED: 'DOCUMENT_UPDATED',
    DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  },
  AuditResourceType: {
    DOCUMENT: 'DOCUMENT',
  },
  recordAudit: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'request-12345678'),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

import { POST } from './route'

describe('POST /api/knowledge/[id]/documents/upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParseRequest.mockResolvedValue({
      success: true,
      data: {
        body: {
          workflowId: 'workflow-1',
          filename: 'doc.pdf',
          fileUrl: 'https://example.com/doc.pdf',
          fileSize: 1024,
          mimeType: 'application/pdf',
        },
      },
    })
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      userName: 'User One',
      userEmail: 'user@example.com',
    })
  })

  it('rejects published workflow readers from upserting documents', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      accessSource: 'published',
      workflow: { id: 'workflow-1', workspaceId: 'ws-1' },
    })

    const response = await POST(
      new NextRequest('http://localhost/api/knowledge/kb-1/documents/upsert', {
        method: 'POST',
        body: JSON.stringify({ workflowId: 'workflow-1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'kb-1' }) }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' })
    expect(mockCheckKnowledgeBaseWriteAccess).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
