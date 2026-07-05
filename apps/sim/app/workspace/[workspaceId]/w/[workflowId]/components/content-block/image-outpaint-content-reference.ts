import type { XYPosition } from 'reactflow'
import {
  createContentReferenceEdge,
  getOrdinaryContentReferenceHandles,
} from '@/lib/workflows/content-reference-edges'

export function createImageOutpaintReferenceEdge({
  edgeId,
  resultBlockId,
  sourceBlockId,
}: {
  edgeId: string
  resultBlockId: string
  sourceBlockId: string
  resultPosition: XYPosition
  sourcePosition: XYPosition
}) {
  return createContentReferenceEdge({
    id: edgeId,
    source: resultBlockId,
    target: sourceBlockId,
    ...getOrdinaryContentReferenceHandles(),
  })
}
