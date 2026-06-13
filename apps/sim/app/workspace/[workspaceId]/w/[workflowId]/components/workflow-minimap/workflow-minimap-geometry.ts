import type { Node } from 'reactflow'
import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import { createNodeGeometrySnapshot } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-node-utilities'
import type { BlockState } from '@/stores/workflows/workflow/types'

export interface MinimapSize {
  width: number
  height: number
  padding: number
}

export interface MinimapRect {
  x: number
  y: number
  width: number
  height: number
}

export interface MinimapPoint {
  x: number
  y: number
}

export interface MinimapTransform {
  scale: number
  offsetX: number
  offsetY: number
}

export interface MinimapViewport {
  x: number
  y: number
  zoom: number
}

export interface MinimapVisibleBounds {
  width: number
  height: number
  offsetLeft: number
}

type NodeDataWithSize = {
  width?: unknown
  height?: unknown
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getNodeDataSize(node: Node): { width?: number; height?: number } {
  const data = node.data as NodeDataWithSize | undefined
  return {
    width: getNumber(data?.width) ?? undefined,
    height: getNumber(data?.height) ?? undefined,
  }
}

export function getMinimapNodeSize(
  node: Node,
  block?: BlockState
): { width: number; height: number } {
  const dataSize = getNodeDataSize(node)

  if (node.type === 'subflowNode' || block?.type === 'loop' || block?.type === 'parallel') {
    return {
      width:
        dataSize.width ??
        getNumber(node.width) ??
        getNumber(block?.data?.width) ??
        CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
      height:
        dataSize.height ??
        getNumber(node.height) ??
        getNumber(block?.data?.height) ??
        CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
    }
  }

  return {
    width:
      getNumber(node.width) ??
      getNumber(block?.layout?.measuredWidth) ??
      getNumber(block?.data?.width) ??
      BLOCK_DIMENSIONS.FIXED_WIDTH,
    height:
      getNumber(node.height) ??
      getNumber(block?.layout?.measuredHeight) ??
      getNumber(block?.height) ??
      BLOCK_DIMENSIONS.MIN_HEIGHT,
  }
}

export function getMinimapNodeRects(
  nodes: Node[],
  blocks: Record<string, BlockState>
): MinimapRect[] {
  if (nodes.length === 0) return []

  const snapshot = createNodeGeometrySnapshot(nodes, blocks)

  return nodes.flatMap((node) => {
    const block = blocks[node.id]
    const { width, height } = getMinimapNodeSize(node, block)
    const position = snapshot.getNodeAbsolutePosition(node.id)

    if (width <= 0 || height <= 0) return []

    return [
      {
        x: position.x,
        y: position.y,
        width,
        height,
      },
    ]
  })
}

export function getRectBounds(rects: MinimapRect[]): MinimapRect | null {
  if (rects.length === 0) return null

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  rects.forEach((rect) => {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  })

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return null
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

export function getMinimapSceneBounds(
  nodeRects: MinimapRect[],
  visibleFlowRect: MinimapRect | null
): MinimapRect | null {
  return getRectBounds(visibleFlowRect ? [...nodeRects, visibleFlowRect] : nodeRects)
}

export function getMinimapTransform(
  bounds: MinimapRect,
  size: MinimapSize
): MinimapTransform | null {
  const contentWidth = size.width - size.padding * 2
  const contentHeight = size.height - size.padding * 2

  if (contentWidth <= 0 || contentHeight <= 0 || bounds.width <= 0 || bounds.height <= 0) {
    return null
  }

  const scale = Math.min(contentWidth / bounds.width, contentHeight / bounds.height)
  if (!Number.isFinite(scale) || scale <= 0) return null

  return {
    scale,
    offsetX: size.padding + (contentWidth - bounds.width * scale) / 2 - bounds.x * scale,
    offsetY: size.padding + (contentHeight - bounds.height * scale) / 2 - bounds.y * scale,
  }
}

export function projectRectToMinimap(rect: MinimapRect, transform: MinimapTransform): MinimapRect {
  return {
    x: rect.x * transform.scale + transform.offsetX,
    y: rect.y * transform.scale + transform.offsetY,
    width: rect.width * transform.scale,
    height: rect.height * transform.scale,
  }
}

export function unprojectPointFromMinimap(
  point: MinimapPoint,
  transform: MinimapTransform
): MinimapPoint | null {
  if (transform.scale <= 0) return null

  return {
    x: (point.x - transform.offsetX) / transform.scale,
    y: (point.y - transform.offsetY) / transform.scale,
  }
}

export function getViewportForMinimapPoint(
  point: MinimapPoint,
  transform: MinimapTransform,
  viewport: MinimapViewport,
  visibleBounds: MinimapVisibleBounds
): MinimapViewport | null {
  const flowPoint = unprojectPointFromMinimap(point, transform)
  if (!flowPoint || viewport.zoom <= 0 || visibleBounds.width <= 0 || visibleBounds.height <= 0) {
    return null
  }

  return {
    x: visibleBounds.offsetLeft + visibleBounds.width / 2 - flowPoint.x * viewport.zoom,
    y: visibleBounds.height / 2 - flowPoint.y * viewport.zoom,
    zoom: viewport.zoom,
  }
}
