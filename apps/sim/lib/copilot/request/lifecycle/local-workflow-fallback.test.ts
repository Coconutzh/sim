/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext, StreamingContext } from '@/lib/copilot/request/types'

const {
  mockEditWorkflowExecute,
  mockGenerateId,
  mockGenerateShortId,
  mockGetLocalCopilotPlannerConfig,
  mockLoadWorkflowFromNormalizedTables,
  mockPlanLocalWorkflow,
} = vi.hoisted(() => {
  return {
    mockEditWorkflowExecute: vi.fn(),
    mockGenerateId: vi.fn(),
    mockGenerateShortId: vi.fn(() => 'abc123'),
    mockGetLocalCopilotPlannerConfig: vi.fn(),
    mockLoadWorkflowFromNormalizedTables: vi.fn(),
    mockPlanLocalWorkflow: vi.fn(),
  }
})

vi.mock('@sim/utils/id', () => ({
  generateId: mockGenerateId,
  generateShortId: mockGenerateShortId,
}))

vi.mock('@/lib/copilot/tools/server/workflow/edit-workflow', () => ({
  editWorkflowServerTool: {
    execute: mockEditWorkflowExecute,
  },
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mockLoadWorkflowFromNormalizedTables,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-workflow-planner', () => ({
  getLocalCopilotPlannerConfig: mockGetLocalCopilotPlannerConfig,
  planLocalWorkflow: mockPlanLocalWorkflow,
}))

import {
  buildLocalWorkflowFallbackPlan,
  isLocalWorkflowFallbackIntent,
  runLocalWorkflowFallback,
  shouldUseLocalWorkflowFallback,
} from '@/lib/copilot/request/lifecycle/local-workflow-fallback'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'

const CHINESE_WORKFLOW_PROMPT =
  '\u5728\u753b\u5e03\u751f\u6210\u4e00\u5957\u6587\u751f\u56fe\u751f\u89c6\u9891\u8282\u70b9\u5e76\u8fde\u7ebf'
const CHINESE_DESCRIBE_PROMPT = '\u63cf\u8ff0\u73b0\u5728\u753b\u5e03\u5185\u7684\u529f\u80fd'
const CHINESE_STORYBOARD_PROMPT =
  '\u628a\u521a\u521a\u5b9e\u73b0\u7684\u529f\u80fd\u4fee\u6539\u4e00\u4e0b\uff0c\u5b9e\u73b0\u6587\u751f3\u4e2a\u5206\u955c\u56fe\u518d\u751f\u89c6\u9891'
const CHINESE_LAYOUT_PROMPT =
  '\u628a\u76ee\u524d\u753b\u5e03\u7684\u5e03\u5c40\u8c03\u6574\u6210\u6a2a\u5411'
const CHINESE_TEXT_AGENT_PROMPT =
  '\u6dfb\u52a0\u4e00\u4e2a\u6587\u672c\u751f\u6210\u6a21\u578b\u8282\u70b9'

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

function createExecutionContext(): ExecutionContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    chatId: 'chat-1',
    messageId: 'message-1',
  }
}

function createImageToVideoWorkflowState() {
  return {
    blocks: {
      'image-1': {
        type: 'image_generator',
        name: 'Image Generator Existing',
        position: { x: 120, y: 80 },
        subBlocks: {
          prompt: { value: 'A cinematic ocean sunrise' },
          model: { value: 'gpt-image-1' },
        },
      },
      'video-1': {
        type: 'video_generator_v2',
        name: 'Video Generator Existing',
        position: { x: 520, y: 80 },
        subBlocks: {
          provider: { value: 'runway' },
          prompt: { value: 'Animate the image' },
        },
      },
    },
    edges: [{ source: 'image-1', target: 'video-1', sourceHandle: 'source' }],
  }
}

