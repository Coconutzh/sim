/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetAccessibleMothershipChat, mockGetSession, mockUpdateWhere, mockReturning } =
  vi.hoisted(() => ({
    mockGetAccessibleMothershipChat: vi.fn(),
    mockGetSession: vi.fn(),
    mockUpdateWhere: vi.fn(),
    mockReturning: vi.fn(),
  }))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  getAccessibleMothershipChat: mockGetAccessibleMothershipChat,
}))

vi.mock('@sim/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: mockUpdateWhere,
        returning: mockReturning,
      })),
    })),
  },
}))

vi.mock('@sim/db/schema', () => ({
  copilotChats: {
    id: 'copilotChats.id',
    type: 'copilotChats.type',
    resources: 'copilotChats.resources',
  },
}))

import { POST } from './route'

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/mothership/chat/resources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Mothership chat resources route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'viewer-1' } })
    mockUpdateWhere.mockResolvedValue(undefined)
    mockReturning.mockResolvedValue([{ resources: [] }])
  })

  it('returns 404 when the chat is not accessible to the viewer', async () => {
    mockGetAccessibleMothershipChat.mockResolvedValueOnce(null)

    const response = await POST(
      createRequest({
        chatId: 'chat-1',
        resource: { id: 'file-1', type: 'file', title: 'Spec.pdf' },
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Chat not found or unauthorized',
    })
  })

  it('allows a workspace member to add resources to another users mothership chat', async () => {
    mockGetAccessibleMothershipChat.mockResolvedValueOnce({
      id: 'chat-1',
      userId: 'creator-1',
      workspaceId: 'ws-1',
      resources: [],
    })

    const response = await POST(
      createRequest({
        chatId: 'chat-1',
        resource: { id: 'file-1', type: 'file', title: 'Spec.pdf' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      resources: [{ id: 'file-1', type: 'file', title: 'Spec.pdf' }],
    })
    expect(mockGetAccessibleMothershipChat).toHaveBeenCalledWith('chat-1', 'viewer-1')
    expect(mockUpdateWhere).toHaveBeenCalled()
  })
})
