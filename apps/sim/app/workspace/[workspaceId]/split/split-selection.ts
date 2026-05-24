import type { WorkflowState } from '@/stores/workflows/workflow/types'

const DEFAULT_BLOCK_WIDTH = 320
const DEFAULT_BLOCK_HEIGHT = 120

export interface PaneBlockSelectionInput {
  currentBlockIds: string[]
  blockId: string
  additive: boolean
}

export interface PaneEdgeSelectionInput {
  currentEdgeIds: string[]
  edgeId: string
  additive: boolean
}

export interface PaneViewportSnapshot {
  x: number
  y: number
  zoom: number
  width: number
  height: number
}

export interface CopyPlacement {
  offsetX: number
  offsetY: number
}

export interface PaneSelectionRectangle {
  left: number
  top: number
  right: number
  bottom: number
}

export function selectPaneBlock({
  currentBlockIds,
  blockId,
  additive,
}: PaneBlockSelectionInput): string[] {
  if (!blockId) return []
  if (!additive) return [blockId]
  if (currentBlockIds.includes(blockId)) {
    return currentBlockIds.filter((currentBlockId) => currentBlockId !== blockId)
  }
  return [...currentBlockIds, blockId]
}

export function selectPaneEdge({
  currentEdgeIds,
  edgeId,
  additive,
}: PaneEdgeSelectionInput): string[] {
  if (!edgeId) return []
  if (!additive) return [edgeId]
  if (currentEdgeIds.includes(edgeId)) {
    return currentEdgeIds.filter((currentEdgeId) => currentEdgeId !== edgeId)
  }
  return [...currentEdgeIds, edgeId]
}

function mapCopiedTargetIds(sourceIds: string[], mappings: Record<string, string>): string[] {
  const orderedTargetIds = sourceIds
    .map((sourceId) => mappings[sourceId])
    .filter((targetId): targetId is string => Boolean(targetId))
  const orderedSet = new Set(orderedTargetIds)
  const remainingTargetIds = Object.values(mappings).filter((targetId) => !orderedSet.has(targetId))
  return [...orderedTargetIds, ...remainingTargetIds]
}

export function mapCopiedTargetBlockIds(
  sourceBlockIds: string[],
  mappings: Record<string, string>
): string[] {
  return mapCopiedTargetIds(sourceBlockIds, mappings)
}

export function mapCopiedTargetEdgeIds(
  sourceEdgeIds: string[],
  mappings: Record<string, string>
): string[] {
  return mapCopiedTargetIds(sourceEdgeIds, mappings)
}

export function describePaneSelection(blockIds: string[], edgeIds: string[] = []): string {
  if (blockIds.length === 0 && edgeIds.length === 0) return 'Click nodes to copy'
  if (blockIds.length === 0) return 'Select endpoint nodes to copy selected edges'
  if (blockIds.length === 1 && edgeIds.length === 0) return `Selected ${blockIds[0]}`
  if (blockIds.length === 1 && edgeIds.length === 1) return `Selected ${blockIds[0]} + 1 edge`
  if (blockIds.length === 1) return `Selected ${blockIds[0]} + ${edgeIds.length} edges`
  if (edgeIds.length === 0) return `Selected ${blockIds.length} blocks`
  if (edgeIds.length === 1) return `Selected ${blockIds.length} blocks + 1 edge`
  return `Selected ${blockIds.length} blocks + ${edgeIds.length} edges`
}

function getBlockDimensions(block: WorkflowState['blocks'][string]): {
  width: number
  height: number
} {
  return {
    width: block.layout?.measuredWidth ?? block.data?.width ?? DEFAULT_BLOCK_WIDTH,
    height:
      block.layout?.measuredHeight ?? block.data?.height ?? block.height ?? DEFAULT_BLOCK_HEIGHT,
  }
}

function getAbsoluteBlockPosition(
  block: WorkflowState['blocks'][string],
  blocks: WorkflowState['blocks'],
  visited = new Set<string>()
): { x: number; y: number } {
  const parentId = block.data?.parentId
  if (!parentId || visited.has(parentId)) return block.position

  const parent = blocks[parentId]
  if (!parent) return block.position

  visited.add(parentId)
  const parentPosition = getAbsoluteBlockPosition(parent, blocks, visited)
  return {
    x: parentPosition.x + block.position.x,
    y: parentPosition.y + block.position.y,
  }
}

function rectanglesIntersect(a: PaneSelectionRectangle, b: PaneSelectionRectangle): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

export function computePaneBoxSelectedBlockIds(params: {
  workflowState?: WorkflowState | null
  viewport?: PaneViewportSnapshot | null
  rectangle: PaneSelectionRectangle
  minSize?: number
}): string[] {
  if (!params.workflowState || !params.viewport) return []
  const { workflowState, viewport } = params

  const minSize = params.minSize ?? 6
  const screenRectangle = {
    left: Math.min(params.rectangle.left, params.rectangle.right),
    top: Math.min(params.rectangle.top, params.rectangle.bottom),
    right: Math.max(params.rectangle.left, params.rectangle.right),
    bottom: Math.max(params.rectangle.top, params.rectangle.bottom),
  }

  if (
    screenRectangle.right - screenRectangle.left < minSize ||
    screenRectangle.bottom - screenRectangle.top < minSize
  ) {
    return []
  }

  const workflowRectangle = {
    left: (screenRectangle.left - viewport.x) / viewport.zoom,
    top: (screenRectangle.top - viewport.y) / viewport.zoom,
    right: (screenRectangle.right - viewport.x) / viewport.zoom,
    bottom: (screenRectangle.bottom - viewport.y) / viewport.zoom,
  }

  return Object.entries(workflowState.blocks)
    .filter(([, block]) => {
      const position = getAbsoluteBlockPosition(block, workflowState.blocks)
      const dimensions = getBlockDimensions(block)
      return rectanglesIntersect(workflowRectangle, {
        left: position.x,
        top: position.y,
        right: position.x + dimensions.width,
        bottom: position.y + dimensions.height,
      })
    })
    .map(([blockId]) => blockId)
}

export function computeViewportCenteredPlacement(params: {
  sourceBlockIds: string[]
  sourceWorkflowState?: WorkflowState | null
  targetViewport?: PaneViewportSnapshot | null
  fallback: CopyPlacement
}): CopyPlacement {
  if (!params.sourceWorkflowState || !params.targetViewport || params.sourceBlockIds.length === 0) {
    return params.fallback
  }

  const selectedBlocks = params.sourceBlockIds
    .map((blockId) => params.sourceWorkflowState?.blocks[blockId])
    .filter((block): block is WorkflowState['blocks'][string] => Boolean(block))

  if (selectedBlocks.length === 0) return params.fallback

  const bounds = selectedBlocks.reduce(
    (accumulator, block) => {
      const dimensions = getBlockDimensions(block)
      const left = block.position.x
      const top = block.position.y
      const right = left + dimensions.width
      const bottom = top + dimensions.height
      return {
        minX: Math.min(accumulator.minX, left),
        minY: Math.min(accumulator.minY, top),
        maxX: Math.max(accumulator.maxX, right),
        maxY: Math.max(accumulator.maxY, bottom),
      }
    },
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    }
  )
  const sourceCenter = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }
  const targetCenter = {
    x: (params.targetViewport.width / 2 - params.targetViewport.x) / params.targetViewport.zoom,
    y: (params.targetViewport.height / 2 - params.targetViewport.y) / params.targetViewport.zoom,
  }

  return {
    offsetX: Math.round(targetCenter.x - sourceCenter.x),
    offsetY: Math.round(targetCenter.y - sourceCenter.y),
  }
}
