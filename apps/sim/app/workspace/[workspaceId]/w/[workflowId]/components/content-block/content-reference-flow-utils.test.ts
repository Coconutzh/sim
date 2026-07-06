import { describe, expect, it } from 'vitest'
import {
  createContentReferenceEdge,
  getOrdinaryContentReferenceHandles,
} from '@/lib/workflows/content-reference-edges'
import { getAllowedReferenceSourceVariants } from '@/lib/workflows/content-references'
import {
  getContentReferenceCreateTargetVariants,
  getNextContentReferencesForSource,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-reference-flow-utils'

describe('content block reference flow helpers', () => {
  it('allows an image node side plus menu to create an image target', () => {
    expect(getContentReferenceCreateTargetVariants('image')).toEqual(['text', 'image', 'video'])
  })

  it('allows side plus drag from an image node to an image node', () => {
    const result = getNextContentReferencesForSource({
      targetVariant: 'image',
      targetModel: 'jimeng-4.5',
      targetReferences: [],
      sourceBlockId: 'image-b',
      sourceVariant: 'image',
    })
    const edge = createContentReferenceEdge({
      id: 'edge-1',
      source: 'image-a',
      target: 'image-b',
      ...getOrdinaryContentReferenceHandles(),
    })

    expect(result).toEqual({
      referenceRole: 'image_reference',
      nextReferences: [
        {
          sourceBlockId: 'image-b',
          sourceVariant: 'image',
          role: 'image_reference',
        },
      ],
      disabledReason: null,
    })
    expect(edge).toMatchObject({
      source: 'image-a',
      target: 'image-b',
      sourceHandle: 'content-reference-source-left',
      targetHandle: 'content-reference-target-right',
    })
  })

  it('allows AI composer existing-node selection to choose an image node', () => {
    expect(getAllowedReferenceSourceVariants('image', 'jimeng-4.5')).toContain('image')

    const result = getNextContentReferencesForSource({
      targetVariant: 'image',
      targetModel: 'jimeng-4.5',
      targetReferences: [],
      sourceBlockId: 'selected-image',
      sourceVariant: 'image',
    })

    expect(result.referenceRole).toBe('image_reference')
    expect(result.disabledReason).toBeNull()
    expect(result.nextReferences).toEqual([
      {
        sourceBlockId: 'selected-image',
        sourceVariant: 'image',
        role: 'image_reference',
      },
    ])
  })

  it('keeps image references blocked for image models without image-reference capability', () => {
    const result = getNextContentReferencesForSource({
      targetVariant: 'image',
      targetModel: 'legacy-image-model',
      targetReferences: [],
      sourceBlockId: 'source-image',
      sourceVariant: 'image',
    })

    expect(result.referenceRole).toBeNull()
    expect(result.disabledReason).toBe('This node cannot be used as a reference.')
  })
})
