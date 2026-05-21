/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckSessionOrInternalAuth,
  mockParseRequest,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockAssertWorkflowMutable,
  mockLoadWorkflowFromNormalizedTables,
} = vi.hoisted(() => ({
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockParseRequest: vi.fn(),
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockAssertWorkflowMutable: vi.fn(),
  mockLoadWorkflowFromNormalizedTables: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@sim/workflow-authz', () => ({
  assertWorkflowMutable: mockAssertWorkflowMutable,
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
  WorkflowLockedError: class WorkflowLockedError extends Error {
    status = 423
  },
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mockLoadWorkflowFromNormalizedTables,
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

vi.mock('@/lib/workflows/autolayout', () => ({
  applyAutoLayout: vi.fn(),
}))

import { POST } from './route'

describe('POST /api/workflows/[id]/autolayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
    })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: {
        params: { id: 'workflow-1' },
        body: {},
      },
    })
  })

  it('rejects published workflow readers from autolayout', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      accessSource: 'published',
      workflow: { id: 'workflow-1', workspaceId: 'ws-1' },
    })

    const response = await POST(
      new NextRequest('http://localhost/api/workflows/workflow-1/autolayout', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Cross-team published workflow access does not include workflow updates',
    })
    expect(mockAssertWorkflowMutable).not.toHaveBeenCalled()
    expect(mockLoadWorkflowFromNormalizedTables).not.toHaveBeenCalled()
  })

  it('hides foreign personal workflows from autolayout', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: { id: 'workflow-hidden', workspaceId: 'ws-hidden' },
    })

    const response = await POST(
      new NextRequest('http://localhost/api/workflows/workflow-hidden/autolayout', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'workflow-hidden' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Workflow not found',
    })
    expect(mockAssertWorkflowMutable).not.toHaveBeenCalled()
    expect(mockLoadWorkflowFromNormalizedTables).not.toHaveBeenCalled()
  })

  it('authenticates before reading route params or validating body', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
    })

    const params = {
      then: () => {
        throw new Error('Route params should not be read before auth')
      },
    } as unknown as Promise<{ id: string }>

    const response = await POST(
      new NextRequest('http://localhost/api/workflows//autolayout', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }),
      { params }
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockAuthorizeWorkflowByWorkspacePermission).not.toHaveBeenCalled()
  })
})
