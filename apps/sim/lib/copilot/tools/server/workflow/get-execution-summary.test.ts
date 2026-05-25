/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorizeWorkflowByWorkspacePermission, mockCheckWorkspaceAccess, mockDbSelect } =
  vi.hoisted(() => ({
    mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
    mockCheckWorkspaceAccess: vi.fn(),
    mockDbSelect: vi.fn(),
  }))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  workflow: {},
  workflowExecutionLogs: {},
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

vi.mock('@/lib/copilot/generated/tool-catalog-v1', () => ({
  GetExecutionSummary: { id: 'get_execution_summary' },
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

import { getExecutionSummaryServerTool } from './get-execution-summary'

describe('getExecutionSummaryServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects published workflow readers before loading execution summaries', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      accessSource: 'organization',
      message: 'Published access only',
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
    })

    await expect(
      getExecutionSummaryServerTool.execute(
        { workspaceId: 'ws-1', workflowId: 'wf-1' },
        { userId: 'user-1' }
      )
    ).rejects.toThrow('Published access only')

    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('rejects mismatched workflow and workspace inputs', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      accessSource: 'workspace',
      workflow: { id: 'wf-1', workspaceId: 'ws-source' },
    })

    await expect(
      getExecutionSummaryServerTool.execute(
        { workspaceId: 'ws-other', workflowId: 'wf-1' },
        { userId: 'user-1' }
      )
    ).rejects.toThrow('Workflow does not belong to the requested canvas')

    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
