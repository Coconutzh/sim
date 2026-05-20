/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSelectLimit, mockInsertReturning, mockCheckWorkspaceAccess, mockAuthorizeWorkflow } =
  vi.hoisted(() => ({
    mockSelectLimit: vi.fn(),
    mockInsertReturning: vi.fn(),
    mockCheckWorkspaceAccess: vi.fn(),
    mockAuthorizeWorkflow: vi.fn(),
  }))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockSelectLimit,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: mockInsertReturning,
      })),
    })),
  },
}))

vi.mock('@sim/db/schema', () => ({
  copilotChats: {
    id: 'copilotChats.id',
    type: 'copilotChats.type',
    userId: 'copilotChats.userId',
    workflowId: 'copilotChats.workflowId',
    workspaceId: 'copilotChats.workspaceId',
    messages: 'copilotChats.messages',
  },
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  assertActiveWorkspaceAccess: vi.fn(),
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflow,
  getActiveWorkflowRecord: vi.fn(),
}))

import { getAccessibleMothershipChat } from './lifecycle'

describe('getAccessibleMothershipChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a mothership chat for a workspace member even when they are not the creator', async () => {
    mockSelectLimit.mockResolvedValueOnce([
      {
        id: 'chat-1',
        userId: 'creator-1',
        workspaceId: 'ws-1',
        workflowId: null,
        type: 'mothership',
        messages: [],
        resources: [],
      },
    ])
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1' },
    })

    const result = await getAccessibleMothershipChat('chat-1', 'viewer-1')

    expect(result).toMatchObject({
      id: 'chat-1',
      userId: 'creator-1',
      workspaceId: 'ws-1',
    })
    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'viewer-1')
  })

  it('returns null when the viewer lacks workspace access', async () => {
    mockSelectLimit.mockResolvedValueOnce([
      {
        id: 'chat-1',
        userId: 'creator-1',
        workspaceId: 'ws-1',
        workflowId: null,
        type: 'mothership',
        messages: [],
        resources: [],
      },
    ])
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-1' },
    })

    const result = await getAccessibleMothershipChat('chat-1', 'viewer-1')

    expect(result).toBeNull()
  })
})
