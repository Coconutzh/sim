import type { XYPosition } from 'reactflow'
import {
  createContentReferenceEdge,
  getContentReferenceAnchorForTarget,
  getContentReferenceSourceHandleId,
  getContentReferenceTargetHandleId,
} from '@/lib/workflows/content-reference-edges'

export function createImageOutpaintReferenceEdge({
  edgeId,
  resultBlockId,
  sourceBlockId,
  resultPosition,
  sourcePosition,
}: {
  edgeId: string
  resultBlockId: string
  sourceBlockId: string
  resultPosition: XYPosition
  sourcePosition: XYPosition
}) {
  const targetAnchor = getContentReferenceAnchorForTarget({
    sourceX: resultPosition.x,
    targetX: sourcePosition.x,
  })

  return createContentReferenceEdge({
    id: edgeId,
    source: resultBlockId,
    target: sourceBlockId,
    sourceHandle: getContentReferenceSourceHandleId(
      sourcePosition.x >= resultPosition.x ? 'right' : 'left'
    ),
    targetHandle: getContentReferenceTargetHandleId(targetAnchor),
  })
}
