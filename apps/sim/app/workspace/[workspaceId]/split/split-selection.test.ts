/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  computePaneBoxSelectedBlockIds,
  computeViewportCenteredPlacement,
  describePaneSelection,
  mapCopiedTargetBlockIds,
  mapCopiedTargetEdgeIds,
  selectPaneBlock,
  selectPaneEdge,
} from '@/app/workspace/[workspaceId]/split/split-selection'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

describe('split canvas pane selection', () => {
  it('replaces selection on regular node clicks', () => {
    expect(
      selectPaneBlock({
        currentBlockIds: ['block-a', 'block-b'],
        blockId: 'block-c',
        additive: false,
      })
    ).toEqual(['block-c'])
  })

  it('toggles nodes during additive selection', () => {
    expect(
      selectPaneBlock({
        currentBlockIds: ['block-a'],
        blockId: 'block-b',
        additive: true,
      })
    ).toEqual(['block-a', 'block-b'])

    expect(
      selectPaneBlock({
        currentBlockIds: ['block-a', 'block-b'],
        blockId: 'block-a',
        additive: true,
      })
    ).toEqual(['block-b'])
  })

  it('toggles edges independently during additive selection', () => {
    expect(
      selectPaneEdge({
        currentEdgeIds: ['edge-a'],
        edgeId: 'edge-b',
        additive: true,
      })
    ).toEqual(['edge-a', 'edge-b'])

    expect(
      selectPaneEdge({
        currentEdgeIds: ['edge-a', 'edge-b'],
        edgeId: 'edge-a',
        additive: true,
      })
    ).toEqual(['edge-b'])

    expect(
      selectPaneEdge({
        currentEdgeIds: ['edge-a', 'edge-b'],
        edgeId: 'edge-c',
        additive: false,
      })
    ).toEqual(['edge-c'])
  })

  it('keeps copied target highlights ordered by source selection', () => {
    expect(
      mapCopiedTargetBlockIds(['source-b', 'source-a'], {
        'source-a': 'target-a',
        'source-b': 'target-b',
        'source-c': 'target-c',
      })
    ).toEqual(['target-b', 'target-a', 'target-c'])
  })

  it('keeps copied target edge highlights ordered by explicit source selection', () => {
    expect(
      mapCopiedTargetEdgeIds(['edge-b', 'edge-a'], {
        'edge-a': 'target-edge-a',
        'edge-b': 'target-edge-b',
        'edge-c': 'target-edge-c',
      })
    ).toEqual(['target-edge-b', 'target-edge-a', 'target-edge-c'])
  })

  it('describes empty, single, and multi selection states', () => {
    expect(describePaneSelection([])).toBe('Click nodes to copy')
    expect(describePaneSelection(['block-a'])).toBe('Selected block-a')
    expect(describePaneSelection(['block-a', 'block-b'])).toBe('Selected 2 blocks')
    expect(describePaneSelection([], ['edge-a'])).toBe(
      'Select endpoint nodes to copy selected edges'
    )
    expect(describePaneSelection(['block-a', 'block-b'], ['edge-a'])).toBe(
      'Selected 2 blocks + 1 edge'
    )
    expect(describePaneSelection(['block-a', 'block-b'], ['edge-a', 'edge-b'])).toBe(
      'Selected 2 blocks + 2 edges'
    )
  })

  it('centers copied selection in the target pane viewport', () => {
    const workflowState = {
      blocks: {
        'block-a': {
          id: 'block-a',
          type: 'agent',
          name: 'Agent',
          position: { x: 100, y: 200 },
          layout: { measuredWidth: 300, measuredHeight: 100 },
        },
        'block-b': {
          id: 'block-b',
          type: 'function',
          name: 'Function',
          position: { x: 500, y: 300 },
          layout: { measuredWidth: 200, measuredHeight: 120 },
        },
      },
    } as WorkflowState

    expect(
      computeViewportCenteredPlacement({
        sourceBlockIds: ['block-a', 'block-b'],
        sourceWorkflowState: workflowState,
        targetViewport: { x: -200, y: -100, zoom: 2, width: 800, height: 600 },
        fallback: { offsetX: 120, offsetY: 80 },
      })
    ).toEqual({ offsetX: -100, offsetY: -110 })
  })

  it('selects blocks intersecting a pane box selection rectangle', () => {
    const workflowState = {
      blocks: {
        'block-a': {
          id: 'block-a',
          type: 'agent',
          name: 'Agent',
          position: { x: 100, y: 100 },
          layout: { measuredWidth: 200, measuredHeight: 100 },
        },
        'block-b': {
          id: 'block-b',
          type: 'function',
          name: 'Function',
          position: { x: 360, y: 100 },
          layout: { measuredWidth: 180, measuredHeight: 100 },
        },
        'block-c': {
          id: 'block-c',
          type: 'api',
          name: 'API',
          position: { x: 700, y: 100 },
          layout: { measuredWidth: 180, measuredHeight: 100 },
        },
      },
    } as WorkflowState

    expect(
      computePaneBoxSelectedBlockIds({
        workflowState,
        viewport: { x: -50, y: -20, zoom: 2, width: 800, height: 600 },
        rectangle: { left: 230, top: 180, right: 850, bottom: 420 },
      })
    ).toEqual(['block-a', 'block-b'])
  })

  it('resolves nested block positions when box selecting subflow children', () => {
    const workflowState = {
      blocks: {
        parent: {
          id: 'parent',
          type: 'loop',
          name: 'Loop',
          position: { x: 100, y: 100 },
          data: { width: 500, height: 300 },
        },
        child: {
          id: 'child',
          type: 'agent',
          name: 'Agent',
          position: { x: 80, y: 60 },
          data: { parentId: 'parent' },
          layout: { measuredWidth: 200, measuredHeight: 100 },
        },
      },
    } as WorkflowState

    expect(
      computePaneBoxSelectedBlockIds({
        workflowState,
        viewport: { x: 0, y: 0, zoom: 1, width: 800, height: 600 },
        rectangle: { left: 170, top: 150, right: 400, bottom: 260 },
      })
    ).toEqual(['parent', 'child'])
  })

  it('ignores tiny drag boxes to avoid accidental pane selections', () => {
    const workflowState = {
      blocks: {
        'block-a': {
          id: 'block-a',
          type: 'agent',
          name: 'Agent',
          position: { x: 100, y: 100 },
        },
      },
    } as WorkflowState

    expect(
      computePaneBoxSelectedBlockIds({
        workflowState,
        viewport: { x: 0, y: 0, zoom: 1, width: 800, height: 600 },
        rectangle: { left: 100, top: 100, right: 102, bottom: 104 },
      })
    ).toEqual([])
  })

  it('falls back to fixed offset when viewport state is not ready', () => {
    expect(
      computeViewportCenteredPlacement({
        sourceBlockIds: ['block-a'],
        sourceWorkflowState: null,
        targetViewport: null,
        fallback: { offsetX: 120, offsetY: 80 },
      })
    ).toEqual({ offsetX: 120, offsetY: 80 })
  })
})
