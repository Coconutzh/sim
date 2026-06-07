/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LocalAgentContext,
  LocalAgentMemoryData,
  LocalAgentPlan,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import type { StreamEvent } from '@/lib/copilot/request/session'
import { ContentBlockType } from '@/lib/copilot/request/types'

const {
  mockResolveLocalAgentContext,
  mockLoadLocalAgentMemory,
  mockSaveLocalAgentMemory,
  mockBuildLocalAgentAnswer,
  mockBuildLocalAgentPlan,
  mockSummarizeLocalAgentRun,
  mockVerifyLocalAgentFinalAnswer,
  mockPersistLocalAgentSessionMetadata,
  mockClassifyLocalCanvasAgentRouting,
  mockExecuteLocalAgentTool,
  mockRunLocalAgentToolLoop,
} = vi.hoisted(() => ({
  mockResolveLocalAgentContext: vi.fn(),
  mockLoadLocalAgentMemory: vi.fn(),
  mockSaveLocalAgentMemory: vi.fn(),
  mockBuildLocalAgentAnswer: vi.fn(async () => '已完成画布修改，并完成验证。'),
  mockBuildLocalAgentPlan: vi.fn(),
  mockSummarizeLocalAgentRun: vi.fn(),
  mockVerifyLocalAgentFinalAnswer: vi.fn(async ({ answer }: { answer: string }) => answer),
  mockPersistLocalAgentSessionMetadata: vi.fn(),
  mockClassifyLocalCanvasAgentRouting: vi.fn(() => ({
    kind: 'canvas',
    reason: 'test canvas request',
  })),
  mockExecuteLocalAgentTool: vi.fn(),
  mockRunLocalAgentToolLoop: vi.fn(),
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/context-manager', () => ({
  resolveLocalAgentContext: mockResolveLocalAgentContext,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/memory', () => ({
  loadLocalAgentMemory: mockLoadLocalAgentMemory,
  saveLocalAgentMemory: mockSaveLocalAgentMemory,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/models/actor', () => ({
  buildLocalAgentAnswer: mockBuildLocalAgentAnswer,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/planner', () => ({
  buildLocalAgentPlan: mockBuildLocalAgentPlan,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/models/summarizer', () => ({
  summarizeLocalAgentRun: mockSummarizeLocalAgentRun,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/models/verifier', () => ({
  verifyLocalAgentFinalAnswer: mockVerifyLocalAgentFinalAnswer,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/routing', () => ({
  classifyLocalCanvasAgentRouting: mockClassifyLocalCanvasAgentRouting,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/session', () => ({
  persistLocalAgentSessionMetadata: mockPersistLocalAgentSessionMetadata,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/tool-executor-bridge', () => ({
  executeLocalAgentTool: mockExecuteLocalAgentTool,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/tool-loop', () => ({
  runLocalAgentToolLoop: mockRunLocalAgentToolLoop,
}))

import { runLocalCanvasAgent } from '@/lib/copilot/request/lifecycle/local-canvas-agent/runtime'

const patchPlan: LocalAgentPlan = {
  goal: 'Reorganize canvas',
  risk: 'medium',
  requiresClarification: false,
  steps: [
    {
      id: 'apply',
      title: 'Apply canvas changes',
      intent: 'update',
      toolHints: ['canvas.apply_patch'],
      expectedObservation: 'Canvas patch is applied',
    },
  ],
  successCriteria: ['Canvas is organized'],
  patch: {
    operations: [{ type: 'layout_nodes', direction: 'horizontal' }],
  },
}

function buildStreamContext() {
  return {
    accumulatedContent: '',
    contentBlocks: [],
    toolCalls: new Map(),
    streamComplete: false,
  } as unknown as LocalAgentContext['streamContext']
}

function buildLocalContext(overrides: Partial<LocalAgentContext> = {}): LocalAgentContext {
  const streamContext = overrides.streamContext ?? buildStreamContext()
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    chatId: 'chat-1',
    message: '重新整理整个画布，补齐缺失节点并连接。',
    sessionScope: 'personal',
    agent: { code: 'chief_director', name: 'Canvas Agent', description: '', systemPrompt: '' },
    discipline: { id: '', code: 'chief_director', name: '总导演' },
    workgroup: { id: '', name: 'Workspace', organizationId: '', teamWorkspaceId: null },
    permissions: { canRead: true, canWrite: true, canPublish: false },
    selectedNodeIds: [],
    conversationHistory: [],
    skills: [],
    model: { model: 'test-model', mode: 'structured' },
    confirmationMode: 'manual',
    thinkingLevel: 'standard',
    requestPayload: {},
    execContext: {
      userId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
    },
    streamContext,
    options: {},
    ...overrides,
  }
}

