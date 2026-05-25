/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckInternalAuth,
  mockParseRequest,
  mockAssertActiveWorkspaceAccess,
  mockIsActiveWorkspaceAccessError,
  mockRunHeadlessCopilotLifecycle,
  mockGenerateWorkspaceContext,
  mockBuildIntegrationToolSchemas,
  mockGetUserEntityPermissions,
} = vi.hoisted(() => ({
  mockCheckInternalAuth: vi.fn(),
  mockParseRequest: vi.fn(),
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockIsActiveWorkspaceAccessError: vi.fn(),
  mockRunHeadlessCopilotLifecycle: vi.fn(),
  mockGenerateWorkspaceContext: vi.fn(),
  mockBuildIntegrationToolSchemas: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    withMetadata: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
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

vi.mock('@/lib/api/contracts/mothership-tasks', () => ({
  mothershipExecuteContract: {},
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkInternalAuth: mockCheckInternalAuth,
}))

vi.mock('@/lib/copilot/chat/payload', () => ({
  buildIntegrationToolSchemas: mockBuildIntegrationToolSchemas,
}))

vi.mock('@/lib/copilot/chat/workspace-context', () => ({
  generateWorkspaceContext: mockGenerateWorkspaceContext,
}))

vi.mock('@/lib/copilot/request/lifecycle/headless', () => ({
  runHeadlessCopilotLifecycle: mockRunHeadlessCopilotLifecycle,
}))

vi.mock('@/lib/copilot/request/session/explicit-abort', () => ({
  requestExplicitStreamAbort: vi.fn(),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  assertActiveWorkspaceAccess: mockAssertActiveWorkspaceAccess,
  getUserEntityPermissions: mockGetUserEntityPermissions,
  isActiveWorkspaceAccessError: mockIsActiveWorkspaceAccessError,
}))

import { POST } from './route'

describe('mothership execute route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckInternalAuth.mockResolvedValue({ success: true })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: {
        body: {
          messages: [{ role: 'user', content: 'hello' }],
          responseFormat: 'text',
          workspaceId: 'ws-1',
          userId: 'user-1',
          workflowId: 'wf-1',
          executionId: 'exec-1',
        },
      },
    })
    mockAssertActiveWorkspaceAccess.mockResolvedValue(undefined)
    mockIsActiveWorkspaceAccessError.mockReturnValue(false)
    mockGenerateWorkspaceContext.mockResolvedValue('workspace context')
    mockBuildIntegrationToolSchemas.mockResolvedValue([])
    mockGetUserEntityPermissions.mockResolvedValue('write')
    mockRunHeadlessCopilotLifecycle.mockResolvedValue({
      success: true,
      content: 'done',
      toolCalls: [],
      usage: { prompt: 1, completion: 1 },
      cost: 0.01,
    })
  })

  it('hides foreign personal workspace execution behind 404', async () => {
    const hiddenError = new Error('hidden workspace')
    mockAssertActiveWorkspaceAccess.mockRejectedValueOnce(hiddenError)
    mockIsActiveWorkspaceAccessError.mockReturnValueOnce(true)
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        body: {
          messages: [{ role: 'user', content: 'hello' }],
          responseFormat: 'text',
          workspaceId: 'ws-hidden',
          userId: 'user-1',
          workflowId: 'wf-1',
          executionId: 'exec-1',
        },
      },
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/mothership/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'ws-hidden' }),
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
    expect(mockRunHeadlessCopilotLifecycle).not.toHaveBeenCalled()
  })
})
