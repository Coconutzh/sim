/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthenticateCopilotRequestSessionOnly, mockParseRequest, mockRouteExecution } =
  vi.hoisted(() => ({
    mockAuthenticateCopilotRequestSessionOnly: vi.fn(),
    mockParseRequest: vi.fn(),
    mockRouteExecution: vi.fn(),
  }))

vi.mock('@/lib/copilot/request/http', () => ({
  authenticateCopilotRequestSessionOnly: mockAuthenticateCopilotRequestSessionOnly,
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@/lib/copilot/tools/server/router', () => ({
  routeExecution: mockRouteExecution,
}))

import { GET } from '@/app/api/copilot/credentials/route'

describe('Copilot credentials route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('authenticates credential reads before validating query parameters', async () => {
    mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
      userId: null,
      isAuthenticated: false,
    })

    const response = await GET(new NextRequest('http://localhost/api/copilot/credentials'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockRouteExecution).not.toHaveBeenCalled()
  })

  it('loads credentials after authentication and contract validation', async () => {
    mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
      userId: 'user-1',
      isAuthenticated: true,
    })
    mockParseRequest.mockResolvedValueOnce({ success: true, data: { query: {} } })
    mockRouteExecution.mockResolvedValueOnce([{ id: 'cred-1' }])

    const request = new NextRequest('http://localhost/api/copilot/credentials')
    const response = await GET(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      result: [{ id: 'cred-1' }],
    })
    expect(mockParseRequest).toHaveBeenCalledWith(expect.any(Object), request, {})
    expect(mockRouteExecution).toHaveBeenCalledWith('get_credentials', {}, { userId: 'user-1' })
  })
})
