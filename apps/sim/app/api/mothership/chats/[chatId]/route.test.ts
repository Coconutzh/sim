/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticateCopilotRequestSessionOnly,
  mockGetAccessibleMothershipChat,
  mockUpdateWhere,
  mockUpdateReturning,
} = vi.hoisted(() => ({
  mockAuthenticateCopilotRequestSessionOnly: vi.fn(),
  mockGetAccessibleMothershipChat: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockUpdateReturning: vi.fn(),
}))

vi.mock('@/lib/copilot/request/http', () => ({
  authenticateCopilotRequestSessionOnly: mockAuthenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse: (message: string) =>
    Response.json({ error: message }, { status: 500 }),
  createUnauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}))

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  getAccessibleMothershipChat: mockGetAccessibleMothershipChat,
}))

vi.mock('@sim/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: mockUpdateReturning,
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
  },
}))

vi.mock('@sim/db/schema', () => ({
  copilotChats: {
    id: 'copilotChats.id',
    type: 'copilotChats.type',
    workspaceId: 'copilotChats.workspaceId',
    updatedAt: 'copilotChats.updatedAt',
  },
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  getLatestRunForStream: vi.fn(),
}))

vi.mock('@/lib/copilot/chat/effective-transcript', () => ({
  buildEffectiveChatTranscript: vi.fn(),
}))

vi.mock('@/lib/copilot/chat/persisted-message', () => ({
  normalizeMessage: vi.fn(),
}))

vi.mock('@/lib/copilot/request/session/buffer', () => ({
  readEvents: vi.fn(),
}))

vi.mock('@/lib/copilot/request/session/file-preview-session', () => ({
  readFilePreviewSessions: vi.fn(),
}))

vi.mock('@/lib/copilot/request/session/types', () => ({
  toStreamBatchEvent: vi.fn(),
}))

vi.mock('@/lib/copilot/tasks', () => ({
  taskPubSub: {
    publishStatusChanged: vi.fn(),
  },
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

import { PATCH } from './route'

function createPatchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/mothership/chats/chat-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Mothership chat PATCH route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'viewer-1',
      isAuthenticated: true,
    })
    mockUpdateWhere.mockResolvedValue(undefined)
    mockUpdateReturning.mockResolvedValue([{ id: 'chat-1', workspaceId: 'ws-1' }])
  })

  it('returns 404 when the chat is not accessible to the viewer', async () => {
    mockGetAccessibleMothershipChat.mockResolvedValueOnce(null)

    const response = await PATCH(createPatchRequest({ title: 'Renamed task' }), {
      params: Promise.resolve({ chatId: 'chat-1' }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Chat not found',
    })
    expect(mockUpdateReturning).not.toHaveBeenCalled()
  })

  it('allows a workspace member to rename another users mothership chat', async () => {
    mockGetAccessibleMothershipChat.mockResolvedValueOnce({
      id: 'chat-1',
      userId: 'creator-1',
      workspaceId: 'ws-1',
      updatedAt: new Date('2026-05-20T00:00:00Z'),
    })

    const response = await PATCH(createPatchRequest({ title: 'Renamed task' }), {
      params: Promise.resolve({ chatId: 'chat-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(mockGetAccessibleMothershipChat).toHaveBeenCalledWith('chat-1', 'viewer-1')
    expect(mockUpdateReturning).toHaveBeenCalled()
  })
})
