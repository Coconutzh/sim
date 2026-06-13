/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { MockContentError, mockRunHermesUserMemoryOperation } = vi.hoisted(() => {
  class MockContentError extends Error {}
  return {
    MockContentError,
    mockRunHermesUserMemoryOperation: vi.fn(),
  }
})

vi.mock('@/lib/core/config/env', () => ({
  env: {
    HERMES_SERVICE_TOKEN: 'h'.repeat(32),
  },
}))

vi.mock('@/lib/hermes/user-memory', () => ({
  HermesUserMemoryContentError: MockContentError,
  HermesUserMemoryScopeError: class MockScopeError extends Error {},
  runHermesUserMemoryOperation: mockRunHermesUserMemoryOperation,
}))

import { POST } from '@/app/api/internal/hermes/memory/run/route'

function buildRequest(params: { body: string; token?: string }): NextRequest {
  return new NextRequest('http://localhost:3000/api/internal/hermes/memory/run', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(params.token ? { 'x-sim-service-token': params.token } : {}),
    },
    body: params.body,
  })
}

describe('Hermes user memory internal route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunHermesUserMemoryOperation.mockResolvedValue({
      operation: 'prefetch',
      answer: 'Loaded 1 SIM user memory item(s).',
      memories: [],
      context: '',
    })
  })

  it('checks service auth before parsing JSON body', async () => {
    const response = await POST(buildRequest({ body: '{not-json' }))
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload.errorCode).toBe('UNAUTHENTICATED_SERVICE')
    expect(mockRunHermesUserMemoryOperation).not.toHaveBeenCalled()
  })

  it('parses the contract and dispatches authorized requests', async () => {
    const response = await POST(
      buildRequest({
        token: 'h'.repeat(32),
        body: JSON.stringify({
          operation: 'prefetch',
          userId: 'user-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          query: 'short video hook format',
          limit: 5,
        }),
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(mockRunHermesUserMemoryOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'prefetch',
        userId: 'user-1',
        organizationId: 'org-1',
        workspaceId: 'workspace-1',
        query: 'short video hook format',
        limit: 5,
      })
    )
  })

  it('maps memory content errors to invalid memory content responses', async () => {
    mockRunHermesUserMemoryOperation.mockRejectedValueOnce(new MockContentError('bad memory'))

    const response = await POST(
      buildRequest({
        token: 'h'.repeat(32),
        body: JSON.stringify({
          operation: 'write',
          userId: 'user-1',
          organizationId: 'org-1',
          content: 'bad memory',
        }),
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.errorCode).toBe('INVALID_MEMORY_CONTENT')
    expect(payload.error).toBe('bad memory')
  })
})
