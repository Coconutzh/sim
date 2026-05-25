/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckSessionOrInternalAuth,
  mockParseRequest,
  mockAuthorizeWorkflowByWorkspacePermission,
} = vi.hoisted(() => ({
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockParseRequest: vi.fn(),
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
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

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  assertPermissionsAllowed: vi.fn(),
  ProviderNotAllowedError: class ProviderNotAllowedError extends Error {},
}))

import { POST } from './route'

describe('POST /api/guardrails/validate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
    })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: {
        body: {
          validationType: 'hallucination',
          input: 'hello',
          knowledgeBaseId: 'kb-1',
          model: 'gpt-4.1',
          workflowId: 'workflow-1',
        },
      },
    })
  })

  it('rejects published workflow readers from hallucination validation', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      accessSource: 'published',
      workflow: { id: 'workflow-1', workspaceId: 'ws-1' },
    })

    const response = await POST(
      new NextRequest('http://localhost/api/guardrails/validate', {
        method: 'POST',
        body: JSON.stringify({ validationType: 'hallucination' }),
        headers: { 'content-type': 'application/json' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      output: {
        passed: false,
        validationType: 'hallucination',
        input: 'hello',
        error: 'Canvas access is required for hallucination validation.',
      },
    })
  })

  it('hides foreign personal workflows behind not found for hallucination validation', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
    })

    const response = await POST(
      new NextRequest('http://localhost/api/guardrails/validate', {
        method: 'POST',
        body: JSON.stringify({ validationType: 'hallucination' }),
        headers: { 'content-type': 'application/json' },
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Workflow not found' })
  })
})
