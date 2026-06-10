/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CanvasNodeDetail,
  CanvasSnapshot,
  LocalAgentContext,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const { mockExecuteLocalAgentModelRequest, mockLoadCanvasSnapshot, mockReadCanvasNodeDetail } =
  vi.hoisted(() => ({
    mockExecuteLocalAgentModelRequest: vi.fn(),
    mockLoadCanvasSnapshot: vi.fn(),
    mockReadCanvasNodeDetail: vi.fn(),
  }))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/models/config', () => ({
  executeLocalAgentModelRequest: mockExecuteLocalAgentModelRequest,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context', () => ({
  loadCanvasSnapshot: mockLoadCanvasSnapshot,
  readCanvasNodeDetail: mockReadCanvasNodeDetail,
  summarizeCanvas: vi.fn((snapshot: CanvasSnapshot) =>
    snapshot.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      blockType: node.blockType,
      kind: node.kind,
      position: node.position,
      selected: true,
      summary: '探索未知，触手可及。',
      capabilities: {
        canRead: true,
        canWrite: true,
        canGenerate: true,
        canReferenceFile: false,
      },
    }))
  ),
}))

import { buildLocalAgentPlan } from '@/lib/copilot/request/lifecycle/local-canvas-agent/planner'

function buildContext(overrides: Partial<LocalAgentContext> = {}): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    message: '把选中文案改成更适合年轻用户的短视频口吻。',
    sessionScope: 'personal',
    agent: {
      code: 'chief_director',
      name: 'Canvas Agent',
      description: '',
      systemPrompt: '',
    },
    discipline: { id: '', code: 'chief_director', name: '总导演' },
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
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    },
    streamContext: {} as LocalAgentContext['streamContext'],
    options: {},
    ...overrides,
  }
}

