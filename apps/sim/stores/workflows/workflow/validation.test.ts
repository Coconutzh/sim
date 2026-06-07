import { describe, expect, it } from 'vitest'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import { normalizeWorkflowState } from '@/stores/workflows/workflow/validation'

function createBlock(id: string, type: string): BlockState {
  return {
    id,
    type,
    name: id,
    position: { x: 0, y: 0 },
    enabled: true,
    horizontalHandles: true,
    advancedMode: false,
    triggerMode: false,
    height: 0,
    subBlocks: {},
    outputs: {},
    data: {},
    locked: false,
  }
}

describe('normalizeWorkflowState', () => {
  it('upgrades legacy content reference handle edges so they survive reload', () => {
    const workflowState: WorkflowState = {
      currentWorkflowId: 'workflow-1',
      blocks: {
        'text-1': createBlock('text-1', 'content'),
        'image-1': createBlock('image-1', 'content'),
      },
      edges: [
        {
          id: 'edge-1',
          source: 'text-1',
          target: 'image-1',
          sourceHandle: 'content-reference-source-right',
          targetHandle: 'content-reference-target-left',
          type: 'default',
          data: {},
        },
      ],
      loops: {},
      parallels: {},
    }

    const result = normalizeWorkflowState(workflowState)

    expect(result.warnings).toEqual([])
    expect(result.state.edges).toEqual([
      expect.objectContaining({
        id: 'edge-1',
        source: 'text-1',
        target: 'image-1',
        sourceHandle: 'content-reference-source-right',
        targetHandle: 'content-reference-target-left',
        type: 'workflowEdge',
        data: {
          kind: 'content_reference',
        },
      }),
    ])
  })
})
