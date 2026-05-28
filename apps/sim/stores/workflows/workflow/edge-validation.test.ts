import { describe, expect, it } from 'vitest'
import { validateEdges } from '@/stores/workflows/workflow/edge-validation'
import type { BlockState } from '@/stores/workflows/workflow/types'

function createBlock(id: string, type: string): BlockState {
  return {
    id,
    type,
    name: id,
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    enabled: true,
    horizontalHandles: true,
    advancedMode: false,
    triggerMode: false,
    height: 0,
    data: {},
    locked: false,
  }
}

describe('validateEdges', () => {
  it('keeps content reference edges between content blocks', () => {
    const blocks = {
      'content-1': createBlock('content-1', 'content'),
      'content-2': createBlock('content-2', 'content'),
    }

    const result = validateEdges(
      [
        {
          id: 'edge-1',
          source: 'content-1',
          target: 'content-2',
          data: { kind: 'content_reference' },
        },
      ],
      blocks
    )

    expect(result.valid).toHaveLength(1)
    expect(result.dropped).toHaveLength(0)
  })

  it('drops content reference edges that do not connect two content blocks', () => {
    const blocks = {
      'content-1': createBlock('content-1', 'content'),
      'agent-1': createBlock('agent-1', 'agent'),
    }

    const result = validateEdges(
      [
        {
          id: 'edge-1',
          source: 'content-1',
          target: 'agent-1',
          data: { kind: 'content_reference' },
        },
      ],
      blocks
    )

    expect(result.valid).toHaveLength(0)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.reason).toContain('content blocks')
  })
})
