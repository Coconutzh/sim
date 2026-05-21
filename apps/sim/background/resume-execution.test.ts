/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockTask, mockGetPausedExecutionById, mockStartResumeExecution } = vi.hoisted(() => ({
  mockTask: vi.fn((config) => config),
  mockGetPausedExecutionById: vi.fn(),
  mockStartResumeExecution: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({ task: mockTask }))

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => ({
  PauseResumeManager: {
    getPausedExecutionById: mockGetPausedExecutionById,
    startResumeExecution: mockStartResumeExecution,
  },
}))

import { executeResumeJob } from './resume-execution'

describe('executeResumeJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a resume payload that points at a different paused execution', async () => {
    mockGetPausedExecutionById.mockResolvedValueOnce({
      id: 'paused-1',
      workflowId: 'workflow-other',
      executionId: 'execution-other',
    })

    await expect(
      executeResumeJob({
        resumeEntryId: 'resume-entry-1',
        resumeExecutionId: 'resume-execution-1',
        pausedExecutionId: 'paused-1',
        contextId: 'context-1',
        resumeInput: { approved: true },
        userId: 'user-1',
        workflowId: 'workflow-1',
        parentExecutionId: 'execution-1',
      })
    ).rejects.toThrow('Paused execution does not match resume payload')

    expect(mockStartResumeExecution).not.toHaveBeenCalled()
  })
})
