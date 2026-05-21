/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthenticateCopilotRequestSessionOnly, mockParseRequest, mockFetchGo } = vi.hoisted(
  () => ({
    mockAuthenticateCopilotRequestSessionOnly: vi.fn(),
    mockParseRequest: vi.fn(),
    mockFetchGo: vi.fn(),
  })
)

vi.mock('@/lib/copilot/request/http', () => ({
  authenticateCopilotRequestSessionOnly: mockAuthenticateCopilotRequestSessionOnly,
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@/lib/copilot/request/go/fetch', () => ({
  fetchGo: mockFetchGo,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {},
}))

vi.mock('@/providers/models', () => ({
  DYNAMIC_MODEL_PROVIDERS: [],
  PROVIDER_DEFINITIONS: {},
}))

import { GET } from '@/app/api/copilot/models/route'

describe('Copilot models route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('authenticates model reads before validating query parameters', async () => {
    mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
      userId: null,
      isAuthenticated: false,
    })

    const response = await GET(new NextRequest('http://localhost/api/copilot/models'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockFetchGo).not.toHaveBeenCalled()
  })

  it('loads models after authentication and contract validation', async () => {
    mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
      userId: 'user-1',
      isAuthenticated: true,
    })
    mockParseRequest.mockResolvedValueOnce({ success: true, data: { query: {} } })
    mockFetchGo.mockResolvedValueOnce(
      Response.json({ models: [{ id: 'model-1', friendlyName: 'Model 1', provider: 'provider' }] })
    )

    const request = new NextRequest('http://localhost/api/copilot/models')
    const response = await GET(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      models: [{ id: 'model-1', friendlyName: 'Model 1', provider: 'provider' }],
    })
    expect(mockParseRequest).toHaveBeenCalledWith(expect.any(Object), request, {})
    expect(mockFetchGo).toHaveBeenCalled()
  })
})
