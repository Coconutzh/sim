/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CanvasSnapshot,
  LocalAgentContext,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const {
  mockBuildCanvasSummaryText,
  mockConvertGeneratedTextToContentHtml,
  mockEditWorkflowExecute,
  mockGenerateContentCanvasText,
  mockGenerateWorkspaceAudioFromPrompt,
  mockGenerateWorkspaceImageFromPrompt,
  mockGenerateWorkspaceVideoFromPrompt,
  mockLoadCanvasSnapshot,
  mockReadCanvasNodeDetail,
  mockSearchCanvasNodes,
  mockSummarizeCanvas,
} = vi.hoisted(() => ({
  mockBuildCanvasSummaryText: vi.fn(),
  mockConvertGeneratedTextToContentHtml: vi.fn(),
  mockEditWorkflowExecute: vi.fn(),
  mockGenerateContentCanvasText: vi.fn(),
  mockGenerateWorkspaceAudioFromPrompt: vi.fn(),
  mockGenerateWorkspaceImageFromPrompt: vi.fn(),
  mockGenerateWorkspaceVideoFromPrompt: vi.fn(),
  mockLoadCanvasSnapshot: vi.fn(),
  mockReadCanvasNodeDetail: vi.fn(),
  mockSearchCanvasNodes: vi.fn(),
  mockSummarizeCanvas: vi.fn(),
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context', () => ({
  buildCanvasSummaryText: mockBuildCanvasSummaryText,
  loadCanvasSnapshot: mockLoadCanvasSnapshot,
  readCanvasNodeDetail: mockReadCanvasNodeDetail,
  searchCanvasNodes: mockSearchCanvasNodes,
  summarizeCanvas: mockSummarizeCanvas,
}))

vi.mock('@/lib/content-canvas/text-executor', () => ({
  generateContentCanvasText: mockGenerateContentCanvasText,
}))

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/text-content-ai-utils',
  () => ({
    convertGeneratedTextToContentHtml: mockConvertGeneratedTextToContentHtml,
  })
)

vi.mock('@/lib/copilot/tools/server/workflow/edit-workflow', () => ({
  editWorkflowServerTool: {
    execute: mockEditWorkflowExecute,
  },
}))

vi.mock('@/lib/generated-media/image/image-generation-service', () => ({
  generateWorkspaceImageFromPrompt: mockGenerateWorkspaceImageFromPrompt,
}))

vi.mock('@/lib/generated-media/video/video-generation-service', () => ({
  generateWorkspaceVideoFromPrompt: mockGenerateWorkspaceVideoFromPrompt,
}))

vi.mock('@/lib/generated-media/audio/audio-generation-service', () => ({
  generateWorkspaceAudioFromPrompt: mockGenerateWorkspaceAudioFromPrompt,
}))

import { executeCanvasTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-tools'

function buildContext(): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    message: '生成这个节点的内容并写回',
    sessionScope: 'personal',
    agent: {
      code: 'local_canvas_agent',
      name: 'Canvas Agent',
      description: '',
      systemPrompt: '你是总导演 Agent，需要以总导演身份发言。',
    },
    discipline: { id: '', code: 'canvas_runtime', name: 'Canvas Runtime' },
    workgroup: {
      id: '',
      name: 'Workspace',
      organizationId: '',
      teamWorkspaceId: null,
    },
    permissions: { canRead: true, canWrite: true, canPublish: false },
    selectedNodeIds: ['text-1'],
    conversationHistory: [],
    skills: [],
    model: { model: 'test-model', mode: 'structured' },
    confirmationMode: 'auto',
    thinkingLevel: 'standard',
    requestPayload: {},
    execContext: {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    },
    streamContext: {
      toolCalls: new Map(),
      contentBlocks: [],
      accumulatedContent: '',
      errors: [],
      wasAborted: false,
      streamComplete: false,
    } as LocalAgentContext['streamContext'],
    options: {},
  }
}

