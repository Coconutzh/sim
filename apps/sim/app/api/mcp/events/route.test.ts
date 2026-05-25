/**
 * Tests for MCP SSE events endpoint
 *
 * @vitest-environment node
 */
import { authMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function createNextRequest(url: string): NextRequest {
  return new NextRequest(new URL(url))
}

const mockCheckWorkspaceAccess = permissionsMockFns.mockCheckWorkspaceAccess

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/events/sse-endpoint', () => ({
  createWorkspaceSSE: (_config: any) => {
    return async (request: any) => {
      const session = await authMockFns.mockGetSession()
      if (!session?.user?.id) {
        return new Response('Unauthorized', { status: 401 })
      }
      const url = new URL(request.url)
      const workspaceId = url.searchParams.get('workspaceId')
      if (!workspaceId) {
        return new Response('Missing workspaceId query parameter', { status: 400 })
      }
      const access = await mockCheckWorkspaceAccess(workspaceId, session.user.id)
      if (!access.exists || !access.hasAccess) {
        return new Response('Canvas not found', { status: 404 })
      }
      return new Response(new ReadableStream({ start() {} }), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }
  },
}))

vi.mock('@/lib/mcp/connection-manager', () => ({
  mcpConnectionManager: null,
}))

vi.mock('@/lib/mcp/pubsub', () => ({
  mcpPubSub: null,
}))

import { GET } from './route'

const defaultMockUser = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
}

describe('MCP Events SSE Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when session is missing', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const request = createNextRequest('http://localhost:3000/api/mcp/events?workspaceId=ws-123')

    const response = await GET(request)

    expect(response.status).toBe(401)
    const text = await response.text()
    expect(text).toBe('Unauthorized')
  })

  it('returns 400 when workspaceId is missing', async () => {
    authMockFns.mockGetSession.mockResolvedValue({ user: defaultMockUser })

    const request = createNextRequest('http://localhost:3000/api/mcp/events')

    const response = await GET(request)

    expect(response.status).toBe(400)
    const text = await response.text()
    expect(text).toBe('Missing workspaceId query parameter')
  })

  it('returns 404 when user lacks workspace access', async () => {
    authMockFns.mockGetSession.mockResolvedValue({ user: defaultMockUser })
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-123' },
    })

    const request = createNextRequest('http://localhost:3000/api/mcp/events?workspaceId=ws-123')

    const response = await GET(request)

    expect(response.status).toBe(404)
    const text = await response.text()
    expect(text).toBe('Canvas not found')
    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-123', 'user-123')
  })

  it('returns SSE stream when authorized', async () => {
    authMockFns.mockGetSession.mockResolvedValue({ user: defaultMockUser })
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-123' },
    })

    const request = createNextRequest('http://localhost:3000/api/mcp/events?workspaceId=ws-123')

    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
    expect(response.headers.get('Connection')).toBe('keep-alive')
  })
})
