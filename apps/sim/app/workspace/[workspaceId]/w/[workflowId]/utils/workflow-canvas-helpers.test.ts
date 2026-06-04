/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getDragHighlightTransition,
  pickBestContainerMatch,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-canvas-helpers'

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
