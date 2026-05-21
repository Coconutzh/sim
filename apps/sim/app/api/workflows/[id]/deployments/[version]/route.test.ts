/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockParseRequest, mockValidateWorkflowPermissions } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockParseRequest: vi.fn(),
  mockValidateWorkflowPermissions: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/api/server', () => ({
  getValidationErrorMessage: vi.fn((_error, fallback: string) => fallback),
  parseRequest: mockParseRequest,
}))

vi.mock('@/lib/workflows/utils', () => ({
  validateWorkflowPermissions: mockValidateWorkflowPermissions,
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

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
  workflowDeploymentVersion: {},
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  performActivateVersion: vi.fn(),
}))

vi.mock('@/app/api/workflows/utils', () => ({
  createErrorResponse: vi.fn((error: string, status: number, code?: string) =>
    Response.json({ error, code: code || error.toUpperCase().replace(/\s+/g, '_') }, { status })
  ),
  createSuccessResponse: vi.fn((data: unknown) => Response.json(data)),
}))

import { GET, PATCH } from './route'

function createThrowingDeploymentParams(): Promise<{ id: string; version: string }> {
  return {
    then: () => {
      throw new Error('Route params should not be read before auth')
    },
  } as unknown as Promise<{ id: string; version: string }>
}

describe('/api/workflows/[id]/deployments/[version] auth boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
  })

  it('GET returns 401 before reading route params', async () => {
    const request = new NextRequest('http://localhost:3000/api/workflows//deployments/1')

    const response = await GET(request, { params: createThrowingDeploymentParams() })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockValidateWorkflowPermissions).not.toHaveBeenCalled()
  })

  it('PATCH returns 401 before reading route params or body', async () => {
    const request = new NextRequest('http://localhost:3000/api/workflows//deployments/1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Version 1' }),
    })

    const response = await PATCH(request, { params: createThrowingDeploymentParams() })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockValidateWorkflowPermissions).not.toHaveBeenCalled()
  })
})
