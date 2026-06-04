/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamingContext } from '@/lib/copilot/request/types'

const {
  mockGenerateId,
  mockExecuteProviderRequest,
  mockEditWorkflowExecute,
  mockLoadWorkflowFromNormalizedTables,
  mockSetTerminalToolCallState,
  mockCreateLogger,
  mockGenerateWorkspaceImageFromPrompt,
  mockGenerateWorkspaceAudioFromPrompt,
  mockGenerateWorkspaceVideoFromPrompt,
} = vi.hoisted(() => ({
  mockGenerateId: vi.fn(),
  mockExecuteProviderRequest: vi.fn(),
  mockEditWorkflowExecute: vi.fn(),
  mockLoadWorkflowFromNormalizedTables: vi.fn(),
  mockSetTerminalToolCallState: vi.fn(),
  mockCreateLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  mockGenerateWorkspaceImageFromPrompt: vi.fn(),
  mockGenerateWorkspaceAudioFromPrompt: vi.fn(),
  mockGenerateWorkspaceVideoFromPrompt: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: mockGenerateId,
}))

vi.mock('@sim/logger', () => ({
  createLogger: mockCreateLogger,
}))

vi.mock('@/providers', () => ({
  executeProviderRequest: mockExecuteProviderRequest,
  executeStructuredActorRequest: mockExecuteProviderRequest,
}))

vi.mock('@/lib/copilot/tools/server/workflow/edit-workflow', () => ({
  editWorkflowServerTool: {
    execute: mockEditWorkflowExecute,
  },
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mockLoadWorkflowFromNormalizedTables,
}))

vi.mock('@/lib/copilot/request/tool-call-state', () => ({
  setTerminalToolCallState: mockSetTerminalToolCallState,
}))

vi.mock('@/lib/core/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/core/config/env')>()
  return {
    ...actual,
    env: {
      ...actual.env,
      CONTENT_CANVAS_ACTOR_PROVIDER: 'openai',
      CONTENT_CANVAS_ACTOR_MODEL: 'gpt-4.1-mini',
      CONTENT_CANVAS_ACTOR_MODE: 'structured',
      LOCAL_COPILOT_PROVIDER: 'deepseek',
      LOCAL_COPILOT_MODEL: 'deepseek-chat',
      DEEPSEEK_API_KEY: 'test-key',
    },
  }
})

describe.skip('generic goal fallback legacy', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(createEmptyWorkflowState())
    mockEditWorkflowExecute.mockResolvedValue({ success: true })
  })
  it('falls back to a generic text-first content chain for high-level goal requests when the planner returns no steps', async () => {
    mockGenerateId.mockReset()
    mockGenerateId
      .mockReturnValueOnce('goal-text-block-1')
      .mockReturnValueOnce('tool-call-1')
      .mockReturnValueOnce('outline-text-block-1')
      .mockReturnValueOnce('tool-call-2')
      .mockReturnValueOnce('draft-text-block-1')
      .mockReturnValueOnce('tool-call-3')
      .mockReturnValueOnce('tool-call-4')
      .mockReturnValueOnce('tool-call-5')
      .mockReturnValueOnce('tool-call-6')

    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '',
        summary: '',
        intent: {
          mode: 'analyze',
          summary: '',
          shouldExecute: false,
          risk: 'low',
        },
        steps: [],
      }),
    })

    mockEditWorkflowExecute
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'goal-text-block-1': {
              type: 'content',
              name: '目标拆解',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: 'prompt-1' },
              },
            },
          },
          edges: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'goal-text-block-1': {
              type: 'content',
              name: '目标拆解',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: 'prompt-1' },
              },
            },
            'outline-text-block-1': {
              type: 'content',
              name: '结构大纲',
              position: { x: 360, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: 'prompt-2' },
              },
            },
          },
          edges: [{ source: 'goal-text-block-1', target: 'outline-text-block-1' }],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'goal-text-block-1': {
              type: 'content',
              name: '目标拆解',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: 'prompt-1' },
              },
            },
            'outline-text-block-1': {
              type: 'content',
              name: '结构大纲',
              position: { x: 360, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: 'prompt-2' },
              },
            },
            'draft-text-block-1': {
              type: 'content',
              name: '内容草稿',
              position: { x: 720, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: 'prompt-3' },
              },
            },
          },
          edges: [
            { source: 'goal-text-block-1', target: 'outline-text-block-1' },
            { source: 'outline-text-block-1', target: 'draft-text-block-1' },
          ],
        },
      })
      .mockResolvedValue({
        success: true,
      })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '帮我做一个毕设PPT全套 pipeline',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).toHaveBeenCalled()
    const createdNodeNames = mockEditWorkflowExecute.mock.calls
      .flatMap((call) => call[0]?.operations ?? [])
      .filter((operation: { operation_type?: string }) => operation.operation_type === 'add')
      .map((operation: { params?: { name?: string } }) => operation.params?.name)

    expect(createdNodeNames).toEqual(expect.arrayContaining(['目标拆解', '结构大纲', '内容草稿']))
    expect(context.accumulatedContent).not.toContain('我暂时没有需要替你执行的画布操作')
    expect(context.contentBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'action_event',
          actionEvent: expect.objectContaining({
            name: 'understood_request',
            text: expect.stringContaining('轻量内容链草案'),
          }),
        }),
      ])
    )
  })

  it('builds text plus image for generic content-pack requests', async () => {
    mockGenerateId.mockReset()
    mockGenerateId
      .mockReturnValueOnce('goal-text-block-1')
      .mockReturnValueOnce('tool-call-1')
      .mockReturnValueOnce('outline-text-block-1')
      .mockReturnValueOnce('tool-call-2')
      .mockReturnValueOnce('draft-text-block-1')
      .mockReturnValueOnce('tool-call-3')
      .mockReturnValueOnce('image-block-1')
      .mockReturnValueOnce('tool-call-4')
      .mockReturnValueOnce('tool-call-5')
      .mockReturnValueOnce('tool-call-6')
      .mockReturnValueOnce('tool-call-7')
      .mockReturnValueOnce('tool-call-8')

    const emptyPlannerResponse = {
      content: JSON.stringify({
        assistantText: '',
        summary: '',
        intent: {
          mode: 'analyze',
          summary: '',
          shouldExecute: false,
          risk: 'low',
        },
        steps: [],
      }),
    }
    mockExecuteProviderRequest.mockResolvedValue(emptyPlannerResponse)

    mockEditWorkflowExecute.mockResolvedValue({
      success: true,
      workflowState: {
        blocks: {
          'goal-text-block-1': {
            type: 'content',
            name: '目标拆解',
            position: { x: 0, y: 0 },
            subBlocks: {
              contentVariant: { value: 'text' },
              aiPrompt: { value: 'prompt-1' },
            },
          },
          'outline-text-block-1': {
            type: 'content',
            name: '结构大纲',
            position: { x: 360, y: 0 },
            subBlocks: {
              contentVariant: { value: 'text' },
              aiPrompt: { value: 'prompt-2' },
            },
          },
          'draft-text-block-1': {
            type: 'content',
            name: '内容草稿',
            position: { x: 720, y: 0 },
            subBlocks: {
              contentVariant: { value: 'text' },
              aiPrompt: { value: 'prompt-3' },
            },
          },
          'image-block-1': {
            type: 'content',
            name: '配图草案',
            position: { x: 1080, y: 0 },
            subBlocks: {
              contentVariant: { value: 'image' },
              aiPrompt: { value: 'prompt-4' },
            },
          },
        },
        edges: [],
      },
    })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '做一套图文内容包',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    const addOperations = mockEditWorkflowExecute.mock.calls
      .flatMap((call) => call[0]?.operations ?? [])
      .filter((operation: { operation_type?: string }) => operation.operation_type === 'add')

    expect(addOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          params: expect.objectContaining({
            name: '配图草案',
            inputs: expect.objectContaining({
              contentVariant: 'image',
            }),
          }),
        }),
      ])
    )
  })

  it('does not trigger the generic fallback for analysis-only requests', async () => {
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '当前画布是空的。',
        summary: '',
        intent: {
          mode: 'analyze',
          summary: '只做分析',
          shouldExecute: false,
          risk: 'low',
        },
        steps: [],
      }),
    })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '先别改，描述一下当前画布',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).not.toHaveBeenCalled()
    expect(context.accumulatedContent).toContain('当前画布是空的')
    expect(context.contentBlocks.some((block) => block.type === 'action_event')).toBe(false)
  })
})

