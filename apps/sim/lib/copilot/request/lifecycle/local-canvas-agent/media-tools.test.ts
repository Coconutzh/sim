/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CanvasNodeDetail,
  CanvasSnapshot,
  LocalAgentContext,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const { mockLoadCanvasSnapshot, mockReadCanvasNodeDetail } = vi.hoisted(() => ({
  mockLoadCanvasSnapshot: vi.fn(),
  mockReadCanvasNodeDetail: vi.fn(),
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context', () => ({
  loadCanvasSnapshot: mockLoadCanvasSnapshot,
  readCanvasNodeDetail: mockReadCanvasNodeDetail,
}))

import { executeMediaTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/media-tools'

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

describe('local canvas media tools', () => {
  beforeEach(() => {
    mockLoadCanvasSnapshot.mockReset()
    mockReadCanvasNodeDetail.mockReset()
    mockLoadCanvasSnapshot.mockResolvedValue(emptySnapshot)
    mockReadCanvasNodeDetail.mockReturnValue(buildVideoDetail())
  })

  it('analyzes a media node from stored context without exposing private file paths', async () => {
    const result = await executeMediaTool(buildContext(), {
      name: 'media.analyze_node_media',
      input: { nodeId: 'video-1', question: '这段视频内容是什么？' },
    })

    expect(result.success).toBe(true)
    expect(result.summary).toBe(
      'Analyzed video node "Launch Video" (stored_media_context, with file)'
    )
    expect(result.output).toMatchObject({
      nodeId: 'video-1',
      kind: 'video',
      analysisMode: 'stored_media_context',
      hasFile: true,
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
