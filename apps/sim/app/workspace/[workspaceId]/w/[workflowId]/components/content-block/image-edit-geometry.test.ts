/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  fitFrameToAspectRatio,
  fitFrameToAspectRatioFromStableBase,
  type Rect,
  type ResizeHandle,
  resizeFrameToContainSubject,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-edit-geometry'

const subject: Rect = { x: 25, y: 25, width: 50, height: 40 }
const frame: Rect = { x: 10, y: 10, width: 80, height: 70 }

function expectContainsSubject(result: Rect): void {
  expect(result.x).toBeLessThanOrEqual(subject.x)
  expect(result.y).toBeLessThanOrEqual(subject.y)
  expect(result.x + result.width).toBeGreaterThanOrEqual(subject.x + subject.width)
  expect(result.y + result.height).toBeGreaterThanOrEqual(subject.y + subject.height)
}

describe('image edit geometry outpaint resize', () => {
  it('moves the north edge upward and keeps the south edge anchored', () => {
    const result = resizeFrameToContainSubject({
      frame,
      handle: 'n',
      delta: { x: 0, y: -20 },
      subject,
      ratio: null,
    })

    expect(result.y).toBeLessThan(frame.y)
    expect(result.height).toBeGreaterThan(frame.height)
    expect(result.y + result.height).toBe(frame.y + frame.height)
    expectContainsSubject(result)
  })

  it('moves the south edge downward without moving the north edge backward', () => {
    const result = resizeFrameToContainSubject({
      frame,
      handle: 's',
      delta: { x: 0, y: 20 },
      subject,
      ratio: null,
    })

    expect(result.y).toBe(frame.y)
    expect(result.height).toBeGreaterThan(frame.height)
    expectContainsSubject(result)
  })

  it('moves the west edge left and keeps the east edge anchored', () => {
    const result = resizeFrameToContainSubject({
      frame,
      handle: 'w',
      delta: { x: -20, y: 0 },
      subject,
      ratio: null,
    })

    expect(result.x).toBeLessThan(frame.x)
    expect(result.width).toBeGreaterThan(frame.width)
    expect(result.x + result.width).toBe(frame.x + frame.width)
    expectContainsSubject(result)
  })

  it('moves the east edge right without moving the west edge backward', () => {
    const result = resizeFrameToContainSubject({
      frame,
      handle: 'e',
      delta: { x: 20, y: 0 },
      subject,
      ratio: null,
    })

    expect(result.x).toBe(frame.x)
    expect(result.width).toBeGreaterThan(frame.width)
    expectContainsSubject(result)
  })

  it.each([
    ['n', { x: 0, y: -20 }, (result: Rect) => result.y < frame.y],
    ['s', { x: 0, y: 20 }, (result: Rect) => result.y === frame.y],
    ['w', { x: -20, y: 0 }, (result: Rect) => result.x < frame.x],
    ['e', { x: 20, y: 0 }, (result: Rect) => result.x === frame.x],
    ['nw', { x: -20, y: -20 }, (result: Rect) => result.x < frame.x && result.y < frame.y],
    ['se', { x: 20, y: 20 }, (result: Rect) => result.x === frame.x && result.y === frame.y],
  ] satisfies Array<[ResizeHandle, { x: number; y: number }, (result: Rect) => boolean]>)(
    'keeps locked-ratio resize direction intuitive for %s',
    (handle, delta, isExpectedDirection) => {
      const result = resizeFrameToContainSubject({
        frame,
        handle,
        delta,
        subject,
        ratio: 1,
      })

      expect(isExpectedDirection(result)).toBe(true)
      expect(result.width).toBe(result.height)
      expectContainsSubject(result)
    }
  )
})

describe('image edit geometry outpaint preset ratios', () => {
  it('recomputes preset ratios from a stable base without cumulative expansion', () => {
    const baseFrame: Rect = { x: 0, y: 0, width: 100, height: 100 }
    const ratios = [9 / 16, 16 / 9, 1, 4 / 3]

    const stableFrames = ratios.map((ratio) =>
      fitFrameToAspectRatioFromStableBase({ baseFrame, subject, ratio })
    )
    const accumulatedFrames = ratios.reduce<Rect[]>((frames, ratio) => {
      const previous = frames.at(-1) ?? baseFrame
      return [...frames, fitFrameToAspectRatio({ frame: previous, subject, ratio })]
    }, [])

    for (const result of stableFrames) {
      expectContainsSubject(result)
    }

    const stableFinal = stableFrames.at(-1)
    const accumulatedFinal = accumulatedFrames.at(-1)
    expect(stableFinal).toBeDefined()
    expect(accumulatedFinal).toBeDefined()
    expect(stableFinal?.width).toBeLessThan(accumulatedFinal?.width ?? 0)
    expect(stableFinal?.height).toBeLessThan(accumulatedFinal?.height ?? 0)
    expect(stableFinal?.width).toBeCloseTo(400 / 3)
    expect(stableFinal?.height).toBeCloseTo(100)
  })
})
