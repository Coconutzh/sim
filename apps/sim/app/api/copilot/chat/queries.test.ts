/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticateCopilotRequestSessionOnly,
  mockGetAccessibleCopilotChat,
  mockReadEvents,
  mockReadFilePreviewSessions,
  mockGetLatestRunForStream,
  mockBuildEffectiveChatTranscript,
  mockNormalizeMessage,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockIsActiveWorkspaceAccessError,
  mockAssertActiveWorkspaceAccess,
  mockSelect,
  mockFrom,
  mockWhere,
  mockOrderBy,
} = vi.hoisted(() => ({
  mockAuthenticateCopilotRequestSessionOnly: vi.fn(),
  mockGetAccessibleCopilotChat: vi.fn(),
  mockReadEvents: vi.fn(),
  mockReadFilePreviewSessions: vi.fn(),
  mockGetLatestRunForStream: vi.fn(),
  mockBuildEffectiveChatTranscript: vi.fn(),
  mockNormalizeMessage: vi.fn((message: unknown) => message),
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockIsActiveWorkspaceAccessError: vi.fn(),
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockOrderBy: vi.fn(),
}))

vi.mock('@/lib/copilot/request/http', () => ({
  authenticateCopilotRequestSessionOnly: mockAuthenticateCopilotRequestSessionOnly,
  createBadRequestResponse: (message: string) => Response.json({ error: message }, { status: 400 }),
  createNotFoundResponse: (message: string) => Response.json({ error: message }, { status: 404 }),
  createInternalServerErrorResponse: (message: string) =>
    Response.json({ error: message }, { status: 500 }),
  createUnauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}))

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  getAccessibleCopilotChat: mockGetAccessibleCopilotChat,
}))

vi.mock('@/lib/copilot/request/session/buffer', () => ({
  readEvents: mockReadEvents,
}))

vi.mock('@/lib/copilot/request/session', () => ({
  readFilePreviewSessions: mockReadFilePreviewSessions,
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  getLatestRunForStream: mockGetLatestRunForStream,
}))

vi.mock('@/lib/copilot/chat/effective-transcript', () => ({
  buildEffectiveChatTranscript: mockBuildEffectiveChatTranscript,
}))

vi.mock('@/lib/copilot/chat/persisted-message', () => ({
  normalizeMessage: mockNormalizeMessage,
}))

vi.mock('@/lib/copilot/request/session/types', () => ({
  toStreamBatchEvent: vi.fn((event: unknown) => event),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  copilotChats: {},
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  assertActiveWorkspaceAccess: mockAssertActiveWorkspaceAccess,
  isActiveWorkspaceAccessError: mockIsActiveWorkspaceAccessError,
}))

import { GET } from './queries'

describe('copilot chat queries GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'viewer-1',
      isAuthenticated: true,
    })
    mockBuildEffectiveChatTranscript.mockImplementation(
      ({ messages }: { messages: unknown[] }) => messages
    )
    mockReadEvents.mockResolvedValue([])
    mockReadFilePreviewSessions.mockResolvedValue([])
    mockGetLatestRunForStream.mockResolvedValue(null)
    mockAssertActiveWorkspaceAccess.mockResolvedValue(undefined)
    mockIsActiveWorkspaceAccessError.mockReturnValue(false)
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      accessSource: 'workspace',
      workflow: { workspaceId: 'ws-1' },
    })
    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ orderBy: mockOrderBy })
    mockOrderBy.mockResolvedValue([])
  })

  it('allows workspace member access for the legacy mothership alias path', async () => {
    mockGetAccessibleCopilotChat.mockResolvedValueOnce({
      id: 'chat-legacy',
      title: 'Legacy task',
      model: 'claude-opus-4-6',
      messages: [],
      conversationId: null,
      resources: [],
      createdAt: new Date('2026-05-21T00:00:00Z'),
      updatedAt: new Date('2026-05-21T00:00:00Z'),
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/mothership/chat?chatId=chat-legacy')
    )

    expect(response.status).toBe(200)
    expect(mockGetAccessibleCopilotChat).toHaveBeenCalledWith('chat-legacy', 'viewer-1', {
      allowWorkspaceMembers: true,
    })
  })

  it('keeps the regular copilot route on owner-only semantics', async () => {
    mockGetAccessibleCopilotChat.mockResolvedValueOnce({
      id: 'chat-1',
      title: 'Personal chat',
      model: 'claude-opus-4-6',
      messages: [],
      conversationId: null,
      resources: [],
      createdAt: new Date('2026-05-21T00:00:00Z'),
      updatedAt: new Date('2026-05-21T00:00:00Z'),
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/copilot/chat?chatId=chat-1')
    )

    expect(response.status).toBe(200)
    expect(mockGetAccessibleCopilotChat).toHaveBeenCalledWith('chat-1', 'viewer-1', {
      allowWorkspaceMembers: false,
    })
  })

  it('rejects workflow chat listings for published workflow readers', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      accessSource: 'published',
      workflow: { workspaceId: 'ws-1' },
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/copilot/chat?workflowId=wf-1')
    )

    expect(response.status).toBe(401)
    expect(mockOrderBy).not.toHaveBeenCalled()
  })

  it('hides foreign personal workflow chat listings behind 404', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/copilot/chat?workflowId=wf-hidden')
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Workflow not found' })
    expect(mockOrderBy).not.toHaveBeenCalled()
  })

  it('hides foreign personal workspace chat queries behind 404', async () => {
    const hiddenError = new Error('hidden workspace')
    mockAssertActiveWorkspaceAccess.mockRejectedValueOnce(hiddenError)
    mockIsActiveWorkspaceAccessError.mockReturnValueOnce(true)

    const response = await GET(
      new NextRequest('http://localhost:3000/api/copilot/chat?workspaceId=ws-hidden')
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
    expect(mockOrderBy).not.toHaveBeenCalled()
  })
})
