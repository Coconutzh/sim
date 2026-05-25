/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockCheckWorkspaceAccess } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

import { createWorkspaceSSE } from './sse-endpoint'

describe('createWorkspaceSSE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides foreign personal workspaces behind 404', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'viewer-1' } })
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden' },
    })

    const handler = createWorkspaceSSE({
      label: 'test',
      subscriptions: [],
    })

    const response = await handler(
      new NextRequest('http://localhost:3000/api/test/events?workspaceId=ws-hidden')
    )

    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toBe('Canvas not found')
    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-hidden', 'viewer-1')
  })

  it('opens the stream for visible workspaces', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'viewer-1' } })
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-visible' },
    })

    const handler = createWorkspaceSSE({
      label: 'test',
      subscriptions: [],
    })

    const response = await handler(
      new NextRequest('http://localhost:3000/api/test/events?workspaceId=ws-visible')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
  })
})
