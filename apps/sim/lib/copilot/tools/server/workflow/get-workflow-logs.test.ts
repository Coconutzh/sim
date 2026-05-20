/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorizeWorkflowByWorkspacePermission, mockDbSelect } = vi.hoisted(() => ({
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockDbSelect: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  workflowExecutionLogs: {},
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

vi.mock('@/lib/copilot/generated/tool-catalog-v1', () => ({
  GetWorkflowLogs: { id: 'get_workflow_logs' },
}))

import { getWorkflowLogsServerTool } from './get-workflow-logs'

describe('getWorkflowLogsServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects published workflow readers before loading execution logs', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      accessSource: 'published',
      message: 'Published access only',
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
    })

    await expect(
      getWorkflowLogsServerTool.execute(
        { workflowId: 'wf-1' },
        {
          userId: 'user-1',
        }
      )
    ).rejects.toThrow('Published access only')

    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
