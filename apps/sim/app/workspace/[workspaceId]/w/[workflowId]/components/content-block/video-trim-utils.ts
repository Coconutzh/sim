export interface VideoTrimRange {
  startSeconds: number
  endSeconds: number
}

export type VideoTrimEdge = 'start' | 'end'

export const MIN_VIDEO_TRIM_DURATION_SECONDS = 0.1
export const DEFAULT_VIDEO_TRIM_DURATION_SECONDS = 3
export const DEFAULT_VIDEO_TRIM_STEP_SECONDS = 0.1
export const PRECISE_VIDEO_TRIM_STEP_SECONDS = 0.01
export const FAST_VIDEO_TRIM_STEP_SECONDS = 1

export function clampVideoTrimValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function normalizeVideoTrimRange(
  range: VideoTrimRange,
  durationSeconds: number,
  minDurationSeconds = MIN_VIDEO_TRIM_DURATION_SECONDS
): VideoTrimRange {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { startSeconds: 0, endSeconds: 0 }
  }

  const effectiveMinDuration = Math.min(minDurationSeconds, durationSeconds)
  const startSeconds = clampVideoTrimValue(
    Number.isFinite(range.startSeconds) ? range.startSeconds : 0,
    0,
    Math.max(0, durationSeconds - effectiveMinDuration)
  )
  const endSeconds = clampVideoTrimValue(
    Number.isFinite(range.endSeconds) ? range.endSeconds : durationSeconds,
    startSeconds + effectiveMinDuration,
    durationSeconds
  )

  return { startSeconds, endSeconds }
}

export function createDefaultVideoTrimRange(durationSeconds: number): VideoTrimRange {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { startSeconds: 0, endSeconds: 0 }
  }

  return normalizeVideoTrimRange(
    {
      startSeconds: 0,
      endSeconds: Math.min(durationSeconds, DEFAULT_VIDEO_TRIM_DURATION_SECONDS),
    },
    durationSeconds
  )
}

export function moveVideoTrimRange(
  range: VideoTrimRange,
  durationSeconds: number,
  deltaSeconds: number
): VideoTrimRange {
  const normalizedRange = normalizeVideoTrimRange(range, durationSeconds)
  const selectionDuration = normalizedRange.endSeconds - normalizedRange.startSeconds
  const startSeconds = clampVideoTrimValue(
    normalizedRange.startSeconds + deltaSeconds,
    0,
    Math.max(0, durationSeconds - selectionDuration)
  )

  return {
    startSeconds,
    endSeconds: startSeconds + selectionDuration,
  }
}

export function positionVideoTrimRangeAtTime(
  range: VideoTrimRange,
  durationSeconds: number,
  timeSeconds: number
): VideoTrimRange {
  const normalizedRange = normalizeVideoTrimRange(range, durationSeconds)
  const selectionDuration = normalizedRange.endSeconds - normalizedRange.startSeconds
  const startSeconds = clampVideoTrimValue(
    timeSeconds - selectionDuration / 2,
    0,
    Math.max(0, durationSeconds - selectionDuration)
  )

  return {
    startSeconds,
    endSeconds: startSeconds + selectionDuration,
  }
}

export function resizeVideoTrimRange(
  range: VideoTrimRange,
  durationSeconds: number,
  edge: VideoTrimEdge,
  deltaSeconds: number
): VideoTrimRange {
  const normalizedRange = normalizeVideoTrimRange(range, durationSeconds)

  if (edge === 'start') {
    return normalizeVideoTrimRange(
      {
        startSeconds: normalizedRange.startSeconds + deltaSeconds,
        endSeconds: normalizedRange.endSeconds,
      },
      durationSeconds
    )
  }

  return normalizeVideoTrimRange(
    {
      startSeconds: normalizedRange.startSeconds,
      endSeconds: normalizedRange.endSeconds + deltaSeconds,
    },
    durationSeconds
  )
}

export function getVideoTrimKeyboardStep(params: {
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
}): number {
  if (params.ctrlKey || params.metaKey) return FAST_VIDEO_TRIM_STEP_SECONDS
  if (params.shiftKey) return PRECISE_VIDEO_TRIM_STEP_SECONDS
  return DEFAULT_VIDEO_TRIM_STEP_SECONDS
}

export function setVideoTrimInPoint(
  range: VideoTrimRange,
  durationSeconds: number,
  currentTimeSeconds: number
): VideoTrimRange {
  return normalizeVideoTrimRange(
    {
      startSeconds: currentTimeSeconds,
      endSeconds: range.endSeconds,
    },
    durationSeconds
  )
}

export function setVideoTrimOutPoint(
  range: VideoTrimRange,
  durationSeconds: number,
  currentTimeSeconds: number
): VideoTrimRange {
  return normalizeVideoTrimRange(
    {
      startSeconds: range.startSeconds,
      endSeconds: currentTimeSeconds,
    },
    durationSeconds
  )
}