function textSnapshot(contentHtml = '<p>old</p>'): CanvasSnapshot {
  return {
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
          aiPrompt: '写一段年轻化短视频文案',
          aiModel: 'test-model',
          contentHtml,
        },
        raw: {},
      },
    ],
    edges: [],
  }
}

function imageSnapshot(file: unknown = null): CanvasSnapshot {
  return {
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
          aiPrompt: '明亮舞台灯光主视觉',
          aiModel: 'jimeng-4.5',
          aiAspectRatio: '16:9',
          file,
        },
        raw: {},
      },
    ],
    edges: [],
  }
}

function videoSnapshot(file: unknown = null): CanvasSnapshot {
  return {
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
          videoPrompt: '镜头向前推进，展示发布会主视觉',
          videoModelFamily: 'wan2.6',
          videoParameters: {
            resolution: '720p',
            duration: 5,
          },
          file,
        },
        raw: {},
      },
    ],
    edges: [],
  }
}

function videoWithIncomingImageSnapshot(file: unknown = null): CanvasSnapshot {
  return {
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
            id: 'image-file-1',
            name: 'first-frame.png',
            key: 'first-frame.png',
            path: '/files/first-frame.png',
            type: 'image/png',
            size: 123,
          },
        },
        raw: {},
      },
      {
        id: 'video-1',
        name: 'Video 1',
        blockType: 'content',
        kind: 'video',
        position: { x: 300, y: 0 },
        values: {
          videoPrompt: '镜头向前推进，展示发布会主视觉',
          videoModelFamily: 'wan2.7',
          videoParameters: {
            resolution: '720p',
            duration: 5,
          },
          file,
        },
        raw: {},
      },
    ],
    edges: [{ source: 'image-1', target: 'video-1' }],
  }
}

function audioSnapshot(file: unknown = null): CanvasSnapshot {
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    nodes: [
      {
        id: 'audio-1',
        name: 'Audio 1',
        blockType: 'content',
        kind: 'audio',
        position: { x: 0, y: 0 },
        values: {
          audioPrompt: '有节奏感的电子风格配乐',
          audioModel: 'suno',
          audioParameters: {
            duration: 30,
            style: 'electronic',
          },
          file,
        },
        raw: {},
      },
    ],
    edges: [],
  }
}

function legacyCreateChainSnapshot(): CanvasSnapshot {
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    nodes: [
      {
        id: 'start-1',
        name: 'Start',
        blockType: 'starter',
        kind: 'generic_workflow_block',
        position: { x: 0, y: 0 },
        values: {},
        raw: {},
      },
    ],
    edges: [],
  }
}

function legacyCreateChainVerifiedSnapshot(): CanvasSnapshot {
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    nodes: [
      ...legacyCreateChainSnapshot().nodes,
      {
        id: 'node_script',
        name: '脚本',
        blockType: 'content',
        kind: 'text',
        position: { x: 300, y: 0 },
        values: {},
        raw: {},
      },
      {
        id: 'node_kv',
        name: '主视觉',
        blockType: 'content',
        kind: 'image',
        position: { x: 600, y: 0 },
        values: {},
        raw: {},
      },
    ],
    edges: [
      { source: 'start-1', target: 'node_script' },
      { source: 'node_script', target: 'node_kv' },
    ],
  }
}

