/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkflowById, mockCheckWorkspaceAccess } = vi.hoisted(() => ({
  mockGetWorkflowById: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
}))

vi.mock('@/lib/workflows/utils', () => ({
  getWorkflowById: mockGetWorkflowById,
}))

vi.mock('@/lib/workspaces/permissions/utils', async () => {
  return {
    checkWorkspaceAccess: mockCheckWorkspaceAccess,
  }
})

import { resolveAccessibleWorkflowWorkspace } from './execution-context'

describe('resolveAccessibleWorkflowWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides foreign personal workspaces behind 404', async () => {
    mockGetWorkflowById.mockResolvedValue({ id: 'wf-hidden', workspaceId: 'ws-hidden' })
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden' },
    })

    const result = await resolveAccessibleWorkflowWorkspace({
      userId: 'viewer-1',
      workflowId: 'wf-hidden',
      workspaceId: 'ws-hidden',
    })

    expect('response' in result).toBe(true)
    if ('response' in result) {
      expect(result.response.status).toBe(404)
      await expect(result.response.json()).resolves.toEqual({ error: 'Canvas not found' })
    }
  })

  it('normalizes to the workflow workspace instead of trusting the request workspace', async () => {
    mockGetWorkflowById.mockResolvedValue({ id: 'wf-1', workspaceId: 'ws-actual' })
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-actual' },
    })

    const result = await resolveAccessibleWorkflowWorkspace({
      userId: 'viewer-1',
      workflowId: 'wf-1',
      workspaceId: 'ws-spoofed',
    })

    expect(result).toEqual({ workspaceId: 'ws-actual' })
    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-actual', 'viewer-1')
  })
})
