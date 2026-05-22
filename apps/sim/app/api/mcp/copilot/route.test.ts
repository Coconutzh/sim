/**
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthorizeWorkflowByWorkspacePermission,
  mockPrepareExecutionContext,
  mockGenerateWorkspaceContext,
  mockRunHeadlessCopilotLifecycle,
  mockResolveWorkflowIdForUser,
} = vi.hoisted(() => ({
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockPrepareExecutionContext: vi.fn(),
  mockGenerateWorkspaceContext: vi.fn(),
  mockRunHeadlessCopilotLifecycle: vi.fn(),
  mockResolveWorkflowIdForUser: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  },
}))

vi.mock('@sim/db/schema', () => ({
  userStats: {
    userId: 'userStats.userId',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@sim/utils/errors', () => ({
  toError: vi.fn((error: unknown) =>
    error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'unknown')
  ),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'generated-id'),
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  sql: vi.fn(),
}))

vi.mock('@/lib/auth/oauth-token', () => ({
  validateOAuthAccessToken: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: vi.fn(),
}))

vi.mock('@/lib/copilot/chat/workspace-context', () => ({
  generateWorkspaceContext: mockGenerateWorkspaceContext,
}))

vi.mock('@/lib/copilot/constants', () => ({
  ORCHESTRATION_TIMEOUT_MS: 1000,
  SIM_AGENT_API_URL: 'http://localhost:8080',
}))

vi.mock('@/lib/copilot/request/http', () => ({
  createRequestId: vi.fn(() => 'req-1'),
}))

vi.mock('@/lib/copilot/request/lifecycle/headless', () => ({
  runHeadlessCopilotLifecycle: mockRunHeadlessCopilotLifecycle,
}))

vi.mock('@/lib/copilot/request/subagent', () => ({
  orchestrateSubagentStream: vi.fn(),
}))

vi.mock('@/lib/copilot/tool-executor', () => ({
  ensureHandlersRegistered: vi.fn(),
  executeTool: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/handlers/context', () => ({
  prepareExecutionContext: mockPrepareExecutionContext,
}))

vi.mock('@/lib/copilot/tools/mcp/definitions', () => ({
  DIRECT_TOOL_DEFS: [],
  SUBAGENT_TOOL_DEFS: [],
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {},
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: vi.fn(() => ({
    checkRateLimitWithSubscription: vi.fn(),
  })),
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

vi.mock('@/lib/workflows/utils', () => ({
  resolveWorkflowIdForUser: mockResolveWorkflowIdForUser,
}))

import { validateOAuthAccessToken } from '@/lib/auth/oauth-token'
import { handleBuildToolCall, POST } from '@/app/api/mcp/copilot/route'

describe('handleBuildToolCall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      accessSource: 'workspace',
      workflow: {
        id: 'wf-1',
        name: 'Workflow One',
        workspaceId: 'ws-1',
      },
    })
    mockPrepareExecutionContext.mockResolvedValue({
      userId: 'user-1',
      workflowId: 'wf-1',
      workspaceId: 'ws-1',
      chatId: 'generated-id',
      decryptedEnvVars: {},
    })
    mockGenerateWorkspaceContext.mockResolvedValue('workspace context')
    mockRunHeadlessCopilotLifecycle.mockResolvedValue({
      success: true,
      content: 'done',
      toolCalls: [],
      error: undefined,
    })
    mockResolveWorkflowIdForUser.mockResolvedValue({
      status: 'not_found',
      message: 'No workflows found.',
    })
  })

  it('rejects published workflow readers before starting MCP build orchestration', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      accessSource: 'published',
      workflow: {
        id: 'wf-1',
        name: 'Workflow One',
        workspaceId: 'ws-1',
      },
    })

    const result = await handleBuildToolCall(
      {
        workflowId: 'wf-1',
        request: 'fix this workflow',
      },
      'user-1'
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(String(result.content[0].text)).toContain(
      'workflowId is required for build. Call create_workflow first.'
    )
    expect(mockPrepareExecutionContext).not.toHaveBeenCalled()
    expect(mockRunHeadlessCopilotLifecycle).not.toHaveBeenCalled()
  })

  it('continues building for workspace-backed workflow access', async () => {
    const result = await handleBuildToolCall(
      {
        workflowId: 'wf-1',
        request: 'fix this workflow',
      },
      'user-1'
    )

    expect(result.isError).toBe(false)
    expect(mockPrepareExecutionContext).toHaveBeenCalledWith('user-1', 'wf-1', 'generated-id', {
      workspaceId: 'ws-1',
    })
    expect(mockRunHeadlessCopilotLifecycle).toHaveBeenCalled()
  })
})

describe('POST /api/mcp/copilot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('authenticates bearer tokens before reading the JSON-RPC body', async () => {
    vi.mocked(validateOAuthAccessToken).mockResolvedValueOnce({
      success: false,
      error: 'bad token',
    })
    const json = vi.fn(async () => {
      throw new Error('body should not be parsed before auth')
    })
    const request = {
      headers: new Headers({ authorization: 'Bearer bad-token' }),
      json,
      signal: new AbortController().signal,
    } as unknown as NextRequest

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toMatchObject({ error: 'unauthorized', message: 'bad token' })
    expect(json).not.toHaveBeenCalled()
  })

  it('validates auth before returning invalid JSON errors', async () => {
    vi.mocked(validateOAuthAccessToken).mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      scopes: ['mcp:tools'],
    })
    const request = {
      headers: new Headers({ authorization: 'Bearer good-token' }),
      json: vi.fn(async () => {
        throw new SyntaxError('invalid json')
      }),
      signal: new AbortController().signal,
    } as unknown as NextRequest

    const response = await POST(request)
    const data = await response.json()

    expect(validateOAuthAccessToken).toHaveBeenCalledWith('good-token')
    expect(response.status).toBe(400)
    expect(data.error).toMatchObject({
      code: -32700,
      message: 'Invalid JSON body',
    })
  })
})
