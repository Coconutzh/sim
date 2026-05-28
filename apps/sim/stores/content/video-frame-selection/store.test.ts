import { beforeEach, describe, expect, it } from 'vitest'
import { useVideoFrameSelectionStore } from '@/stores/content/video-frame-selection/store'

describe('video frame selection store', () => {
  beforeEach(() => {
    useVideoFrameSelectionStore.setState({
      selection: null,
    })
  })

  it('starts and clears a one-shot frame selection session', () => {
    useVideoFrameSelectionStore.getState().beginSelection({
      targetBlockId: 'video-1',
      slot: 'first',
      modelFamily: 'wan2.6',
      requiredAspectRatioPreset: '16:9',
    })

    expect(useVideoFrameSelectionStore.getState().selection).toEqual({
      targetBlockId: 'video-1',
      slot: 'first',
      modelFamily: 'wan2.6',
      requiredAspectRatioPreset: '16:9',
    })

    useVideoFrameSelectionStore.getState().clearSelection()
    expect(useVideoFrameSelectionStore.getState().selection).toBeNull()
  })
})
