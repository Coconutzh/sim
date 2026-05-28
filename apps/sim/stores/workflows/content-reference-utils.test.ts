import type { Edge } from 'reactflow'
import { describe, expect, it } from 'vitest'
import { filterNewEdges } from '@/stores/workflows/utils'

describe('content reference edge dedupe', () => {
  it('treats reverse-direction content reference edges as duplicates', () => {
    const currentEdges: Edge[] = [
      {
        id: 'edge-1',
        source: 'content-1',
        target: 'content-2',
        data: { kind: 'content_reference' },
      },
    ]

    const nextEdges: Edge[] = [
      {
        id: 'edge-2',
        source: 'content-2',
        target: 'content-1',
        data: { kind: 'content_reference' },
      },
    ]

    expect(filterNewEdges(nextEdges, currentEdges)).toEqual([])
  })
})
