/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAssertFolderMutable,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockRestoreWorkflow,
  mockParseRequest,
} = vi.hoisted(() => ({
  mockAssertFolderMutable: vi.fn(),
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockRestoreWorkflow: vi.fn(),
  mockParseRequest: vi.fn(async (_contract, _request, context) => ({
    success: true,
    data: { params: await context.params },
  })),
}))

vi.mock('@/lib/workflows/lifecycle', () => ({
  restoreWorkflow: mockRestoreWorkflow,
}))
vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))
vi.mock('@sim/workflow-authz', () => ({
  assertFolderMutable: mockAssertFolderMutable,
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
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
    mockParseRequest.mockImplementation(async (_contract, _request, context) => ({
      success: true,
      data: { params: await context.params },
    }))
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      userName: 'User',
      userEmail: 'user@example.com',
    })
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      accessSource: 'workspace',
      workspacePermission: 'write',
      workflow: {
        id: 'wf-1',
        name: 'Workflow',
        userId: 'user-1',
        folderId: null,
        locked: false,
        workspaceId: 'ws-1',
      },
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
    expect(mockAuthorizeWorkflowByWorkspacePermission).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      userId: 'user-1',
      action: 'write',
      includeArchived: true,
    })
  })

  it('authenticates before validating route params', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({ success: false })
    const unreadableParams = {
      then: () => {
        throw new Error('params should not be read')
      },
    } as unknown as Promise<{ id: string }>

    const response = await POST(createMockRequest('POST'), { params: unreadableParams })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockParseRequest).not.toHaveBeenCalled()
  })

  it('returns 404 when stale personal rows no longer grant restore visibility', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      accessSource: null,
      workspacePermission: null,
      workflow: {
        id: 'wf-1',
        name: 'Workflow',
        userId: 'owner-2',
        folderId: null,
        locked: false,
        workspaceId: 'ws-1',
      },
    })

    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ id: 'wf-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Workflow not found' })
    expect(mockRestoreWorkflow).not.toHaveBeenCalled()
  })
})
