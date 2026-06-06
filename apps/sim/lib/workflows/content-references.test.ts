import { describe, expect, it } from 'vitest'
import {
  buildContentReferencePromptContext,
  buildStructuredContentReferenceContext,
  findMatchingContentReferenceEdgeIds,
  getAllowedReferenceSourceVariants,
  getContentReferenceCapability,
  getModelDisabledReason,
  inferContentReferencesFromCanvas,
  normalizeContentReferences,
  type ContentReferenceRecord,
} from '@/lib/workflows/content-references'
import { CONTENT_REFERENCE_EDGE_KIND } from '@/lib/workflows/content-reference-edges'

describe('content reference capabilities', () => {
  it('allows Gemini image models to reference both text and image nodes', () => {
    expect(getAllowedReferenceSourceVariants('image', 'gemini-3.1-flash-image-preview')).toEqual([
      'text',
      'image',
    ])
  })

  it('restricts Jimeng image models to text references only', () => {
    expect(getAllowedReferenceSourceVariants('image', 'jimeng-4.5')).toEqual(['text'])
  })

  it('lets Gemini text models keep image references but blocks switching to text-only models', () => {
    const references: ContentReferenceRecord[] = [
      {
        sourceBlockId: 'image-1',
        sourceVariant: 'image',
        role: 'image_reference',
      },
    ]

    expect(
      getContentReferenceCapability('text', 'gemini-2.5-flash').supportedRoles
    ).toContain('image_reference')

    expect(
      getModelDisabledReason({
        targetVariant: 'text',
        model: 'glm-4.7',
        references,
      })
    ).toContain('image')
  })

  it('prevents GLM text models from selecting image nodes as references', () => {
    expect(getAllowedReferenceSourceVariants('text', 'glm-4.7')).toEqual(['text', 'video', 'audio'])
  })

  it('returns slot-based video capabilities for the supported Wan models', () => {
    expect(getContentReferenceCapability('video', 'wan2.6-t2v')).toMatchObject({
      selectionMode: 'slot',
      slots: [],
    })

    expect(getContentReferenceCapability('video', 'wan2.6-i2v-flash')).toMatchObject({
      selectionMode: 'slot',
      slots: [{ role: 'video_first_frame', sourceVariants: ['image'] }],
    })

    expect(getContentReferenceCapability('video', 'wan2.7-i2v')).toMatchObject({
      selectionMode: 'slot',
      slots: [
        { role: 'video_first_frame', sourceVariants: ['image'] },
        { role: 'video_last_frame', sourceVariants: ['image'] },
      ],
    })
  })

  it('disables models that cannot satisfy the current references', () => {
    const references: ContentReferenceRecord[] = [
      {
        sourceBlockId: 'image-1',
        sourceVariant: 'image',
        role: 'image_reference',
      },
    ]

    expect(
      getModelDisabledReason({
        targetVariant: 'image',
        model: 'jimeng-4.5',
        references,
      })
    ).toContain('image')

    expect(
      getModelDisabledReason({
        targetVariant: 'image',
        model: 'gemini-3.1-flash-image-preview',
        references,
      })
    ).toBeNull()
  })
})

