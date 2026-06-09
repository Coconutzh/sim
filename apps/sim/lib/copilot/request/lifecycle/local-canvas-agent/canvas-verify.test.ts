/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { CanvasSnapshot } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const { mockLoadCanvasSnapshot, mockReadCanvasNodeDetail } = vi.hoisted(() => ({
  mockLoadCanvasSnapshot: vi.fn(),
  mockReadCanvasNodeDetail: vi.fn(),
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context', () => ({
  loadCanvasSnapshot: mockLoadCanvasSnapshot,
  readCanvasNodeDetail: mockReadCanvasNodeDetail,
}))

import { verifyLocalCanvasPatch } from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-verify'

describe('local canvas patch verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves client node ids from created node title and kind before checking edges', async () => {
    const snapshot: CanvasSnapshot = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'real-script-id',
          name: '短视频脚本',
          blockType: 'content',
          kind: 'text',
          position: { x: 0, y: 0 },
          values: {},
          raw: {},
        },
        {
          id: 'real-image-id',
          name: '视觉画面',
          blockType: 'content',
          kind: 'image',
          position: { x: 360, y: 0 },
          values: {},
          raw: {},
        },
      ],
      edges: [{ source: 'real-script-id', target: 'real-image-id' }],
    }
    mockLoadCanvasSnapshot.mockResolvedValue(snapshot)

    const result = await verifyLocalCanvasPatch({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      selectedNodeIds: [],
      patch: {
        operations: [
          {
            type: 'create_node',
            clientNodeId: 'script',
            kind: 'text',
            title: '短视频脚本',
          },
          {
            type: 'create_node',
            clientNodeId: 'image',
            kind: 'image',
            title: '视觉画面',
          },
          {
            type: 'connect',
            operationId: 'connect-script-image',
            sourceNodeId: 'script',
            targetNodeId: 'image',
          },
        ],
      },
    })

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.operationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: 'connect-script-image',
          operationType: 'connect',
          sourceNodeId: 'real-script-id',
          targetNodeId: 'real-image-id',
          success: true,
        }),
      ])
    )
  })

  it('reports created node title and kind mismatches by operation id', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'real-script-id',
          name: '旧标题',
          blockType: 'content',
          kind: 'image',
          position: { x: 0, y: 0 },
          values: {},
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)

    const result = await verifyLocalCanvasPatch({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      selectedNodeIds: [],
      patch: {
        operations: [
          {
            type: 'create_node',
            operationId: 'create-script',
            nodeId: 'real-script-id',
            kind: 'text',
            title: '短视频脚本',
          },
        ],
      },
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContain(
      'Created node "real-script-id" kind was "image" instead of "text"'
    )
    expect(result.errors).toContain(
      'Created node "real-script-id" title was "旧标题" instead of "短视频脚本"'
    )
    expect(result.operationResults).toEqual([
      expect.objectContaining({
        operationId: 'create-script',
        operationType: 'create_node',
        nodeId: 'real-script-id',
        expected: { kind: 'text', title: '短视频脚本' },
        actual: { kind: 'image', title: '旧标题' },
        success: false,
        error:
          'Created node "real-script-id" kind was "image" instead of "text"; Created node "real-script-id" title was "旧标题" instead of "短视频脚本"',
      }),
    ])
  })

  it('verifies updated node field values after patch', async () => {
    const snapshot: CanvasSnapshot = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'text-1',
          name: 'Text 1',
          blockType: 'content',
          kind: 'text',
          position: { x: 0, y: 0 },
          values: {
            contentHtml: '<p>新的年轻化短视频口吻。</p>',
            aiPrompt: '改成年轻用户口吻',
          },
          raw: {},
        },
      ],
      edges: [],
    }
    mockLoadCanvasSnapshot.mockResolvedValue(snapshot)
    mockReadCanvasNodeDetail.mockReturnValue({
      id: 'text-1',
      name: 'Text 1',
      blockType: 'content',
      kind: 'text',
      position: { x: 0, y: 0 },
      selected: true,
      summary: '新的年轻化短视频口吻。',
      capabilities: {
        canRead: true,
        canWrite: true,
        canGenerate: true,
        canReferenceFile: false,
      },
      fields: snapshot.nodes[0].values,
      textContent: '新的年轻化短视频口吻。',
      file: null,
    })

    const result = await verifyLocalCanvasPatch({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      selectedNodeIds: ['text-1'],
      patch: {
        operations: [
          {
            type: 'update_node',
            operationId: 'update-text-copy',
            nodeId: 'text-1',
            fields: {
              contentHtml: '<p>新的年轻化短视频口吻。</p>',
              aiPrompt: '改成年轻用户口吻',
            },
          },
        ],
      },
    })

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.operationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: 'update-text-copy',
          operationType: 'update_node',
          nodeId: 'text-1',
          field: 'contentHtml',
          expected: '<p>新的年轻化短视频口吻。</p>',
          actual: '<p>新的年轻化短视频口吻。</p>',
          success: true,
        }),
      ])
    )
  })

  it('accepts contentHtml matches when only markup differs but text is identical', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'text-1',
          name: 'Text 1',
          blockType: 'content',
          kind: 'text',
          position: { x: 0, y: 0 },
          values: {
            contentHtml: '<div><strong>新的年轻化短视频口吻。</strong></div>',
          },
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)

    const result = await verifyLocalCanvasPatch({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      selectedNodeIds: ['text-1'],
      patch: {
        operations: [
          {
            type: 'update_node',
            operationId: 'update-text-copy',
            nodeId: 'text-1',
            fields: {
              contentHtml: '<p>新的年轻化短视频口吻。</p>',
            },
          },
        ],
      },
    })

    expect(result.success).toBe(true)
    expect(result.operationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: 'update-text-copy',
          field: 'contentHtml',
          success: true,
        }),
      ])
    )
  })

  it('fails verification when an updated field was not written', async () => {
    const snapshot: CanvasSnapshot = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'text-1',
          name: 'Text 1',
          blockType: 'content',
          kind: 'text',
          position: { x: 0, y: 0 },
          values: {
            contentHtml: '<p>旧文案。</p>',
            aiPrompt: '改成年轻用户口吻',
          },
          raw: {},
        },
      ],
      edges: [],
    }
    mockLoadCanvasSnapshot.mockResolvedValue(snapshot)
    mockReadCanvasNodeDetail.mockReturnValue({
      id: 'text-1',
      name: 'Text 1',
      blockType: 'content',
      kind: 'text',
      position: { x: 0, y: 0 },
      selected: true,
      summary: '旧文案。',
      capabilities: {
        canRead: true,
        canWrite: true,
        canGenerate: true,
        canReferenceFile: false,
      },
      fields: snapshot.nodes[0].values,
      textContent: '旧文案。',
      file: null,
    })

    const result = await verifyLocalCanvasPatch({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      selectedNodeIds: ['text-1'],
      patch: {
        operations: [
          {
            type: 'update_node',
            operationId: 'update-text-copy',
            nodeId: 'text-1',
            fields: {
              contentHtml: '<p>新的年轻化短视频口吻。</p>',
              aiPrompt: '改成年轻用户口吻',
            },
          },
        ],
      },
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContain('Field "contentHtml" was not written on node "text-1"')
    expect(result.operationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: 'update-text-copy',
          operationType: 'update_node',
          nodeId: 'text-1',
          field: 'contentHtml',
          expected: '<p>新的年轻化短视频口吻。</p>',
          actual: '<p>旧文案。</p>',
          success: false,
          error: 'Field "contentHtml" was not written on node "text-1"',
        }),
      ])
    )
  })

  it('accepts JSON-string persisted structured fields when verifying updates', async () => {
    const snapshot: CanvasSnapshot = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'video-1',
          name: 'Video 1',
          blockType: 'content',
          kind: 'video',
          position: { x: 0, y: 0 },
          values: {
            videoParameters: '{"resolution":"720P","duration":5}',
          },
          raw: {},
        },
      ],
      edges: [],
    }
    mockLoadCanvasSnapshot.mockResolvedValue(snapshot)
    mockReadCanvasNodeDetail.mockReturnValue({
      id: 'video-1',
      name: 'Video 1',
      blockType: 'content',
      kind: 'video',
      position: { x: 0, y: 0 },
      selected: true,
      summary: 'Video 1',
      capabilities: {
        canRead: true,
        canWrite: true,
        canGenerate: true,
        canReferenceFile: true,
      },
      fields: snapshot.nodes[0].values,
      file: null,
    })

    const result = await verifyLocalCanvasPatch({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      selectedNodeIds: ['video-1'],
      patch: {
        operations: [
          {
            type: 'update_node',
            nodeId: 'video-1',
            fields: {
              videoParameters: { resolution: '720P', duration: 5 },
            },
          },
        ],
      },
    })

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('verifies content reference fields, auto-link edges, and video media slots', async () => {
    const file = { key: 'private/image.png', name: 'image.png', type: 'image/png', size: 100 }
    mockLoadCanvasSnapshot.mockResolvedValue({
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
          values: {
            contentReferences: [
              {
                sourceBlockId: 'image-1',
                sourceVariant: 'image',
                role: 'video_first_frame',
              },
            ],
            videoMedia: [{ type: 'first_frame', file }],
          },
          raw: {},
        },
      ],
      edges: [
        {
          source: 'image-1',
          target: 'video-1',
          sourceHandle: 'content-reference-source-right',
          targetHandle: 'content-reference-target-left',
          data: { kind: 'content_reference', autoLinkType: 'video_first_frame' },
        },
      ],
    } satisfies CanvasSnapshot)

    const result = await verifyLocalCanvasPatch({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      selectedNodeIds: [],
      patch: {
        operations: [
          {
            type: 'add_content_reference',
            operationId: 'add-first-frame',
            consumerNodeId: 'video-1',
            sourceNodeId: 'image-1',
            role: 'video_first_frame',
          },
        ],
      },
    })

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.operationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: 'add-first-frame',
          field: 'contentReferences',
          success: true,
        }),
        expect.objectContaining({
          operationId: 'add-first-frame:edge',
          expected: expect.objectContaining({ autoLinkType: 'video_first_frame' }),
          success: true,
        }),
        expect.objectContaining({
          operationId: 'add-first-frame:videoMedia',
          field: 'videoMedia',
          success: true,
        }),
      ])
    )
  })

  it('verifies horizontal layout node positions after patch', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'text-1',
          name: 'Text 1',
          blockType: 'content',
          kind: 'text',
          position: { x: 0, y: 0 },
          values: {},
          raw: {},
        },
        {
          id: 'image-1',
          name: 'Image 1',
          blockType: 'content',
          kind: 'image',
          position: { x: 360, y: 0 },
          values: {},
          raw: {},
        },
        {
          id: 'video-1',
          name: 'Video 1',
          blockType: 'content',
          kind: 'video',
          position: { x: 720, y: 0 },
          values: {},
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)

    const result = await verifyLocalCanvasPatch({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      selectedNodeIds: [],
      patch: {
        operations: [
          { type: 'layout_nodes', operationId: 'layout-chain', direction: 'horizontal' },
        ],
      },
    })

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.operationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: 'layout-chain',
          operationType: 'layout_nodes',
          success: true,
          actual: expect.arrayContaining([
            expect.objectContaining({
              nodeId: 'image-1',
              expected: { x: 360, y: 0 },
              actual: { x: 360, y: 0 },
              success: true,
            }),
          ]),
        }),
      ])
    )
  })

  it('accepts autolayout-shifted positions for nodes created and laid out in the same patch', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'real-script-id',
          name: '脚本',
          blockType: 'content',
          kind: 'text',
          position: { x: 40, y: 80 },
          values: {},
          raw: {},
        },
        {
          id: 'real-visual-id',
          name: '主视觉',
          blockType: 'content',
          kind: 'image',
          position: { x: 520, y: 120 },
          values: {},
          raw: {},
        },
        {
          id: 'real-video-id',
          name: '视频',
          blockType: 'content',
          kind: 'video',
          position: { x: 980, y: 100 },
          values: {},
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)

    const result = await verifyLocalCanvasPatch({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      selectedNodeIds: [],
      patch: {
        operations: [
          { type: 'create_node', clientNodeId: 'script', kind: 'text', title: '脚本' },
          { type: 'create_node', clientNodeId: 'visual', kind: 'image', title: '主视觉' },
          { type: 'create_node', clientNodeId: 'video', kind: 'video', title: '视频' },
          {
            type: 'layout_nodes',
            operationId: 'layout-created-chain',
            direction: 'horizontal',
            nodeIds: ['script', 'visual', 'video'],
          },
        ],
      },
    })

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.operationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: 'layout-created-chain',
          operationType: 'layout_nodes',
          success: true,
          actual: expect.arrayContaining([
            expect.objectContaining({
              nodeId: 'real-visual-id',
              expected: expect.objectContaining({
                direction: 'horizontal',
                mode: 'directional_order',
              }),
              actual: { x: 520, y: 120 },
              success: true,
            }),
          ]),
        }),
      ])
    )
  })

  it('fails layout verification when positions do not match the requested direction', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'text-1',
          name: 'Text 1',
          blockType: 'content',
          kind: 'text',
          position: { x: 0, y: 0 },
          values: {},
          raw: {},
        },
        {
          id: 'image-1',
          name: 'Image 1',
          blockType: 'content',
          kind: 'image',
          position: { x: 100, y: 40 },
          values: {},
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)

    const result = await verifyLocalCanvasPatch({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      selectedNodeIds: [],
      patch: {
        operations: [
          { type: 'layout_nodes', operationId: 'layout-chain', direction: 'horizontal' },
        ],
      },
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContain(
      'Layout position for node "image-1" was not written after patch'
    )
    expect(result.operationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: 'layout-chain',
          operationType: 'layout_nodes',
          success: false,
          error: 'Layout position for node "image-1" was not written after patch',
        }),
      ])
    )
  })

  it('verifies generated output by target node id and field', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'image-1',
          name: 'Image 1',
          blockType: 'content',
          kind: 'image',
          position: { x: 0, y: 0 },
          values: {
            file: {
              name: 'generated.png',
              key: 'private/generated.png',
              url: 'https://files.example.test/private/generated.png',
              path: 'C:\\private\\generated.png',
              type: 'image/png',
              size: 1234,
            },
          },
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)

    const result = await verifyLocalCanvasPatch({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      selectedNodeIds: ['image-1'],
      generation: { nodeId: 'image-1', field: 'file' },
    })

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.operationResults).toEqual([
      expect.objectContaining({
        operationId: 'generation:image-1:file',
        operationType: 'generation',
        nodeId: 'image-1',
        field: 'file',
        expected: 'present',
        actual: { name: 'generated.png', type: 'image/png', size: 1234 },
        success: true,
      }),
    ])
    expect(JSON.stringify(result.operationResults)).not.toContain('private/generated.png')
    expect(JSON.stringify(result.operationResults)).not.toContain('files.example.test')
    expect(JSON.stringify(result.operationResults)).not.toContain('C:\\private')
  })

  it('fails generated output verification when the target field is empty', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'image-1',
          name: 'Image 1',
          blockType: 'content',
          kind: 'image',
          position: { x: 0, y: 0 },
          values: {},
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)

    const result = await verifyLocalCanvasPatch({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      selectedNodeIds: ['image-1'],
      generation: { nodeId: 'image-1', field: 'file' },
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContain('Generated field "file" was not written on node "image-1"')
  })
})
