/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { findMatchingContentReferenceEdgeIds } from '@/lib/workflows/content-references'
import { createImageOutpaintReferenceEdge } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-outpaint-content-reference'

describe('createImageOutpaintReferenceEdge', () => {
  it('creates a result-to-source image reference edge that matches result contentReferences', () => {
    const edge = createImageOutpaintReferenceEdge({
      edgeId: 'edge-1',
      resultBlockId: 'result-node',
      sourceBlockId: 'source-node',
      resultPosition: { x: 500, y: 100 },
      sourcePosition: { x: 100, y: 100 },
    })
    const reference = {
      sourceBlockId: 'source-node',
      sourceVariant: 'image' as const,
      role: 'image_reference' as const,
    }

    expect(edge).toMatchObject({
      source: 'result-node',
      target: 'source-node',
      sourceHandle: 'content-reference-source-left',
      targetHandle: 'content-reference-target-right',
    })
    expect(
      findMatchingContentReferenceEdgeIds({
        targetBlockId: 'result-node',
        reference,
        edges: [edge],
      })
    ).toEqual(['edge-1'])
  })
})
