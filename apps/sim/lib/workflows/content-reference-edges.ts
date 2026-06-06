import type { Edge } from 'reactflow'
import type { ContentNodeVariant } from '@/lib/workflows/content-references'
import type { BlockState } from '@/stores/workflows/workflow/types'

export const CONTENT_REFERENCE_EDGE_KIND = 'content_reference'

export type ContentReferenceEdgeKind = typeof CONTENT_REFERENCE_EDGE_KIND

export type ContentReferenceAutoLinkType = 'video_first_frame' | 'video_last_frame'
export type ContentReferenceAnchor = 'left' | 'right'

export interface ContentReferenceEdgeData {
  kind: ContentReferenceEdgeKind
  autoLinkType?: ContentReferenceAutoLinkType
}

export interface ContentReferenceSelectionSession {
  sourceBlockId: string
  sourceVariant: ContentNodeVariant
  sourceModel: string
  allowedSourceVariants: ContentNodeVariant[]
  sourceAnchor: ContentReferenceAnchor
  mode: 'content_reference'
}

export const CONTENT_REFERENCE_SOURCE_HANDLE_PREFIX = 'content-reference-source'
export const CONTENT_REFERENCE_TARGET_HANDLE_PREFIX = 'content-reference-target'

export function isContentBlockState(block: BlockState | undefined): boolean {
  return block?.type === 'content'
}

export function isContentReferenceEdge(edge: Pick<Edge, 'data'> | null | undefined): boolean {
  return (edge?.data as { kind?: unknown } | undefined)?.kind === CONTENT_REFERENCE_EDGE_KIND
}

export function getContentReferenceAutoLinkType(
  edge: Pick<Edge, 'data'> | null | undefined
): ContentReferenceAutoLinkType | null {
  if (!isContentReferenceEdge(edge)) return null
  const autoLinkType = (edge?.data as { autoLinkType?: unknown } | undefined)?.autoLinkType
  return autoLinkType === 'video_first_frame' || autoLinkType === 'video_last_frame'
    ? autoLinkType
    : null
}

export function createContentReferenceEdge(params: {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  autoLinkType?: ContentReferenceAutoLinkType
}): Edge {
  return {
    id: params.id,
    source: params.source,
    target: params.target,
    sourceHandle: params.sourceHandle,
    targetHandle: params.targetHandle,
    type: 'workflowEdge',
    data: {
      kind: CONTENT_REFERENCE_EDGE_KIND,
      ...(params.autoLinkType ? { autoLinkType: params.autoLinkType } : {}),
    } satisfies ContentReferenceEdgeData,
  }
}

export function getContentReferencePairKey(source: string, target: string): string {
  return [source, target].sort().join('::')
}

export function isDuplicateContentReferenceEdge(
  candidate: Pick<Edge, 'source' | 'target' | 'data'>,
  existing: Pick<Edge, 'source' | 'target' | 'data'>
): boolean {
  return (
    isContentReferenceEdge(candidate) &&
    isContentReferenceEdge(existing) &&
    getContentReferencePairKey(candidate.source, candidate.target) ===
      getContentReferencePairKey(existing.source, existing.target)
  )
}

export function isValidContentReferenceConnection(
  edge: Pick<Edge, 'source' | 'target'>,
  blocks: Record<string, BlockState>
): boolean {
  if (edge.source === edge.target) return false
  return isContentBlockState(blocks[edge.source]) && isContentBlockState(blocks[edge.target])
}

export function findAutoVideoContentReferenceEdge(
  edges: Edge[],
  videoBlockId: string,
  autoLinkType: ContentReferenceAutoLinkType
): Edge | undefined {
  return edges.find(
    (edge) =>
      edge.target === videoBlockId &&
      getContentReferenceAutoLinkType(edge) === autoLinkType &&
      isContentReferenceEdge(edge)
  )
}

export function getContentReferenceSourceHandleId(anchor: ContentReferenceAnchor): string {
  return `${CONTENT_REFERENCE_SOURCE_HANDLE_PREFIX}-${anchor}`
}

export function getContentReferenceTargetHandleId(anchor: ContentReferenceAnchor): string {
  return `${CONTENT_REFERENCE_TARGET_HANDLE_PREFIX}-${anchor}`
}

export function getContentReferenceAnchorForTarget(params: {
  sourceX: number
  targetX: number
}): ContentReferenceAnchor {
  return params.targetX >= params.sourceX ? 'left' : 'right'
}
