/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQueryHermesCanvasHistory } = vi.hoisted(() => ({
  mockQueryHermesCanvasHistory: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {
    HERMES_SERVICE_TOKEN: 'h'.repeat(32),
  },
}))

vi.mock('@/lib/hermes/canvas-history-query', () => ({
  queryHermesCanvasHistory: mockQueryHermesCanvasHistory,
}))

import { POST } from '@/app/api/internal/hermes/canvas-history/query/route'

function buildRequest(params: { body: string; token?: string }): NextRequest {
  return new NextRequest('http://localhost:3000/api/internal/hermes/canvas-history/query', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(params.token ? { 'x-sim-service-token': params.token } : {}),
    },
    body: params.body,
  })
}

describe('Hermes canvas history internal route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryHermesCanvasHistory.mockResolvedValue({
      success: true,
      scope: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        query: 'recent_operations',
      },
      summary: {
        total: 0,
        successCount: 0,
        errorCount: 0,
        pendingConfirmationCount: 0,
        changedNodeIds: [],
        generatedNodeIds: [],
        latestVerificationSummary: null,
      },
      items: [],
      evidenceRefs: [],
    })
  })

  it('checks service auth before parsing JSON body', async () => {
    const response = await POST(buildRequest({ body: '{not-json' }))
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload.errorCode).toBe('UNAUTHENTICATED_SERVICE')
    expect(mockQueryHermesCanvasHistory).not.toHaveBeenCalled()
  })

  it('parses the contract and queries scoped canvas history', async () => {
    const response = await POST(
      buildRequest({
        token: 'h'.repeat(32),
        body: JSON.stringify({
          userId: 'user-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          chatId: 'chat-1',
          query: 'pending_actions',
          mode: 'propose',
          limit: 5,
        }),
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(mockQueryHermesCanvasHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        organizationId: 'org-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        query: 'pending_actions',
        mode: 'propose',
        limit: 5,
      })
    )
  })
})
