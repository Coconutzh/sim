/**
 * Tests for workflow chat status route auth and access.
 *
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  hybridAuthMockFns,
  resetDbChainMock,
  workflowAuthzMockFns,
  workflowsUtilsMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseRequest } = vi.hoisted(() => ({
  mockParseRequest: vi.fn(async (_contract, _request, context) => ({
    success: true,
    data: { params: await context.params },
  })),
}))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  eq: vi.fn(),
  isNull: vi.fn((field: unknown) => ({ type: 'isNull', field })),
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)
vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

import { GET } from '@/app/api/workflows/[id]/chat/status/route'

describe('Workflow Chat Status Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockParseRequest.mockImplementation(async (_contract, _request, context) => ({
      success: true,
      data: { params: await context.params },
    }))
  })

  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({ success: false })

    const req = new NextRequest('http://localhost:3000/api/workflows/wf-1/chat/status')
    const response = await GET(req, { params: Promise.resolve({ id: 'wf-1' }) })

    expect(response.status).toBe(401)
  })

  it('authenticates before validating route params', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({ success: false })
    const unreadableParams = {
      then: () => {
        throw new Error('params should not be read')
      },
    } as unknown as Promise<{ id: string }>

    const req = new NextRequest('http://localhost:3000/api/workflows/wf-1/chat/status')
    const response = await GET(req, {
      params: unreadableParams,
    })

    expect(response.status).toBe(401)
    expect(mockParseRequest).not.toHaveBeenCalled()
  })

  it('returns 403 when user lacks workspace access', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 403,
      message: 'Access denied',
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
      workspacePermission: null,
    })

    const req = new NextRequest('http://localhost:3000/api/workflows/wf-1/chat/status')
    const response = await GET(req, { params: Promise.resolve({ id: 'wf-1' }) })

    expect(response.status).toBe(403)
  })

  it('returns 404 for hidden personal workflows', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: { id: 'wf-hidden', workspaceId: 'ws-hidden' },
      workspacePermission: null,
    })

    const req = new NextRequest('http://localhost:3000/api/workflows/wf-hidden/chat/status')
    const response = await GET(req, { params: Promise.resolve({ id: 'wf-hidden' }) })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Workflow not found',
    })
  })

  it('returns 403 for cross-team published readers', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
      workspacePermission: 'read',
      accessSource: 'selected_workgroups',
    })

    const req = new NextRequest('http://localhost:3000/api/workflows/wf-1/chat/status')
    const response = await GET(req, { params: Promise.resolve({ id: 'wf-1' }) })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Cross-team published workflow access does not include deployment status',
    })
  })

  it('returns deployment details when authorized', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
      workspacePermission: 'read',
    })
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'chat-1',
        identifier: 'assistant',
        title: 'Support Bot',
        description: 'desc',
        customizations: { theme: 'dark' },
        authType: 'public',
        allowedEmails: [],
        outputConfigs: [{ blockId: 'agent-1', path: 'content' }],
        password: 'secret',
        isActive: true,
      },
    ])

    const req = new NextRequest('http://localhost:3000/api/workflows/wf-1/chat/status')
    const response = await GET(req, { params: Promise.resolve({ id: 'wf-1' }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.isDeployed).toBe(true)
    expect(data.deployment.id).toBe('chat-1')
    expect(data.deployment.hasPassword).toBe(true)
    expect(data.deployment.outputConfigs).toEqual([{ blockId: 'agent-1', path: 'content' }])
  })
})
