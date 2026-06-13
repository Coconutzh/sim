/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockListHermesUserMemories } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockListHermesUserMemories: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/hermes/user-memory', () => ({
  listHermesUserMemories: mockListHermesUserMemories,
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
  runWithRequestContext: (_context: unknown, callback: () => unknown) => callback(),
}))

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

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { method: 'GET' })
}

describe('SIM Hermes user memory admin route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mockListHermesUserMemories.mockResolvedValue([memory])
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
})
