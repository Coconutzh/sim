/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRestoreWorkflow, mockGetWorkflowById } = vi.hoisted(() => ({
  mockRestoreWorkflow: vi.fn(),
  mockGetWorkflowById: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/workflows/lifecycle', () => ({
  restoreWorkflow: mockRestoreWorkflow,
}))
vi.mock('@/lib/workflows/utils', () => ({
  getWorkflowById: mockGetWorkflowById,
}))
vi.mock('@sim/workflow-authz', () => ({
  assertFolderMutable: vi.fn(),
  FolderLockedError: class FolderLockedError extends Error {
    status = 423
  },
  WorkflowLockedError: class WorkflowLockedError extends Error {
    status = 423
  },
}))

import { POST } from '@/app/api/workflows/[id]/restore/route'

describe('POST /api/workflows/[id]/restore', () => {
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
    mockGetWorkflowById.mockResolvedValue({
      id: 'wf-1',
      name: 'Workflow',
      userId: 'user-1',
      folderId: null,
      locked: false,
      workspaceId: 'ws-1',
    })
    mockRestoreWorkflow.mockResolvedValue({ restored: true })
  })

  it('restores workflows for accessible workspaces', async () => {
    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ id: 'wf-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ success: true })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'user-1')
  })

  it('returns 404 when stale personal rows no longer grant restore visibility', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-1', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ id: 'wf-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Workflow not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})
