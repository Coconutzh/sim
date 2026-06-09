/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildEditWorkflowOperationsFromPatch,
  validateLocalCanvasPatch,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-patch'
import type { CanvasSnapshot } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

describe('local canvas patch validation', () => {
  it('accepts connections between nodes created in the same patch using client node ids', () => {
    const snapshot: CanvasSnapshot = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    }

    const result = validateLocalCanvasPatch(
      {
        operations: [
          {
            type: 'create_node',
            clientNodeId: 'new_script',
            kind: 'text',
            title: '短视频脚本',
            fields: { contentHtml: '<p>脚本</p>' },
          },
          {
            type: 'create_node',
            clientNodeId: 'new_image',
            kind: 'image',
            title: '视觉画面',
            fields: { aiPrompt: '主视觉' },
          },
          { type: 'connect', sourceNodeId: 'new_script', targetNodeId: 'new_image' },
        ],
      },
      snapshot
    )

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('preserves existing outgoing content reference edges when adding another connection', () => {
    const snapshot: CanvasSnapshot = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'video-1',
          name: 'Video 1',
          blockType: 'content',
          kind: 'video',
          position: { x: 720, y: 0 },
          values: {},
          raw: {},
        },
        {
          id: 'audio-1',
          name: 'Audio 1',
          blockType: 'content',
          kind: 'audio',
          position: { x: 1080, y: 0 },
          values: {},
          raw: {},
        },
        {
          id: 'text-1',
          name: 'Text 1',
          blockType: 'content',
          kind: 'text',
          position: { x: 1080, y: 220 },
          values: {},
          raw: {},
        },
      ],
      edges: [
        {
          source: 'video-1',
          target: 'audio-1',
          sourceHandle: 'content-reference-source-right',
          targetHandle: 'content-reference-target-left',
        },
      ],
    }

    const { operations } = buildEditWorkflowOperationsFromPatch({
      snapshot,
      patch: {
        operations: [{ type: 'connect', sourceNodeId: 'video-1', targetNodeId: 'text-1' }],
      },
    })

    expect(operations).toHaveLength(1)
    expect(operations[0]).toMatchObject({
      operation_type: 'edit',
      block_id: 'video-1',
      params: {
        connections: {
          'content-reference-source-right': expect.arrayContaining([
            { block: 'audio-1', handle: 'content-reference-target-left' },
            { block: 'text-1', handle: 'content-reference-target-left' },
          ]),
        },
      },
    })
  })

  it('compiles add_content_reference into contentReferences and a semantic reference edge', () => {
    const snapshot: CanvasSnapshot = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'image-1',
          name: 'Image 1',
          blockType: 'content',
          kind: 'image',
          position: { x: 0, y: 0 },
          values: { contentReferences: [] },
          raw: {},
        },
        {
          id: 'text-1',
          name: 'Text 1',
          blockType: 'content',
          kind: 'text',
          position: { x: 360, y: 0 },
          values: {},
          raw: {},
        },
      ],
      edges: [],
    }

    const { operations } = buildEditWorkflowOperationsFromPatch({
      snapshot,
      patch: {
        operations: [
          {
            type: 'add_content_reference',
            consumerNodeId: 'image-1',
            sourceNodeId: 'text-1',
            role: 'text_context',
          },
        ],
      },
    })

    expect(operations).toEqual([
      expect.objectContaining({
        operation_type: 'edit',
        block_id: 'image-1',
        params: {
          inputs: {
            contentReferences: [
              {
                sourceBlockId: 'text-1',
                sourceVariant: 'text',
                role: 'text_context',
              },
            ],
          },
        },
      }),
      expect.objectContaining({
        operation_type: 'edit',
        block_id: 'image-1',
        params: {
          connections: {
            'content-reference-source-right': {
              block: 'text-1',
              handle: 'content-reference-target-left',
            },
          },
        },
      }),
    ])
  })

  it('syncs video first-frame references to contentReferences, videoMedia, and auto-link edges', () => {
    const file = { key: 'private/image.png', name: 'image.png', type: 'image/png', size: 100 }
    const snapshot: CanvasSnapshot = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'image-1',
          name: 'Image 1',
          blockType: 'content',
          kind: 'image',
          position: { x: 0, y: 0 },
          values: { file },
          raw: {},
        },
        {
          id: 'video-1',
          name: 'Video 1',
          blockType: 'content',
          kind: 'video',
          position: { x: 360, y: 0 },
          values: { contentReferences: [], videoMedia: [] },
          raw: {},
        },
      ],
      edges: [],
    }

    const { operations } = buildEditWorkflowOperationsFromPatch({
      snapshot,
      patch: {
        operations: [
          {
            type: 'add_content_reference',
            consumerNodeId: 'video-1',
            sourceNodeId: 'image-1',
            role: 'video_first_frame',
          },
        ],
      },
    })

    expect(operations[0]).toMatchObject({
      operation_type: 'edit',
      block_id: 'video-1',
      params: {
        inputs: {
          contentReferences: [
            {
              sourceBlockId: 'image-1',
              sourceVariant: 'image',
              role: 'video_first_frame',
            },
          ],
          videoMedia: [{ type: 'first_frame', file }],
        },
      },
    })
    expect(operations[1]).toMatchObject({
      operation_type: 'edit',
      block_id: 'image-1',
      params: {
        connections: {
          'content-reference-source-right': {
            block: 'video-1',
            handle: 'content-reference-target-left',
            autoLinkType: 'video_first_frame',
          },
        },
      },
    })
  })
})
