import type { WorkflowState } from '@/stores/workflows/workflow/types'

const DEFAULT_BLOCK_WIDTH = 320
const DEFAULT_BLOCK_HEIGHT = 120

export interface PaneBlockSelectionInput {
  currentBlockIds: string[]
  blockId: string
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

export function mapCopiedTargetBlockIds(
  sourceBlockIds: string[],
  mappings: Record<string, string>
): string[] {
  const orderedTargetIds = sourceBlockIds
    .map((sourceBlockId) => mappings[sourceBlockId])
    .filter((targetBlockId): targetBlockId is string => Boolean(targetBlockId))
  const orderedSet = new Set(orderedTargetIds)
  const remainingTargetIds = Object.values(mappings).filter(
    (targetBlockId) => !orderedSet.has(targetBlockId)
  )
  return [...orderedTargetIds, ...remainingTargetIds]
}

export function describePaneSelection(blockIds: string[]): string {
  if (blockIds.length === 0) return 'Click nodes to copy'
  if (blockIds.length === 1) return `Selected ${blockIds[0]}`
  return `Selected ${blockIds.length} blocks`
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
