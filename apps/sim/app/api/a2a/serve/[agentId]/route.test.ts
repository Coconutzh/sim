/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockCheckHybridAuth, mockCheckWorkspaceAccess } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockCheckHybridAuth: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({ db: { select: mockDbSelect } }))
vi.mock('@sim/db/schema', () => ({
  a2aAgent: { id: 'id', archivedAt: 'archivedAt', workspaceId: 'workspaceId' },
  a2aPushNotificationConfig: {},
  a2aTask: { $inferSelect: {} },
  workflow: {},
  workspace: { id: 'id', workspaceMode: 'workspaceMode' },
}))
vi.mock('@/lib/auth/hybrid', () => ({
  AuthType: { API_KEY: 'api_key' },
  checkHybridAuth: mockCheckHybridAuth,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ checkWorkspaceAccess: mockCheckWorkspaceAccess }))
vi.mock('@/lib/api/contracts/a2a-agents', () => ({
  a2aServeAgentParamsSchema: { parse: vi.fn(() => ({ agentId: 'agent-1' })) },
  a2aJsonRpcRequestSchema: { safeParse: vi.fn() },
  a2aMessageSendParamsSchema: { safeParse: vi.fn() },
  a2aPushNotificationSetParamsSchema: { safeParse: vi.fn() },
  a2aTaskIdParamsSchema: { safeParse: vi.fn() },
}))
vi.mock('@/lib/core/utils/with-route-handler', () => ({ withRouteHandler: vi.fn((handler) => handler) }))
vi.mock('@sim/logger', () => ({ createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) }))
vi.mock('@/lib/a2a/constants', () => ({ A2A_DEFAULT_TIMEOUT: 30000, A2A_MAX_HISTORY_LENGTH: 20 }))
vi.mock('@/lib/a2a/push-notifications', () => ({ notifyTaskStateChange: vi.fn() }))
vi.mock('@/lib/a2a/utils', () => ({
  createAgentMessage: vi.fn(),
  extractWorkflowInput: vi.fn(),
  isTerminalState: vi.fn(() => false),
  parseWorkflowSSEChunk: vi.fn(),
}))
vi.mock('@/lib/core/config/redis', () => ({ acquireLock: vi.fn(), getRedisClient: vi.fn(), releaseLock: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({ validateUrlWithDNS: vi.fn() }))
vi.mock('@/lib/core/utils/request', () => ({ getClientIp: vi.fn(() => '127.0.0.1') }))
vi.mock('@/lib/core/utils/sse', () => ({ SSE_HEADERS: {} }))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: vi.fn(() => 'http://localhost:3000') }))
vi.mock('@/lib/execution/cancellation', () => ({ markExecutionCancelled: vi.fn() }))
vi.mock('@/lib/workspaces/utils', () => ({ getWorkspaceBilledAccountUserId: vi.fn() }))
vi.mock('@/app/api/a2a/serve/[agentId]/utils', () => ({
  A2A_ERROR_CODES: { AGENT_UNAVAILABLE: 'agent_unavailable', AUTHENTICATION_REQUIRED: 'auth_required' },
  A2A_METHODS: {},
  buildExecuteRequest: vi.fn(),
  buildTaskResponse: vi.fn(),
  createError: vi.fn((id: unknown, code: string, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })),
  createResponse: vi.fn(),
  extractAgentContent: vi.fn(),
  formatTaskResponse: vi.fn(),
  generateTaskId: vi.fn(),
}))
vi.mock('@/ee/whitelabeling', () => ({ getBrandConfig: vi.fn(() => ({ name: 'Sim' })) }))
vi.mock('@sim/utils/id', () => ({ generateId: vi.fn(() => 'generated-id') }))

import { POST } from '@/app/api/a2a/serve/[agentId]/route'
import { GET } from '@/app/api/a2a/serve/[agentId]/route'

describe('/api/a2a/serve/[agentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbSelect.mockReturnValueOnce(
      createSelectChain([
        {
          id: 'agent-1',
          name: 'Agent',
          workflowId: 'wf-1',
          workspaceId: 'ws-hidden',
          workspaceMode: 'personal',
          isPublished: true,
          capabilities: {},
          authentication: { schemes: ['bearer'] },
        },
      ])
    )
    mockCheckHybridAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
      apiKeyType: null,
      workspaceId: null,
    })
  })

  it('hides foreign personal workspace published agents behind 404', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/a2a/serve/agent-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: {} }),
      }),
      { params: Promise.resolve({ agentId: 'agent-1' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: 'agent_unavailable', message: 'Agent not found' },
    })
  })

  it('hides foreign personal workspace published agent cards behind 404', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: false,
      userId: null,
      authType: null,
      apiKeyType: null,
      workspaceId: null,
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/a2a/serve/agent-1'),
      { params: Promise.resolve({ agentId: 'agent-1' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Agent not found' })
  })
})
