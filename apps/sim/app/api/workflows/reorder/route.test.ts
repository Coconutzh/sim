/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  hybridAuthMockFns,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockDbTransaction } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbTransaction: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    transaction: mockDbTransaction,
  },
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@sim/workflow-authz', () => ({
  assertFolderMutable: vi.fn(),
  assertWorkflowMutable: vi.fn(),
  FolderLockedError: class FolderLockedError extends Error {},
  WorkflowLockedError: class WorkflowLockedError extends Error {},
}))

import { PUT } from '@/app/api/workflows/reorder/route'

describe('PUT /api/workflows/reorder', () => {
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
    mockDbSelect.mockReturnValue(createSelectChain([{ id: 'wf-1', workspaceId: 'ws-1' }]))
    mockDbTransaction.mockImplementation(
      async (fn: (tx: Record<string, unknown>) => Promise<void>) => {
        await fn({
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn().mockResolvedValue(undefined),
            })),
          })),
        })
      }
    )
  })

  it('reorders workflows for accessible workspaces', async () => {
    const response = await PUT(
      createMockRequest('PUT', {
        workspaceId: 'ws-1',
        updates: [{ id: 'wf-1', sortOrder: 0 }],
      })
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ success: true, updated: 1 })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'user-1')
  })

  it('returns 404 when stale personal rows no longer grant reorder visibility', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-1', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await PUT(
      createMockRequest('PUT', {
        workspaceId: 'ws-1',
        updates: [{ id: 'wf-1', sortOrder: 0 }],
      })
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('returns 404 when moving a workflow into a folder from another hidden workspace', async () => {
    mockDbSelect
      .mockReturnValueOnce(createSelectChain([{ id: 'wf-1', workspaceId: 'ws-1' }]))
      .mockReturnValueOnce(createSelectChain([{ id: 'folder-hidden', workspaceId: 'ws-hidden' }]))

    const response = await PUT(
      createMockRequest('PUT', {
        workspaceId: 'ws-1',
        updates: [{ id: 'wf-1', sortOrder: 0, folderId: 'folder-hidden' }],
      })
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Folder not found' })
    expect(mockDbTransaction).not.toHaveBeenCalled()
  })
})