describe('content reference prompt context', () => {
  it('normalizes references and drops invalid values', () => {
    expect(
      normalizeContentReferences([
        {
          sourceBlockId: 'text-1',
          sourceVariant: 'text',
          role: 'text_context',
        },
        {
          sourceBlockId: '',
          sourceVariant: 'audio',
          role: 'audio_reference',
        },
      ])
    ).toEqual([
      {
        sourceBlockId: 'text-1',
        sourceVariant: 'text',
        role: 'text_context',
      },
    ])
  })

  it('builds structured prompt context from mixed references', () => {
    const context = buildContentReferencePromptContext({
      references: [
        {
          sourceBlockId: 'text-1',
          sourceVariant: 'text',
          role: 'text_context',
        },
        {
          sourceBlockId: 'image-1',
          sourceVariant: 'image',
          role: 'image_reference',
        },
        {
          sourceBlockId: 'audio-1',
          sourceVariant: 'audio',
          role: 'audio_reference',
        },
      ],
      referencedNodes: {
        'text-1': {
          name: 'Scene Notes',
          variant: 'text',
          textContent: 'Neon alley, rainy night, reflective pavement.',
        },
        'image-1': {
          name: 'Moodboard',
          variant: 'image',
          file: {
            name: 'moodboard.png',
            url: 'https://example.com/moodboard.png',
          },
        },
        'audio-1': {
          name: 'Scratch Track',
          variant: 'audio',
          file: {
            name: 'scratch.mp3',
            url: 'https://example.com/scratch.mp3',
          },
        },
      },
    })

    expect(context).toContain('Referenced canvas context')
    expect(context).toContain('Scene Notes')
    expect(context).toContain('Neon alley, rainy night')
    expect(context).toContain('Moodboard')
    expect(context).toContain('https://example.com/moodboard.png')
    expect(context).toContain('Scratch Track')
    expect(context).toContain('https://example.com/scratch.mp3')
  })

  it('builds structured request context for downstream media models', () => {
    const context = buildStructuredContentReferenceContext({
      references: [
        {
          sourceBlockId: 'text-1',
          sourceVariant: 'text',
          role: 'text_context',
        },
        {
          sourceBlockId: 'image-1',
          sourceVariant: 'image',
          role: 'image_reference',
        },
      ],
      referencedNodes: {
        'text-1': {
          name: 'Prompt Notes',
          variant: 'text',
          textContent: 'Keep the scene quiet and cinematic.',
        },
        'image-1': {
          name: 'Board',
          variant: 'image',
          file: {
            name: 'board.png',
            url: 'https://example.com/board.png',
            key: 'workspace/board.png',
            size: 128,
            type: 'image/png',
          },
        },
      },
    })

    expect(context.text).toEqual(['Keep the scene quiet and cinematic.'])
    expect(context.images).toEqual([
      {
        id: '',
        name: 'board.png',
        url: 'https://example.com/board.png',
        key: 'workspace/board.png',
        size: 128,
        type: 'image/png',
        context: undefined,
        base64: undefined,
      },
    ])
  })
})

describe('content reference canvas reconciliation', () => {
  it('infers legacy multi-select references from existing content edges', () => {
    const references = inferContentReferencesFromCanvas({
      targetBlockId: 'image-target',
      targetVariant: 'image',
      model: 'gemini-3.1-flash-image-preview',
      edges: [
        {
          id: 'edge-1',
          source: 'image-target',
          target: 'image-source',
          data: { kind: CONTENT_REFERENCE_EDGE_KIND },
        },
      ],
      candidateBlockIds: ['image-target', 'image-source'],
      resolveVariant: (blockId) => (blockId === 'image-source' ? 'image' : 'image'),
      resolveFileKey: () => null,
    })

    expect(references).toEqual([
      {
        sourceBlockId: 'image-source',
        sourceVariant: 'image',
        role: 'image_reference',
      },
    ])
  })

  it('infers missing video frame references from current video media by file key', () => {
    const references = inferContentReferencesFromCanvas({
      targetBlockId: 'video-target',
      targetVariant: 'video',
      model: 'wan2.7-i2v',
      edges: [],
      candidateBlockIds: ['video-target', 'image-first', 'image-last'],
      resolveVariant: (blockId) => (blockId === 'video-target' ? 'video' : 'image'),
      resolveFileKey: (blockId) =>
        blockId === 'image-first'
          ? 'workspace/first.png'
          : blockId === 'image-last'
            ? 'workspace/last.png'
            : null,
      videoMedia: [
        {
          type: 'first_frame',
          file: { key: 'workspace/first.png' },
        },
        {
          type: 'last_frame',
          file: { key: 'workspace/last.png' },
        },
      ],
    })

    expect(references).toEqual([
      {
        sourceBlockId: 'image-first',
        sourceVariant: 'image',
        role: 'video_first_frame',
      },
      {
        sourceBlockId: 'image-last',
        sourceVariant: 'image',
        role: 'video_last_frame',
      },
    ])
  })

  it('finds matching edges for both legacy and auto-linked references', () => {
    const edges = [
      {
        id: 'legacy-edge',
        source: 'text-target',
        target: 'image-source',
        data: { kind: CONTENT_REFERENCE_EDGE_KIND },
      },
      {
        id: 'video-edge',
        source: 'image-source',
        target: 'video-target',
        data: { kind: CONTENT_REFERENCE_EDGE_KIND, autoLinkType: 'video_first_frame' },
      },
    ]

    expect(
      findMatchingContentReferenceEdgeIds({
        targetBlockId: 'text-target',
        reference: {
          sourceBlockId: 'image-source',
          sourceVariant: 'image',
          role: 'text_context',
        },
        edges,
      })
    ).toEqual(['legacy-edge'])

    expect(
      findMatchingContentReferenceEdgeIds({
        targetBlockId: 'video-target',
        reference: {
          sourceBlockId: 'image-source',
          sourceVariant: 'image',
          role: 'video_first_frame',
        },
        edges,
      })
    ).toEqual(['video-edge'])
  })
})
