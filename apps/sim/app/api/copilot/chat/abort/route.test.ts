/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAbortActiveStream,
  mockAuthenticateCopilotRequestSessionOnly,
  mockFetchGo,
  mockGetLatestRunForStream,
  mockLogger,
  mockWaitForPendingChatStream,
} = vi.hoisted(() => ({
  mockAbortActiveStream: vi.fn(),
  mockAuthenticateCopilotRequestSessionOnly: vi.fn(),
  mockFetchGo: vi.fn(),
  mockGetLatestRunForStream: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockWaitForPendingChatStream: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  getLatestRunForStream: mockGetLatestRunForStream,
}))

vi.mock('@/lib/copilot/request/go/fetch', () => ({
  fetchGo: mockFetchGo,
}))

vi.mock('@/lib/copilot/request/http', () => ({
  authenticateCopilotRequestSessionOnly: mockAuthenticateCopilotRequestSessionOnly,
}))

vi.mock('@/lib/copilot/request/otel', () => ({
  withCopilotSpan: vi.fn(
    async (
      _spanName: unknown,
      _attributes: unknown,
      handler: (span: {
        setAttribute: ReturnType<typeof vi.fn>
        setAttributes: ReturnType<typeof vi.fn>
      }) => unknown
    ) => handler({ setAttribute: vi.fn(), setAttributes: vi.fn() })
  ),
  withIncomingGoSpan: vi.fn(
    async (
      _headers: unknown,
      _spanName: unknown,
      _attributes: unknown,
      handler: (span: {
        setAttribute: ReturnType<typeof vi.fn>
        setAttributes: ReturnType<typeof vi.fn>
      }) => unknown
    ) => handler({ setAttribute: vi.fn(), setAttributes: vi.fn() })
  ),
}))

vi.mock('@/lib/copilot/request/session', () => ({
  abortActiveStream: mockAbortActiveStream,
  waitForPendingChatStream: mockWaitForPendingChatStream,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: { COPILOT_API_KEY: '' },
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))

import { POST } from '@/app/api/copilot/chat/abort/route'

function createAbortRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/copilot/chat/abort', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/copilot/chat/abort', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    mockAbortActiveStream.mockResolvedValue(true)
    mockFetchGo.mockResolvedValue(new Response('{}', { status: 200 }))
    mockGetLatestRunForStream.mockResolvedValue(null)
    mockWaitForPendingChatStream.mockResolvedValue(true)
  })

  it('logs stream id, chat id, local abort, Go marker, and settle result', async () => {
    const response = await POST(createAbortRequest({ streamId: 'stream-1', chatId: 'chat-1' }))

    await expect(response.json()).resolves.toEqual({ aborted: true, settled: true })
    expect(mockAbortActiveStream).toHaveBeenCalledWith('stream-1')
    expect(mockWaitForPendingChatStream).toHaveBeenCalledWith('chat-1', 8000, 'stream-1')
    expect(mockLogger.info).toHaveBeenCalledWith('Copilot chat abort requested', {
      streamId: 'stream-1',
      chatId: 'chat-1',
      reason: 'user_stop',
      localAborted: true,
    })
    expect(mockLogger.info).toHaveBeenCalledWith('Copilot chat abort settled', {
      streamId: 'stream-1',
      chatId: 'chat-1',
      reason: 'user_stop',
      localAborted: true,
      goAbortOk: true,
      settled: true,
    })
  })

  it('resolves chat id from the latest stream run before logging settle', async () => {
    mockGetLatestRunForStream.mockResolvedValue({ chatId: 'resolved-chat-1' })

    const response = await POST(createAbortRequest({ streamId: 'stream-1' }))

    await expect(response.json()).resolves.toEqual({ aborted: true, settled: true })
    expect(mockGetLatestRunForStream).toHaveBeenCalledWith('stream-1', 'user-1')
    expect(mockWaitForPendingChatStream).toHaveBeenCalledWith('resolved-chat-1', 8000, 'stream-1')
    expect(mockLogger.info).toHaveBeenCalledWith('Copilot chat abort settled', {
      streamId: 'stream-1',
      chatId: 'resolved-chat-1',
      reason: 'user_stop',
      localAborted: true,
      goAbortOk: true,
      settled: true,
    })
  })

  it('logs a stream-only abort when no chat id can be resolved', async () => {
    const response = await POST(createAbortRequest({ streamId: 'stream-1' }))

    await expect(response.json()).resolves.toEqual({ aborted: true })
    expect(mockGetLatestRunForStream).toHaveBeenCalledWith('stream-1', 'user-1')
    expect(mockWaitForPendingChatStream).not.toHaveBeenCalled()
    expect(mockLogger.info).toHaveBeenCalledWith('Copilot chat abort completed without chat id', {
      streamId: 'stream-1',
      reason: 'user_stop',
      localAborted: true,
      goAbortOk: true,
      settled: null,
    })
  })
})
