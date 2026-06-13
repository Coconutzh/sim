/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRunLocalCanvasAgentHeadless } = vi.hoisted(() => ({
  mockRunLocalCanvasAgentHeadless: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {
    HERMES_SERVICE_TOKEN: 'h'.repeat(32),
  },
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent', () => ({
  runLocalCanvasAgentHeadless: mockRunLocalCanvasAgentHeadless,
}))

import { POST } from '@/app/api/internal/hermes/canvas-agent/run/route'

function buildRequest(params: { body: string; token?: string }): NextRequest {
  return new NextRequest('http://localhost:3000/api/internal/hermes/canvas-agent/run', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(params.token ? { 'x-sim-service-token': params.token } : {}),
    },
    body: params.body,
  })
}

describe('Hermes canvas agent internal route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunLocalCanvasAgentHeadless.mockResolvedValue({
      success: true,
      answer: 'ok',
      mode: 'read_only',
      risk: 'low',
      requiresConfirmation: false,
      changedNodeIds: [],
      generatedNodeIds: [],
      auditId: 'audit-1',
    })
  })

  it('checks service auth before parsing JSON body', async () => {
    const response = await POST(buildRequest({ body: '{not-json' }))
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload.errorCode).toBe('UNAUTHENTICATED_SERVICE')
    expect(mockRunLocalCanvasAgentHeadless).not.toHaveBeenCalled()
  })

  it('parses the contract and calls the headless runtime for authorized requests', async () => {
    const response = await POST(
      buildRequest({
        token: 'h'.repeat(32),
        body: JSON.stringify({
          userId: 'user-1',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          message: 'read canvas',
          mode: 'read_only',
          selectedNodeIds: ['node-1'],
        }),
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(mockRunLocalCanvasAgentHeadless).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        message: 'read canvas',
        mode: 'read_only',
        selectedNodeIds: ['node-1'],
      })
    )
  })
})
