/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getWorkflowStateAccessScope,
  isPublishedSummaryWorkflowState,
} from '@/hooks/queries/workflow-state-access'

describe('workflow-state-access', () => {
  it('defaults workflow state access scope to workspace', () => {
    expect(getWorkflowStateAccessScope(undefined)).toBe('workspace')
    expect(getWorkflowStateAccessScope({ blocks: {}, edges: [], loops: {}, parallels: {} })).toBe(
      'workspace'
    )
  })

  it('detects published workflow summaries explicitly', () => {
    const workflowState = {
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      metadata: { accessScope: 'published_summary' as const },
    }

    expect(getWorkflowStateAccessScope(workflowState)).toBe('published_summary')
    expect(isPublishedSummaryWorkflowState(workflowState)).toBe(true)
  })
})
