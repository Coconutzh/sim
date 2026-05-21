/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckSessionOrInternalAuth, mockParseRequest } = vi.hoisted(() => ({
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockParseRequest: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

import { POST } from '@/app/api/tools/thinking/route'

describe('POST /api/tools/thinking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: { body: { thought: 'check the plan' } },
    })
  })

  it('authenticates before validating the thinking request body', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
    })

    const request = new NextRequest('http://localhost/api/tools/thinking', { method: 'POST' })
    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockCheckSessionOrInternalAuth).toHaveBeenCalledWith(request)
    expect(mockParseRequest).not.toHaveBeenCalled()
  })

  it('validates and acknowledges the thought after authentication', async () => {
    const request = new NextRequest('http://localhost/api/tools/thinking', { method: 'POST' })
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      output: { acknowledgedThought: 'check the plan' },
    })
    expect(mockParseRequest).toHaveBeenCalledWith(expect.any(Object), request, {})
    expect(mockCheckSessionOrInternalAuth.mock.invocationCallOrder[0]).toBeLessThan(
      mockParseRequest.mock.invocationCallOrder[0]
    )
  })
})
