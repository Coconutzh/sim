/**
 * @vitest-environment node
 */

import type { Node } from 'reactflow'
import { describe, expect, it } from 'vitest'
import {
  getDragHighlightTransition,
  pickBestContainerMatch,
  reconcileDisplayNodePositions,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-canvas-helpers'
import type { BlockState } from '@/stores/workflows/workflow/types'

function makeNode(
  id: string,
  position: { x: number; y: number },
  selected = false,
  parentId?: string
): Node {
  return {
    id,
    type: 'custom',
    position,
    selected,
    parentId,
    data: {},
  }
}

function makeBlock(id: string, position: { x: number; y: number }, parentId?: string): BlockState {
  return {
    id,
    type: 'agent',
    name: id,
    position,
    data: parentId ? { parentId } : {},
    enabled: true,
  } as BlockState
}

describe('pickBestContainerMatch', () => {
  it('prefers the deepest overlapping container, then the smallest one at the same depth', () => {
    const match = pickBestContainerMatch(
      [
        { id: 'wide-root', depth: 0, size: 100000 },
        { id: 'same-depth-large', depth: 2, size: 9000 },
        { id: 'same-depth-small', depth: 2, size: 4000 },
        { id: 'deepest', depth: 3, size: 7000 },
      ],
      'dragged-node',
      () => false
    )

    expect(match?.id).toBe('deepest')
  })

  it('skips containers that would create a cycle', () => {
    const match = pickBestContainerMatch(
      [
        { id: 'invalid-child', depth: 4, size: 1000 },
        { id: 'valid-parent', depth: 2, size: 3000 },
      ],
      'dragged-container',
      (ancestorId, nodeId) => ancestorId === 'dragged-container' && nodeId === 'invalid-child'
    )

    expect(match?.id).toBe('valid-parent')
  })
})

describe('getDragHighlightTransition', () => {
  it('returns noop when the highlighted container does not change', () => {
    expect(getDragHighlightTransition('container-a', 'container-a')).toBe('noop')
    expect(getDragHighlightTransition(null, null)).toBe('noop')
  })

  it('returns apply or clear only when the target actually changes', () => {
    expect(getDragHighlightTransition(null, 'container-a')).toBe('apply')
    expect(getDragHighlightTransition('container-a', null)).toBe('clear')
    expect(getDragHighlightTransition('container-a', 'container-b')).toBe('apply')
  })
})

describe('reconcileDisplayNodePositions', () => {
  it('updates display node positions from committed blocks while preserving selection', () => {
    const nodes = [makeNode('node-1', { x: 10, y: 20 }, true)]
    const blocks = {
      'node-1': makeBlock('node-1', { x: 100, y: 200 }),
    }

    const result = reconcileDisplayNodePositions(nodes, blocks)

    expect(result).not.toBe(nodes)
    expect(result[0]).toMatchObject({
      id: 'node-1',
      position: { x: 100, y: 200 },
      selected: true,
    })
  })

  it('returns the original nodes when positions already match', () => {
    const nodes = [makeNode('node-1', { x: 10, y: 20 })]
    const blocks = {
      'node-1': makeBlock('node-1', { x: 10, y: 20 }),
    }

    expect(reconcileDisplayNodePositions(nodes, blocks)).toBe(nodes)
  })

  it('leaves structural changes to the derived node rebuild path', () => {
    const nodes = [makeNode('node-1', { x: 10, y: 20 })]
    const blocks = {
      'node-1': makeBlock('node-1', { x: 100, y: 200 }),
      'node-2': makeBlock('node-2', { x: 300, y: 400 }),
    }

    expect(reconcileDisplayNodePositions(nodes, blocks)).toBe(nodes)
  })

  it('does not reconcile when parent relationships differ', () => {
    const nodes = [makeNode('node-1', { x: 10, y: 20 })]
    const blocks = {
      'node-1': makeBlock('node-1', { x: 100, y: 200 }, 'parent-1'),
    }

    expect(reconcileDisplayNodePositions(nodes, blocks)).toBe(nodes)
  })
})
