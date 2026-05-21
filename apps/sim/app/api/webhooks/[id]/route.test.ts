/**
 * @vitest-environment node
 */
import { workflowAuthzMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockParseRequest,
  mockCheckSessionOrInternalAuth,
  mockDbSelect,
  mockDbFrom,
  mockDbInnerJoin,
  mockDbWhere,
  mockDbLimit,
  mockDbUpdate,
  mockDbSet,
  mockDbUpdateWhere,
  mockDbDelete,
  mockDbDeleteWhere,
  mockAssertWorkflowMutable,
} = vi.hoisted(() => ({
  mockParseRequest: vi.fn(async (_contract, _request, context) => ({
    success: true,
    data: {
      params: await context.params,
      body: { isActive: false, failedCount: 0 },
    },
  })),
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbFrom: vi.fn(),
  mockDbInnerJoin: vi.fn(),
  mockDbWhere: vi.fn(),
  mockDbLimit: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbSet: vi.fn(),
  mockDbUpdateWhere: vi.fn(),
  mockDbDelete: vi.fn(),
  mockDbDeleteWhere: vi.fn(),
  mockAssertWorkflowMutable: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    update: mockDbUpdate,
    delete: mockDbDelete,
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission:
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission,
  assertWorkflowMutable: mockAssertWorkflowMutable,
  WorkflowLockedError: class WorkflowLockedError extends Error {
    status = 423
  },
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

vi.mock('@/lib/webhooks/provider-subscriptions', () => ({
  cleanupExternalWebhook: vi.fn(),
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: {
    webhookDeleted: vi.fn(),
  },
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { WEBHOOK_DELETED: 'WEBHOOK_DELETED' },
  AuditResourceType: { WEBHOOK: 'WEBHOOK' },
  recordAudit: vi.fn(),
}))

import { DELETE, GET, PATCH } from './route'

describe('Webhook [id] API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      userName: 'User One',
      userEmail: 'user@example.com',
    })
    mockDbSelect.mockReturnValue({ from: mockDbFrom })
    mockDbFrom.mockReturnValue({ innerJoin: mockDbInnerJoin })
    mockDbInnerJoin.mockReturnValue({ where: mockDbWhere })
    mockDbWhere.mockReturnValue({ limit: mockDbLimit })
    mockDbLimit.mockResolvedValue([
      {
        webhook: {
          id: 'wh-1',
          workflowId: 'wf-1',
          provider: 'gmail',
          path: 'test-path',
          blockId: 'block-1',
          credentialSetId: null,
          isActive: true,
          failedCount: 0,
        },
        workflow: {
          id: 'wf-1',
          name: 'Workflow One',
          userId: 'owner-1',
          workspaceId: 'ws-1',
        },
      },
    ])
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      accessSource: 'workspace',
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
    })
    mockDbUpdate.mockReturnValue({ set: mockDbSet })
    mockDbSet.mockReturnValue({ where: mockDbUpdateWhere })
    mockDbUpdateWhere.mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'wh-1' }]) })
    mockDbDelete.mockReturnValue({ where: mockDbDeleteWhere })
    mockDbDeleteWhere.mockResolvedValue(undefined)
    mockAssertWorkflowMutable.mockResolvedValue(undefined)
  })

  function params(id = 'wh-1') {
    return { params: Promise.resolve({ id }) }
  }

  it('authenticates webhook fetch before validating params', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Authentication required',
    })

    const response = await GET(new NextRequest('http://localhost/api/webhooks/wh-1'), params())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockParseRequest).not.toHaveBeenCalled()
  })

  it('authenticates webhook updates before validating params or body', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Authentication required',
    })

    const response = await PATCH(
      new NextRequest('http://localhost/api/webhooks/wh-1', {
        method: 'PATCH',
      }),
      params()
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockParseRequest).not.toHaveBeenCalled()
  })

  it('authenticates webhook deletion before validating params', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Authentication required',
    })

    const response = await DELETE(
      new NextRequest('http://localhost/api/webhooks/wh-1', {
        method: 'DELETE',
      }),
      params()
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockParseRequest).not.toHaveBeenCalled()
  })

  it('rejects published workflow readers from fetching a webhook by id', async () => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      accessSource: 'published',
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
    })

    const response = await GET(new NextRequest('http://localhost/api/webhooks/wh-1'), params())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' })
  })

  it('rejects published workflow readers from updating a webhook by id', async () => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      accessSource: 'published',
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
    })

    const response = await PATCH(
      new NextRequest('http://localhost/api/webhooks/wh-1', {
        method: 'PATCH',
        body: JSON.stringify({ isActive: false }),
        headers: { 'content-type': 'application/json' },
      }),
      params()
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' })
    expect(mockAssertWorkflowMutable).not.toHaveBeenCalled()
  })

  it('rejects published workflow readers from deleting a webhook by id', async () => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      accessSource: 'published',
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
    })

    const response = await DELETE(
      new NextRequest('http://localhost/api/webhooks/wh-1', {
        method: 'DELETE',
      }),
      params()
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' })
    expect(mockAssertWorkflowMutable).not.toHaveBeenCalled()
  })

  it('hides foreign personal workflow webhook fetches behind 404', async () => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: { id: 'wf-hidden', workspaceId: 'ws-hidden' },
    })

    const response = await GET(new NextRequest('http://localhost/api/webhooks/wh-1'), params())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Workflow not found' })
  })

  it('hides foreign personal workflow webhook updates behind 404', async () => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: { id: 'wf-hidden', workspaceId: 'ws-hidden' },
    })

    const response = await PATCH(
      new NextRequest('http://localhost/api/webhooks/wh-1', {
        method: 'PATCH',
        body: JSON.stringify({ isActive: false }),
        headers: { 'content-type': 'application/json' },
      }),
      params()
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Workflow not found' })
    expect(mockAssertWorkflowMutable).not.toHaveBeenCalled()
  })

  it('hides foreign personal workflow webhook deletions behind 404', async () => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: { id: 'wf-hidden', workspaceId: 'ws-hidden' },
    })

    const response = await DELETE(
      new NextRequest('http://localhost/api/webhooks/wh-1', {
        method: 'DELETE',
      }),
      params()
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Workflow not found' })
    expect(mockAssertWorkflowMutable).not.toHaveBeenCalled()
  })
})
