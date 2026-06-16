export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

type FrameAnchor = {
  x: 'left' | 'center' | 'right'
  y: 'top' | 'center' | 'bottom'
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function getElementScale(element: HTMLElement): { scaleX: number; scaleY: number } {
  const rect = element.getBoundingClientRect()
  return {
    scaleX: element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1,
    scaleY: element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1,
  }
}

export function getRelativeElementRect({
  root,
  element,
}: {
  root: HTMLElement
  element: HTMLElement
}): Rect {
  const rootRect = root.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const scale = getElementScale(root)
  return {
    x: (elementRect.left - rootRect.left) / scale.scaleX,
    y: (elementRect.top - rootRect.top) / scale.scaleY,
    width: elementRect.width / scale.scaleX,
    height: elementRect.height / scale.scaleY,
  }
}

export function createInitialContainingFrame(subject: Rect): Rect {
  const width = subject.width * 1.35
  const height = subject.height * 1.35
  return clampFrameToContainSubject(
    {
      x: subject.x + subject.width / 2 - width / 2,
      y: subject.y + subject.height / 2 - height / 2,
      width,
      height,
    },
    subject
  )
}

export function clampFrameToContainSubject(frame: Rect, subject: Rect): Rect {
  const width = Math.max(frame.width, subject.width)
  const height = Math.max(frame.height, subject.height)
  return {
    x: clamp(frame.x, subject.x + subject.width - width, subject.x),
    y: clamp(frame.y, subject.y + subject.height - height, subject.y),
    width,
    height,
  }
}

export function resizeFrameToContainSubject({
  frame,
  handle,
  delta,
  subject,
  ratio,
}: {
  frame: Rect
  handle: ResizeHandle
  delta: { x: number; y: number }
  subject: Rect
  ratio: number | null
}): Rect {
  if (ratio) {
    return resizeLockedFrameToContainSubject({ frame, handle, delta, subject, ratio })
  }
  return resizeFreeFrameToContainSubject({ frame, handle, delta, subject })
}

function resizeFreeFrameToContainSubject({
  frame,
  handle,
  delta,
  subject,
}: {
  frame: Rect
  handle: ResizeHandle
  delta: { x: number; y: number }
  subject: Rect
}): Rect {
  let left = frame.x
  let top = frame.y
  let right = frame.x + frame.width
  let bottom = frame.y + frame.height
  const subjectRight = subject.x + subject.width
  const subjectBottom = subject.y + subject.height

  if (handle.includes('w')) left = Math.min(left + delta.x, subject.x)
  if (handle.includes('e')) right = Math.max(right + delta.x, subjectRight)
  if (handle.includes('n')) top = Math.min(top + delta.y, subject.y)
  if (handle.includes('s')) bottom = Math.max(bottom + delta.y, subjectBottom)

  return clampFrameToContainSubject(
    {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    },
    subject
  )
}

function resizeLockedFrameToContainSubject({
  frame,
  handle,
  delta,
  subject,
  ratio,
}: {
  frame: Rect
  handle: ResizeHandle
  delta: { x: number; y: number }
  subject: Rect
  ratio: number
}): Rect {
  const freeFrame = resizeFreeFrameToContainSubject({ frame, handle, delta, subject })
  return fitFrameToAspectRatio({
    frame: freeFrame,
    subject,
    ratio,
    anchor: {
      x:
        handle.includes('w') && !handle.includes('e')
          ? 'right'
          : handle.includes('e') && !handle.includes('w')
            ? 'left'
            : 'center',
      y:
        handle.includes('n') && !handle.includes('s')
          ? 'bottom'
          : handle.includes('s') && !handle.includes('n')
            ? 'top'
            : 'center',
    },
  })
}

export function fitFrameToAspectRatio({
  frame,
  subject,
  ratio,
  anchor,
  center,
}: {
  frame: Rect
  subject: Rect
  ratio: number
  anchor?: FrameAnchor
  center?: { x: number; y: number }
}): Rect {
  const minWidth = Math.max(subject.width, subject.height * ratio)
  const minHeight = Math.max(subject.height, subject.width / ratio)
  let width = Math.max(frame.width, minWidth)
  let height = Math.max(frame.height, minHeight)

  if (width / height > ratio) {
    height = width / ratio
  } else {
    width = height * ratio
  }

  const resolvedAnchor = anchor ?? { x: 'center', y: 'center' }
  const resolvedCenter = center
  const x =
    resolvedCenter && !anchor
      ? resolvedCenter.x - width / 2
      : resolvedAnchor.x === 'left'
        ? frame.x
        : resolvedAnchor.x === 'right'
          ? frame.x + frame.width - width
          : frame.x + frame.width / 2 - width / 2
  const y =
    resolvedCenter && !anchor
      ? resolvedCenter.y - height / 2
      : resolvedAnchor.y === 'top'
        ? frame.y
        : resolvedAnchor.y === 'bottom'
          ? frame.y + frame.height - height
          : frame.y + frame.height / 2 - height / 2

  return clampFrameToContainSubject(
    {
      x,
      y,
      width,
      height,
    },
    subject
  )
}

export function getPlacementFromFrame({ frame, subject }: { frame: Rect; subject: Rect }): {
  x: number
  y: number
  width: number
  height: number
  canvasWidth: number
  canvasHeight: number
} {
  return {
    x: subject.x - frame.x,
    y: subject.y - frame.y,
    width: subject.width,
    height: subject.height,
    canvasWidth: frame.width,
    canvasHeight: frame.height,
  }
}