describe('local workflow fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateId
      .mockReturnValueOnce('image-block-id')
      .mockReturnValueOnce('video-block-id')
      .mockImplementation(() => `generated-id-${mockGenerateId.mock.calls.length}`)
    mockEditWorkflowExecute.mockResolvedValue({ success: true })
    mockGetLocalCopilotPlannerConfig.mockReturnValue(null)
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(null)
    mockPlanLocalWorkflow.mockResolvedValue(null)
  })

  it('detects image to video scaffold intent from Chinese workflow prompts', () => {
    expect(isLocalWorkflowFallbackIntent(CHINESE_WORKFLOW_PROMPT)).toBe(true)
  })

  it('detects canvas edit intents beyond image and video scaffolding', () => {
    expect(isLocalWorkflowFallbackIntent(CHINESE_LAYOUT_PROMPT)).toBe(true)
    expect(isLocalWorkflowFallbackIntent(CHINESE_STORYBOARD_PROMPT)).toBe(true)
    expect(isLocalWorkflowFallbackIntent(CHINESE_TEXT_AGENT_PROMPT)).toBe(true)
  })

  it('builds image and video add operations that stay connected', () => {
    const plan = buildLocalWorkflowFallbackPlan(CHINESE_WORKFLOW_PROMPT)

    expect(plan.kind).toBe('image_to_video')
    expect(plan.operations).toHaveLength(2)
    expect(plan.operations[0]).toMatchObject({
      operation_type: 'add',
      block_id: 'image-block-id',
      params: {
        type: 'image_generator',
        name: 'Image Generator ABC123',
        connections: {
          success: 'video-block-id',
        },
      },
    })
    expect(plan.operations[1]).toMatchObject({
      operation_type: 'add',
      block_id: 'video-block-id',
      params: {
        type: 'video_generator_v2',
        name: 'Video Generator ABC123',
        inputs: {
          provider: 'runway',
        },
      },
    })
  })

  it('preserves a Chinese theme phrase as the image prompt seed', () => {
    const plan = buildLocalWorkflowFallbackPlan(
      '在画布生成一套文生图生视频节点并连线，画面主题是清晨海边的电影感旅行短片'
    )

    expect(plan.operations[0]).toMatchObject({
      params: {
        inputs: {
          prompt: '清晨海边的电影感旅行短片',
        },
      },
    })
  })

  it('enables the fallback only for local workflow debug sessions', () => {
    expect(
      shouldUseLocalWorkflowFallback({
        workflowId: 'wf-1',
        disableAuth: true,
        hasCopilotApiKey: false,
      })
    ).toBe(true)

    expect(
      shouldUseLocalWorkflowFallback({
        workflowId: 'wf-1',
        disableAuth: false,
        hasCopilotApiKey: false,
      })
    ).toBe(false)
  })

  it('describes the current canvas from the workflow snapshot without editing it', async () => {
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(createImageToVideoWorkflowState())

    const context = createStreamingContext()
    await runLocalWorkflowFallback({
      requestPayload: {
        message: CHINESE_DESCRIBE_PROMPT,
        workflowId: 'workflow-1',
      },
      context,
      execContext: createExecutionContext(),
      options: {},
    })

    expect(editWorkflowServerTool.execute).not.toHaveBeenCalled()
    expect(context.streamComplete).toBe(true)
    expect(context.accumulatedContent).toContain(
      '\u5f53\u524d\u753b\u5e03\u91cc\u6709 2 \u4e2a\u8282\u70b9'
    )
    expect(context.accumulatedContent).toContain('Image Generator Existing')
    expect(context.accumulatedContent).toContain('Video Generator Existing')
    expect(context.accumulatedContent).toContain(
      'Image Generator Existing -> Video Generator Existing'
    )
  })

  it('edits the existing image-to-video chain when converting it to storyboard video', async () => {
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(createImageToVideoWorkflowState())

    const context = createStreamingContext()
    await runLocalWorkflowFallback({
      requestPayload: {
        message: CHINESE_STORYBOARD_PROMPT,
        workflowId: 'workflow-1',
      },
      context,
      execContext: createExecutionContext(),
      options: {},
    })

    expect(editWorkflowServerTool.execute).toHaveBeenCalledTimes(1)
    const executeParams = vi.mocked(editWorkflowServerTool.execute).mock.calls[0]?.[0]

    expect(executeParams?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation_type: 'edit',
          block_id: 'image-1',
          params: expect.objectContaining({
            connections: { success: 'video-1' },
          }),
        }),
        expect.objectContaining({
          operation_type: 'edit',
          block_id: 'video-1',
        }),
      ])
    )
    expect(
      executeParams?.operations.filter((operation) => operation.operation_type === 'add')
    ).toHaveLength(2)
    expect(context.accumulatedContent).toContain('3 \u4e2a\u5206\u955c\u56fe\u8282\u70b9')
  })

  it('answers basic chat requests instead of forcing every prompt into media workflow creation', async () => {
    const context = createStreamingContext()
    await runLocalWorkflowFallback({
      requestPayload: {
        message: '\u4e00\u52a0\u4e00\u7b49\u4e8e\u51e0\uff1f',
        workflowId: 'workflow-1',
        conversationHistory: [
          { role: 'user', content: '\u6211\u559c\u6b22\u6a2a\u5411\u5e03\u5c40' },
        ],
      },
      context,
      execContext: createExecutionContext(),
      options: {},
    })

    expect(editWorkflowServerTool.execute).not.toHaveBeenCalled()
    expect(context.accumulatedContent).toContain('2')
  })

  it('creates a layout edit proposal that only changes positions', async () => {
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(createImageToVideoWorkflowState())

    const context = createStreamingContext()
    await runLocalWorkflowFallback({
      requestPayload: {
        message: CHINESE_LAYOUT_PROMPT,
        workflowId: 'workflow-1',
      },
      context,
      execContext: createExecutionContext(),
      options: {},
    })

    const executeParams = vi.mocked(editWorkflowServerTool.execute).mock.calls[0]?.[0]
    expect(executeParams?.operations).toEqual([
      expect.objectContaining({
        operation_type: 'edit',
        block_id: 'image-1',
        params: { position: { x: 0, y: 0 } },
      }),
      expect.objectContaining({
        operation_type: 'edit',
        block_id: 'video-1',
        params: { position: { x: 360, y: 180 } },
      }),
    ])
    expect(context.accumulatedContent).toContain('\u6a2a\u5411\u5e03\u5c40')
  })

  it('creates a generic text generation agent node', async () => {
    const context = createStreamingContext()
    await runLocalWorkflowFallback({
      requestPayload: {
        message: CHINESE_TEXT_AGENT_PROMPT,
        workflowId: 'workflow-1',
      },
      context,
      execContext: createExecutionContext(),
      options: {},
    })

    const executeParams = vi.mocked(editWorkflowServerTool.execute).mock.calls[0]?.[0]
    expect(executeParams?.operations).toEqual([
      expect.objectContaining({
        operation_type: 'add',
        params: expect.objectContaining({
          type: 'agent',
          name: 'Text Agent ABC123',
          inputs: expect.objectContaining({
            model: 'claude-sonnet-4-6',
          }),
        }),
      }),
    ])
  })
})
