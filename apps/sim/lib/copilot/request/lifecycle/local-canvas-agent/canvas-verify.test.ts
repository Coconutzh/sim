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
          { type: 'connect', sourceNodeId: 'script', targetNodeId: 'image' },
        ],
      },
    })

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
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
        operations: [{ type: 'layout_nodes', direction: 'horizontal' }],
      },
    })

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
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
        operations: [{ type: 'layout_nodes', direction: 'horizontal' }],
      },
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContain(
      'Layout position for node "image-1" was not written after patch'
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
          values: { file: { name: 'generated.png' } },
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
