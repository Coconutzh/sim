/**
 * Tests for copilot chats list API route
 *
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelectDistinctOn,
  mockFrom,
  mockLeftJoin,
  mockWhere,
  mockOrderBy,
  mockEq,
  mockInArray,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockAssertActiveWorkspaceAccess,
  mockIsActiveWorkspaceAccessError,
  mockListAccessibleWorkspaceIds,
  mockResolveOrCreateChat,
  mockPublishStatusChanged,
} = vi.hoisted(() => ({
  mockSelectDistinctOn: vi.fn(),
  mockFrom: vi.fn(),
  mockLeftJoin: vi.fn(),
  mockWhere: vi.fn(),
  mockOrderBy: vi.fn(),
  mockEq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  mockInArray: vi.fn((field: unknown, value: unknown[]) => ({ field, value, type: 'inArray' })),
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockIsActiveWorkspaceAccessError: vi.fn(),
  mockListAccessibleWorkspaceIds: vi.fn(),
  mockResolveOrCreateChat: vi.fn(),
  mockPublishStatusChanged: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    selectDistinctOn: mockSelectDistinctOn,
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: mockEq,
  inArray: mockInArray,
  or: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' })),
  isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
  desc: vi.fn((field: unknown) => ({ field, type: 'desc' })),
  sql: vi.fn(),
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)
vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  assertActiveWorkspaceAccess: mockAssertActiveWorkspaceAccess,
  isActiveWorkspaceAccessError: mockIsActiveWorkspaceAccessError,
  listAccessibleWorkspaceIds: mockListAccessibleWorkspaceIds,
}))
vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  resolveOrCreateChat: mockResolveOrCreateChat,
}))
vi.mock('@/lib/copilot/tasks', () => ({
  taskPubSub: {
    publishStatusChanged: mockPublishStatusChanged,
  },
}))

import { GET, POST } from '@/app/api/copilot/chats/route'

describe('Copilot Chats List API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockSelectDistinctOn.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ leftJoin: mockLeftJoin })
    mockLeftJoin.mockReturnValue({ leftJoin: mockLeftJoin, where: mockWhere })
    mockWhere.mockReturnValue({ orderBy: mockOrderBy })
    mockOrderBy.mockResolvedValue([])
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      accessSource: 'workspace',
      workflow: { workspaceId: 'ws-1' },
    })
    mockAssertActiveWorkspaceAccess.mockResolvedValue(undefined)
    mockIsActiveWorkspaceAccessError.mockReturnValue(false)
    mockListAccessibleWorkspaceIds.mockResolvedValue(['ws-1'])
    mockResolveOrCreateChat.mockResolvedValue({ chatId: 'chat-new' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET', () => {
    it('should return 401 when user is not authenticated', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: null,
        isAuthenticated: false,
      })

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return empty chats array when user has no chats', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockOrderBy.mockResolvedValueOnce([])

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        chats: [],
      })
    })

    it('should return list of chats for authenticated user', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const mockChats = [
        {
          id: 'chat-1',
          title: 'First Chat',
          workflowId: 'workflow-1',
          updatedAt: new Date('2024-01-02'),
        },
        {
          id: 'chat-2',
          title: 'Second Chat',
          workflowId: 'workflow-2',
          updatedAt: new Date('2024-01-01'),
        },
      ]
      mockOrderBy.mockResolvedValueOnce(mockChats)

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.success).toBe(true)
      expect(responseData.chats).toHaveLength(2)
      expect(responseData.chats[0].id).toBe('chat-1')
      expect(responseData.chats[0].title).toBe('First Chat')
      expect(responseData.chats[1].id).toBe('chat-2')
    })

    it('should return chats ordered by updatedAt descending', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const mockChats = [
        {
          id: 'newest-chat',
          title: 'Newest',
          workflowId: 'workflow-1',
          updatedAt: new Date('2024-01-10'),
        },
        {
          id: 'older-chat',
          title: 'Older',
          workflowId: 'workflow-2',
          updatedAt: new Date('2024-01-05'),
        },
        {
          id: 'oldest-chat',
          title: 'Oldest',
          workflowId: 'workflow-3',
          updatedAt: new Date('2024-01-01'),
        },
      ]
      mockOrderBy.mockResolvedValueOnce(mockChats)

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.chats[0].id).toBe('newest-chat')
      expect(responseData.chats[2].id).toBe('oldest-chat')
    })

    it('should handle chats with null workflowId', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const mockChats = [
        {
          id: 'chat-no-workflow',
          title: 'Chat without workflow',
          workflowId: null,
          updatedAt: new Date('2024-01-01'),
        },
      ]
      mockOrderBy.mockResolvedValueOnce(mockChats)

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.chats[0].workflowId).toBeNull()
    })

    it('should handle database errors gracefully', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockOrderBy.mockRejectedValueOnce(new Error('Database connection failed'))

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to fetch user chats')
    })

    it('should only return chats belonging to authenticated user', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const mockChats = [
        {
          id: 'my-chat',
          title: 'My Chat',
          workflowId: 'workflow-1',
          updatedAt: new Date('2024-01-01'),
        },
      ]
      mockOrderBy.mockResolvedValueOnce(mockChats)

      const request = new Request('http://localhost:3000/api/copilot/chats')
      await GET(request as any)

      expect(mockSelectDistinctOn).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
    })

    it('filters visible chats through accessible workspace ids', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'owner-123',
        isAuthenticated: true,
      })
      mockListAccessibleWorkspaceIds.mockResolvedValueOnce(['ws-owner', 'ws-team'])

      const request = new Request('http://localhost:3000/api/copilot/chats')
      await GET(request as any)

      expect(mockWhere).toHaveBeenCalled()
      expect(mockInArray).toHaveBeenCalledWith('id', ['ws-owner', 'ws-team'])
    })

    it('should return 401 when userId is null despite isAuthenticated being true', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: null,
        isAuthenticated: true,
      })

      const request = new Request('http://localhost:3000/api/copilot/chats')
      const response = await GET(request as any)

      expect(response.status).toBe(401)
    })
  })

  describe('POST', () => {
    it('rejects published workflow readers from creating workflow copilot chats', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: true,
        status: 200,
        accessSource: 'published',
        workflow: { workspaceId: 'ws-1' },
      })

      const request = new NextRequest('http://localhost:3000/api/copilot/chats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'ws-1',
          workflowId: 'wf-1',
        }),
      })
      const response = await POST(request as any)
      const responseData = await response.json()

      expect(response.status).toBe(403)
      expect(responseData).toEqual({
        success: false,
        error: 'Canvas access required',
      })
      expect(mockResolveOrCreateChat).not.toHaveBeenCalled()
    })

    it('hides foreign personal workspace copilot chat creation behind 404', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })
      const hiddenError = new Error('hidden workspace')
      mockAssertActiveWorkspaceAccess.mockRejectedValueOnce(hiddenError)
      mockIsActiveWorkspaceAccessError.mockReturnValueOnce(true)

      const request = new NextRequest('http://localhost:3000/api/copilot/chats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'ws-hidden',
          workflowId: 'wf-1',
        }),
      })
      const response = await POST(request as any)

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
      expect(mockAuthorizeWorkflowByWorkspacePermission).not.toHaveBeenCalled()
      expect(mockResolveOrCreateChat).not.toHaveBeenCalled()
    })

    it('hides foreign personal workflow copilot chat creation behind 404', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: false,
        status: 404,
        message: 'Workflow not found',
      })

      const request = new NextRequest('http://localhost:3000/api/copilot/chats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'ws-1',
          workflowId: 'wf-hidden',
        }),
      })
      const response = await POST(request as any)

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({ error: 'Workflow not found' })
      expect(mockResolveOrCreateChat).not.toHaveBeenCalled()
    })
  })
})
