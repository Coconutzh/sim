/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckNeedsRedeployment,
  mockGetSession,
  mockParseRequest,
  mockPerformFullDeploy,
  mockValidateWorkflowPermissions,
} = vi.hoisted(() => ({
  mockCheckNeedsRedeployment: vi.fn(),
  mockGetSession: vi.fn(),
  mockParseRequest: vi.fn(),
  mockPerformFullDeploy: vi.fn(),
  mockValidateWorkflowPermissions: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/api/server', () => ({
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
    update: vi.fn(),
  },
  workflow: {},
}))

vi.mock('@sim/workflow-authz', () => ({
  assertWorkflowMutable: vi.fn(),
  WorkflowLockedError: class WorkflowLockedError extends Error {
    status = 423
  },
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  performFullDeploy: mockPerformFullDeploy,
  performFullUndeploy: vi.fn(),
}))

vi.mock('@/app/api/workflows/utils', () => ({
  checkNeedsRedeployment: mockCheckNeedsRedeployment,
  createErrorResponse: vi.fn((error: string, status: number, code?: string) =>
    Response.json({ error, code: code || error.toUpperCase().replace(/\s+/g, '_') }, { status })
  ),
  createSuccessResponse: vi.fn((data: unknown) => Response.json(data)),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  PublicApiNotAllowedError: class PublicApiNotAllowedError extends Error {},
  validatePublicApiAllowed: vi.fn(),
}))

import { DELETE, GET, PATCH, POST } from './route'

function createThrowingWorkflowParams(): Promise<{ id: string }> {
  return {
    then: () => {
      throw new Error('Route params should not be read before auth')
    },
  } as unknown as Promise<{ id: string }>
}

describe('/api/workflows/[id]/deploy auth boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
  })

  it('GET returns 401 before reading route params', async () => {
    const request = new NextRequest('http://localhost:3000/api/workflows//deploy')

    const response = await GET(request, { params: createThrowingWorkflowParams() })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockValidateWorkflowPermissions).not.toHaveBeenCalled()
  })

  it('POST returns 401 before reading route params', async () => {
    const request = new NextRequest('http://localhost:3000/api/workflows//deploy', {
      method: 'POST',
    })

    const response = await POST(request, { params: createThrowingWorkflowParams() })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockValidateWorkflowPermissions).not.toHaveBeenCalled()
  })

  it('PATCH returns 401 before reading route params or body', async () => {
    const request = new NextRequest('http://localhost:3000/api/workflows//deploy', {
      method: 'PATCH',
      body: JSON.stringify({}),
    })

    const response = await PATCH(request, { params: createThrowingWorkflowParams() })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockValidateWorkflowPermissions).not.toHaveBeenCalled()
  })

  it('DELETE returns 401 before reading route params', async () => {
    const request = new NextRequest('http://localhost:3000/api/workflows//deploy', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: createThrowingWorkflowParams() })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockValidateWorkflowPermissions).not.toHaveBeenCalled()
  })

  it('GET returns canvas API key wording for workspace-scoped deployments', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: { params: { id: 'workflow-1' } },
    })
    mockValidateWorkflowPermissions.mockResolvedValue({
      error: null,
      workflow: {
        id: 'workflow-1',
        workspaceId: 'workspace-1',
        isDeployed: true,
        deployedAt: new Date('2026-05-25T00:00:00.000Z'),
        isPublicApi: false,
      },
    })
    mockCheckNeedsRedeployment.mockResolvedValue(false)

    const request = new NextRequest('http://localhost:3000/api/workflows/workflow-1/deploy')

    const response = await GET(request, { params: Promise.resolve({ id: 'workflow-1' }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      apiKey: 'Canvas API keys',
      isDeployed: true,
      needsRedeployment: false,
    })
  })

  it('POST returns canvas API key wording after deploying workspace-scoped workflows', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: { params: { id: 'workflow-1' } },
    })
    mockValidateWorkflowPermissions.mockResolvedValue({
      error: null,
      session: { user: { id: 'user-1' } },
      workflow: {
        id: 'workflow-1',
        name: 'Team deploy',
        workspaceId: 'workspace-1',
      },
    })
    mockPerformFullDeploy.mockResolvedValue({
      success: true,
      deployedAt: new Date('2026-05-25T00:00:00.000Z'),
      warnings: [],
    })

    const request = new NextRequest('http://localhost:3000/api/workflows/workflow-1/deploy', {
      method: 'POST',
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'workflow-1' }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      apiKey: 'Canvas API keys',
      isDeployed: true,
      warnings: [],
    })
  })
})