describe('local canvas planner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadCanvasSnapshot.mockReset()
    mockReadCanvasNodeDetail.mockReset()
    mockExecuteLocalAgentModelRequest.mockRejectedValue(new Error('model unavailable'))
  })

  it('fallback rewrite patches selected text contentHtml, not only aiPrompt', async () => {
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
          values: { contentHtml: '<p>探索未知，触手可及。</p>' },
          raw: {},
        },
      ],
      edges: [],
    }
    const detail: CanvasNodeDetail = {
      id: 'text-1',
      name: 'Text 1',
      blockType: 'content',
      kind: 'text',
      position: { x: 0, y: 0 },
      selected: true,
      summary: '探索未知，触手可及。',
      capabilities: {
        canRead: true,
        canWrite: true,
        canGenerate: true,
        canReferenceFile: false,
      },
      fields: { contentHtml: '<p>探索未知，触手可及。</p>' },
      textContent: '探索未知，触手可及。',
      file: null,
    }
    mockLoadCanvasSnapshot.mockResolvedValue(snapshot)
    mockReadCanvasNodeDetail.mockReturnValue(detail)

    const plan = await buildLocalAgentPlan(buildContext())
    const update = plan.patch?.operations.find(
      (operation) => operation.type === 'update_node' && operation.nodeId === 'text-1'
    )

    expect(update).toBeDefined()
    expect(update?.type).toBe('update_node')
    if (update?.type === 'update_node') {
      expect(update.fields.aiPrompt).toContain('年轻用户')
      expect(update.fields.contentHtml).toContain('<p>')
      expect(update.fields.contentHtml).not.toBe('<p>探索未知，触手可及。</p>')
    }
  })

  it('creates selected-node text drafts without writing the raw user command as content', async () => {
    const message = '在选中的图片后面加一个口播文案，接到这个图片节点。'
    const snapshot: CanvasSnapshot = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'image-1',
          name: '火星露营主视觉',
          blockType: 'content',
          kind: 'image',
          position: { x: 100, y: 80 },
          values: { aiPrompt: '火星露营主视觉，红色星球背景。' },
          raw: {},
        },
      ],
      edges: [],
    }
    const detail: CanvasNodeDetail = {
      id: 'image-1',
      name: '火星露营主视觉',
      blockType: 'content',
      kind: 'image',
      position: { x: 100, y: 80 },
      selected: true,
      summary: '火星露营主视觉，红色星球背景。',
      capabilities: {
        canRead: true,
        canWrite: true,
        canGenerate: true,
        canReferenceFile: true,
      },
      fields: { aiPrompt: '火星露营主视觉，红色星球背景。' },
      textContent: '',
      file: null,
    }
    mockLoadCanvasSnapshot.mockResolvedValue(snapshot)
    mockReadCanvasNodeDetail.mockReturnValue(detail)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: ['image-1'],
        message,
      })
    )

    const createText = plan.patch?.operations.find(
      (operation) => operation.type === 'create_node' && operation.kind === 'text'
    )
    expect(createText?.type).toBe('create_node')
    if (createText?.type !== 'create_node') throw new Error('expected create text operation')
    const serializedFields = JSON.stringify(createText.fields)
    expect(serializedFields).not.toContain(message)
    expect(serializedFields).not.toContain('在选中的图片后面加一个口播文案')
    expect(String(createText.fields.contentHtml)).toContain('火星露营主视觉')
    expect(String(createText.fields.contentHtml)).not.toContain('加一个')
    expect(String(createText.fields.contentHtml)).not.toContain('接到这个图片节点')
  })

  it('classifies workflow design discussion as read-only consult intent', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: [],
        message:
          '你好，我想做一个小红书的小猫ai视频生成工作流，先告诉我工作流如何设计，和我讨论一下',
      })
    )

    expect(mockExecuteLocalAgentModelRequest).not.toHaveBeenCalled()
    expect(plan.userIntent).toBe('consult_design')
    expect(plan.mutationPolicy).toBe('read_only')
    expect(plan.canvasReadPolicy).toBe('none')
    expect(plan.patch).toBeUndefined()
    expect(plan.generateNodeIds).toBeUndefined()
    expect(plan.steps.flatMap((step) => step.toolHints)).toEqual([])
  })

  it('does not write persona-leaking rewrite output into selected text contentHtml', async () => {
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
          values: { contentHtml: '<p>探索未知，触手可及。</p>' },
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
      summary: '探索未知，触手可及。',
      capabilities: {
        canRead: true,
        canWrite: true,
        canGenerate: true,
        canReferenceFile: false,
      },
      fields: { contentHtml: '<p>探索未知，触手可及。</p>' },
      textContent: '探索未知，触手可及。',
      file: null,
    } satisfies CanvasNodeDetail)
    mockExecuteLocalAgentModelRequest.mockResolvedValueOnce({
      content: '各组注意，我是总导演。这个文案已经改好了。',
    })

    const plan = await buildLocalAgentPlan(buildContext())
    const update = plan.patch?.operations.find(
      (operation) => operation.type === 'update_node' && operation.nodeId === 'text-1'
    )

    expect(update?.type).toBe('update_node')
    if (update?.type === 'update_node') {
      expect(update.fields.contentHtml).not.toContain('总导演')
      expect(update.fields.contentHtml).not.toContain('各组注意')
      expect(update.fields.contentHtml).toContain('年轻用户')
    }
  })

  it('does not write rewrite formatting instructions into selected text contentHtml', async () => {
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
          values: { contentHtml: '<p>探索未知，触手可及。</p>' },
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
      summary: '探索未知，触手可及。',
      capabilities: {
        canRead: true,
        canWrite: true,
        canGenerate: true,
        canReferenceFile: false,
      },
      fields: { contentHtml: '<p>探索未知，触手可及。</p>' },
      textContent: '探索未知，触手可及。',
      file: null,
    } satisfies CanvasNodeDetail)
    mockExecuteLocalAgentModelRequest.mockResolvedValueOnce({
      content:
        'Do not use markdown such as `#`, `**`, or JSON. Just plain text with line breaks. Short video tone? Yes.',
    })

    const plan = await buildLocalAgentPlan(buildContext())
    const update = plan.patch?.operations.find(
      (operation) => operation.type === 'update_node' && operation.nodeId === 'text-1'
    )

    expect(update?.type).toBe('update_node')
    if (update?.type === 'update_node') {
      expect(update.fields.contentHtml).not.toContain('Do not use markdown')
      expect(update.fields.contentHtml).not.toContain('Just plain text')
      expect(update.fields.contentHtml).toContain('年轻用户')
    }
  })

  it('fallback update patches image prompts without text-only fields', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)
    mockReadCanvasNodeDetail.mockReturnValue({
      id: 'image-1',
      name: 'Image 1',
      blockType: 'content',
      kind: 'image',
      position: { x: 0, y: 0 },
      selected: true,
      summary: 'old visual',
      capabilities: {
        canRead: true,
        canWrite: true,
        canGenerate: true,
        canReferenceFile: true,
      },
      fields: { aiPrompt: 'old visual' },
      file: null,
    } satisfies CanvasNodeDetail)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: ['image-1'],
        message: '把这个图片节点的提示词改成更明亮、更有舞台灯光感。',
      })
    )
    const update = plan.patch?.operations[0]

    expect(update?.type).toBe('update_node')
    if (update?.type === 'update_node') {
      expect(update.fields.aiPrompt).toContain('舞台灯光感')
      expect(update.fields.aiPrompt).not.toContain('这个图片节点')
      expect(update.fields.aiPrompt).not.toContain('提示词')
      expect(update.fields.contentHtml).toBeUndefined()
    }
  })

  it('treats selected image visual-direction questions as read-only analysis', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'image-1',
          name: 'Image 1',
          blockType: 'content',
          kind: 'image',
          position: { x: 360, y: 0 },
          values: { aiPrompt: '明亮舞台灯光主视觉' },
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: ['image-1'],
        message: '根据选中的图片节点，说明它的视觉方向和适合接什么视频节点。',
      })
    )

    expect(mockExecuteLocalAgentModelRequest).not.toHaveBeenCalled()
    expect(plan.patch).toBeUndefined()
    expect(plan.steps[0]?.toolHints).toContain('canvas.read_selected_nodes')
  })

  it('fallback update patches video prompt and duration parameters', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)
    mockReadCanvasNodeDetail.mockReturnValue({
      id: 'video-1',
      name: 'Video 1',
      blockType: 'content',
      kind: 'video',
      position: { x: 0, y: 0 },
      selected: true,
      summary: 'old video',
      capabilities: {
        canRead: true,
        canWrite: true,
        canGenerate: true,
        canReferenceFile: true,
      },
      fields: { videoPrompt: 'old motion', videoParameters: { resolution: '720P', duration: 3 } },
      file: null,
    } satisfies CanvasNodeDetail)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: ['video-1'],
        message: '把视频时长改成 5 秒，并让镜头更有推进感。',
      })
    )
    const update = plan.patch?.operations[0]

    expect(update?.type).toBe('update_node')
    if (update?.type === 'update_node') {
      expect(update.fields.videoPrompt).toContain('推进感')
      expect(update.fields.videoParameters).toMatchObject({ resolution: '720P', duration: 5 })
      expect(update.fields.contentHtml).toBeUndefined()
    }
  })

  it('fallback update patches audio prompts without text-only fields', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)
    mockReadCanvasNodeDetail.mockReturnValue({
      id: 'audio-1',
      name: 'Audio 1',
      blockType: 'content',
      kind: 'audio',
      position: { x: 0, y: 0 },
      selected: true,
      summary: 'old audio',
      capabilities: {
        canRead: true,
        canWrite: true,
        canGenerate: true,
        canReferenceFile: true,
      },
      fields: { audioPrompt: 'old music' },
      file: null,
    } satisfies CanvasNodeDetail)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: ['audio-1'],
        message: '把音乐方向改成更有节奏感的电子风格。',
      })
    )
    const update = plan.patch?.operations[0]

    expect(update?.type).toBe('update_node')
    if (update?.type === 'update_node') {
      expect(update.fields.audioPrompt).toContain('电子风格')
      expect(update.fields.contentHtml).toBeUndefined()
    }
  })

  it('does not let model planning turn a selected audio update into generation', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'audio-1',
          name: 'Audio 1',
          blockType: 'content',
          kind: 'audio',
          position: { x: 0, y: 0 },
          values: { audioPrompt: 'old audio' },
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)
    mockReadCanvasNodeDetail.mockReturnValue({
      id: 'audio-1',
      name: 'Audio 1',
      blockType: 'content',
      kind: 'audio',
      position: { x: 0, y: 0 },
      selected: true,
      summary: 'old audio',
      capabilities: {
        canRead: true,
        canWrite: true,
        canGenerate: true,
        canReferenceFile: true,
      },
      fields: { audioPrompt: 'old audio' },
      file: null,
    } satisfies CanvasNodeDetail)
    mockExecuteLocalAgentModelRequest.mockResolvedValue({
      content: JSON.stringify({
        goal: 'Generate selected audio',
        risk: 'medium',
        requiresClarification: false,
        steps: [],
        successCriteria: ['Generated audio is written'],
        generateNodeIds: ['audio-1'],
      }),
    })

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: ['audio-1'],
        message: '把音乐方向改成更有节奏感的电子风格。',
      })
    )
    const update = plan.patch?.operations[0]

    expect(mockExecuteLocalAgentModelRequest).not.toHaveBeenCalled()
    expect(plan.generateNodeIds).toBeUndefined()
    expect(update?.type).toBe('update_node')
    if (update?.type === 'update_node') {
      expect(update.nodeId).toBe('audio-1')
      expect(update.fields.audioPrompt).toContain('电子风格')
    }
  })

  it('targets the selected audio node even when another selected node appears first', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'video-1',
          name: 'Video 1',
          blockType: 'content',
          kind: 'video',
          position: { x: 720, y: 0 },
          values: { videoPrompt: 'old video' },
          raw: {},
        },
        {
          id: 'audio-1',
          name: 'Audio 1',
          blockType: 'content',
          kind: 'audio',
          position: { x: 1080, y: 0 },
          values: { audioPrompt: 'old audio' },
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)
    mockReadCanvasNodeDetail.mockImplementation((_snapshot, nodeId: string) => {
      if (nodeId === 'audio-1') {
        return {
          id: 'audio-1',
          name: 'Audio 1',
          blockType: 'content',
          kind: 'audio',
          position: { x: 1080, y: 0 },
          selected: true,
          summary: 'old audio',
          capabilities: {
            canRead: true,
            canWrite: true,
            canGenerate: true,
            canReferenceFile: true,
          },
          fields: { audioPrompt: 'old audio' },
          file: null,
        } satisfies CanvasNodeDetail
      }
      return {
        id: 'video-1',
        name: 'Video 1',
        blockType: 'content',
        kind: 'video',
        position: { x: 720, y: 0 },
        selected: true,
        summary: 'old video',
        capabilities: {
          canRead: true,
          canWrite: true,
          canGenerate: true,
          canReferenceFile: true,
        },
        fields: { videoPrompt: 'old video' },
        file: null,
      } satisfies CanvasNodeDetail
    })

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: ['video-1', 'audio-1'],
        message: '把这个音频节点的音乐方向改成更有节奏感的电子风格。',
      })
    )
    const update = plan.patch?.operations[0]

    expect(update?.type).toBe('update_node')
    if (update?.type === 'update_node') {
      expect(update.nodeId).toBe('audio-1')
      expect(update.fields.audioPrompt).toContain('电子风格')
      expect(update.fields.videoPrompt).toBeUndefined()
    }
  })

  it('creates a text node after the selected video node and connects video to text', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'video-1',
          name: 'Video 1',
          blockType: 'content',
          kind: 'video',
          position: { x: 720, y: 120 },
          values: {},
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: ['video-1'],
        message: '补一个结尾口播文案节点，接到当前视频节点后面。',
      })
    )

    expect(plan.patch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'create_node',
          clientNodeId: 'new_text_after_selection',
          kind: 'text',
          position: { x: 1080, y: 120 },
        }),
        expect.objectContaining({
          type: 'connect',
          sourceNodeId: 'video-1',
          targetNodeId: 'new_text_after_selection',
        }),
      ])
    )
  })

  it('creates a text node before the selected image node and connects text to image', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'image-1',
          name: 'Image 1',
          blockType: 'content',
          kind: 'image',
          position: { x: 360, y: 80 },
          values: {},
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: ['image-1'],
        message: '给当前图片节点前面补一个创意说明文本节点。',
      })
    )

    expect(plan.patch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'create_node',
          clientNodeId: 'new_text_before_selection',
          kind: 'text',
          title: '创意说明',
          position: { x: 0, y: 80 },
        }),
        expect.objectContaining({
          type: 'connect',
          sourceNodeId: 'new_text_before_selection',
          targetNodeId: 'image-1',
        }),
      ])
    )
  })

  it('creates a complete text-image-video-audio content chain from an empty workflow', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: [],
        message: '根据当前主题，创建一个短视频内容链：脚本、主视觉、视频、配乐，并按生产顺序连接。',
      })
    )

    expect(plan.patch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'create_node', clientNodeId: 'new_script', kind: 'text' }),
        expect.objectContaining({ type: 'create_node', clientNodeId: 'new_image', kind: 'image' }),
        expect.objectContaining({ type: 'create_node', clientNodeId: 'new_video', kind: 'video' }),
        expect.objectContaining({ type: 'create_node', clientNodeId: 'new_audio', kind: 'audio' }),
        expect.objectContaining({
          type: 'add_content_reference',
          sourceNodeId: 'new_script',
          consumerNodeId: 'new_image',
          role: 'text_context',
        }),
        expect.objectContaining({
          type: 'add_content_reference',
          sourceNodeId: 'new_image',
          consumerNodeId: 'new_video',
          role: 'video_first_frame',
        }),
        expect.objectContaining({
          type: 'add_content_reference',
          sourceNodeId: 'new_script',
          consumerNodeId: 'new_video',
          role: 'text_context',
        }),
        expect.objectContaining({
          type: 'add_content_reference',
          sourceNodeId: 'new_script',
          consumerNodeId: 'new_audio',
          role: 'text_context',
        }),
      ])
    )
    expect(plan.steps.flatMap((step) => step.toolHints)).toEqual(
      expect.arrayContaining(['canvas.read_summary', 'canvas.apply_patch', 'canvas.verify_patch'])
    )
  })

  it('creates node-specific content chain fields instead of copying the raw instruction', async () => {
    const message =
      '创建一条用于小红书短视频的内容链，包含种草文案、产品主图、短视频、配乐四个节点，并从左到右排好。'
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: [],
        message,
      })
    )

    const createOperations =
      plan.patch?.operations.filter((operation) => operation.type === 'create_node') ?? []
    expect(createOperations).toHaveLength(4)
    for (const operation of createOperations) {
      if (operation.type !== 'create_node') continue
      expect(JSON.stringify(operation.fields)).not.toContain(message)
      expect(JSON.stringify(operation.fields)).not.toContain('创建一条用于')
    }
    const textNode = createOperations.find(
      (operation) => operation.type === 'create_node' && operation.kind === 'text'
    )
    const imageNode = createOperations.find(
      (operation) => operation.type === 'create_node' && operation.kind === 'image'
    )
    expect(textNode?.type).toBe('create_node')
    expect(imageNode?.type).toBe('create_node')
    if (textNode?.type === 'create_node') {
      expect(String(textNode.fields.contentHtml)).toContain('小红书')
      expect(String(textNode.fields.contentHtml)).toContain('短视频')
      expect(String(textNode.fields.contentHtml)).not.toContain('包含')
      expect(String(textNode.fields.contentHtml)).not.toContain('从左到右')
    }
    if (imageNode?.type === 'create_node') {
      expect(String(imageNode.fields.aiPrompt)).toContain('小红书')
      expect(String(imageNode.fields.aiPrompt)).toContain('主视觉')
      expect(String(imageNode.fields.aiPrompt)).not.toContain('创建')
      expect(String(imageNode.fields.aiPrompt)).not.toContain('从左到右')
    }
  })

  it('does not allow model output to escalate a read-only inspect policy', async () => {
    mockExecuteLocalAgentModelRequest.mockResolvedValue({
      content: JSON.stringify({
        goal: 'bad mutation plan',
        risk: 'low',
        userIntent: 'mutate_canvas',
        mutationPolicy: 'allow_mutation',
        canvasReadPolicy: 'required',
        requiresClarification: false,
        steps: [
          {
            id: 'bad_apply',
            title: 'Apply patch despite consult policy',
            intent: 'update',
            toolHints: ['canvas.read_summary', 'canvas.apply_patch', 'canvas.verify_patch'],
            expectedObservation: 'Should be filtered',
          },
        ],
        successCriteria: ['No mutation should run'],
        patch: { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] },
      }),
    })
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: [],
        message: '总结当前画布。',
      })
    )

    expect(mockExecuteLocalAgentModelRequest).toHaveBeenCalled()
    expect(plan.userIntent).toBe('inspect_canvas')
    expect(plan.mutationPolicy).toBe('read_only')
    expect(plan.canvasReadPolicy).toBe('required')
    expect(plan.patch).toBeUndefined()
    expect(plan.steps.flatMap((step) => step.toolHints)).toContain('canvas.read_summary')
    expect(plan.steps.flatMap((step) => step.toolHints)).not.toContain('canvas.apply_patch')
    expect(plan.steps.flatMap((step) => step.toolHints)).not.toContain('canvas.verify_patch')
    expect(plan.intentEvidence).toEqual(expect.arrayContaining(['inspection_signal']))
  })

  it('uses deterministic create-chain patch when the model omits mutation steps', async () => {
    mockExecuteLocalAgentModelRequest.mockResolvedValue({
      content: JSON.stringify({
        goal: 'inspect schema before creating a chain',
        risk: 'low',
        requiresClarification: false,
        steps: [
          {
            id: 'inspect_schema',
            title: 'Inspect text schema',
            intent: 'inspect',
            toolHints: ['canvas.inspect_schema'],
            expectedObservation: 'Text schema is known',
          },
        ],
        successCriteria: ['Plan a chain'],
      }),
    })
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: [],
        message: '根据高考主题创建一个短视频内容链。',
      })
    )

    expect(plan.patch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'create_node', clientNodeId: 'new_script', kind: 'text' }),
        expect.objectContaining({ type: 'create_node', clientNodeId: 'new_image', kind: 'image' }),
        expect.objectContaining({ type: 'create_node', clientNodeId: 'new_video', kind: 'video' }),
        expect.objectContaining({ type: 'create_node', clientNodeId: 'new_audio', kind: 'audio' }),
      ])
    )
    expect(plan.steps.flatMap((step) => step.toolHints)).toEqual(
      expect.arrayContaining(['canvas.apply_patch', 'canvas.verify_patch'])
    )
  })

  it('extracts arbitrary creative subjects without relying on a fixed sample-topic list', async () => {
    mockExecuteLocalAgentModelRequest.mockResolvedValue({
      content: JSON.stringify({
        goal: 'inspect schema before creating a chain',
        risk: 'low',
        requiresClarification: false,
        steps: [],
        successCriteria: ['Plan a chain'],
      }),
    })
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: [],
        message: '以火星露营为主题创建一个短视频内容链。',
      })
    )

    const createOperations =
      plan.patch?.operations.filter((operation) => operation.type === 'create_node') ?? []
    const serializedFields = JSON.stringify(
      createOperations.map((operation) =>
        operation.type === 'create_node' ? operation.fields : undefined
      )
    )
    expect(serializedFields).toContain('火星露营')
    expect(serializedFields).not.toContain('以火星露营为主题')
    expect(serializedFields).not.toContain('创建一个短视频内容链')
  })

  it('plans proposal-only canvas changes when user asks to wait for confirmation', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: [],
        message: '先给我一个短视频内容链创建方案，等我确认后再执行。',
      })
    )

    expect(plan.userIntent).toBe('propose_plan')
    expect(plan.mutationPolicy).toBe('propose_only')
    expect(plan.patch?.operations.length).toBeGreaterThan(0)
    expect(plan.steps.flatMap((step) => step.toolHints)).toContain('canvas.propose_patch')
    expect(plan.steps.flatMap((step) => step.toolHints)).not.toContain('canvas.apply_patch')
  })

  it('plans a horizontal layout patch for canvas organization requests', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'text-1',
          name: 'Text 1',
          blockType: 'content',
          kind: 'text',
          position: { x: 400, y: 200 },
          values: {},
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: [],
        message: '把当前画布按内容生产顺序从左到右整理一下。',
      })
    )

    expect(plan.patch?.operations).toEqual([{ type: 'layout_nodes', direction: 'horizontal' }])
    expect(plan.steps.flatMap((step) => step.toolHints)).toEqual(
      expect.arrayContaining(['canvas.read_summary', 'canvas.apply_patch', 'canvas.verify_patch'])
    )
  })

  it('plans selected node generation and writeback without relying on model output', async () => {
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
          values: { aiPrompt: '写正文' },
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: ['text-1'],
        message: '根据这个节点的 aiPrompt 生成正文并写回。',
      })
    )

    expect(plan.generateNodeIds).toEqual(['text-1'])
    expect(plan.steps.flatMap((step) => step.toolHints)).toEqual(
      expect.arrayContaining([
        'canvas.read_selected_nodes',
        'canvas.generate_node_output',
        'canvas.verify_patch',
      ])
    )
    expect(plan.patch).toBeUndefined()
  })

  it('asks for clarification when a selection-scoped update has no selected node', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: [],
        message: '把选中文案改成更适合年轻用户的短视频口吻。',
      })
    )

    expect(plan.requiresClarification).toBe(true)
    expect(plan.clarificationQuestion).toContain('没有收到当前选中的画布节点')
    expect(plan.patch).toBeUndefined()
  })

  it('asks for clarification when selected-node analysis has no selected node', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: [],
        message: '基于我选中的节点，提炼 3 个关键卖点。',
      })
    )

    expect(plan.requiresClarification).toBe(true)
    expect(plan.clarificationQuestion).toContain('没有收到当前选中的画布节点')
    expect(plan.patch).toBeUndefined()
  })

  it('plans selected-node analysis with read_selected_nodes without calling the planner model', async () => {
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
          values: { contentHtml: '<p>探索未知，触手可及。</p>' },
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: ['text-1'],
        message: '基于我选中的节点，提炼 3 个关键卖点。',
      })
    )

    expect(mockExecuteLocalAgentModelRequest).not.toHaveBeenCalled()
    expect(plan.requiresClarification).toBe(false)
    expect(plan.patch).toBeUndefined()
    expect(plan.steps[0]?.toolHints).toContain('canvas.read_selected_nodes')
  })

  it('checks selected video generation settings as read-only analysis, not generation', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'video-1',
          name: 'Video 1',
          blockType: 'content',
          kind: 'video',
          position: { x: 0, y: 0 },
          values: { videoPrompt: '完整视频提示词' },
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: ['video-1'],
        message: '检查这个视频节点的生成设置是否完整。',
      })
    )

    expect(mockExecuteLocalAgentModelRequest).not.toHaveBeenCalled()
    expect(plan.requiresClarification).toBe(false)
    expect(plan.patch).toBeUndefined()
    expect(plan.generateNodeIds).toBeUndefined()
    expect(plan.steps[0]?.toolHints).toContain('canvas.read_selected_nodes')
  })

  it('plans local context tools deterministically for file, knowledge, and task requests', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: [],
        message: '读取附件 brief，结合品牌规范和当前生产任务状态给我一个摘要。',
        attachments: [{ name: 'brief.pdf', type: 'application/pdf' }],
      })
    )

    expect(mockExecuteLocalAgentModelRequest).not.toHaveBeenCalled()
    expect(plan.requiresClarification).toBe(false)
    expect(plan.patch).toBeUndefined()
    expect(plan.steps[0]?.toolHints).toEqual(
      expect.arrayContaining(['read_file', 'query_knowledge', 'read_tasks'])
    )
    expect(plan.successCriteria).toContain(
      'Answer using retrieved local context without modifying the canvas'
    )
  })

  it('plans explicit local context write tools for file materialization and task submission', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: ['text-1'],
        message: '保存附件 brief.pdf，并提交任务 task-1 的当前节点结果。',
        attachments: [{ name: 'brief.pdf', type: 'application/pdf' }],
      })
    )

    expect(mockExecuteLocalAgentModelRequest).not.toHaveBeenCalled()
    expect(plan.risk).toBe('medium')
    expect(plan.patch).toBeUndefined()
    expect(plan.steps[0]?.toolHints).toEqual(
      expect.arrayContaining(['read_file', 'materialize_file', 'submit_task_result', 'read_tasks'])
    )
    expect(plan.successCriteria).toContain(
      'Execute the explicitly requested local context action without modifying the canvas'
    )
  })

  it('does not inject raw Chinese profile persona into planner prompts', async () => {
    mockExecuteLocalAgentModelRequest.mockResolvedValue({
      content: JSON.stringify({
        goal: 'analyze canvas',
        risk: 'low',
        requiresClarification: false,
        steps: [],
        successCriteria: ['Answer from canvas'],
      }),
    })
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)

    await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: [],
        message: '总结当前画布里有哪些内容节点，以及它们之间的关系。',
        agent: {
          code: 'chief_director',
          name: '总导演 Agent',
          description: '负责以总导演口吻统筹团队',
          systemPrompt: '你是总导演。输出时请说各组注意。',
        },
        discipline: { id: 'discipline-1', code: 'chief_director', name: '总导演' },
      })
    )

    const request = mockExecuteLocalAgentModelRequest.mock.calls[0]?.[1]
    expect(request?.systemPrompt).not.toContain('你是总导演')
    expect(request?.systemPrompt).not.toContain('各组注意')
    expect(request?.systemPrompt).not.toContain('总导演 Agent')
    expect(request?.prompt).not.toContain('总导演 Agent')
    expect(request?.prompt).not.toContain('负责以总导演口吻')
  })

  it('adds read summary and search tools for search requests even when model omits them', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: [],
        message: '找到包含“春季发布会主视觉”的节点，并说明它连接到了哪里。',
      })
    )

    expect(plan.requiresClarification).toBe(false)
    expect(plan.steps[0]?.toolHints).toEqual(
      expect.arrayContaining(['canvas.read_summary', 'canvas.search_nodes'])
    )
    expect(mockExecuteLocalAgentModelRequest).not.toHaveBeenCalled()
  })

  it('requires clarification for destructive whole-canvas requests', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: [],
        message: '把所有节点都删掉。',
      })
    )

    expect(plan.risk).toBe('high')
    expect(plan.requiresClarification).toBe(true)
    expect(plan.clarificationQuestion).toContain('不会直接执行')
    expect(plan.patch).toBeUndefined()
  })

  it('plans explicit read_node for a referenced node id before any modification', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    } satisfies CanvasSnapshot)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: [],
        message: '读取 node-does-not-exist 并修改它。',
      })
    )

    expect(plan.requiresClarification).toBe(false)
    expect(plan.readNodeIds).toEqual(['node-does-not-exist'])
    expect(plan.patch).toBeUndefined()
    expect(plan.steps.flatMap((step) => step.toolHints)).toContain('canvas.read_node')
  })

  it('refuses writes to selected read-only node types before building a patch', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'document-1',
          name: 'Document 1',
          blockType: 'file',
          kind: 'document',
          position: { x: 0, y: 0 },
          values: {},
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)
    mockReadCanvasNodeDetail.mockReturnValue({
      id: 'document-1',
      name: 'Document 1',
      blockType: 'file',
      kind: 'document',
      position: { x: 0, y: 0 },
      selected: true,
      summary: 'Document node',
      capabilities: {
        canRead: true,
        canWrite: false,
        canGenerate: false,
        canReferenceFile: true,
      },
      fields: {},
      file: null,
    } satisfies CanvasNodeDetail)

    const plan = await buildLocalAgentPlan(
      buildContext({
        selectedNodeIds: ['document-1'],
        message: '修改这个节点的内容。',
      })
    )

    expect(plan.requiresClarification).toBe(true)
    expect(plan.clarificationQuestion).toContain('暂不支持写入')
    expect(plan.clarificationQuestion).toContain('document')
    expect(plan.patch).toBeUndefined()
  })
})
