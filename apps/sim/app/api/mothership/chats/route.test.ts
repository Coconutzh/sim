/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticateCopilotRequestSessionOnly,
  mockParseRequest,
  mockAssertActiveWorkspaceAccess,
  mockIsActiveWorkspaceAccessError,
  mockSelect,
  mockFrom,
  mockWhere,
  mockOrderBy,
  mockInsert,
  mockValues,
  mockReturning,
  mockPublishStatusChanged,
  mockCaptureServerEvent,
} = vi.hoisted(() => ({
  mockAuthenticateCopilotRequestSessionOnly: vi.fn(),
  mockParseRequest: vi.fn(),
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockIsActiveWorkspaceAccessError: vi.fn(),
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockOrderBy: vi.fn(),
  mockInsert: vi.fn(),
  mockValues: vi.fn(),
  mockReturning: vi.fn(),
  mockPublishStatusChanged: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
  },
}))

vi.mock('@sim/db/schema', () => ({
  copilotChats: {
    id: 'copilotChats.id',
    title: 'copilotChats.title',
    updatedAt: 'copilotChats.updatedAt',
    conversationId: 'copilotChats.conversationId',
    lastSeenAt: 'copilotChats.lastSeenAt',
    workspaceId: 'copilotChats.workspaceId',
    type: 'copilotChats.type',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  desc: vi.fn((field: unknown) => ({ type: 'desc', field })),
  eq: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
}))

vi.mock('@/lib/copilot/request/http', () => ({
  authenticateCopilotRequestSessionOnly: mockAuthenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse: (message: string) =>
    Response.json({ error: message }, { status: 500 }),
  createUnauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@/lib/api/contracts/mothership-tasks', () => ({
  createMothershipChatContract: {},
  listMothershipChatsContract: {},
}))

vi.mock('@/lib/copilot/tasks', () => ({
  taskPubSub: {
    publishStatusChanged: mockPublishStatusChanged,
  },
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  assertActiveWorkspaceAccess: mockAssertActiveWorkspaceAccess,
  isActiveWorkspaceAccessError: mockIsActiveWorkspaceAccessError,
}))

import { GET, POST } from './route'

describe('mothership chats route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: {
        query: { workspaceId: 'ws-1' },
        body: { workspaceId: 'ws-1' },
      },
    })
    mockAssertActiveWorkspaceAccess.mockResolvedValue(undefined)
    mockIsActiveWorkspaceAccessError.mockReturnValue(false)
    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ orderBy: mockOrderBy })
    mockOrderBy.mockResolvedValue([])
    mockInsert.mockReturnValue({ values: mockValues })
    mockValues.mockReturnValue({ returning: mockReturning })
    mockReturning.mockResolvedValue([{ id: 'chat-new' }])
  })

  it('hides foreign personal workspace chat listings behind 404', async () => {
    const hiddenError = new Error('hidden workspace')
    mockAssertActiveWorkspaceAccess.mockRejectedValueOnce(hiddenError)
    mockIsActiveWorkspaceAccessError.mockReturnValueOnce(true)

    const response = await GET(
      new NextRequest('http://localhost:3000/api/mothership/chats?workspaceId=ws-hidden')
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
    expect(mockOrderBy).not.toHaveBeenCalled()
  })

  it('hides foreign personal workspace chat creation behind 404', async () => {
    const hiddenError = new Error('hidden workspace')
    mockAssertActiveWorkspaceAccess.mockRejectedValueOnce(hiddenError)
    mockIsActiveWorkspaceAccessError.mockReturnValueOnce(true)
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: { body: { workspaceId: 'ws-hidden' } },
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/mothership/chats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'ws-hidden' }),
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
    expect(mockReturning).not.toHaveBeenCalled()
    expect(mockPublishStatusChanged).not.toHaveBeenCalled()
  })
})
