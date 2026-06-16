/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createDefaultVideoTrimRange,
  getVideoTrimKeyboardStep,
  moveVideoTrimRange,
  normalizeVideoTrimRange,
  positionVideoTrimRangeAtTime,
  resizeVideoTrimRange,
  setVideoTrimInPoint,
  setVideoTrimOutPoint,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/video-trim-utils'

describe('video trim timeline utilities', () => {
  it('clamps ranges to the video duration and preserves a minimum segment', () => {
    expect(normalizeVideoTrimRange({ startSeconds: -1, endSeconds: 20 }, 10)).toEqual({
      startSeconds: 0,
      endSeconds: 10,
    })

    expect(normalizeVideoTrimRange({ startSeconds: 9.98, endSeconds: 9.99 }, 10)).toEqual({
      startSeconds: 9.9,
      endSeconds: 10,
    })
  })

  it('creates a three-second default range when the video is long enough', () => {
    expect(createDefaultVideoTrimRange(8)).toEqual({
      startSeconds: 0,
      endSeconds: 3,
    })
  })

  it('moves a selection without changing its duration', () => {
    expect(moveVideoTrimRange({ startSeconds: 1, endSeconds: 3 }, 5, 4)).toEqual({
      startSeconds: 3,
      endSeconds: 5,
    })

    expect(moveVideoTrimRange({ startSeconds: 1, endSeconds: 3 }, 5, -4)).toEqual({
      startSeconds: 0,
      endSeconds: 2,
    })
  })

  it('positions a selection around a timeline time without changing its duration', () => {
    expect(positionVideoTrimRangeAtTime({ startSeconds: 0, endSeconds: 3 }, 10, 6)).toEqual({
      startSeconds: 4.5,
      endSeconds: 7.5,
    })

    expect(positionVideoTrimRangeAtTime({ startSeconds: 0, endSeconds: 3 }, 10, 9.5)).toEqual({
      startSeconds: 7,
      endSeconds: 10,
    })
  })

  it('resizes either edge while enforcing a valid interval', () => {
    expect(resizeVideoTrimRange({ startSeconds: 1, endSeconds: 3 }, 5, 'start', 1)).toEqual({
      startSeconds: 2,
      endSeconds: 3,
    })

    expect(resizeVideoTrimRange({ startSeconds: 1, endSeconds: 3 }, 5, 'end', -5)).toEqual({
      startSeconds: 1,
      endSeconds: 1.1,
    })
  })

  it('uses modifier keys for precise and fast shortcut steps', () => {
    expect(getVideoTrimKeyboardStep({})).toBe(0.1)
    expect(getVideoTrimKeyboardStep({ shiftKey: true })).toBe(0.01)
    expect(getVideoTrimKeyboardStep({ ctrlKey: true })).toBe(1)
    expect(getVideoTrimKeyboardStep({ metaKey: true, shiftKey: true })).toBe(1)
  })

  it('sets in and out points from the current preview time', () => {
    expect(setVideoTrimInPoint({ startSeconds: 1, endSeconds: 4 }, 6, 2)).toEqual({
      startSeconds: 2,
      endSeconds: 4,
    })
    expect(setVideoTrimOutPoint({ startSeconds: 1, endSeconds: 4 }, 6, 2)).toEqual({
      startSeconds: 1,
      endSeconds: 2,
    })
  })
})
