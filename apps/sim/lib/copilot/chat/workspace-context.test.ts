/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorizeWorkflow } = vi.hoisted(() => ({
  mockAuthorizeWorkflow: vi.fn(),
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflow,
}))

import { filterReadableWorkflowRows } from '@/lib/copilot/chat/workspace-context'

describe('filterReadableWorkflowRows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps only workflows the user can read', async () => {
    mockAuthorizeWorkflow
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false })
      .mockResolvedValueOnce({ allowed: true })

    const workflows = [
      { id: 'personal-owned', name: 'Owned Draft' },
      { id: 'personal-hidden', name: 'Hidden Draft' },
      { id: 'team-canvas', name: 'Team Canvas' },
    ]

    await expect(filterReadableWorkflowRows('user-1', workflows)).resolves.toEqual([
      workflows[0],
      workflows[2],
    ])
    expect(mockAuthorizeWorkflow).toHaveBeenCalledWith({
      workflowId: 'personal-owned',
      userId: 'user-1',
      action: 'read',
    })
    expect(mockAuthorizeWorkflow).toHaveBeenCalledWith({
      workflowId: 'personal-hidden',
      userId: 'user-1',
      action: 'read',
    })
  })

  it('drops workflows when authorization throws', async () => {
    mockAuthorizeWorkflow
      .mockResolvedValueOnce({ allowed: true })
      .mockRejectedValueOnce(new Error('db unavailable'))

    const workflows = [
      { id: 'visible-workflow', name: 'Visible' },
      { id: 'errored-workflow', name: 'Errored' },
    ]

    await expect(filterReadableWorkflowRows('user-1', workflows)).resolves.toEqual([workflows[0]])
  })
})
