/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  describePaneSelection,
  mapCopiedTargetBlockIds,
  selectPaneBlock,
} from '@/app/workspace/[workspaceId]/split/split-selection'

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
})
