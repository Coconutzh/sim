/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockParseRequest,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockDbSelect,
  mockDbInsert,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockParseRequest: vi.fn(),
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
  },
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    TEMPLATE_CREATED: 'TEMPLATE_CREATED',
  },
  AuditResourceType: {
    TEMPLATE: 'TEMPLATE',
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
  generateId: vi.fn(() => 'template-1'),
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

vi.mock('@/lib/templates/permissions', () => ({
  canAccessTemplate: vi.fn(),
  verifyCreatorPermission: vi.fn(),
  verifyEffectiveSuperUser: vi.fn(async () => ({ effectiveSuperUser: false })),
}))

vi.mock('@/lib/workflows/credentials/credential-extractor', () => ({
  extractRequiredCredentials: vi.fn(() => []),
  sanitizeCredentials: vi.fn((value: unknown) => value),
}))

import { GET, POST } from './route'

describe('/api/templates workflow access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('hides workflow template lookup from published workflow readers', async () => {
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        query: {
          workflowId: 'wf-1',
          limit: 20,
          offset: 0,
        },
      },
    })
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      accessSource: 'published',
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/templates?workflowId=wf-1')
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: [],
      pagination: {
        total: 0,
        limit: 20,
        offset: 0,
        page: 1,
        totalPages: 0,
      },
    })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('rejects template creation from published workflow readers', async () => {
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        body: {
          workflowId: 'wf-1',
          creatorId: 'creator-1',
          name: 'Template One',
          details: null,
          tags: [],
        },
      },
    })
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      accessSource: 'published',
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/templates', {
        method: 'POST',
        body: JSON.stringify({
          workflowId: 'wf-1',
          creatorId: 'creator-1',
          name: 'Template One',
          tags: [],
        }),
        headers: { 'content-type': 'application/json' },
      })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' })
    expect(mockDbInsert).not.toHaveBeenCalled()
  })
})
