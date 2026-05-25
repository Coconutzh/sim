/**
 * @vitest-environment node
 */
import {
  authMock,
  authMockFns,
  createMockRequest,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockHasInboxAccess } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockHasInboxAccess: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).orderBy = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
  mothershipInboxTask: {
    id: 'id',
    workspaceId: 'workspaceId',
    fromEmail: 'fromEmail',
    fromName: 'fromName',
    subject: 'subject',
    bodyPreview: 'bodyPreview',
    status: 'status',
    hasAttachments: 'hasAttachments',
    resultSummary: 'resultSummary',
    errorMessage: 'errorMessage',
    rejectionReason: 'rejectionReason',
    chatId: 'chatId',
    createdAt: 'createdAt',
    completedAt: 'completedAt',
  },
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/billing/core/subscription', () => ({
  hasInboxAccess: mockHasInboxAccess,
}))

import { GET } from './route'

describe('GET /api/workspaces/[id]/inbox/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' },
    })
    mockHasInboxAccess.mockResolvedValue(true)
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-owner', ownerId: 'owner-1', workspaceMode: 'organization' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')
    mockDbSelect.mockReturnValue(
      createSelectChain([
        {
          id: 'task-1',
          fromEmail: 'sender@example.com',
          fromName: 'Sender',
          subject: 'Hello',
          bodyPreview: 'Preview',
          status: 'completed',
          hasAttachments: false,
          resultSummary: 'Done',
          errorMessage: null,
          rejectionReason: null,
          chatId: 'chat-1',
          createdAt: new Date('2026-05-21T01:00:00.000Z'),
          completedAt: new Date('2026-05-21T01:05:00.000Z'),
        },
      ])
    )
  })

  it('returns paginated inbox tasks for accessible workspaces', async () => {
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        undefined,
        'http://localhost/api/workspaces/ws-owner/inbox/tasks?limit=20'
      ),
      { params: Promise.resolve({ id: 'ws-owner' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.pagination).toEqual({
      limit: 20,
      hasMore: false,
      nextCursor: null,
    })
    expect(data.tasks).toHaveLength(1)
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-owner', 'owner-1')
  })

  it('authenticates before validating route params', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockHasInboxAccess).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('returns 404 when stale personal rows no longer grant task visibility', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-owner', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(mockHasInboxAccess).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('returns 404 for hidden personal workspaces before checking plan access', async () => {
    mockHasInboxAccess.mockResolvedValueOnce(false)
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-owner', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(mockHasInboxAccess).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
