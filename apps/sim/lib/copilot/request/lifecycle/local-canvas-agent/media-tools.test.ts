/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CanvasNodeDetail,
  CanvasSnapshot,
  LocalAgentContext,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const {
  mockDownloadFileFromStorage,
  mockDownloadFileFromUrl,
  mockExecuteLocalAgentModelRequest,
  mockLoadCanvasSnapshot,
  mockReadCanvasNodeDetail,
} = vi.hoisted(() => ({
  mockDownloadFileFromStorage: vi.fn(),
  mockDownloadFileFromUrl: vi.fn(),
  mockExecuteLocalAgentModelRequest: vi.fn(),
  mockLoadCanvasSnapshot: vi.fn(),
  mockReadCanvasNodeDetail: vi.fn(),
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context', () => ({
  loadCanvasSnapshot: mockLoadCanvasSnapshot,
  readCanvasNodeDetail: mockReadCanvasNodeDetail,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/models/config', () => ({
  executeLocalAgentModelRequest: mockExecuteLocalAgentModelRequest,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/models/prompts', () => ({
  buildLocalAgentRoleSystemPrompt: vi.fn(() => 'media system prompt'),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: mockDownloadFileFromStorage,
  downloadFileFromUrl: mockDownloadFileFromUrl,
}))

import { executeMediaTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/media-tools'
import { getLocalAgentToolDescriptor } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-descriptor'

const emptySnapshot: CanvasSnapshot = {
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  nodes: [],
  edges: [],
}

function buildContext(overrides: Partial<LocalAgentContext> = {}): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    message: '描述这个视频',
    sessionScope: 'personal',
    agent: { code: 'chief_director', name: 'Canvas Agent', description: '', systemPrompt: '' },
    discipline: { id: '', code: 'chief_director', name: '总导演' },
    workgroup: { id: '', name: 'Workspace', organizationId: '', teamWorkspaceId: null },
    permissions: { canRead: true, canWrite: true, canPublish: false },
    selectedNodeIds: ['video-1'],
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

function buildVideoDetail(overrides: Partial<CanvasNodeDetail> = {}): CanvasNodeDetail {
  const file = {
    name: 'launch.mp4',
    type: 'video/mp4',
    size: 1024,
    url: 'https://private.example.test/launch.mp4',
    key: 'private/generated/launch.mp4',
    context: '画面是一段明亮舞台发布会开场视频，镜头从观众席推向主屏。',
  }
  return {
    id: 'video-1',
    name: 'Launch Video',
    blockType: 'content',
    kind: 'video',
    position: { x: 0, y: 0 },
    selected: true,
    summary: '明亮舞台发布会开场',
    capabilities: {
      canRead: true,
      canWrite: true,
      canGenerate: true,
      canReferenceFile: true,
    },
    fields: {
      file,
      videoPrompt: '明亮舞台发布会开场，镜头推进。',
      videoModelFamily: 'wan2.7',
      videoParameters: { duration: 5 },
    },
    file,
    ...overrides,
  }
}

function buildImageDetail(overrides: Partial<CanvasNodeDetail> = {}): CanvasNodeDetail {
  const file = {
    name: 'hero.png',
    type: 'image/png',
    size: 1024,
    key: 'workspace/generated/hero.png',
  }
  return {
    id: 'image-1',
    name: 'Hero Image',
    blockType: 'content',
    kind: 'image',
    position: { x: 0, y: 0 },
    selected: true,
    summary: '发布会主视觉',
    capabilities: {
      canRead: true,
      canWrite: true,
      canGenerate: true,
      canReferenceFile: true,
    },
    fields: {
      file,
      aiPrompt: '明亮舞台灯光，品牌主视觉。',
    },
    file,
    ...overrides,
  }
}

describe('local canvas media tools', () => {
  beforeEach(() => {
    mockLoadCanvasSnapshot.mockReset()
    mockReadCanvasNodeDetail.mockReset()
    mockDownloadFileFromStorage.mockReset()
    mockDownloadFileFromUrl.mockReset()
    mockExecuteLocalAgentModelRequest.mockReset()
    mockLoadCanvasSnapshot.mockResolvedValue(emptySnapshot)
    mockReadCanvasNodeDetail.mockReturnValue(buildVideoDetail())
    mockDownloadFileFromStorage.mockResolvedValue(Buffer.from('fake-image'))
    mockDownloadFileFromUrl.mockResolvedValue(Buffer.from('fake-image'))
    mockExecuteLocalAgentModelRequest.mockResolvedValue({
      content: '画面中是明亮舞台主视觉，中央有发光屏幕和蓝白色灯光。',
    })
  })

  it('analyzes a media node from stored context without exposing private file paths', async () => {
    const result = await executeMediaTool(buildContext(), {
      name: 'media.analyze_node_media',
      input: {
        nodeId: 'video-1',
        analysisGoal: 'compare_with_prompt',
        question: '这段视频内容是否符合提示？',
      },
    })

    expect(result.success).toBe(true)
    expect(result.summary).toBe(
      'Analyzed video node "Launch Video" (stored_media_context, with file)'
    )
    expect(result.output).toMatchObject({
      nodeId: 'video-1',
      kind: 'video',
      analysisMode: 'stored_media_context',
      analysisGoal: 'compare_with_prompt',
      hasFile: true,
      mediaContentAccess: {
        hasFile: true,
        binaryFetched: false,
        contentEvidence: 'stored_media_context',
        canDescribeActualMedia: true,
      },
      file: {
        name: 'launch.mp4',
        type: 'video/mp4',
        hasUrl: true,
        hasStorageKey: true,
      },
      prompt: {
        field: 'videoPrompt',
        value: '明亮舞台发布会开场，镜头推进。',
      },
    })
    expect(JSON.stringify(result.output)).not.toContain('private/generated/launch.mp4')
    expect(JSON.stringify(result.output)).not.toContain('https://private.example.test')
    expect(JSON.stringify(result.output)).toContain('镜头从观众席推向主屏')
    expect(JSON.stringify(result.output)).toContain('分析目标：compare_with_prompt')
  })

  it('returns output that satisfies the media tool descriptor schema', async () => {
    const result = await executeMediaTool(buildContext(), {
      name: 'media.analyze_node_media',
      input: { nodeId: 'video-1' },
    })
    const descriptor = getLocalAgentToolDescriptor('media.analyze_node_media')

    expect(result.success).toBe(true)
    expect(descriptor?.outputSchema?.safeParse(result.output).success).toBe(true)
  })

  it('fetches image bytes and uses the model response as binary image evidence', async () => {
    mockReadCanvasNodeDetail.mockReturnValue(buildImageDetail())

    const result = await executeMediaTool(
      buildContext({
        message: '描述这张图片',
        selectedNodeIds: ['image-1'],
        model: { provider: 'google', model: 'gemini-2.5-flash', mode: 'structured' },
      }),
      {
        name: 'media.analyze_node_media',
        input: { nodeId: 'image-1', analysisGoal: 'describe' },
      }
    )

    expect(result.success).toBe(true)
    expect(mockDownloadFileFromStorage).toHaveBeenCalled()
    expect(mockExecuteLocalAgentModelRequest).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash', provider: 'google' }),
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            parts: expect.arrayContaining([expect.objectContaining({ type: 'image' })]),
          }),
        ],
      })
    )
    expect(result.output).toMatchObject({
      analysisMode: 'binary_image_analysis',
      mediaContentAccess: {
        hasFile: true,
        binaryFetched: true,
        contentEvidence: 'binary_image_analysis',
        canDescribeActualMedia: true,
      },
      limitations:
        'Analysis uses fetched image bytes and a vision model response; storage paths remain hidden.',
    })
    expect(JSON.stringify(result.output)).toContain('中央有发光屏幕')
    expect(JSON.stringify(result.output)).not.toContain('workspace/generated/hero.png')
  })

  it('does not fetch image bytes when the model provider has no image message support', async () => {
    mockReadCanvasNodeDetail.mockReturnValue(buildImageDetail())

    const result = await executeMediaTool(
      buildContext({
        message: '描述这张图片',
        selectedNodeIds: ['image-1'],
        model: { provider: 'deepseek', model: 'deepseek-chat', mode: 'structured' },
      }),
      {
        name: 'media.analyze_node_media',
        input: { nodeId: 'image-1', analysisGoal: 'describe' },
      }
    )

    expect(result.success).toBe(true)
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
    expect(mockExecuteLocalAgentModelRequest).not.toHaveBeenCalled()
    expect(result.output).toMatchObject({
      analysisMode: 'file_metadata',
      mediaContentAccess: {
        hasFile: true,
        binaryFetched: false,
        contentEvidence: 'file_metadata_only',
        canDescribeActualMedia: false,
      },
    })
  })

  it('limits file-only media analysis to metadata and prompt claims', async () => {
    mockReadCanvasNodeDetail.mockReturnValue(
      buildVideoDetail({
        fields: {
          file: {
            name: 'launch.mp4',
            type: 'video/mp4',
            size: 1024,
          },
          videoPrompt: '明亮舞台发布会开场，镜头推进。',
        },
        file: {
          name: 'launch.mp4',
          type: 'video/mp4',
          size: 1024,
        },
      })
    )

    const result = await executeMediaTool(buildContext(), {
      name: 'media.analyze_node_media',
      input: { nodeId: 'video-1', analysisGoal: 'describe' },
    })

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      analysisMode: 'file_metadata',
      hasFile: true,
      mediaContentAccess: {
        hasFile: true,
        binaryFetched: false,
        contentEvidence: 'file_metadata_only',
        canDescribeActualMedia: false,
        safeDescriptionScope:
          'May describe file metadata and prompts only; do not claim to have seen or heard the media content.',
      },
      limitations:
        'Analysis uses file metadata only; binary media bytes were not fetched in this local tool.',
    })
  })

  it('falls back to prompt-only analysis when no media file exists', async () => {
    mockReadCanvasNodeDetail.mockReturnValue(
      buildVideoDetail({
        fields: {
          file: null,
          videoPrompt: '夜晚城市航拍，霓虹灯，快节奏。',
        },
        file: null,
      })
    )

    const result = await executeMediaTool(buildContext(), {
      name: 'media.analyze_node_media',
      input: { nodeId: 'video-1' },
    })

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      analysisMode: 'prompt_only',
      hasFile: false,
      mediaContentAccess: {
        hasFile: false,
        binaryFetched: false,
        contentEvidence: 'prompt_only',
        canDescribeActualMedia: false,
      },
      prompt: {
        field: 'videoPrompt',
        value: '夜晚城市航拍，霓虹灯，快节奏。',
      },
      limitations: 'Analysis uses the prompt only because no generated media file is attached.',
    })
    expect(JSON.stringify(result.output)).toContain('不能声称看过真实图片、视频或音频内容')
  })

  it('rejects non-media nodes', async () => {
    mockReadCanvasNodeDetail.mockReturnValue(
      buildVideoDetail({
        kind: 'text',
        fields: { contentHtml: '<p>hello</p>' },
        file: null,
      })
    )

    const result = await executeMediaTool(buildContext(), {
      name: 'media.analyze_node_media',
      input: { nodeId: 'text-1' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('not image, video, or audio')
  })
})
