/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticateCopilotRequestSessionOnly,
  mockParseRequest,
  mockGetChat,
  mockHandleUnifiedChatPost,
} = vi.hoisted(() => ({
  mockAuthenticateCopilotRequestSessionOnly: vi.fn(),
  mockParseRequest: vi.fn(),
  mockGetChat: vi.fn(),
  mockHandleUnifiedChatPost: vi.fn(),
}))

vi.mock('@/lib/copilot/request/http', () => ({
  authenticateCopilotRequestSessionOnly: mockAuthenticateCopilotRequestSessionOnly,
  createUnauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@/lib/copilot/chat/post', () => ({
  handleUnifiedChatPost: mockHandleUnifiedChatPost,
  maxDuration: 60,
}))

vi.mock('@/app/api/copilot/chat/queries', () => ({
  GET: mockGetChat,
}))

import { GET } from '@/app/api/copilot/chat/route'

describe('Copilot chat route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('authenticates chat reads before validating query parameters', async () => {
    mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
      userId: null,
      isAuthenticated: false,
    })

    const response = await GET(new NextRequest('http://localhost/api/copilot/chat'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockGetChat).not.toHaveBeenCalled()
  })

  it('delegates authenticated chat reads after contract validation', async () => {
    mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
      userId: 'user-1',
      isAuthenticated: true,
    })
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: { query: { chatId: 'chat-1' } },
    })
    mockGetChat.mockResolvedValueOnce(Response.json({ success: true }))

    const request = new NextRequest('http://localhost/api/copilot/chat?chatId=chat-1')
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(mockParseRequest).toHaveBeenCalledWith(expect.any(Object), request, {})
    expect(mockGetChat).toHaveBeenCalledWith(request)
  })
})