describe('generic goal fallback', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(createEmptyWorkflowState())
    mockEditWorkflowExecute.mockResolvedValue({ success: true })
    mockGenerateWorkspaceImageFromPrompt.mockResolvedValue({
      file: {
        id: 'generated-image-1',
        name: 'generated-image.png',
        url: 'https://example.com/generated-image.png',
        key: 'files/generated-image.png',
        size: 12345,
        type: 'image/png',
        context: 'generated',
      },
    })
  })

  it('falls back to a generic text-first content chain for high-level goal requests when the planner returns no steps', async () => {
    mockGenerateId.mockReset()
    let generatedIdCallCount = 0
    mockGenerateId.mockImplementation(() => {
      generatedIdCallCount += 1
      if (generatedIdCallCount === 1) return 'goal-text-block-1'
      if (generatedIdCallCount === 3) return 'outline-text-block-1'
      if (generatedIdCallCount === 5) return 'draft-text-block-1'
      return `tool-call-${generatedIdCallCount}`
    })

    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '',
        summary: '',
        intent: {
          mode: 'analyze',
          summary: '',
          shouldExecute: false,
          risk: 'low',
        },
        steps: [],
      }),
    })

    const goalBlock = {
      type: 'content',
      name: '\u76ee\u6807\u62c6\u89e3',
      position: { x: 0, y: 0 },
      subBlocks: {
        contentVariant: { value: 'text' },
        aiPrompt: { value: 'prompt-1' },
      },
    }
    const outlineBlock = {
      type: 'content',
      name: '\u7ed3\u6784\u5927\u7eb2',
      position: { x: 360, y: 0 },
      subBlocks: {
        contentVariant: { value: 'text' },
        aiPrompt: { value: 'prompt-2' },
      },
    }
    const draftBlock = {
      type: 'content',
      name: '\u5185\u5bb9\u8349\u7a3f',
      position: { x: 720, y: 0 },
      subBlocks: {
        contentVariant: { value: 'text' },
        aiPrompt: { value: 'prompt-3' },
      },
    }

    const structuralStates = [
      {
        blocks: {
          'goal-text-block-1': goalBlock,
        },
        edges: [],
      },
      {
        blocks: {
          'goal-text-block-1': goalBlock,
          'outline-text-block-1': outlineBlock,
        },
        edges: [],
      },
      {
        blocks: {
          'goal-text-block-1': goalBlock,
          'outline-text-block-1': outlineBlock,
          'draft-text-block-1': draftBlock,
        },
        edges: [],
      },
      {
        blocks: {
          'goal-text-block-1': goalBlock,
          'outline-text-block-1': outlineBlock,
          'draft-text-block-1': draftBlock,
        },
        edges: [{ source: 'goal-text-block-1', target: 'outline-text-block-1' }],
      },
      {
        blocks: {
          'goal-text-block-1': goalBlock,
          'outline-text-block-1': outlineBlock,
          'draft-text-block-1': draftBlock,
        },
        edges: [
          { source: 'goal-text-block-1', target: 'outline-text-block-1' },
          { source: 'outline-text-block-1', target: 'draft-text-block-1' },
        ],
      },
    ]

    mockEditWorkflowExecute.mockImplementation(() =>
      Promise.resolve(
        structuralStates.length > 0
          ? {
              success: true,
              workflowState: structuralStates.shift(),
            }
          : { success: true }
      )
    )

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '\u5e2e\u6211\u505a\u4e00\u4e2a\u6bd5\u8bbePPT\u5168\u5957 pipeline',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).toHaveBeenCalled()
    const createdNodeNames = mockEditWorkflowExecute.mock.calls
      .flatMap((call) => call[0]?.operations ?? [])
      .filter((operation: { operation_type?: string }) => operation.operation_type === 'add')
      .map((operation: { params?: { name?: string } }) => operation.params?.name)

    expect(createdNodeNames).toEqual(
      expect.arrayContaining([
        '\u76ee\u6807\u62c6\u89e3',
        '\u7ed3\u6784\u5927\u7eb2',
        '\u5185\u5bb9\u8349\u7a3f',
      ])
    )
    expect(context.accumulatedContent).not.toContain(
      '\u6211\u6682\u65f6\u6ca1\u6709\u9700\u8981\u66ff\u4f60\u6267\u884c\u7684\u753b\u5e03\u64cd\u4f5c'
    )
    expect(context.contentBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'action_event',
          actionEvent: expect.objectContaining({
            name: 'understood_request',
            text: expect.stringContaining('\u8f7b\u91cf\u5185\u5bb9\u94fe\u8349\u6848'),
          }),
        }),
      ])
    )
  })

  it('builds text plus image for generic content-pack requests', async () => {
    mockGenerateId.mockReset()
    let generatedIdCallCount = 0
    mockGenerateId.mockImplementation(() => {
      generatedIdCallCount += 1
      if (generatedIdCallCount === 1) return 'goal-text-block-1'
      if (generatedIdCallCount === 3) return 'outline-text-block-1'
      if (generatedIdCallCount === 5) return 'draft-text-block-1'
      if (generatedIdCallCount === 7) return 'image-block-1'
      return `tool-call-${generatedIdCallCount}`
    })

    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '',
        summary: '',
        intent: {
          mode: 'analyze',
          summary: '',
          shouldExecute: false,
          risk: 'low',
        },
        steps: [],
      }),
    })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '\u505a\u4e00\u5957\u56fe\u6587\u5185\u5bb9\u5305',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'manual',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).not.toHaveBeenCalled()
    expect(context.accumulatedContent).toContain('\u56fe\u7247')
    expect(context.accumulatedContent).toContain('\u6587\u672c')
    expect(context.contentBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'options',
        }),
      ])
    )
  })

  it('does not trigger the generic fallback for analysis-only requests', async () => {
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '\u5f53\u524d\u753b\u5e03\u662f\u7a7a\u7684\u3002',
        summary: '',
        intent: {
          mode: 'analyze',
          summary: '\u53ea\u505a\u5206\u6790',
          shouldExecute: false,
          risk: 'low',
        },
        steps: [],
      }),
    })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '\u5148\u522b\u6539\uff0c\u63cf\u8ff0\u4e00\u4e0b\u5f53\u524d\u753b\u5e03',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).not.toHaveBeenCalled()
    expect(context.accumulatedContent).toContain('\u5f53\u524d\u753b\u5e03\u662f\u7a7a\u7684')
    expect(context.contentBlocks.some((block) => block.type === 'action_event')).toBe(false)
  })
})

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/text-content-ai-utils',
  () => ({
    buildTextNodeAiSystemPrompt: vi.fn(() => 'system'),
    convertGeneratedTextToContentHtml: vi.fn((text: string) => `<p>${text}</p>`),
  })
)

vi.mock('@/lib/generated-media/audio/audio-generation-service', () => ({
  generateWorkspaceAudioFromPrompt: mockGenerateWorkspaceAudioFromPrompt,
}))