describe('local canvas tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConvertGeneratedTextToContentHtml.mockReturnValue('<p>generated copy</p>')
    mockEditWorkflowExecute.mockResolvedValue({ success: true })
  })

  it('verifies text generation was written back to contentHtml', async () => {
    mockLoadCanvasSnapshot
      .mockResolvedValueOnce(textSnapshot())
      .mockResolvedValueOnce(textSnapshot())
      .mockResolvedValueOnce(textSnapshot('<p>generated copy</p>'))
    mockGenerateContentCanvasText.mockResolvedValue('generated copy')

    const result = await executeCanvasTool(buildContext(), {
      name: 'canvas.generate_node_output',
      input: { nodeId: 'text-1' },
    })

    expect(result.error).toBeUndefined()
    expect(result).toMatchObject({ success: true })
    expect(mockGenerateContentCanvasText).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.not.stringContaining('总导演'),
      })
    )
    expect(mockGenerateContentCanvasText).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('Do not introduce yourself'),
      })
    )
    expect(mockEditWorkflowExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        operations: [
          expect.objectContaining({
            operation_type: 'edit',
            block_id: 'text-1',
            params: { inputs: { contentHtml: '<p>generated copy</p>' } },
          }),
        ],
      }),
      expect.objectContaining({ userId: 'user-1', workspaceId: 'workspace-1' })
    )
  })

  it('fails text generation when contentHtml was not actually written', async () => {
    mockLoadCanvasSnapshot
      .mockResolvedValueOnce(textSnapshot())
      .mockResolvedValueOnce(textSnapshot())
      .mockResolvedValueOnce(textSnapshot('<p>old</p>'))
    mockGenerateContentCanvasText.mockResolvedValue('generated copy')

    const result = await executeCanvasTool(buildContext(), {
      name: 'canvas.generate_node_output',
      input: { nodeId: 'text-1' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Generated field "contentHtml" was not written on node "text-1"')
  })

  it('does not write generated text back when the request is cancelled during generation', async () => {
    const abortController = new AbortController()
    mockLoadCanvasSnapshot
      .mockResolvedValueOnce(textSnapshot())
      .mockResolvedValueOnce(textSnapshot())
    mockGenerateContentCanvasText.mockImplementationOnce(async () => {
      abortController.abort()
      return 'generated copy'
    })

    const result = await executeCanvasTool(
      {
        ...buildContext(),
        options: { abortSignal: abortController.signal },
      },
      {
        name: 'canvas.generate_node_output',
        input: { nodeId: 'text-1' },
      }
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Request was cancelled')
    expect(mockEditWorkflowExecute).not.toHaveBeenCalled()
  })

  it('does not write generated video back when the request is cancelled before writeback', async () => {
    const abortController = new AbortController()
    const generatedFile = {
      id: 'video-file-1',
      name: 'generated-video.mp4',
      key: 'generated-video.mp4',
      url: '/generated-video.mp4',
      type: 'video/mp4',
    }
    mockLoadCanvasSnapshot.mockResolvedValue(videoSnapshot())
    mockGenerateWorkspaceVideoFromPrompt.mockImplementationOnce(async () => {
      abortController.abort()
      return {
        file: generatedFile,
        metadata: { provider: 'test' },
      }
    })

    const result = await executeCanvasTool(
      {
        ...buildContext(),
        selectedNodeIds: ['video-1'],
        options: { abortSignal: abortController.signal },
      },
      {
        name: 'canvas.generate_node_output',
        input: { nodeId: 'video-1' },
      }
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Request was cancelled')
    expect(mockGenerateWorkspaceVideoFromPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: abortController.signal,
      })
    )
    expect(mockEditWorkflowExecute).not.toHaveBeenCalled()
  })

  it('verifies image generation was written back to file', async () => {
    const generatedFile = {
      id: 'file-1',
      name: 'generated.png',
      key: 'generated.png',
      url: '/generated.png',
      type: 'image/png',
    }
    const writtenFile = { ...generatedFile, path: '/generated.png' }
    mockLoadCanvasSnapshot
      .mockResolvedValueOnce(imageSnapshot())
      .mockResolvedValueOnce(imageSnapshot())
      .mockResolvedValueOnce(imageSnapshot({ value: writtenFile }))
    mockGenerateWorkspaceImageFromPrompt.mockResolvedValue({
      file: generatedFile,
      metadata: { provider: 'test' },
    })

    const result = await executeCanvasTool(
      { ...buildContext(), selectedNodeIds: ['image-1'] },
      {
        name: 'canvas.generate_node_output',
        input: { nodeId: 'image-1' },
      }
    )

    expect(result).toMatchObject({ success: true })
    expect(result.output).toMatchObject({ nodeId: 'image-1', verifiedField: 'file' })
    expect(mockEditWorkflowExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            block_id: 'image-1',
            params: { inputs: { file: writtenFile } },
          }),
        ],
      }),
      expect.objectContaining({ userId: 'user-1', workspaceId: 'workspace-1' })
    )
  })

  it('verifies video generation was written back to file and uses the incoming image as first frame', async () => {
    const generatedFile = {
      id: 'video-file-1',
      name: 'generated-video.mp4',
      key: 'generated-video.mp4',
      url: '/generated-video.mp4',
      type: 'video/mp4',
    }
    const writtenFile = { ...generatedFile, path: '/generated-video.mp4' }
    mockLoadCanvasSnapshot
      .mockResolvedValueOnce(videoWithIncomingImageSnapshot())
      .mockResolvedValueOnce(videoWithIncomingImageSnapshot())
      .mockResolvedValueOnce(videoWithIncomingImageSnapshot({ value: writtenFile }))
    mockGenerateWorkspaceVideoFromPrompt.mockResolvedValue({
      file: generatedFile,
      metadata: { provider: 'test' },
    })

    const result = await executeCanvasTool(
      { ...buildContext(), selectedNodeIds: ['video-1'] },
      {
        name: 'canvas.generate_node_output',
        input: { nodeId: 'video-1' },
      }
    )

    expect(result).toMatchObject({ success: true })
    expect(result.output).toMatchObject({ nodeId: 'video-1', verifiedField: 'file' })
    expect(mockGenerateWorkspaceVideoFromPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        media: [
          expect.objectContaining({
            type: 'first_frame',
            file: expect.objectContaining({
              key: 'first-frame.png',
              url: '/files/first-frame.png',
            }),
          }),
        ],
      })
    )
    expect(mockEditWorkflowExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            block_id: 'video-1',
            params: { inputs: { file: writtenFile } },
          }),
        ],
      }),
      expect.objectContaining({ userId: 'user-1', workspaceId: 'workspace-1' })
    )
  })

  it('verifies audio generation was written back to file', async () => {
    const generatedFile = {
      id: 'audio-file-1',
      name: 'generated-audio.mp3',
      key: 'generated-audio.mp3',
      url: '/generated-audio.mp3',
      type: 'audio/mpeg',
    }
    const writtenFile = { ...generatedFile, path: '/generated-audio.mp3' }
    mockLoadCanvasSnapshot
      .mockResolvedValueOnce(audioSnapshot())
      .mockResolvedValueOnce(audioSnapshot())
      .mockResolvedValueOnce(audioSnapshot({ value: writtenFile }))
    mockGenerateWorkspaceAudioFromPrompt.mockResolvedValue({
      file: generatedFile,
      metadata: { provider: 'test' },
    })

    const result = await executeCanvasTool(
      { ...buildContext(), selectedNodeIds: ['audio-1'] },
      {
        name: 'canvas.generate_node_output',
        input: { nodeId: 'audio-1' },
      }
    )

    expect(result).toMatchObject({ success: true })
    expect(result.output).toMatchObject({ nodeId: 'audio-1', verifiedField: 'file' })
    expect(mockEditWorkflowExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            block_id: 'audio-1',
            params: { inputs: { file: writtenFile } },
          }),
        ],
      }),
      expect.objectContaining({ userId: 'user-1', workspaceId: 'workspace-1' })
    )
  })

  it('does not write back or report success when image generation fails', async () => {
    const existingFile = {
      name: 'existing.png',
      path: '/files/existing.png',
      type: 'image/png',
    }
    mockLoadCanvasSnapshot
      .mockResolvedValueOnce(imageSnapshot({ value: existingFile }))
      .mockResolvedValueOnce(imageSnapshot({ value: existingFile }))
    mockGenerateWorkspaceImageFromPrompt.mockRejectedValue(new Error('Image provider failed'))

    const result = await executeCanvasTool(
      { ...buildContext(), selectedNodeIds: ['image-1'] },
      {
        name: 'canvas.generate_node_output',
        input: { nodeId: 'image-1' },
      }
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Image provider failed')
    expect(mockEditWorkflowExecute).not.toHaveBeenCalled()
  })

  it('redacts selected node file metadata to the file name for agent reads', async () => {
    const fullFile = {
      id: 'file-1',
      name: 'generated-video.mp4',
      key: 'private/generated-video.mp4',
      path: '/storage/private/generated-video.mp4',
      url: 'https://example.test/private/generated-video.mp4',
      type: 'video/mp4',
      size: 12345,
    }
    mockLoadCanvasSnapshot.mockResolvedValueOnce({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'video-1',
          name: 'Video 1',
          blockType: 'content',
          kind: 'video',
          position: { x: 0, y: 0 },
          values: {},
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)
    mockReadCanvasNodeDetail.mockReturnValueOnce({
      id: 'video-1',
      name: 'Video 1',
      blockType: 'content',
      kind: 'video',
      position: { x: 0, y: 0 },
      selected: true,
      summary: 'Video node',
      capabilities: {
        canRead: true,
        canWrite: true,
        canGenerate: true,
        canReferenceFile: true,
      },
      fields: {
        videoPrompt: '完整视频提示词',
        videoParameters: { duration: 5, resolution: '720P' },
        file: fullFile,
      },
      file: fullFile,
    })

    const result = await executeCanvasTool(
      { ...buildContext(), selectedNodeIds: ['video-1'] },
      {
        name: 'canvas.read_selected_nodes',
        input: {},
      }
    )

    expect(result.success).toBe(true)
    expect(result.output).toEqual([
      expect.objectContaining({
        file: { name: 'generated-video.mp4' },
        fields: expect.objectContaining({
          file: { name: 'generated-video.mp4' },
          videoPrompt: '完整视频提示词',
          videoParameters: { duration: 5, resolution: '720P' },
        }),
      }),
    ])
    expect(JSON.stringify(result.output)).not.toContain('private/generated-video.mp4')
    expect(JSON.stringify(result.output)).not.toContain('https://example.test')
  })

  it('normalizes legacy addNodes/addEdges apply_patch input into executable operations', async () => {
    mockLoadCanvasSnapshot
      .mockResolvedValueOnce(legacyCreateChainSnapshot())
      .mockResolvedValueOnce(legacyCreateChainVerifiedSnapshot())

    const result = await executeCanvasTool(
      { ...buildContext(), selectedNodeIds: [] },
      {
        name: 'canvas.apply_patch',
        input: {
          patch: {
            addNodes: [
              JSON.stringify({
                id: 'node_script',
                name: '脚本',
                blockType: 'llm_chat',
                position: { x: 300, y: 0 },
              }),
              JSON.stringify({
                id: 'node_kv',
                name: '主视觉',
                blockType: 'image_generation',
                position: { x: 600, y: 0 },
              }),
            ],
            addEdges: [
              JSON.stringify({ source: 'start-1', target: 'node_script' }),
              JSON.stringify({ source: 'node_script', target: 'node_kv' }),
            ],
          },
        },
      }
    )

    expect(result.success).toBe(true)
    const [executeInput, executeContext] = mockEditWorkflowExecute.mock.calls[0]
    expect(executeInput).toMatchObject({ workflowId: 'workflow-1' })
    expect(executeInput.operations).toHaveLength(4)
    expect(executeInput.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation_type: 'add',
          params: expect.objectContaining({
            type: 'content',
            name: '脚本',
            inputs: expect.objectContaining({ contentVariant: 'text' }),
          }),
        }),
        expect.objectContaining({
          operation_type: 'add',
          params: expect.objectContaining({
            type: 'content',
            name: '主视觉',
            inputs: expect.objectContaining({ contentVariant: 'image' }),
          }),
        }),
        expect.objectContaining({ operation_type: 'edit', block_id: 'start-1' }),
      ])
    )
    expect(
      executeInput.operations.filter((operation) => operation.operation_type === 'edit')
    ).toHaveLength(2)
    expect(executeContext).toEqual(
      expect.objectContaining({ userId: 'user-1', workspaceId: 'workspace-1' })
    )
  })

  it('normalizes instruction-only patch proposals into create and connect operations', async () => {
    mockLoadCanvasSnapshot.mockResolvedValueOnce(legacyCreateChainSnapshot())

    const result = await executeCanvasTool(
      { ...buildContext(), selectedNodeIds: [] },
      {
        name: 'canvas.propose_patch',
        input: {
          patch: {
            instructions:
              "Create 4 new nodes: '脚本' (Script), '主视觉' (Key Visual), '视频' (Video), and '配乐' (Soundtrack). Connect them sequentially: Start (start-1) -> 脚本 -> 主视觉 -> 视频 -> 配乐.",
          },
        },
      }
    )

    expect(result.success).toBe(true)
    expect(result.output).toEqual(
      expect.objectContaining({
        operationCount: 8,
        patch: expect.objectContaining({
          operations: expect.arrayContaining([
            expect.objectContaining({ type: 'create_node', title: '脚本', kind: 'text' }),
            expect.objectContaining({ type: 'create_node', title: '主视觉', kind: 'image' }),
            expect.objectContaining({ type: 'create_node', title: '视频', kind: 'video' }),
            expect.objectContaining({ type: 'create_node', title: '配乐', kind: 'audio' }),
            expect.objectContaining({
              type: 'connect',
              sourceNodeId: 'start-1',
              targetNodeId: 'instruction_node_1',
            }),
          ]),
        }),
      })
    )
  })

  it('normalizes direct legacy update_node apply_patch input into executable operations', async () => {
    mockLoadCanvasSnapshot
      .mockResolvedValueOnce(textSnapshot())
      .mockResolvedValueOnce(textSnapshot('<p>updated</p>'))

    const result = await executeCanvasTool(buildContext(), {
      name: 'canvas.apply_patch',
      input: {
        patch: {
          type: 'update_node',
          nodeId: 'text-1',
          fields: ['contentHtml'],
          values: ['<p>updated</p>'],
        },
      },
    })

    expect(result.error).toBeUndefined()
    expect(result).toMatchObject({ success: true })
    const [executeInput] = mockEditWorkflowExecute.mock.calls[0]
    expect(executeInput.operations).toEqual([
      expect.objectContaining({
        operation_type: 'edit',
        block_id: 'text-1',
        params: { inputs: { contentHtml: '<p>updated</p>' } },
      }),
    ])
  })

  it('rejects connect patches that reference missing nodes', async () => {
    mockLoadCanvasSnapshot.mockResolvedValueOnce(textSnapshot())

    const result = await executeCanvasTool(buildContext(), {
      name: 'canvas.apply_patch',
      input: {
        patch: {
          operations: [
            { type: 'connect', sourceNodeId: 'text-1', targetNodeId: 'node-does-not-exist' },
          ],
        },
      },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Target node "node-does-not-exist" was not found')
    expect(mockEditWorkflowExecute).not.toHaveBeenCalled()
  })

  it('rejects layout patches that reference missing nodes', async () => {
    mockLoadCanvasSnapshot.mockResolvedValueOnce(textSnapshot())

    const result = await executeCanvasTool(buildContext(), {
      name: 'canvas.apply_patch',
      input: {
        patch: {
          operations: [
            { type: 'layout_nodes', direction: 'horizontal', nodeIds: ['text-1', 'missing-1'] },
          ],
        },
      },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Node "missing-1" was not found')
    expect(mockEditWorkflowExecute).not.toHaveBeenCalled()
  })
})
