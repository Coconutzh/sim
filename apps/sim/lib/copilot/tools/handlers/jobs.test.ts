/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { executeCreateJob, executeManageJob, executeUpdateJobHistory } from './jobs'

describe('job tool context wording', () => {
  it('returns canvas context wording when creating without a workspaceId', async () => {
    const result = await executeCreateJob(
      { prompt: 'Follow up', time: '2030-01-01T00:00:00Z' },
      { userId: 'user-1', workflowId: 'wf-1' }
    )

    expect(result).toEqual({ success: false, error: 'Missing user or canvas context' })
  })

  it('returns canvas context wording when managing without a workspaceId', async () => {
    const result = await executeManageJob(
      { operation: 'list' },
      { userId: 'user-1', workflowId: 'wf-1' }
    )

    expect(result).toEqual({ success: false, error: 'Missing user or canvas context' })
  })

  it('returns canvas context wording when updating history without a workspaceId', async () => {
    const result = await executeUpdateJobHistory(
      { jobId: 'job-1', summary: 'Done' },
      { userId: 'user-1', workflowId: 'wf-1' }
    )

    expect(result).toEqual({ success: false, error: 'Missing canvas context' })
  })
})