function buildMemory(): LocalAgentMemoryData {
  return {
    version: 1,
    scope: 'personal',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    agentCode: 'chief_director',
    chatId: 'chat-1',
    conversationSummary: '',
    taskState: { completedSteps: [], openQuestions: [] },
    canvasSummary: '',
    recentObservations: [],
    updatedAt: '2026-06-06T00:00:00.000Z',
  }
}

describe('local canvas runtime manual confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadLocalAgentMemory.mockResolvedValue(buildMemory())
    mockSummarizeLocalAgentRun.mockResolvedValue(buildMemory())
    mockExecuteLocalAgentTool.mockResolvedValue({
      name: 'canvas.apply_patch',
      success: true,
      output: {},
      summary: 'Patch applied',
    })
    mockBuildLocalAgentPlan.mockResolvedValue(patchPlan)
    mockClassifyLocalCanvasAgentRouting.mockReturnValue({
      kind: 'canvas',
      reason: 'test canvas request',
    })
    mockRunLocalAgentToolLoop.mockResolvedValue({
      plan: patchPlan,
      observations: [],
      answer: 'ready',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows Confirm and Revise options without applying a manual patch immediately', async () => {
    const streamContext = buildStreamContext()
    const events: StreamEvent[] = []
    mockResolveLocalAgentContext.mockResolvedValue(buildLocalContext({ streamContext }))

    await runLocalCanvasAgent({
      requestPayload: {},
      context: streamContext,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        chatId: 'chat-1',
      },
      options: {
        onEvent: async (event) => {
          events.push(event)
        },
      },
    })

    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalled()
    expect(mockRunLocalAgentToolLoop).not.toHaveBeenCalled()
    expect(mockPersistLocalAgentSessionMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionScope: 'personal',
        agent: expect.objectContaining({ code: 'chief_director' }),
      })
    )
    expect(streamContext.streamComplete).toBe(true)
    expect(streamContext.contentBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: ContentBlockType.options,
          options: expect.arrayContaining([
            expect.objectContaining({ label: 'Confirm' }),
            expect.objectContaining({ label: 'Revise' }),
          ]),
        }),
      ])
    )
    expect(
      events.some(
        (event) =>
          event.type === 'text' &&
          event.payload.text.includes('<options>') &&
          event.payload.text.includes('__local_canvas_confirm__') &&
          event.payload.text.includes('__local_canvas_revise__')
      )
    ).toBe(true)
  })

  it('passes loaded memory into the tool loop context', async () => {
    const streamContext = buildStreamContext()
    const memory = buildMemory()
    memory.conversationSummary = '上一轮已经分析过当前画布。'
    mockLoadLocalAgentMemory.mockResolvedValueOnce(memory)
    mockResolveLocalAgentContext.mockResolvedValue(
      buildLocalContext({
        confirmationMode: 'auto',
        streamContext,
      })
    )

    await runLocalCanvasAgent({
      requestPayload: {},
      context: streamContext,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        chatId: 'chat-1',
      },
      options: {},
    })

    expect(mockRunLocalAgentToolLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        memory: expect.objectContaining({
          conversationSummary: '上一轮已经分析过当前画布。',
        }),
      })
    )
  })

  it('answers clearly non-canvas requests without planning or reading the canvas', async () => {
    const streamContext = buildStreamContext()
    mockClassifyLocalCanvasAgentRouting.mockReturnValueOnce({
      kind: 'non_canvas',
      reason: 'message is clearly outside current canvas operations',
    })
    mockResolveLocalAgentContext.mockResolvedValue(
      buildLocalContext({
        confirmationMode: 'auto',
        message: '高考可能会考什么内容？',
        streamContext,
      })
    )

    await runLocalCanvasAgent({
      requestPayload: {},
      context: streamContext,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        chatId: 'chat-1',
      },
      options: {},
    })

    expect(mockBuildLocalAgentPlan).not.toHaveBeenCalled()
    expect(mockRunLocalAgentToolLoop).not.toHaveBeenCalled()
    expect(mockLoadLocalAgentMemory).not.toHaveBeenCalled()
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalled()
    expect(streamContext.accumulatedContent).toContain('不是当前画布相关任务')
    expect(streamContext.streamComplete).toBe(true)
  })

  it('still emits the final answer when memory load and save fail', async () => {
    const streamContext = buildStreamContext()
    mockLoadLocalAgentMemory.mockRejectedValueOnce(new Error('memory unavailable'))
    mockSummarizeLocalAgentRun.mockRejectedValueOnce(new Error('summary failed'))
    mockResolveLocalAgentContext.mockResolvedValue(
      buildLocalContext({
        confirmationMode: 'auto',
        streamContext,
      })
    )
    mockRunLocalAgentToolLoop.mockResolvedValueOnce({
      plan: patchPlan,
      observations: [
        {
          toolName: 'canvas.apply_patch',
          success: true,
          summary: 'Patch applied',
          timestamp: '2026-06-06T00:00:00.000Z',
        },
      ],
      answer: '已完成画布修改。',
    })

    await runLocalCanvasAgent({
      requestPayload: {},
      context: streamContext,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        chatId: 'chat-1',
      },
      options: {},
    })

    expect(streamContext.accumulatedContent).toBe('已完成画布修改。')
    expect(streamContext.streamComplete).toBe(true)
  })

  it('emits a visible final error when the auto tool loop throws', async () => {
    const streamContext = buildStreamContext()
    mockResolveLocalAgentContext.mockResolvedValue(
      buildLocalContext({
        confirmationMode: 'auto',
        streamContext,
      })
    )
    mockRunLocalAgentToolLoop.mockRejectedValueOnce(new Error('edit workflow failed'))

    await runLocalCanvasAgent({
      requestPayload: {},
      context: streamContext,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        chatId: 'chat-1',
      },
      options: {},
    })

    expect(streamContext.accumulatedContent).toContain('edit workflow failed')
    expect(streamContext.streamComplete).toBe(true)
  })

  it('executes the pending patch and verifies after Confirm', async () => {
    const firstStream = buildStreamContext()
    mockResolveLocalAgentContext.mockResolvedValueOnce(
      buildLocalContext({ streamContext: firstStream })
    )
    await runLocalCanvasAgent({
      requestPayload: {},
      context: firstStream,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        chatId: 'chat-confirm',
      },
      options: {},
    })

    const confirmStream = buildStreamContext()
    mockResolveLocalAgentContext.mockResolvedValueOnce(
      buildLocalContext({
        chatId: 'chat-1',
        message: '确认',
        streamContext: confirmStream,
      })
    )
    await runLocalCanvasAgent({
      requestPayload: {},
      context: confirmStream,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        chatId: 'chat-confirm',
      },
      options: {},
    })

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.apply_patch',
      input: { patch: patchPlan.patch },
    })
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.verify_patch',
      input: { patch: patchPlan.patch },
    })
    expect(confirmStream.accumulatedContent).toBe('已完成画布修改，并完成验证。')
  })

  it('drops the pending patch after Revise and asks for adjustment direction', async () => {
    const firstStream = buildStreamContext()
    mockResolveLocalAgentContext.mockResolvedValueOnce(
      buildLocalContext({ chatId: 'chat-revise', streamContext: firstStream })
    )
    await runLocalCanvasAgent({
      requestPayload: {},
      context: firstStream,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        chatId: 'chat-revise',
      },
      options: {},
    })

    const reviseId = (
      firstStream.contentBlocks.find((block) => block.type === ContentBlockType.options)?.options ??
      []
    ).find((option) => option.label === 'Revise')?.value
    expect(reviseId).toBeDefined()

    const reviseStream = buildStreamContext()
    mockResolveLocalAgentContext.mockResolvedValueOnce(
      buildLocalContext({
        chatId: 'chat-revise',
        message: String(reviseId),
        streamContext: reviseStream,
      })
    )
    await runLocalCanvasAgent({
      requestPayload: {},
      context: reviseStream,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        chatId: 'chat-revise',
      },
      options: {},
    })

    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalled()
    expect(reviseStream.accumulatedContent).toContain('如何调整')
  })

  it('expires pending manual plans before executing old Confirm actions', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-06T00:00:00.000Z'))
    const firstStream = buildStreamContext()
    mockResolveLocalAgentContext.mockResolvedValueOnce(
      buildLocalContext({ chatId: 'chat-expire', streamContext: firstStream })
    )
    await runLocalCanvasAgent({
      requestPayload: {},
      context: firstStream,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        chatId: 'chat-expire',
      },
      options: {},
    })
    const confirmId = (
      firstStream.contentBlocks.find((block) => block.type === ContentBlockType.options)?.options ??
      []
    ).find((option) => option.label === 'Confirm')?.value
    expect(confirmId).toBeDefined()

    vi.setSystemTime(new Date('2026-06-06T00:31:00.000Z'))
    const confirmStream = buildStreamContext()
    mockResolveLocalAgentContext.mockResolvedValueOnce(
      buildLocalContext({
        chatId: 'chat-expire',
        message: String(confirmId),
        streamContext: confirmStream,
      })
    )
    await runLocalCanvasAgent({
      requestPayload: {},
      context: confirmStream,
      execContext: {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        chatId: 'chat-expire',
      },
      options: {},
    })

    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalled()
    expect(confirmStream.accumulatedContent).toContain('确认请求已经过期')
    expect(confirmStream.streamComplete).toBe(true)
  })
})
