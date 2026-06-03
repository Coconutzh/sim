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
}))

vi.mock('@sim/utils/id', () => ({
  generateId: mockGenerateId,
}))

vi.mock('@sim/logger', () => ({
  createLogger: mockCreateLogger,
}))

vi.mock('@/providers', () => ({
  executeProviderRequest: mockExecuteProviderRequest,
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
      LOCAL_COPILOT_PROVIDER: 'deepseek',
      LOCAL_COPILOT_MODEL: 'deepseek-chat',
      DEEPSEEK_API_KEY: 'test-key',
    },
  }
})

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/text-content-ai-utils',
  () => ({
    buildTextNodeAiSystemPrompt: vi.fn(() => 'system'),
    convertGeneratedTextToContentHtml: vi.fn((text: string) => `<p>${text}</p>`),
  })
)

vi.mock('@/lib/generated-media/audio/audio-generation-service', () => ({
  generateWorkspaceAudioFromPrompt: vi.fn(),
}))

vi.mock('@/lib/generated-media/image/image-generation-service', () => ({
  generateWorkspaceImageFromPrompt: mockGenerateWorkspaceImageFromPrompt,
}))

vi.mock('@/lib/generated-media/video/video-generation-service', () => ({
  generateWorkspaceVideoFromPrompt: vi.fn(),
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

describe('content canvas agent', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
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

  it('requires deepseek env vars for planner config', () => {
    delete process.env.LOCAL_COPILOT_PROVIDER
    delete process.env.LOCAL_COPILOT_MODEL
    delete process.env.DEEPSEEK_API_KEY

    expect(() => __contentCanvasAgentTestUtils.resolveContentCanvasPlannerConfig()).toThrow(
      'LOCAL_COPILOT_PROVIDER=deepseek'
    )
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
