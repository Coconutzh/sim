/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckHybridAuth, mockParseRequest, mockValidateWorkflowAccess } = vi.hoisted(() => ({
  mockCheckHybridAuth: vi.fn(),
  mockParseRequest: vi.fn(),
  mockValidateWorkflowAccess: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: mockCheckHybridAuth,
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@/app/api/workflows/middleware', () => ({
  validateWorkflowAccess: mockValidateWorkflowAccess,
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: vi.fn(),
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: vi.fn(),
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBilledAccountUserId: vi.fn(),
}))

import { POST } from './route'

describe('POST /api/workflows/[id]/log', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckHybridAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
  })

  it('authenticates before reading route params or validating body', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
      authType: 'session',
    })

    const params = {
      then: () => {
        throw new Error('Route params should not be read before auth')
      },
    } as unknown as Promise<{ id: string }>

    const request = new NextRequest('http://localhost:3000/api/workflows//log', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockValidateWorkflowAccess).not.toHaveBeenCalled()
  })

  it('requires workflow write access before persisting execution logs', async () => {
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        params: { id: 'workflow-1' },
        body: {
          logs: [{ level: 'info', message: 'started' }],
        },
      },
    })
    mockValidateWorkflowAccess.mockResolvedValueOnce({
      error: { message: 'Published workflows are read-only', status: 403 },
    })

    const request = new NextRequest('http://localhost:3000/api/workflows/workflow-1/log', {
      method: 'POST',
      body: JSON.stringify({ logs: [{ level: 'info', message: 'started' }] }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'workflow-1' }) })

    expect(mockValidateWorkflowAccess).toHaveBeenCalledWith(request, 'workflow-1', false, 'write')
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Published workflows are read-only',
      code: 'PUBLISHED_WORKFLOWS_ARE_READ-ONLY',
    })
  })
})
