/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockRestoreKnowledgeBase } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockRestoreKnowledgeBase: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => ({
    limit: vi.fn(() => Promise.resolve(result)),
  }))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  knowledgeBase: {
    id: 'id',
    name: 'name',
    workspaceId: 'workspaceId',
    userId: 'userId',
  },
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/knowledge/service', () => ({
  restoreKnowledgeBase: mockRestoreKnowledgeBase,
  KnowledgeBaseConflictError: class KnowledgeBaseConflictError extends Error {},
}))

import { POST } from '@/app/api/knowledge/[id]/restore/route'

describe('POST /api/knowledge/[id]/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      userName: 'User',
      userEmail: 'user@example.com',
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'user-1', workspaceMode: 'organization' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockDbSelect.mockReturnValue(
      createSelectChain([
        {
          id: 'kb-1',
          name: 'KB',
          workspaceId: 'ws-1',
          userId: 'user-1',
        },
      ])
    )
    mockRestoreKnowledgeBase.mockResolvedValue(undefined)
  })

  it('restores knowledge bases for accessible workspaces', async () => {
    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ id: 'kb-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ success: true })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'user-1')
  })

  it('returns 404 when stale personal rows no longer grant knowledge-base visibility', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-1', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ id: 'kb-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Knowledge base not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})
