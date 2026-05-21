/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockVerifyInternalToken,
  mockParseRequest,
  mockValidateWorkflowPermissions,
  mockLoadDeployedWorkflowState,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockVerifyInternalToken: vi.fn(),
  mockParseRequest: vi.fn(async (_contract, _request, context) => ({
    success: true,
    data: { params: await context.params },
  })),
  mockValidateWorkflowPermissions: vi.fn(),
  mockLoadDeployedWorkflowState: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/auth/internal', () => ({
  verifyInternalToken: mockVerifyInternalToken,
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@/lib/workflows/utils', () => ({
  validateWorkflowPermissions: mockValidateWorkflowPermissions,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadDeployedWorkflowState: mockLoadDeployedWorkflowState,
}))

vi.mock('@/app/api/workflows/utils', () => ({
  createErrorResponse: (message: string, status: number) =>
    Response.json({ error: message }, { status }),
  createSuccessResponse: (data: unknown) => Response.json(data),
}))

import { GET } from '@/app/api/workflows/[id]/deployed/route'

describe('GET /api/workflows/[id]/deployed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockVerifyInternalToken.mockResolvedValue({ valid: false })
    mockParseRequest.mockImplementation(async (_contract, _request, context) => ({
      success: true,
      data: { params: await context.params },
    }))
    mockValidateWorkflowPermissions.mockResolvedValue({ error: null })
    mockLoadDeployedWorkflowState.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
    })
  })

  it('authenticates session requests before validating route params', async () => {
    mockGetSession.mockResolvedValueOnce(null)
    const unreadableParams = {
      then: () => {
        throw new Error('params should not be read')
      },
    } as unknown as Promise<{ id: string }>

    const response = await GET(new NextRequest('http://localhost/api/workflows/wf-1/deployed'), {
      params: unreadableParams,
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockValidateWorkflowPermissions).not.toHaveBeenCalled()
  })

  it('verifies internal bearer tokens before validating route params', async () => {
    mockVerifyInternalToken.mockResolvedValueOnce({ valid: true })

    const request = new NextRequest('http://localhost/api/workflows/wf-1/deployed', {
      headers: { authorization: 'Bearer internal-token' },
    })
    const response = await GET(request, { params: Promise.resolve({ id: 'wf-1' }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      deployedState: {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        variables: {},
      },
    })
    expect(mockVerifyInternalToken).toHaveBeenCalledWith('internal-token')
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockValidateWorkflowPermissions).not.toHaveBeenCalled()
    expect(mockParseRequest).toHaveBeenCalledWith(expect.any(Object), request, {
      params: expect.any(Promise),
    })
  })

  it('loads deployed state after session access validation', async () => {
    const request = new NextRequest('http://localhost/api/workflows/wf-1/deployed')
    const response = await GET(request, { params: Promise.resolve({ id: 'wf-1' }) })

    expect(response.status).toBe(200)
    expect(mockValidateWorkflowPermissions).toHaveBeenCalledWith('wf-1', expect.any(String), 'read')
    expect(mockLoadDeployedWorkflowState).toHaveBeenCalledWith('wf-1')
  })
})