vi.mock('@/lib/generated-media/image/image-generation-service', () => ({
  generateWorkspaceImageFromPrompt: mockGenerateWorkspaceImageFromPrompt,
}))

vi.mock('@/lib/generated-media/video/video-generation-service', () => ({
  generateWorkspaceVideoFromPrompt: mockGenerateWorkspaceVideoFromPrompt,
}))

import {
  __contentCanvasAgentTestUtils,
  runContentCanvasAgent,
} from '@/lib/copilot/request/lifecycle/content-canvas-agent'
import {
  getContentReferenceSourceHandleId,
  getContentReferenceTargetHandleId,
} from '@/lib/workflows/content-reference-edges'

function createStreamingContext(): StreamingContext {
  return {
    messageId: 'message-1',
    accumulatedContent: '',
    contentBlocks: [],
    toolCalls: new Map(),
    pendingToolPromises: new Map(),
    currentThinkingBlock: null,
    currentSubagentThinkingBlock: null,
    isInThinkingBlock: false,
    subAgentParentStack: [],
    subAgentContent: {},
    subAgentToolCalls: {},
    pendingContent: '',
    streamComplete: false,
    wasAborted: false,
    errors: [],
    trace: {} as StreamingContext['trace'],
  }
}

function createEmptyWorkflowState() {
  return {
    blocks: {},
    edges: [],
  }
}

function createSelectedImageWorkflowState() {
  return {
    blocks: {
      'image-1': {
        type: 'content',
        name: 'Image 1',
        position: { x: 0, y: 0 },
        subBlocks: {
          contentVariant: { value: 'image' },
          aiPrompt: { value: '海边的美少女，夕阳，长发，半写实插画' },
          file: {
            value: {
              id: 'file-1',
              name: 'pretty-girl.png',
              path: 'https://example.com/pretty-girl.png',
              key: 'files/pretty-girl.png',
              type: 'image/png',
              size: 12345,
            },
          },
        },
      },
    },
    edges: [],
  }
}

function createContentCanvasWorkflowState() {
  return {
    blocks: {
      'text-1': {
        type: 'content',
        name: '开场文案',
        position: { x: 0, y: 0 },
        subBlocks: {
          contentVariant: { value: 'text' },
          aiPrompt: { value: '3 秒抓住观众注意力' },
          contentHtml: { value: '<p>3 秒抓住观众注意力</p>' },
        },
      },
      'text-2': {
        type: 'content',
        name: '正文',
        position: { x: 0, y: 220 },
        subBlocks: {
          contentVariant: { value: 'text' },
          aiPrompt: { value: '详细介绍产品亮点' },
          contentHtml: { value: '<p>详细介绍产品亮点</p>' },
        },
      },
      'image-1': {
        type: 'content',
        name: '配图节点',
        position: { x: 360, y: 0 },
        subBlocks: {
          contentVariant: { value: 'image' },
          aiPrompt: { value: '极简咖啡海报' },
        },
      },
      'video-1': {
        type: 'content',
        name: '视频节点',
        position: { x: 720, y: 0 },
        subBlocks: {
          contentVariant: { value: 'video' },
          videoPrompt: { value: '短视频分镜' },
        },
      },
      'audio-1': {
        type: 'content',
        name: '音频节点',
        position: { x: 360, y: 220 },
        subBlocks: {
          contentVariant: { value: 'audio' },
          audioPrompt: { value: '温柔旁白' },
        },
      },
    },
    edges: [],
  }
}

