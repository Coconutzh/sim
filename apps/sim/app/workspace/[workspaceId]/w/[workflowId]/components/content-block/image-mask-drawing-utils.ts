export type ImageMaskTool = 'brush' | 'rectangle' | 'eraser'

export interface ImageMaskBounds {
  left: number
  top: number
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
}

export interface ImageMaskPoint {
  x: number
  y: number
}

export interface ImageMaskAction {
  tool: ImageMaskTool
  points: ImageMaskPoint[]
  rect?: { x: number; y: number; width: number; height: number }
  size: number
}

export const IMAGE_MASK_COLOR = 'rgba(85, 190, 255, 0.42)'

export function getImageMaskCanvasGeometry({
  bounds,
  mode,
  devicePixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
}: {
  bounds: ImageMaskBounds
  mode: 'display' | 'export'
  devicePixelRatio?: number
}): { width: number; height: number; scaleX: number; scaleY: number } {
  if (mode === 'export') {
    return {
      width: Math.max(1, Math.round(bounds.sourceWidth)),
      height: Math.max(1, Math.round(bounds.sourceHeight)),
      scaleX: bounds.sourceWidth / bounds.width,
      scaleY: bounds.sourceHeight / bounds.height,
    }
  }

  return {
    width: Math.max(1, Math.round(bounds.width * devicePixelRatio)),
    height: Math.max(1, Math.round(bounds.height * devicePixelRatio)),
    scaleX: devicePixelRatio,
    scaleY: devicePixelRatio,
  }
}

export function getSourceImageMaskRect({
  bounds,
  rect,
}: {
  bounds: ImageMaskBounds
  rect: NonNullable<ImageMaskAction['rect']>
}): NonNullable<ImageMaskAction['rect']> {
  const geometry = getImageMaskCanvasGeometry({ bounds, mode: 'export' })
  return {
    x: rect.x * geometry.scaleX,
    y: rect.y * geometry.scaleY,
    width: rect.width * geometry.scaleX,
    height: rect.height * geometry.scaleY,
  }
}

export function resizeMaskCanvas(
  canvas: HTMLCanvasElement,
  bounds: ImageMaskBounds,
  mode: 'display' | 'export' = 'display'
): CanvasRenderingContext2D | null {
  const geometry = getImageMaskCanvasGeometry({ bounds, mode })
  canvas.width = geometry.width
  canvas.height = geometry.height
  canvas.style.width = `${bounds.width}px`
  canvas.style.height = `${bounds.height}px`
  const context = canvas.getContext('2d')
  if (!context) return null
  context.setTransform(geometry.scaleX, 0, 0, geometry.scaleY, 0, 0)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  return context
}

export function drawBrushAction(context: CanvasRenderingContext2D, action: ImageMaskAction) {
  const firstPoint = action.points[0]
  if (!firstPoint) return

  context.lineWidth = action.size
  context.beginPath()
  context.moveTo(firstPoint.x, firstPoint.y)
  for (const point of action.points.slice(1)) {
    context.lineTo(point.x, point.y)
  }
  if (action.points.length === 1) {
    context.lineTo(firstPoint.x + 0.01, firstPoint.y + 0.01)
  }
  context.stroke()
}

export function renderMaskActions({
  context,
  width,
  height,
  actions,
  mode,
}: {
  context: CanvasRenderingContext2D
  width: number
  height: number
  actions: ImageMaskAction[]
  mode: 'display' | 'export'
}) {
  context.clearRect(0, 0, width, height)
  if (mode === 'export') {
    context.fillStyle = 'black'
    context.fillRect(0, 0, width, height)
  }

  for (const action of actions) {
    if (action.tool === 'eraser') {
      context.globalCompositeOperation = mode === 'display' ? 'destination-out' : 'source-over'
      context.strokeStyle = mode === 'display' ? IMAGE_MASK_COLOR : 'black'
      context.fillStyle = mode === 'display' ? IMAGE_MASK_COLOR : 'black'
    } else {
      context.globalCompositeOperation = 'source-over'
      context.strokeStyle = mode === 'display' ? IMAGE_MASK_COLOR : 'white'
      context.fillStyle = mode === 'display' ? IMAGE_MASK_COLOR : 'white'
    }

    if (action.tool === 'rectangle' && action.rect) {
      context.fillRect(action.rect.x, action.rect.y, action.rect.width, action.rect.height)
    } else {
      drawBrushAction(context, action)
    }
  }

  context.globalCompositeOperation = 'source-over'
}

export function hasMaskPixels(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('2d')
  if (!context) return false
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] > 0 || data[index + 1] > 0 || data[index + 2] > 0) return true
  }
  return false
}

export function getRelativeImageMaskBounds({
  root,
  image,
}: {
  root: HTMLElement
  image: HTMLElement
}): ImageMaskBounds | null {
  const rootRect = root.getBoundingClientRect()
  const imageRect = image.getBoundingClientRect()
  if (imageRect.width <= 0 || imageRect.height <= 0) return null
  const scaleX = root.offsetWidth > 0 ? rootRect.width / root.offsetWidth : 1
  const scaleY = root.offsetHeight > 0 ? rootRect.height / root.offsetHeight : 1
  const width = imageRect.width / scaleX
  const height = imageRect.height / scaleY
  const isImageElement =
    typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement
  const naturalWidth = isImageElement && image.naturalWidth > 0 ? image.naturalWidth : width
  const naturalHeight = isImageElement && image.naturalHeight > 0 ? image.naturalHeight : height

  return {
    left: (imageRect.left - rootRect.left) / scaleX,
    top: (imageRect.top - rootRect.top) / scaleY,
    width,
    height,
    sourceWidth: naturalWidth,
    sourceHeight: naturalHeight,
  }
}
