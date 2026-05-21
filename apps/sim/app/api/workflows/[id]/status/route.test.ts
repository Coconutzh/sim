/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckHybridAuth,
  mockParseRequest,
  mockValidateWorkflowAccess,
  mockCheckNeedsRedeployment,
} = vi.hoisted(() => ({
  mockCheckHybridAuth: vi.fn(),
  mockParseRequest: vi.fn(async (_contract, _request, context) => ({
    success: true,
    data: { params: await context.params },
  })),
  mockValidateWorkflowAccess: vi.fn(),
  mockCheckNeedsRedeployment: vi.fn(),
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

vi.mock('@/app/api/workflows/utils', () => ({
  checkNeedsRedeployment: mockCheckNeedsRedeployment,
  createErrorResponse: (message: string, status: number) =>
    Response.json({ error: message }, { status }),
  createSuccessResponse: (data: unknown) => Response.json(data),
}))

import { GET } from '@/app/api/workflows/[id]/status/route'

describe('GET /api/workflows/[id]/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckHybridAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockParseRequest.mockImplementation(async (_contract, _request, context) => ({
      success: true,
      data: { params: await context.params },
    }))
    mockValidateWorkflowAccess.mockResolvedValue({
      workflow: {
        isDeployed: true,
        deployedAt: '2026-01-01T00:00:00.000Z',
        publishedAt: null,
      },
    })
    mockCheckNeedsRedeployment.mockResolvedValue(false)
  })

  it('authenticates before validating route params', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({ success: false, error: 'Unauthorized' })
    const unreadableParams = {
      then: () => {
        throw new Error('params should not be read')
      },
    } as unknown as Promise<{ id: string }>

    const response = await GET(new NextRequest('http://localhost/api/workflows/wf-1/status'), {
      params: unreadableParams,
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockValidateWorkflowAccess).not.toHaveBeenCalled()
  })

  it('returns deployment status after access validation', async () => {
    const request = new NextRequest('http://localhost/api/workflows/wf-1/status')
    const response = await GET(request, { params: Promise.resolve({ id: 'wf-1' }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      isDeployed: true,
      deployedAt: '2026-01-01T00:00:00.000Z',
      isPublished: false,
      needsRedeployment: false,
    })
    expect(mockValidateWorkflowAccess).toHaveBeenCalledWith(request, 'wf-1', false)
    expect(mockCheckNeedsRedeployment).toHaveBeenCalledWith('wf-1')
  })
})
