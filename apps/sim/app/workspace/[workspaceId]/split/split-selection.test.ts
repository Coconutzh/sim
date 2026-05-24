/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  computeViewportCenteredPlacement,
  describePaneSelection,
  mapCopiedTargetBlockIds,
  selectPaneBlock,
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

  it('keeps copied target highlights ordered by source selection', () => {
    expect(
      mapCopiedTargetBlockIds(['source-b', 'source-a'], {
        'source-a': 'target-a',
        'source-b': 'target-b',
        'source-c': 'target-c',
      })
    ).toEqual(['target-b', 'target-a', 'target-c'])
  })

  it('describes empty, single, and multi selection states', () => {
    expect(describePaneSelection([])).toBe('Click nodes to copy')
    expect(describePaneSelection(['block-a'])).toBe('Selected block-a')
    expect(describePaneSelection(['block-a', 'block-b'])).toBe('Selected 2 blocks')
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
