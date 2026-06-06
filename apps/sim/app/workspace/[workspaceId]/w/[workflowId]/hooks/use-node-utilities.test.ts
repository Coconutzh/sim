/**
 * @vitest-environment node
 */
import type { Node } from 'reactflow'
import { describe, expect, it } from 'vitest'
import { createNodeGeometrySnapshot } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-node-utilities'

type TestBlock = {
  type?: string
  height?: number
  data?: {
    parentId?: string
    width?: number
    height?: number
  }
}

function createNode(
  id: string,
  position: { x: number; y: number },
  options?: Partial<Node>
): Node {
  return {
    id,
    type: 'workflowBlock',
    position,
    data: {},
    ...options,
  } as Node
}

describe('createNodeGeometrySnapshot', () => {
  it('calculates absolute positions and depth for nested nodes', () => {
    const nodes = [
      createNode('root-loop', { x: 100, y: 200 }, {
        type: 'subflowNode',
        data: { width: 600, height: 400 },
      }),
      createNode('nested-loop', { x: 40, y: 80 }, {
        type: 'subflowNode',
        data: { width: 320, height: 240 },
      }),
      createNode('child-block', { x: 30, y: 50 }),
    ]

    const blocks: Record<string, TestBlock> = {
      'root-loop': {
        type: 'loop',
        data: { width: 600, height: 400 },
      },
      'nested-loop': {
        type: 'parallel',
        data: { parentId: 'root-loop', width: 320, height: 240 },
      },
      'child-block': {
        type: 'function',
        data: { parentId: 'nested-loop' },
      },
    }

    const snapshot = createNodeGeometrySnapshot(nodes, blocks)

    expect(snapshot.getNodeDepth('root-loop')).toBe(0)
    expect(snapshot.getNodeDepth('nested-loop')).toBe(1)
    expect(snapshot.getNodeDepth('child-block')).toBe(2)
    expect(snapshot.getNodeAbsolutePosition('root-loop')).toEqual({ x: 100, y: 200 })
    expect(snapshot.getNodeAbsolutePosition('nested-loop')).toEqual({ x: 156, y: 346 })
    expect(snapshot.getNodeAbsolutePosition('child-block')).toEqual({ x: 202, y: 462 })
  })

  it('keeps descendant checks safe when parent references form a cycle', () => {
    const nodes = [
      createNode('loop-a', { x: 0, y: 0 }, { type: 'subflowNode', data: { width: 300, height: 200 } }),
      createNode('loop-b', { x: 10, y: 10 }, { type: 'subflowNode', data: { width: 260, height: 180 } }),
    ]

    const blocks: Record<string, TestBlock> = {
      'loop-a': {
        type: 'loop',
        data: { parentId: 'loop-b', width: 300, height: 200 },
      },
      'loop-b': {
        type: 'parallel',
        data: { parentId: 'loop-a', width: 260, height: 180 },
      },
    }

    const snapshot = createNodeGeometrySnapshot(nodes, blocks)

    expect(snapshot.isDescendantOf('loop-a', 'loop-b')).toBe(true)
    expect(snapshot.isDescendantOf('loop-b', 'loop-a')).toBe(true)
    expect(snapshot.getNodeDepth('loop-a')).toBeGreaterThanOrEqual(0)
    expect(snapshot.getNodeAbsolutePosition('loop-a')).toEqual({ x: 0, y: 0 })
  })
})
