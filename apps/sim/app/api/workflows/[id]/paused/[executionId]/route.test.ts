/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckHybridAuth,
  mockParseRequest,
  mockValidateWorkflowAccess,
  mockGetPausedExecutionDetail,
} = vi.hoisted(() => ({
  mockCheckHybridAuth: vi.fn(),
  mockParseRequest: vi.fn(async (_contract, _request, context) => ({
    success: true,
    data: { params: await context.params },
  })),
  mockValidateWorkflowAccess: vi.fn(),
  mockGetPausedExecutionDetail: vi.fn(),
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

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => ({
  PauseResumeManager: {
    getPausedExecutionDetail: mockGetPausedExecutionDetail,
  },
}))

import { GET } from '@/app/api/workflows/[id]/paused/[executionId]/route'

describe('GET /api/workflows/[id]/paused/[executionId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckHybridAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockParseRequest.mockImplementation(async (_contract, _request, context) => ({
      success: true,
      data: { params: await context.params },
    }))
    mockValidateWorkflowAccess.mockResolvedValue({
      workflow: { id: 'wf-1' },
      auth: { success: true, userId: 'user-1' },
    })
    mockGetPausedExecutionDetail.mockResolvedValue({ executionId: 'exec-1' })
  })

  it('authenticates before validating route params', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({ success: false, error: 'Unauthorized' })
    const unreadableParams = {
      then: () => {
        throw new Error('params should not be read')
      },
    } as unknown as Promise<{ id: string; executionId: string }>

    const response = await GET(
      new NextRequest('http://localhost/api/workflows/wf-1/paused/exec-1'),
      { params: unreadableParams }
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockValidateWorkflowAccess).not.toHaveBeenCalled()
  })

  it('returns paused execution detail after access validation', async () => {
    const request = new NextRequest('http://localhost/api/workflows/wf-1/paused/exec-1')
    const response = await GET(request, {
      params: Promise.resolve({ id: 'wf-1', executionId: 'exec-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ executionId: 'exec-1' })
    expect(mockValidateWorkflowAccess).toHaveBeenCalledWith(request, 'wf-1', false)
    expect(mockGetPausedExecutionDetail).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      executionId: 'exec-1',
    })
  })
})