describe('content canvas agent', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetAllMocks()
    process.env = { ...originalEnv }
    mockGenerateId
      .mockReturnValueOnce('pending-plan-1')
      .mockReturnValueOnce('new-block-1')
      .mockReturnValueOnce('tool-call-1')
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(createEmptyWorkflowState())
    mockEditWorkflowExecute.mockResolvedValue({ success: true })
    mockGenerateWorkspaceImageFromPrompt.mockResolvedValue({
      file: {
        id: 'generated-image-1',
        name: 'generated-image.png',
        url: 'https://example.com/generated-image.png',
        key: 'files/generated-image.png',
        size: 12345,
        type: 'image/png',
        context: 'generated',
      },
    })
    mockGenerateWorkspaceAudioFromPrompt.mockResolvedValue({
      file: {
        id: 'generated-audio-1',
        name: 'generated-audio.mp3',
        url: 'https://example.com/generated-audio.mp3',
        key: 'files/generated-audio.mp3',
        size: 34567,
        type: 'audio/mpeg',
        context: 'generated',
      },
    })
    mockGenerateWorkspaceVideoFromPrompt.mockResolvedValue({
      file: {
        id: 'generated-video-1',
        name: 'generated-video.mp4',
        url: 'https://example.com/generated-video.mp4',
        key: 'files/generated-video.mp4',
        size: 45678,
        type: 'video/mp4',
        context: 'generated',
      },
    })
    mockSetTerminalToolCallState.mockImplementation((toolCall, update) => {
      Object.assign(toolCall, {
        status: update.status,
        ...(update.output !== undefined
          ? {
              result: {
                success: true,
                output: update.output,
              },
            }
          : {}),
        ...(update.error ? { error: update.error } : {}),
      })
    })
  })

  it('recognizes confirmation messages', () => {
    expect(__contentCanvasAgentTestUtils.isConfirmationMessage('确认')).toBe(true)
    expect(__contentCanvasAgentTestUtils.isConfirmationMessage('confirm')).toBe(true)
    expect(__contentCanvasAgentTestUtils.isConfirmationMessage('帮我改成更亮一点')).toBe(false)
  })

  it('creates a manual confirmation card without executing workflow edits', async () => {
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '已为您在画布上构建图片生成pipeline。',
        summary: '已为您在画布上构建图片生成pipeline。',
        actions: [
          {
            type: 'add_node',
            clientNodeId: 'new_image_1',
            nodeType: 'image',
            prompt: '夕阳下的少女',
          },
        ],
      }),
    })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '帮我加一个图片节点',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'manual',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).not.toHaveBeenCalled()
    expect(context.streamComplete).toBe(true)
    expect(context.accumulatedContent).toContain('图片')
    expect(context.accumulatedContent).not.toContain('pipeline')
    expect(context.contentBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'options',
          options: [
            expect.objectContaining({
              label: '确认执行',
              value: '__content_canvas_confirm__:pending-plan-1',
            }),
            expect.objectContaining({
              label: '继续修改',
              value: '__content_canvas_revise__:pending-plan-1',
            }),
          ],
        }),
      ])
    )
  })

  it('executes pending plan only when the confirmation token matches', async () => {
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '',
        summary: '',
        actions: [
          {
            type: 'add_node',
            clientNodeId: 'new_text_1',
            nodeType: 'text',
            contentText: '你好',
          },
        ],
      }),
    })

    const firstContext = createStreamingContext()
    await runContentCanvasAgent({
      requestPayload: {
        message: '新增一个文本节点',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'manual',
      },
      context: firstContext,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    const optionsBlock = firstContext.contentBlocks.find((block) => block.type === 'options')
    const confirmToken = optionsBlock?.options?.[0]?.value
    mockGenerateId.mockReset()
    mockGenerateId.mockReturnValueOnce('new-text-block-1').mockReturnValueOnce('tool-call-1')
    mockEditWorkflowExecute.mockResolvedValueOnce({
      success: true,
      workflowState: {
        blocks: {
          'new-text-block-1': {
            type: 'content',
            name: 'Text 1',
            position: { x: 0, y: 0 },
            subBlocks: {
              contentVariant: { value: 'text' },
              contentHtml: { value: '<p>你好</p>' },
            },
          },
        },
        edges: [],
      },
    })

    const secondContext = createStreamingContext()
    await runContentCanvasAgent({
      requestPayload: {
        message: confirmToken,
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'manual',
      },
      context: secondContext,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).toHaveBeenCalledTimes(1)
    expect(secondContext.accumulatedContent).toContain('文本')
  })

  it('rejects stale confirmation tokens without executing the plan', async () => {
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '',
        summary: '',
        actions: [
          {
            type: 'add_node',
            clientNodeId: 'new_audio_1',
            nodeType: 'audio',
            prompt: '海边钢琴',
          },
        ],
      }),
    })

    const firstContext = createStreamingContext()
    await runContentCanvasAgent({
      requestPayload: {
        message: '新增一个音频节点',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'manual',
      },
      context: firstContext,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    const secondContext = createStreamingContext()
    await runContentCanvasAgent({
      requestPayload: {
        message: '__content_canvas_confirm__:wrong-plan',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'manual',
      },
      context: secondContext,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).not.toHaveBeenCalled()
    expect(secondContext.accumulatedContent).toContain('失效')
  })

  it('returns a non-empty fallback when the planner emits no actions and no text', async () => {
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '',
        summary: '',
        actions: [],
      }),
    })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '现在画布怎么样',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(context.accumulatedContent.trim().length).toBeGreaterThan(0)
  })

  it('updates an existing text node without creating new nodes or triggering fallback', async () => {
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(createContentCanvasWorkflowState())
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '我先把开场文案改得更像标题党一点。',
        shouldContinue: false,
        actions: [
          {
            type: 'update_node',
            blockId: 'text-1',
            contentText: '3 秒抓住注意力的爆款开场',
          },
        ],
      }),
    })
    mockEditWorkflowExecute.mockResolvedValueOnce({
      success: true,
      workflowState: {
        ...createContentCanvasWorkflowState(),
        blocks: {
          ...createContentCanvasWorkflowState().blocks,
          'text-1': {
            ...createContentCanvasWorkflowState().blocks['text-1'],
            subBlocks: {
              ...createContentCanvasWorkflowState().blocks['text-1'].subBlocks,
              contentHtml: { value: '<p>3 秒抓住注意力的爆款开场</p>' },
            },
          },
        },
      },
    })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '把“开场文案”那个文本节点改得更像小红书标题党一点。',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).toHaveBeenCalledTimes(1)
    expect(mockEditWorkflowExecute.mock.calls[0]?.[0]?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation_type: 'edit',
          block_id: 'text-1',
        }),
      ])
    )
    expect(mockEditWorkflowExecute.mock.calls[0]?.[0]?.operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation_type: 'add',
        }),
      ])
    )
  })

  it('does not execute actor actions for analyze-only requests', async () => {
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(createContentCanvasWorkflowState())
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '我来直接帮你补一个节点。',
        shouldContinue: false,
        actions: [
          {
            type: 'create_node',
            clientNodeId: 'new_text_1',
            nodeType: 'text',
            title: '补充说明',
            contentText: '这是补充说明',
          },
        ],
      }),
    })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '你先看看我这个画布在讲什么，不要动任何节点。',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).not.toHaveBeenCalled()
    expect(context.accumulatedContent).not.toContain('补充说明')
  })

  it('rejects out-of-scope workflow/database requests without executing actor actions', async () => {
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(createContentCanvasWorkflowState())
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '我来替你新建一个配置节点。',
        shouldContinue: false,
        actions: [
          {
            type: 'create_node',
            clientNodeId: 'new_text_1',
            nodeType: 'text',
            title: '数据库配置',
            contentText: '数据库连接串',
          },
        ],
      }),
    })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '把整个 workflow 的数据库配置也一起改了。',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).not.toHaveBeenCalled()
    expect(context.accumulatedContent).not.toContain('数据库配置')
  })

  it('does not create nodes when selection-scoped edit receives invalid create actions twice', async () => {
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(createContentCanvasWorkflowState())
    mockExecuteProviderRequest
      .mockResolvedValueOnce({
        content: JSON.stringify({
          assistantText: '我来新建一个节点。',
          shouldContinue: false,
          actions: [
            {
              type: 'create_node',
              clientNodeId: 'new_text_1',
              nodeType: 'text',
              contentText: '压缩后的句子',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          assistantText: '那我再新建一个节点。',
          shouldContinue: false,
          actions: [
            {
              type: 'create_node',
              clientNodeId: 'new_text_2',
              nodeType: 'text',
              contentText: '还是新建一个节点',
            },
          ],
        }),
      })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '不要新建，直接修改我当前选中的节点，把内容压缩成一句话。',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
        autoSelectionContexts: [
          {
            kind: 'blocks',
            blockIds: ['text-1'],
            label: 'Current canvas selection (1)',
          },
        ],
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(2)
    expect(mockEditWorkflowExecute).not.toHaveBeenCalled()
  })

  it('connects content nodes without creating new nodes', async () => {
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(createContentCanvasWorkflowState())
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '我先把三个节点按顺序连起来。',
        shouldContinue: false,
        actions: [
          {
            type: 'connect_nodes',
            sourceBlockId: 'text-1',
            targetBlockId: 'image-1',
          },
          {
            type: 'connect_nodes',
            sourceBlockId: 'image-1',
            targetBlockId: 'video-1',
          },
        ],
      }),
    })
    mockEditWorkflowExecute
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          ...createContentCanvasWorkflowState(),
          edges: [{ source: 'text-1', target: 'image-1' }],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          ...createContentCanvasWorkflowState(),
          edges: [
            { source: 'text-1', target: 'image-1' },
            { source: 'image-1', target: 'video-1' },
          ],
        },
      })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '把文案节点连到图片节点，再把图片节点连到视频节点。',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).toHaveBeenCalledTimes(2)
    expect(mockEditWorkflowExecute.mock.calls.flatMap((call) => call[0]?.operations ?? [])).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation_type: 'add',
        }),
      ])
    )
  })

  it('does not create nodes when connect requests receive invalid create actions twice', async () => {
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(createContentCanvasWorkflowState())
    mockExecuteProviderRequest
      .mockResolvedValueOnce({
        content: JSON.stringify({
          assistantText: '我先加个中间节点。',
          shouldContinue: false,
          actions: [
            {
              type: 'create_node',
              clientNodeId: 'new_text_1',
              nodeType: 'text',
              contentText: '中间节点',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          assistantText: '我还是加个节点吧。',
          shouldContinue: false,
          actions: [
            {
              type: 'create_node',
              clientNodeId: 'new_text_2',
              nodeType: 'text',
              contentText: '还是中间节点',
            },
          ],
        }),
      })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '把文案节点连到图片节点，再把图片节点连到视频节点。',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(2)
    expect(mockEditWorkflowExecute).not.toHaveBeenCalled()
  })

  it('lays out nodes vertically without creating or updating node content', async () => {
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(createContentCanvasWorkflowState())
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '我先把画布改成纵向排版。',
        shouldContinue: false,
        actions: [
          {
            type: 'layout_nodes',
            direction: 'vertical',
            blockIds: ['text-1', 'image-1', 'video-1'],
          },
        ],
      }),
    })
    mockEditWorkflowExecute.mockResolvedValueOnce({
      success: true,
      workflowState: {
        ...createContentCanvasWorkflowState(),
        blocks: {
          ...createContentCanvasWorkflowState().blocks,
          'image-1': {
            ...createContentCanvasWorkflowState().blocks['image-1'],
            position: { x: 0, y: 220 },
          },
          'video-1': {
            ...createContentCanvasWorkflowState().blocks['video-1'],
            position: { x: 0, y: 440 },
          },
        },
      },
    })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '把整个画布改成纵向排版，适合从上到下阅读。',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).toHaveBeenCalledTimes(1)
    expect(mockEditWorkflowExecute.mock.calls[0]?.[0]?.operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation_type: 'add',
        }),
      ])
    )
  })

  it('does not execute updates when layout requests receive invalid actions twice', async () => {
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(createContentCanvasWorkflowState())
    mockExecuteProviderRequest
      .mockResolvedValueOnce({
        content: JSON.stringify({
          assistantText: '我先改一下文案内容。',
          shouldContinue: false,
          actions: [
            {
              type: 'update_node',
              blockId: 'text-1',
              contentText: '改文案',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          assistantText: '我还是改一下内容吧。',
          shouldContinue: false,
          actions: [
            {
              type: 'update_node',
              blockId: 'text-2',
              contentText: '继续改文案',
            },
          ],
        }),
      })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '把当前这些节点横向排开，别改内容，只整理位置。',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(2)
    expect(mockEditWorkflowExecute).not.toHaveBeenCalled()
  })

  it('synthesizes an image-to-text plan from the selected image when the planner returns no actions', async () => {
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(createSelectedImageWorkflowState())
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '',
        summary: '',
        actions: [],
      }),
    })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '帮我为这张图片生成一段文字',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'manual',
        autoSelectionContexts: [
          {
            kind: 'blocks',
            blockIds: ['image-1'],
            label: 'Current canvas selection (1)',
          },
        ],
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).not.toHaveBeenCalled()
    expect(context.accumulatedContent).toContain('文本')
    expect(context.contentBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'options',
        }),
      ])
    )
  })

  it('falls back to a deterministic three-node content chain when the planner declines a concrete build request', async () => {
    mockGenerateId.mockReset()
    let generatedIdCallCount = 0
    mockGenerateId.mockImplementation(() => {
      generatedIdCallCount += 1
      if (generatedIdCallCount === 1) return 'text-block-1'
      if (generatedIdCallCount === 3) return 'image-block-1'
      if (generatedIdCallCount === 5) return 'video-block-1'
      return `tool-call-${generatedIdCallCount}`
    })
    mockExecuteProviderRequest
      .mockResolvedValueOnce({
        content: JSON.stringify({
          assistantText: '',
          summary: '',
          intent: {
            mode: 'analyze',
            summary: '',
            shouldExecute: false,
            risk: 'low',
          },
          steps: [
            {
              id: 'ignored-step',
              type: 'create_node',
              clientNodeId: 'ignored_text_1',
              nodeType: 'text',
              prompt: 'ignore me',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        content: '夏日第一口，清爽到心动。',
      })

    mockEditWorkflowExecute
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'text-block-1': {
              type: 'content',
              name: '文案节点',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: '写一句夏日饮品文案' },
              },
            },
          },
          edges: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'text-block-1': {
              type: 'content',
              name: '文案节点',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: '写一句夏日饮品文案' },
              },
            },
            'image-block-1': {
              type: 'content',
              name: '配图节点',
              position: { x: 360, y: 0 },
              subBlocks: {
                contentVariant: { value: 'image' },
                aiPrompt: { value: '生成夏日饮品文案的配图' },
              },
            },
          },
          edges: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'text-block-1': {
              type: 'content',
              name: '文案节点',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: '写一句夏日饮品文案' },
              },
            },
            'image-block-1': {
              type: 'content',
              name: '配图节点',
              position: { x: 360, y: 0 },
              subBlocks: {
                contentVariant: { value: 'image' },
                aiPrompt: { value: '生成夏日饮品文案的配图' },
              },
            },
            'video-block-1': {
              type: 'content',
              name: '短视频节点',
              position: { x: 720, y: 0 },
              subBlocks: {
                contentVariant: { value: 'video' },
                videoPrompt: { value: '生成配图对应的短视频' },
              },
            },
          },
          edges: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'text-block-1': {
              type: 'content',
              name: '文案节点',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: '写一句夏日饮品文案' },
              },
            },
            'image-block-1': {
              type: 'content',
              name: '配图节点',
              position: { x: 360, y: 0 },
              subBlocks: {
                contentVariant: { value: 'image' },
                aiPrompt: { value: '生成夏日饮品文案的配图' },
              },
            },
            'video-block-1': {
              type: 'content',
              name: '短视频节点',
              position: { x: 720, y: 0 },
              subBlocks: {
                contentVariant: { value: 'video' },
                videoPrompt: { value: '生成配图对应的短视频' },
              },
            },
          },
          edges: [{ source: 'text-block-1', target: 'image-block-1' }],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'text-block-1': {
              type: 'content',
              name: '文案节点',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: '写一句夏日饮品文案' },
              },
            },
            'image-block-1': {
              type: 'content',
              name: '配图节点',
              position: { x: 360, y: 0 },
              subBlocks: {
                contentVariant: { value: 'image' },
                aiPrompt: { value: '生成夏日饮品文案的配图' },
              },
            },
            'video-block-1': {
              type: 'content',
              name: '短视频节点',
              position: { x: 720, y: 0 },
              subBlocks: {
                contentVariant: { value: 'video' },
                videoPrompt: { value: '生成配图对应的短视频' },
              },
            },
          },
          edges: [
            { source: 'text-block-1', target: 'image-block-1' },
            { source: 'image-block-1', target: 'video-block-1' },
          ],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'text-block-1': {
              type: 'content',
              name: '文案节点',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: '写一句夏日饮品文案' },
                contentHtml: { value: '<p>夏日第一口，清爽到心动。</p>' },
              },
            },
            'image-block-1': {
              type: 'content',
              name: '配图节点',
              position: { x: 360, y: 0 },
              subBlocks: {
                contentVariant: { value: 'image' },
                aiPrompt: { value: '生成夏日饮品文案的配图' },
              },
            },
            'video-block-1': {
              type: 'content',
              name: '短视频节点',
              position: { x: 720, y: 0 },
              subBlocks: {
                contentVariant: { value: 'video' },
                videoPrompt: { value: '生成配图对应的短视频' },
              },
            },
          },
          edges: [
            { source: 'text-block-1', target: 'image-block-1' },
            { source: 'image-block-1', target: 'video-block-1' },
          ],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'text-block-1': {
              type: 'content',
              name: '文案节点',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: '写一句夏日饮品文案' },
                contentHtml: { value: '<p>夏日第一口，清爽到心动。</p>' },
              },
            },
            'image-block-1': {
              type: 'content',
              name: '配图节点',
              position: { x: 360, y: 0 },
              subBlocks: {
                contentVariant: { value: 'image' },
                aiPrompt: { value: '生成夏日饮品文案的配图' },
                file: {
                  value: {
                    id: 'generated-image-1',
                    name: 'generated-image.png',
                    path: 'https://example.com/generated-image.png',
                    key: 'files/generated-image.png',
                    type: 'image/png',
                    size: 12345,
                  },
                },
              },
            },
            'video-block-1': {
              type: 'content',
              name: '短视频节点',
              position: { x: 720, y: 0 },
              subBlocks: {
                contentVariant: { value: 'video' },
                videoPrompt: { value: '生成配图对应的短视频' },
              },
            },
          },
          edges: [
            { source: 'text-block-1', target: 'image-block-1' },
            { source: 'image-block-1', target: 'video-block-1' },
          ],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'text-block-1': {
              type: 'content',
              name: '文案节点',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: '写一句夏日饮品文案' },
                contentHtml: { value: '<p>夏日第一口，清爽到心动。</p>' },
              },
            },
            'image-block-1': {
              type: 'content',
              name: '配图节点',
              position: { x: 360, y: 0 },
              subBlocks: {
                contentVariant: { value: 'image' },
                aiPrompt: { value: '生成夏日饮品文案的配图' },
                file: {
                  value: {
                    id: 'generated-image-1',
                    name: 'generated-image.png',
                    path: 'https://example.com/generated-image.png',
                    key: 'files/generated-image.png',
                    type: 'image/png',
                    size: 12345,
                  },
                },
              },
            },
            'video-block-1': {
              type: 'content',
              name: '短视频节点',
              position: { x: 720, y: 0 },
              subBlocks: {
                contentVariant: { value: 'video' },
                videoPrompt: { value: '生成配图对应的短视频' },
                file: {
                  value: {
                    id: 'generated-video-1',
                    name: 'generated-video.mp4',
                    path: 'https://example.com/generated-video.mp4',
                    key: 'files/generated-video.mp4',
                    type: 'video/mp4',
                    size: 45678,
                  },
                },
              },
            },
          },
          edges: [
            { source: 'text-block-1', target: 'image-block-1' },
            { source: 'image-block-1', target: 'video-block-1' },
          ],
        },
      })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '帮我做一个三节点内容流：先写一句夏日饮品文案，再生成配图，最后生成配图对应的短视频。',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).toHaveBeenCalled()
    const addOperations = mockEditWorkflowExecute.mock.calls
      .flatMap((call) => call[0]?.operations ?? [])
      .filter((operation: { operation_type?: string }) => operation.operation_type === 'add')

    expect(addOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          params: expect.objectContaining({
            inputs: expect.objectContaining({
              contentVariant: 'text',
              aiPrompt: expect.stringContaining('夏日饮品文案'),
            }),
          }),
        }),
        expect.objectContaining({
          params: expect.objectContaining({
            inputs: expect.objectContaining({
              contentVariant: 'image',
              aiPrompt: expect.stringContaining('配图'),
            }),
          }),
        }),
        expect.objectContaining({
          params: expect.objectContaining({
            inputs: expect.objectContaining({
              contentVariant: 'video',
              videoPrompt: expect.stringContaining('短视频'),
            }),
          }),
        }),
      ])
    )
    expect(context.accumulatedContent).not.toContain('我暂时没有需要替你执行的画布操作')
  })

  it('creates an image node without generation when the planner no-ops on an explicit image-node request', async () => {
    mockGenerateId.mockReset()
    mockGenerateId.mockReturnValueOnce('image-block-1').mockReturnValueOnce('tool-call-1')
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '',
        summary: '',
        intent: {
          mode: 'analyze',
          summary: '',
          shouldExecute: false,
          risk: 'low',
        },
        steps: [],
      }),
    })
    mockEditWorkflowExecute.mockResolvedValueOnce({
      success: true,
      workflowState: {
        blocks: {
          'image-block-1': {
            type: 'content',
            name: '图片节点',
            position: { x: 0, y: 0 },
            subBlocks: {
              contentVariant: { value: 'image' },
              aiPrompt: { value: '极简咖啡海报' },
            },
          },
        },
        edges: [],
      },
    })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '加一个图片节点，主题是极简咖啡海报，先不要生成，只把需求写进去。',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockGenerateWorkspaceImageFromPrompt).not.toHaveBeenCalled()
    expect(mockEditWorkflowExecute).toHaveBeenCalledTimes(1)
    expect(mockEditWorkflowExecute.mock.calls[0]?.[0]?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation_type: 'add',
          params: expect.objectContaining({
            inputs: expect.objectContaining({
              contentVariant: 'image',
              aiPrompt: expect.stringContaining('极简咖啡海报'),
            }),
          }),
        }),
      ])
    )
    expect(context.accumulatedContent).not.toContain('我暂时没有需要替你执行的画布操作')
  })

  it('retries the actor once before applying deterministic create fallback', async () => {
    mockGenerateId.mockReset()
    mockGenerateId.mockReturnValueOnce('image-block-1').mockReturnValueOnce('tool-call-1')
    mockExecuteProviderRequest
      .mockResolvedValueOnce({
        content: JSON.stringify({
          assistantText: '',
          shouldContinue: true,
          actions: [],
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          assistantText: '先加一个图片节点。',
          shouldContinue: false,
          actions: [
            {
              type: 'create_node',
              clientNodeId: 'new_image_1',
              nodeType: 'image',
              title: '图片节点',
              prompt: '极简咖啡海报',
            },
          ],
        }),
      })
    mockEditWorkflowExecute.mockResolvedValueOnce({
      success: true,
      workflowState: {
        blocks: {
          'image-block-1': {
            type: 'content',
            name: '图片节点',
            position: { x: 0, y: 0 },
            subBlocks: {
              contentVariant: { value: 'image' },
              aiPrompt: { value: '极简咖啡海报' },
            },
          },
        },
        edges: [],
      },
    })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '加一个图片节点，主题是极简咖啡海报，先不要生成，只把需求写进去。',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(2)
    expect(mockEditWorkflowExecute).toHaveBeenCalledTimes(1)
    expect(mockGenerateWorkspaceImageFromPrompt).not.toHaveBeenCalled()
  })

  it('waits until actor repair attempts are exhausted before using deterministic fallback', async () => {
    mockGenerateId.mockReset()
    mockGenerateId.mockReturnValueOnce('image-block-1').mockReturnValueOnce('tool-call-1')
    mockExecuteProviderRequest
      .mockResolvedValueOnce({
        content: JSON.stringify({
          assistantText: '',
          shouldContinue: true,
          actions: [],
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          assistantText: '',
          shouldContinue: false,
          actions: [],
        }),
      })
    mockEditWorkflowExecute.mockResolvedValueOnce({
      success: true,
      workflowState: {
        blocks: {
          'image-block-1': {
            type: 'content',
            name: '图片节点',
            position: { x: 0, y: 0 },
            subBlocks: {
              contentVariant: { value: 'image' },
              aiPrompt: { value: '极简咖啡海报' },
            },
          },
        },
        edges: [],
      },
    })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '加一个图片节点，主题是极简咖啡海报，先不要生成，只把需求写进去。',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(2)
    expect(mockEditWorkflowExecute).toHaveBeenCalledTimes(1)
  })

  it('creates an audio node when the planner no-ops on an explicit audio-node request', async () => {
    mockGenerateId.mockReset()
    let generatedIdCallCount = 0
    mockGenerateId.mockImplementation(() => {
      generatedIdCallCount += 1
      if (generatedIdCallCount === 1) return 'audio-block-1'
      return `tool-call-${generatedIdCallCount}`
    })
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '',
        summary: '',
        intent: {
          mode: 'analyze',
          summary: '',
          shouldExecute: false,
          risk: 'low',
        },
        steps: [],
      }),
    })
    mockEditWorkflowExecute
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'audio-block-1': {
              type: 'content',
              name: '音频节点',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'audio' },
                audioPrompt: { value: '做旁白，语气温柔一点' },
              },
            },
          },
          edges: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'audio-block-1': {
              type: 'content',
              name: '音频节点',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'audio' },
                audioPrompt: { value: '做旁白，语气温柔一点' },
                file: {
                  value: {
                    id: 'generated-audio-1',
                    name: 'generated-audio.mp3',
                    path: 'https://example.com/generated-audio.mp3',
                    key: 'files/generated-audio.mp3',
                    type: 'audio/mpeg',
                    size: 34567,
                  },
                },
              },
            },
          },
          edges: [],
        },
      })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '给我加一个音频节点，用来做旁白，语气要温柔一点。',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockGenerateWorkspaceAudioFromPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('旁白'),
      })
    )
    expect(mockEditWorkflowExecute.mock.calls[0]?.[0]?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation_type: 'add',
          params: expect.objectContaining({
            inputs: expect.objectContaining({
              contentVariant: 'audio',
              audioPrompt: expect.stringContaining('温柔'),
            }),
          }),
        }),
      ])
    )
    expect(context.accumulatedContent).not.toContain('我暂时没有需要替你执行的画布操作')
  })

  it('uses content reference handles when adding a linked content node', () => {
    mockGenerateId.mockReset()
    mockGenerateId.mockReturnValueOnce('new-text-block-1')

    const snapshot = {
      blocks: [
        {
          id: 'image-1',
          name: 'Image 1',
          type: 'content' as const,
          variant: 'image' as const,
          position: { x: 0, y: 0 },
          values: {},
        },
      ],
      edges: [],
    }

    const { operations } = __contentCanvasAgentTestUtils.compileEditWorkflowOperations({
      plan: {
        assistantText: '',
        summary: '',
        actions: [
          {
            type: 'add_node',
            clientNodeId: 'new_text_1',
            nodeType: 'text',
            title: '图片描述',
            targetBlockId: 'image-1',
          },
        ],
      },
      snapshot,
    })

    expect(operations).toEqual([
      expect.objectContaining({
        operation_type: 'add',
        block_id: 'new-text-block-1',
        params: expect.objectContaining({
          connections: {
            [getContentReferenceSourceHandleId('left')]: {
              block: 'image-1',
              handle: getContentReferenceTargetHandleId('right'),
            },
          },
        }),
      }),
    ])
  })

  it('uses content reference handles when connecting two content nodes', () => {
    const snapshot = {
      blocks: [
        {
          id: 'image-1',
          name: 'Image 1',
          type: 'content' as const,
          variant: 'image' as const,
          position: { x: 0, y: 0 },
          values: {},
        },
        {
          id: 'text-1',
          name: 'Text 1',
          type: 'content' as const,
          variant: 'text' as const,
          position: { x: 360, y: 0 },
          values: {},
        },
      ],
      edges: [],
    }

    const { operations } = __contentCanvasAgentTestUtils.compileEditWorkflowOperations({
      plan: {
        assistantText: '',
        summary: '',
        actions: [
          {
            type: 'connect_nodes',
            sourceBlockId: 'image-1',
            targetBlockId: 'text-1',
          },
        ],
      },
      snapshot,
    })

    expect(operations).toEqual([
      {
        operation_type: 'edit',
        block_id: 'image-1',
        params: {
          connections: {
            [getContentReferenceSourceHandleId('right')]: {
              block: 'text-1',
              handle: getContentReferenceTargetHandleId('left'),
            },
          },
        },
      },
    ])
  })

  it('prefers explicit content canvas actor env vars for planner config', () => {
    process.env.CONTENT_CANVAS_ACTOR_PROVIDER = 'openai'
    process.env.CONTENT_CANVAS_ACTOR_MODEL = 'gpt-4.1-mini'
    process.env.CONTENT_CANVAS_ACTOR_MODE = 'structured'
    delete process.env.LOCAL_COPILOT_PROVIDER
    delete process.env.LOCAL_COPILOT_MODEL
    delete process.env.DEEPSEEK_API_KEY

    expect(__contentCanvasAgentTestUtils.resolveContentCanvasActorConfig()).toEqual({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      mode: 'structured',
      apiKey: undefined,
    })
  })

  it('prefers the new content-canvas text env before legacy actor env', () => {
    process.env.CONTENT_TEXT_GLM_API_KEY = 'content-glm-key'
    process.env.CONTENT_TEXT_GLM_ENABLED_MODELS = 'glm-4.7'
    process.env.CONTENT_TEXT_GLM_DEFAULT_MODEL = 'glm-4.7'
    process.env.CONTENT_CANVAS_ACTOR_PROVIDER = 'openai'
    process.env.CONTENT_CANVAS_ACTOR_MODEL = 'gpt-4.1-mini'

    expect(__contentCanvasAgentTestUtils.resolveContentCanvasActorConfig()).toEqual({
      model: 'glm-4.7',
      mode: 'structured',
      useContentCanvasTextResolver: true,
    })
  })

  it('surfaces an invalid workflow error when legacy unsupported blocks break edit_workflow', async () => {
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '',
        summary: '',
        actions: [
          {
            type: 'add_node',
            clientNodeId: 'new_text_1',
            nodeType: 'text',
            contentText: '图片描述',
          },
        ],
      }),
    })
    mockEditWorkflowExecute.mockRejectedValue(
      new Error(
        "Invalid edited workflow: Block Image 1: unknown block type 'image_generator'; Block Video 1: unknown block type 'video_generator'; Edge references non-existent target block 'dead-edge'"
      )
    )

    const context = createStreamingContext()
    const onEvent = vi.fn()

    await expect(
      runContentCanvasAgent({
        requestPayload: {
          message: '帮我为这张图片生成一段文字',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          confirmationMode: 'auto',
          autoSelectionContexts: [
            {
              kind: 'blocks',
              blockIds: ['image-1'],
              label: 'Current canvas selection (1)',
            },
          ],
        },
        context,
        execContext: {
          userId: 'user-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
        },
        options: { onEvent },
      })
    ).rejects.toThrow(/当前画布中存在不受支持的旧节点或无效连线/)

    expect(context.accumulatedContent).toContain('当前画布中存在不受支持的旧节点或无效连线')
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'text',
        payload: expect.objectContaining({
          text: expect.stringContaining('当前画布中存在不受支持的旧节点或无效连线'),
        }),
      })
    )
  })

  it('rewrites explicit create-image requests to add a new image node instead of overwriting the selected image', async () => {
    mockGenerateId.mockReset()
    mockGenerateId.mockReturnValueOnce('new-image-block-1').mockReturnValueOnce('tool-call-1')
    mockLoadWorkflowFromNormalizedTables
      .mockResolvedValueOnce(createSelectedImageWorkflowState())
      .mockResolvedValueOnce({
        blocks: {
          ...createSelectedImageWorkflowState().blocks,
          'new-image-block-1': {
            type: 'content',
            name: 'Image 2',
            position: { x: 360, y: 0 },
            subBlocks: {
              contentVariant: { value: 'image' },
              aiPrompt: { value: '美少女，半写实插画' },
              aiModel: { value: 'jimeng-4.5' },
              file: { value: null },
            },
          },
        },
        edges: [],
      })
    mockEditWorkflowExecute.mockResolvedValueOnce({
      success: true,
      workflowState: {
        blocks: {
          ...createSelectedImageWorkflowState().blocks,
          'new-image-block-1': {
            type: 'content',
            name: 'Image 2',
            position: { x: 360, y: 0 },
            subBlocks: {
              contentVariant: { value: 'image' },
              aiPrompt: { value: '美少女，半写实插画' },
              aiModel: { value: 'jimeng-4.5' },
              file: { value: null },
            },
          },
        },
        edges: [],
      },
    })
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '',
        summary: '',
        actions: [
          {
            type: 'update_node',
            blockId: 'image-1',
            prompt: '美少女，半写实插画',
          },
          {
            type: 'generate_node_output',
            blockId: 'image-1',
          },
        ],
      }),
    })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '帮我新建一张美少女图片',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
        autoSelectionContexts: [
          {
            kind: 'blocks',
            blockIds: ['image-1'],
            label: 'Current canvas selection (1)',
          },
        ],
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).toHaveBeenCalled()
    const firstCall = mockEditWorkflowExecute.mock.calls[0]?.[0]
    expect(firstCall.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation_type: 'add',
          params: expect.objectContaining({
            type: 'content',
            inputs: expect.objectContaining({
              contentVariant: 'image',
              aiPrompt: '美少女，半写实插画',
            }),
          }),
        }),
      ])
    )
    expect(firstCall.operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation_type: 'edit',
          block_id: 'image-1',
          params: expect.objectContaining({
            inputs: expect.objectContaining({
              aiPrompt: '美少女，半写实插画',
            }),
          }),
        }),
      ])
    )
  })

  it('defaults to auto execution and emits step-level action events for multi-step content chains', async () => {
    mockGenerateId.mockReset()
    mockGenerateId
      .mockReturnValueOnce('new-image-block-1')
      .mockReturnValueOnce('tool-call-1')
      .mockReturnValueOnce('new-text-block-1')
      .mockReturnValueOnce('tool-call-2')
      .mockReturnValueOnce('tool-call-3')
      .mockReturnValueOnce('tool-call-4')
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '',
        summary: '先生成图片，再补一条文案。',
        intent: {
          mode: 'build_from_scratch',
          summary: '创建图片并补一条文案',
          shouldExecute: true,
          risk: 'low',
        },
        steps: [
          {
            id: 'step-1',
            type: 'create_node',
            clientNodeId: 'new_image_1',
            nodeType: 'image',
            title: '海边插画',
            prompt: '日落海边少女插画',
          },
          {
            id: 'step-2',
            type: 'create_node',
            clientNodeId: 'new_text_1',
            nodeType: 'text',
            title: '配套文案',
            prompt: '为这张图写一句广告标题',
          },
          {
            id: 'step-3',
            type: 'connect_nodes',
            sourceBlockId: 'new_image_1',
            targetBlockId: 'new_text_1',
          },
          {
            id: 'step-4',
            type: 'generate_output',
            blockId: 'new_image_1',
          },
          {
            id: 'step-5',
            type: 'writeback_output',
            blockId: 'new_image_1',
          },
        ],
      }),
    })
    mockEditWorkflowExecute
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'new-image-block-1': {
              type: 'content',
              name: '海边插画',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'image' },
                aiPrompt: { value: '日落海边少女插画' },
              },
            },
          },
          edges: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'new-image-block-1': {
              type: 'content',
              name: '海边插画',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'image' },
                aiPrompt: { value: '日落海边少女插画' },
              },
            },
            'new-text-block-1': {
              type: 'content',
              name: '配套文案',
              position: { x: 360, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: '为这张图写一句广告标题' },
              },
            },
          },
          edges: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'new-image-block-1': {
              type: 'content',
              name: '海边插画',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'image' },
                aiPrompt: { value: '日落海边少女插画' },
              },
            },
            'new-text-block-1': {
              type: 'content',
              name: '配套文案',
              position: { x: 360, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: '为这张图写一句广告标题' },
              },
            },
          },
          edges: [{ source: 'new-image-block-1', target: 'new-text-block-1' }],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'new-image-block-1': {
              type: 'content',
              name: '海边插画',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'image' },
                aiPrompt: { value: '日落海边少女插画' },
                file: {
                  value: {
                    id: 'generated-image-1',
                    name: 'generated-image.png',
                    path: 'https://example.com/generated-image.png',
                    key: 'files/generated-image.png',
                    type: 'image/png',
                    size: 12345,
                  },
                },
              },
            },
            'new-text-block-1': {
              type: 'content',
              name: '配套文案',
              position: { x: 360, y: 0 },
              subBlocks: {
                contentVariant: { value: 'text' },
                aiPrompt: { value: '为这张图写一句广告标题' },
              },
            },
          },
          edges: [{ source: 'new-image-block-1', target: 'new-text-block-1' }],
        },
      })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '先生成一张图，再补一个文案节点。',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).toHaveBeenCalledTimes(4)
    expect(context.contentBlocks.some((block) => block.type === 'options')).toBe(false)
    expect(
      context.contentBlocks
        .filter((block) => block.type === 'action_event')
        .map((block) => block.actionEvent?.name)
    ).toEqual(
      expect.arrayContaining([
        'understood_request',
        'created_node',
        'connected_nodes',
        'generated_output',
        'completed_request',
      ])
    )
  })

  it('repairs a missing created node once before continuing', async () => {
    mockGenerateId.mockReset()
    mockGenerateId
      .mockReturnValueOnce('new-image-block-1')
      .mockReturnValueOnce('tool-call-1')
      .mockReturnValueOnce('tool-call-2')
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '',
        summary: '新建一张图。',
        intent: {
          mode: 'build_from_scratch',
          summary: '创建图片节点',
          shouldExecute: true,
          risk: 'low',
        },
        steps: [
          {
            id: 'step-1',
            type: 'create_node',
            clientNodeId: 'new_image_1',
            nodeType: 'image',
            title: '新图',
            prompt: '电影感海边插画',
          },
        ],
      }),
    })
    mockEditWorkflowExecute
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {},
          edges: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {
            'new-image-block-1': {
              type: 'content',
              name: '新图',
              position: { x: 0, y: 0 },
              subBlocks: {
                contentVariant: { value: 'image' },
                aiPrompt: { value: '电影感海边插画' },
              },
            },
          },
          edges: [],
        },
      })

    const context = createStreamingContext()

    await runContentCanvasAgent({
      requestPayload: {
        message: '新建一张图',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        confirmationMode: 'auto',
      },
      context,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      options: {},
    })

    expect(mockEditWorkflowExecute).toHaveBeenCalledTimes(2)
    expect(
      context.contentBlocks.some(
        (block) =>
          block.type === 'action_event' && block.actionEvent?.name === 'repaired_step'
      )
    ).toBe(true)
  })

  it('marks the request blocked when step repair is exhausted', async () => {
    mockGenerateId.mockReset()
    mockGenerateId
      .mockReturnValueOnce('new-image-block-1')
      .mockReturnValueOnce('tool-call-1')
      .mockReturnValueOnce('tool-call-2')
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '',
        summary: '新建一张图。',
        intent: {
          mode: 'build_from_scratch',
          summary: '创建图片节点',
          shouldExecute: true,
          risk: 'low',
        },
        steps: [
          {
            id: 'step-1',
            type: 'create_node',
            clientNodeId: 'new_image_1',
            nodeType: 'image',
            title: '新图',
            prompt: '电影感海边插画',
          },
        ],
      }),
    })
    mockEditWorkflowExecute
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {},
          edges: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workflowState: {
          blocks: {},
          edges: [],
        },
      })

    const context = createStreamingContext()

    await expect(
      runContentCanvasAgent({
        requestPayload: {
          message: '新建一张图',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          confirmationMode: 'auto',
        },
        context,
        execContext: {
          userId: 'user-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
        },
        options: {},
      })
    ).rejects.toThrow(/blocked|卡住|无法继续/i)

    expect(mockEditWorkflowExecute).toHaveBeenCalledTimes(2)
    expect(
      context.contentBlocks.some(
        (block) => block.type === 'action_event' && block.actionEvent?.name === 'blocked_step'
      )
    ).toBe(true)
  })

  it('fails visibly when planned add_node actions do not materialize in the workflow', async () => {
    mockLoadWorkflowFromNormalizedTables
      .mockResolvedValueOnce(createSelectedImageWorkflowState())
      .mockResolvedValueOnce(createSelectedImageWorkflowState())
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({
        assistantText: '',
        summary: '',
        actions: [],
      }),
    })
    mockEditWorkflowExecute.mockResolvedValue({
      success: true,
      skippedItems: ['Block name "图片描述" conflicts with existing block "图片描述"'],
      skippedItemsMessage:
        '1 operation(s) were skipped due to invalid references. Details: Block name "图片描述" conflicts with existing block "图片描述"',
    })

    const context = createStreamingContext()

    await expect(
      runContentCanvasAgent({
        requestPayload: {
          message: '帮我为这张图片生成文字说明',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          confirmationMode: 'auto',
          autoSelectionContexts: [
            {
              kind: 'blocks',
              blockIds: ['image-1'],
              label: 'Current canvas selection (1)',
            },
          ],
        },
        context,
        execContext: {
          userId: 'user-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
        },
        options: {},
      })
    ).rejects.toThrow(/画布|canvas/i)

    expect(context.accumulatedContent).not.toContain('已执行以下内容画布操作')
  })
})
