/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDeleteHermesUserMemory, mockGetSession, mockListHermesUserMemories } = vi.hoisted(
  () => ({
    mockDeleteHermesUserMemory: vi.fn(),
    mockGetSession: vi.fn(),
    mockListHermesUserMemories: vi.fn(),
  })
)

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/hermes/user-memory', () => ({
  deleteHermesUserMemory: mockDeleteHermesUserMemory,
  listHermesUserMemories: mockListHermesUserMemories,
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
  runWithRequestContext: (_context: unknown, callback: () => unknown) => callback(),
}))

import { DELETE } from '@/app/api/organizations/[id]/hermes/user-memories/[memoryId]/route'
import { GET } from '@/app/api/organizations/[id]/hermes/user-memories/route'

const memory = {
  id: 'memory-1',
  userId: 'user-1',
  organizationId: 'org-1',
  workspaceId: 'workspace-1',
  category: 'workflow_habit',
  content: '用户做短视频脚本时偏好先出三版 hook，再生成分镜。',
  source: 'hermes',
  sourceHermesRunId: 'hermes-run-1',
  sourceTraceId: 'trace-1',
  evidenceRefs: ['hermes-session:chat-1'],
  createdAt: '2026-06-13T00:00:00.000Z',
  updatedAt: '2026-06-13T00:00:00.000Z',
  lastSeenAt: '2026-06-13T00:00:00.000Z',
} as const

function context(params: Record<string, string>) {
  return { params: Promise.resolve(params) }
}

function request(path: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { method: 'GET', ...init })
}

describe('SIM Hermes user memory admin route', () => {
  beforeEach(() => {
    mockDeleteHermesUserMemory.mockReset()
    mockGetSession.mockReset()
    mockListHermesUserMemories.mockReset()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mockListHermesUserMemories.mockResolvedValue([memory])
    mockDeleteHermesUserMemory.mockResolvedValue({
      memory,
      deletedAt: '2026-06-13T01:00:00.000Z',
    })
  })

  it('lists sanitized Hermes user memories for organization admins', async () => {
    const response = await GET(
      request(
        '/api/organizations/org-1/hermes/user-memories?userId=user-1&workspaceId=workspace-1&category=workflow_habit&limit=10'
      ),
      context({ id: 'org-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.memories[0]).toMatchObject({
      id: 'memory-1',
      content: '用户做短视频脚本时偏好先出三版 hook，再生成分镜。',
    })
    expect(payload.memories[0]).not.toHaveProperty('metadata')
    expect(mockListHermesUserMemories).toHaveBeenCalledWith({
      requesterUserId: 'admin-1',
      organizationId: 'org-1',
      query: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        category: 'workflow_habit',
        limit: 10,
      },
    })
  })

  it('uses safe defaults for optional filters', async () => {
    const response = await GET(
      request('/api/organizations/org-1/hermes/user-memories'),
      context({ id: 'org-1' })
    )

    expect(response.status).toBe(200)
    expect(mockListHermesUserMemories).toHaveBeenCalledWith({
      requesterUserId: 'admin-1',
      organizationId: 'org-1',
      query: { limit: 25 },
    })
  })

  it('rejects unauthenticated memory reads before service calls', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await GET(
      request('/api/organizations/org-1/hermes/user-memories'),
      context({ id: 'org-1' })
    )

    expect(response.status).toBe(401)
    expect(mockListHermesUserMemories).not.toHaveBeenCalled()
  })

  it('does not expose user memories to non-admin organization users', async () => {
    mockListHermesUserMemories.mockRejectedValueOnce(
      new Error('Organization admin access required')
    )

    const response = await GET(
      request('/api/organizations/org-1/hermes/user-memories'),
      context({ id: 'org-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error).toBe('Organization admin access required')
  })

  it('returns 500 for unexpected memory list failures', async () => {
    mockListHermesUserMemories.mockRejectedValueOnce(new Error('database unavailable'))

    const response = await GET(
      request('/api/organizations/org-1/hermes/user-memories'),
      context({ id: 'org-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.error).toBe('Unable to list Hermes user memories')
  })

  it('soft-deletes a Hermes user memory for organization admins', async () => {
    const response = await DELETE(
      request('/api/organizations/org-1/hermes/user-memories/memory-1', {
        method: 'DELETE',
        body: JSON.stringify({ reason: 'privacy request' }),
      }),
      context({ id: 'org-1', memoryId: 'memory-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.deletedAt).toBe('2026-06-13T01:00:00.000Z')
    expect(payload.memory.id).toBe('memory-1')
    expect(mockDeleteHermesUserMemory).toHaveBeenCalledWith({
      requesterUserId: 'admin-1',
      organizationId: 'org-1',
      memoryId: 'memory-1',
      reason: 'privacy request',
    })
  })

  it('rejects unauthenticated memory deletes before service calls', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await DELETE(
      request('/api/organizations/org-1/hermes/user-memories/memory-1', { method: 'DELETE' }),
      context({ id: 'org-1', memoryId: 'memory-1' })
    )

    expect(response.status).toBe(401)
    expect(mockDeleteHermesUserMemory).not.toHaveBeenCalled()
  })

  it('does not delete user memories for non-admin organization users', async () => {
    mockDeleteHermesUserMemory.mockRejectedValueOnce(
      new Error('Organization admin access required')
    )

    const response = await DELETE(
      request('/api/organizations/org-1/hermes/user-memories/memory-1', {
        method: 'DELETE',
        body: JSON.stringify({}),
      }),
      context({ id: 'org-1', memoryId: 'memory-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error).toBe('Organization admin access required')
  })

  it('returns 404 when deleting a missing Hermes user memory', async () => {
    mockDeleteHermesUserMemory.mockRejectedValueOnce(new Error('Hermes user memory not found'))

    const response = await DELETE(
      request('/api/organizations/org-1/hermes/user-memories/missing-memory', {
        method: 'DELETE',
        body: JSON.stringify({}),
      }),
      context({ id: 'org-1', memoryId: 'missing-memory' })
    )
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error).toBe('Hermes user memory not found')
  })

  it('returns 500 for unexpected memory delete failures', async () => {
    mockDeleteHermesUserMemory.mockRejectedValueOnce(new Error('database unavailable'))

    const response = await DELETE(
      request('/api/organizations/org-1/hermes/user-memories/memory-1', {
        method: 'DELETE',
        body: JSON.stringify({}),
      }),
      context({ id: 'org-1', memoryId: 'memory-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.error).toBe('Unable to delete Hermes user memory')
  })
})
