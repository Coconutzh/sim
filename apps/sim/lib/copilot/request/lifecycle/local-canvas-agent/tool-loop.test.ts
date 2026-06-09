/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LocalAgentContext,
  LocalAgentPlan,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const {
  mockBuildLocalAgentPlan,
  mockBuildLocalAgentAnswer,
  mockRequestLocalAgentDecision,
  mockExecuteLocalAgentTool,
  mockSelectLocalAgentNextToolCall,
} = vi.hoisted(() => ({
  mockBuildLocalAgentPlan: vi.fn(),
  mockBuildLocalAgentAnswer: vi.fn(async () => 'done'),
  mockRequestLocalAgentDecision: vi.fn(),
  mockExecuteLocalAgentTool: vi.fn(),
  mockSelectLocalAgentNextToolCall: vi.fn(({ candidates }) => candidates[0] ?? null),
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/planner', () => ({
  buildLocalAgentPlan: mockBuildLocalAgentPlan,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/models/actor', () => ({
  buildLocalAgentAnswer: mockBuildLocalAgentAnswer,
  selectLocalAgentNextToolCall: mockSelectLocalAgentNextToolCall,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/decision', () => ({
  requestLocalAgentDecision: mockRequestLocalAgentDecision,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/tool-executor-bridge', () => ({
  executeLocalAgentTool: mockExecuteLocalAgentTool,
}))

import { runLocalAgentToolLoop } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-loop'

function buildContext(overrides: Partial<LocalAgentContext> = {}): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    message: '读取 node-does-not-exist 并修改它。',
    sessionScope: 'personal',
    agent: { code: 'chief_director', name: 'Canvas Agent', description: '', systemPrompt: '' },
    discipline: { id: '', code: 'chief_director', name: '总导演' },
    workgroup: { id: '', name: 'Workspace', organizationId: '', teamWorkspaceId: null },
    permissions: { canRead: true, canWrite: true, canPublish: false },
    selectedNodeIds: [],
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

function buildLegacyContext(overrides: Partial<LocalAgentContext> = {}): LocalAgentContext {
  return buildContext({
    ...overrides,
    requestPayload: {
      ...overrides.requestPayload,
      localAgentMode: 'legacy',
    },
  })
}

describe('local canvas tool loop', () => {
  beforeEach(() => {
    mockBuildLocalAgentPlan.mockReset()
    mockBuildLocalAgentAnswer.mockReset()
    mockRequestLocalAgentDecision.mockReset()
    mockExecuteLocalAgentTool.mockReset()
    mockSelectLocalAgentNextToolCall.mockReset()
    mockBuildLocalAgentAnswer.mockResolvedValue('done')
    mockSelectLocalAgentNextToolCall.mockImplementation(({ candidates }) => candidates[0] ?? null)
    mockRequestLocalAgentDecision.mockRejectedValue(new Error('model decision unavailable'))
    mockExecuteLocalAgentTool.mockResolvedValue({
      name: 'canvas.read_node',
      success: false,
      error: 'Node "node-does-not-exist" was not found',
      summary: 'Node "node-does-not-exist" was not found',
    })
  })

  it('runs model decision tool calls when model_tool_loop mode is requested', async () => {
    mockRequestLocalAgentDecision
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolName: 'canvas.read_summary',
        toolInput: {},
        userVisibleReason: '我先读取当前画布。',
        risk: 'low',
      })
      .mockResolvedValueOnce({
        type: 'final_answer',
        answer: '当前画布是空的。',
      })
    mockExecuteLocalAgentTool.mockResolvedValueOnce({
      name: 'canvas.read_summary',
      success: true,
      output: { nodes: [], edges: [] },
      summary: 'Read canvas summary with 0 nodes and 0 connections',
    })

    const result = await runLocalAgentToolLoop(
      buildContext({
        requestPayload: { localAgentMode: 'model_tool_loop' },
        message: '当前画布有什么？',
      })
    )

    expect(mockBuildLocalAgentPlan).not.toHaveBeenCalled()
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.read_summary',
      input: {},
    })
    expect(result.answer).toBe('当前画布是空的。')
    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'canvas.read_summary',
          success: true,
        }),
      ])
    )
  })

  it('defaults to model_tool_loop without silently falling back to planner', async () => {
    vi.stubEnv('LOCAL_CANVAS_AGENT_MODE', '')

    try {
      const result = await runLocalAgentToolLoop(
        buildContext({
          message: '当前画布有什么？',
        })
      )

      expect(mockRequestLocalAgentDecision).toHaveBeenCalled()
      expect(mockBuildLocalAgentPlan).not.toHaveBeenCalled()
      expect(mockExecuteLocalAgentTool).not.toHaveBeenCalled()
      expect(result.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolName: 'decision',
            success: false,
            summary: 'model decision unavailable',
          }),
          expect.objectContaining({
            toolName: 'decision',
            success: false,
            summary: 'Stopped because the model decision could not be produced.',
          }),
        ])
      )
      expect(result.observations).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            summary: expect.stringContaining('max step limit'),
          }),
        ])
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('retries one malformed model decision before stopping the model loop', async () => {
    mockRequestLocalAgentDecision
      .mockRejectedValueOnce(new Error('Unterminated string in JSON at position 566'))
      .mockResolvedValueOnce({
        type: 'final_answer',
        answer: '我已修正决策格式并继续处理。',
      })

    const result = await runLocalAgentToolLoop(
      buildContext({
        requestPayload: { localAgentMode: 'model_tool_loop' },
        message: '先给我一个内容链方案。',
      })
    )

    expect(mockBuildLocalAgentPlan).not.toHaveBeenCalled()
    expect(mockRequestLocalAgentDecision).toHaveBeenCalledTimes(2)
    expect(result.answer).toBe('我已修正决策格式并继续处理。')
    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'decision',
          success: false,
          summary: 'Unterminated string in JSON at position 566',
        }),
      ])
    )
  })

  it('uses the legacy planner fallback when hybrid mode is explicitly requested', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Read the current canvas with legacy fallback',
      risk: 'low',
      userIntent: 'inspect_canvas',
      mutationPolicy: 'read_only',
      canvasReadPolicy: 'required',
      requiresClarification: false,
      steps: [],
      successCriteria: ['Canvas summary is read'],
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)
    mockExecuteLocalAgentTool.mockResolvedValueOnce({
      name: 'canvas.read_summary',
      success: true,
      output: {},
      summary: 'Canvas summary read',
    })

    await runLocalAgentToolLoop(
      buildContext({
        requestPayload: { localAgentMode: 'hybrid' },
        message: '总结当前画布。',
      })
    )

    expect(mockRequestLocalAgentDecision).toHaveBeenCalled()
    expect(mockBuildLocalAgentPlan).toHaveBeenCalled()
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.read_summary',
      input: {},
    })
  })

  it('runs parallel model read-only tool calls without planner fallback', async () => {
    mockRequestLocalAgentDecision
      .mockResolvedValueOnce({
        type: 'tool_calls',
        userVisibleReason: '我会并行读取画布摘要和选中节点。',
        risk: 'low',
        toolCalls: [
          { toolName: 'canvas.read_summary', toolInput: {} },
          { toolName: 'canvas.read_selected_nodes', toolInput: {} },
        ],
      })
      .mockResolvedValueOnce({
        type: 'final_answer',
        answer: '已读取画布和选中节点。',
      })
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.read_summary',
        success: true,
        output: { nodes: [{ id: 'video-1' }], edges: [] },
        summary: 'Read canvas summary',
      })
      .mockResolvedValueOnce({
        name: 'canvas.read_selected_nodes',
        success: true,
        output: { nodes: [{ id: 'video-1', kind: 'video' }] },
        summary: 'Read selected video node',
      })

    const result = await runLocalAgentToolLoop(
      buildContext({
        requestPayload: { localAgentMode: 'model_tool_loop' },
        selectedNodeIds: ['video-1'],
        message: '总结当前画布并说明选中节点。',
      })
    )

    expect(mockBuildLocalAgentPlan).not.toHaveBeenCalled()
    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(1, expect.anything(), {
      name: 'canvas.read_summary',
      input: {},
    })
    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(2, expect.anything(), {
      name: 'canvas.read_selected_nodes',
      input: {},
    })
    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'canvas.read_summary', success: true }),
        expect.objectContaining({ toolName: 'canvas.read_selected_nodes', success: true }),
      ])
    )
    expect(result.answer).toBe('已读取画布和选中节点。')
  })

  it('blocks mutation tools from parallel model tool calls', async () => {
    mockRequestLocalAgentDecision
      .mockResolvedValueOnce({
        type: 'tool_calls',
        userVisibleReason: '我会并行读取和修改画布。',
        risk: 'low',
        toolCalls: [
          { toolName: 'canvas.read_summary', toolInput: {} },
          {
            toolName: 'canvas.apply_patch',
            toolInput: { patch: { operations: [{ type: 'layout_nodes', direction: 'grid' }] } },
          },
        ],
      })
      .mockResolvedValueOnce({
        type: 'final_answer',
        answer: '我只读取了画布，写入工具不能并行执行。',
      })
    mockExecuteLocalAgentTool.mockResolvedValueOnce({
      name: 'canvas.read_summary',
      success: true,
      output: { nodes: [] },
      summary: 'Read canvas summary',
    })

    const result = await runLocalAgentToolLoop(
      buildContext({
        requestPayload: { localAgentMode: 'model_tool_loop' },
        message: '更新画布布局并读取当前画布。',
      })
    )

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledTimes(1)
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.read_summary',
      input: {},
    })
    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'decision',
          success: false,
          summary: expect.stringContaining('not read-only and concurrency-safe'),
        }),
      ])
    )
    expect(result.answer).toBe('我只读取了画布，写入工具不能并行执行。')
  })

  it('auto-verifies successful model-driven apply_patch before final answer', async () => {
    const patch = { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] }
    mockRequestLocalAgentDecision
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolName: 'canvas.apply_patch',
        toolInput: { patch },
        userVisibleReason: '我会应用布局修改。',
        risk: 'low',
      })
      .mockResolvedValueOnce({
        type: 'final_answer',
        answer: '已更新布局。',
      })
      .mockResolvedValueOnce({
        type: 'final_answer',
        answer: '已更新并验证布局。',
      })
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.apply_patch',
        success: true,
        output: { verification: { success: true } },
        summary: 'Applied canvas patch',
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        output: { success: true },
        summary: 'Verified canvas patch',
      })

    const result = await runLocalAgentToolLoop(
      buildContext({
        requestPayload: { localAgentMode: 'model_tool_loop' },
        message: '请直接修改当前画布布局为横向。',
      })
    )

    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(2, expect.anything(), {
      name: 'canvas.verify_patch',
      input: { patch },
    })
    expect(result.answer).toBe('已更新并验证布局。')
  })

  it('uses the pending verified patch when the model sends a malformed verify patch after apply', async () => {
    const patch = { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] }
    mockRequestLocalAgentDecision
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolName: 'canvas.apply_patch',
        toolInput: { patch },
        userVisibleReason: '我会应用布局修改。',
        risk: 'low',
      })
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolName: 'canvas.verify_patch',
        toolInput: { patch: { operations: [null] } },
        userVisibleReason: '我会验证刚才的修改。',
        risk: 'low',
      })
      .mockResolvedValueOnce({
        type: 'final_answer',
        answer: '已更新并验证布局。',
      })
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.apply_patch',
        success: true,
        output: { verification: { success: true } },
        summary: 'Applied canvas patch',
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        output: { success: true },
        summary: 'Verified canvas patch',
      })

    const result = await runLocalAgentToolLoop(
      buildContext({
        requestPayload: { localAgentMode: 'model_tool_loop' },
        message: '请直接修改当前画布布局为横向。',
      })
    )

    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(2, expect.anything(), {
      name: 'canvas.verify_patch',
      input: { patch },
    })
    expect(result.answer).toBe('已更新并验证布局。')
  })

  it('returns a verified mutation completion when only the final model decision is unavailable', async () => {
    const patch = { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] }
    mockRequestLocalAgentDecision
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolName: 'canvas.apply_patch',
        toolInput: { patch },
        userVisibleReason: '我会应用布局修改。',
        risk: 'low',
      })
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolName: 'canvas.verify_patch',
        toolInput: {},
        userVisibleReason: '我会验证刚才的修改。',
        risk: 'low',
      })
      .mockRejectedValue(new Error('Invalid AgentDecision: expected object, received null'))
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.apply_patch',
        success: true,
        output: { verification: { success: true } },
        summary: 'Applied canvas patch',
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        output: { success: true },
        summary: 'Verified canvas patch',
      })

    const result = await runLocalAgentToolLoop(
      buildContext({
        requestPayload: { localAgentMode: 'model_tool_loop' },
        message: '请直接修改当前画布布局为横向。',
      })
    )

    expect(result.answer).toBe('已完成画布修改，并完成验证。')
    expect(mockBuildLocalAgentAnswer).not.toHaveBeenCalled()
  })

  it('runs a model-authored short-video content-chain patch without planner fallback', async () => {
    const patch = {
      operations: [
        {
          type: 'create_node' as const,
          clientNodeId: 'script',
          kind: 'text' as const,
          title: '高考脚本',
          fields: { contentHtml: '<p>高考冲刺，用三个问题带出短视频开场。</p>' },
        },
        {
          type: 'create_node' as const,
          clientNodeId: 'visual',
          kind: 'image' as const,
          title: '高考主视觉',
          fields: { aiPrompt: '清晨教室、倒计时牌、明亮励志的短视频主视觉。' },
        },
        {
          type: 'create_node' as const,
          clientNodeId: 'video',
          kind: 'video' as const,
          title: '高考视频',
          fields: {
            videoPrompt: '镜头从课桌推向黑板倒计时，节奏轻快、励志。',
            videoParameters: { duration: 5, resolution: '720P' },
          },
        },
        {
          type: 'create_node' as const,
          clientNodeId: 'audio',
          kind: 'audio' as const,
          title: '高考配乐',
          fields: { audioPrompt: '轻快、明亮、带一点紧张推进感的电子配乐。' },
        },
        { type: 'connect' as const, sourceNodeId: 'script', targetNodeId: 'visual' },
        { type: 'connect' as const, sourceNodeId: 'visual', targetNodeId: 'video' },
        { type: 'connect' as const, sourceNodeId: 'video', targetNodeId: 'audio' },
      ],
      reason: '模型直接构造高考主题短视频内容链。',
    }
    mockRequestLocalAgentDecision
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolName: 'canvas.apply_patch',
        toolInput: { patch },
        userVisibleReason: '我会创建脚本、主视觉、视频和配乐节点并连接。',
        risk: 'low',
      })
      .mockResolvedValueOnce({
        type: 'final_answer',
        answer: '已创建内容链。',
      })
      .mockResolvedValueOnce({
        type: 'final_answer',
        answer: '已创建并验证内容链。',
      })
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.apply_patch',
        success: true,
        output: { verification: { success: true } },
        summary: 'Applied canvas patch',
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        output: { success: true },
        summary: 'Verified canvas patch',
      })

    const result = await runLocalAgentToolLoop(
      buildContext({
        requestPayload: { localAgentMode: 'model_tool_loop' },
        message: '以高考为主题创建短视频内容链。',
      })
    )

    expect(mockBuildLocalAgentPlan).not.toHaveBeenCalled()
    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(1, expect.anything(), {
      name: 'canvas.apply_patch',
      input: { patch },
    })
    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(2, expect.anything(), {
      name: 'canvas.verify_patch',
      input: { patch },
    })
    expect(JSON.stringify(patch)).not.toContain('以高考为主题创建短视频内容链')
    expect(result.answer).toBe('已创建并验证内容链。')
  })

  it('records model final-answer thread memory updates for persistence', async () => {
    const memoryUpdate = {
      conversationSummary: '用户正在推进高考主题短视频内容链。',
      canvasSummary: '画布已有高考主题脚本、主视觉、视频和配乐。',
      taskState: {
        goal: '继续优化高考主题内容链',
        openQuestions: ['是否继续生成各节点输出？'],
        lastObservation: '内容链已经验证。',
      },
    }
    mockRequestLocalAgentDecision.mockResolvedValueOnce({
      type: 'final_answer',
      answer: '已记录当前进展。',
      memoryUpdate,
    })

    const result = await runLocalAgentToolLoop(
      buildContext({
        requestPayload: { localAgentMode: 'model_tool_loop' },
        message: '记住这个内容链后续还要继续优化。',
      })
    )

    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'memory',
          success: true,
          output: memoryUpdate,
        }),
      ])
    )
    expect(result.answer).toBe('已记录当前进展。')
  })

  it.each([
    {
      kind: 'text',
      nodeId: 'text-1',
      message: '把选中的文本节点改成更年轻、更轻快一点的语气。',
      fields: { contentHtml: '<p>开场更短、更轻快，像在和同学直接聊天。</p>' },
    },
    {
      kind: 'image',
      nodeId: 'image-1',
      message: '把选中的图片节点提示词改成清晨教室的励志风格。',
      fields: { aiPrompt: '清晨教室、倒计时牌、明亮励志的主视觉。' },
    },
    {
      kind: 'video',
      nodeId: 'video-1',
      message: '把选中的视频节点提示词改成慢镜头推进，时长改成 8 秒。',
      fields: {
        videoPrompt: '慢镜头从课桌推进到黑板倒计时，情绪逐渐振奋。',
        videoParameters: { duration: 8, resolution: '720P' },
      },
    },
    {
      kind: 'audio',
      nodeId: 'audio-1',
      message: '把选中的音频节点音乐方向改成轻快电子乐。',
      fields: { audioPrompt: '轻快电子乐，明亮、鼓点稳定、适合高考冲刺短视频。' },
    },
  ])('updates a selected $kind node from a model-authored patch', async (caseData) => {
    const patch = {
      operations: [
        {
          type: 'update_node' as const,
          nodeId: caseData.nodeId,
          fields: caseData.fields,
        },
      ],
      reason: `Update selected ${caseData.kind} node fields from the user's instruction.`,
    }
    mockRequestLocalAgentDecision
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolName: 'canvas.read_selected_nodes',
        toolInput: {},
        userVisibleReason: '我先读取当前选中节点。',
        risk: 'low',
      })
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolName: 'canvas.apply_patch',
        toolInput: { patch },
        userVisibleReason: '我会只更新选中节点的可编辑字段。',
        risk: 'low',
      })
      .mockResolvedValueOnce({
        type: 'final_answer',
        answer: '已更新选中节点。',
      })
      .mockResolvedValueOnce({
        type: 'final_answer',
        answer: '已更新并验证选中节点。',
      })
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.read_selected_nodes',
        success: true,
        output: {
          nodes: [
            {
              id: caseData.nodeId,
              kind: caseData.kind,
              fields: {},
            },
          ],
        },
        summary: `Read selected ${caseData.kind} node`,
      })
      .mockResolvedValueOnce({
        name: 'canvas.apply_patch',
        success: true,
        output: { verification: { success: true } },
        summary: 'Applied selected node patch',
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        output: { success: true },
        summary: 'Verified selected node patch',
      })

    const result = await runLocalAgentToolLoop(
      buildContext({
        requestPayload: { localAgentMode: 'model_tool_loop' },
        selectedNodeIds: [caseData.nodeId],
        message: caseData.message,
      })
    )

    expect(mockBuildLocalAgentPlan).not.toHaveBeenCalled()
    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(1, expect.anything(), {
      name: 'canvas.read_selected_nodes',
      input: {},
    })
    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(2, expect.anything(), {
      name: 'canvas.apply_patch',
      input: { patch },
    })
    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(3, expect.anything(), {
      name: 'canvas.verify_patch',
      input: { patch },
    })
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'canvas.generate_node_output' })
    )
    expect(JSON.stringify(patch)).not.toContain(caseData.message)
    expect(result.answer).toBe('已更新并验证选中节点。')
  })

  it('analyzes selected media through the model tool loop without mutating canvas', async () => {
    mockRequestLocalAgentDecision
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolName: 'canvas.read_selected_nodes',
        toolInput: {},
        userVisibleReason: '我先读取当前选中的媒体节点。',
        risk: 'low',
      })
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolName: 'media.analyze_node_media',
        toolInput: { nodeId: 'video-1', analysisGoal: 'describe' },
        userVisibleReason: '我会分析这个视频节点已有的媒体上下文。',
        risk: 'low',
      })
      .mockResolvedValueOnce({
        type: 'final_answer',
        answer: '这个视频是高考冲刺主题，画面从课桌推进到倒计时牌。',
      })
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.read_selected_nodes',
        success: true,
        output: {
          nodes: [{ id: 'video-1', kind: 'video', file: { name: 'gaokao.mp4' } }],
        },
        summary: 'Read selected video node with file',
      })
      .mockResolvedValueOnce({
        name: 'media.analyze_node_media',
        success: true,
        output: {
          nodeId: 'video-1',
          kind: 'video',
          analysisMode: 'stored_media_context',
          analysisGoal: 'describe',
          analysis: ['视频画面从课桌推进到倒计时牌。'],
        },
        summary: 'Analyzed video node "高考视频" (stored_media_context, with file)',
      })

    const result = await runLocalAgentToolLoop(
      buildContext({
        requestPayload: { localAgentMode: 'model_tool_loop' },
        selectedNodeIds: ['video-1'],
        message: '描述这个视频。',
      })
    )

    expect(mockBuildLocalAgentPlan).not.toHaveBeenCalled()
    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(1, expect.anything(), {
      name: 'canvas.read_selected_nodes',
      input: {},
    })
    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(2, expect.anything(), {
      name: 'media.analyze_node_media',
      input: { nodeId: 'video-1', analysisGoal: 'describe' },
    })
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'canvas.apply_patch' })
    )
    expect(result.answer).toContain('高考冲刺主题')
  })

  it('blocks model mutation calls when intent policy is read-only', async () => {
    mockRequestLocalAgentDecision
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolName: 'canvas.apply_patch',
        toolInput: { patch: { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] } },
        userVisibleReason: '我会修改画布。',
        risk: 'low',
      })
      .mockResolvedValueOnce({
        type: 'final_answer',
        answer: '我先只给方案，不会改画布。',
      })

    const result = await runLocalAgentToolLoop(
      buildContext({
        requestPayload: { localAgentMode: 'model_tool_loop' },
        message: '先和我讨论当前画布怎么设计。',
      })
    )

    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalled()
    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'decision',
          success: false,
          summary: expect.stringContaining('read-only'),
        }),
      ])
    )
    expect(result.answer).toBe('我先只给方案，不会改画布。')
  })

  it('treats manual confirmation mode as propose-only in the model loop', async () => {
    mockRequestLocalAgentDecision
      .mockResolvedValueOnce({
        type: 'tool_call',
        toolName: 'canvas.apply_patch',
        toolInput: { patch: { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] } },
        userVisibleReason: '我会修改画布。',
        risk: 'low',
      })
      .mockResolvedValueOnce({
        type: 'final_answer',
        answer: '需要先确认，我不会直接修改画布。',
      })

    const result = await runLocalAgentToolLoop(
      buildContext({
        confirmationMode: 'manual',
        requestPayload: { localAgentMode: 'model_tool_loop' },
        message: '重新整理当前画布。',
      })
    )

    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalled()
    expect(result.plan).toMatchObject({
      mutationPolicy: 'propose_only',
      requiresUserConfirmation: true,
    })
    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'decision',
          success: false,
          summary: expect.stringContaining('proposal or confirmation first'),
        }),
      ])
    )
    expect(result.answer).toBe('需要先确认，我不会直接修改画布。')
  })

  it('keeps model confirmation patch available for runtime Confirm execution', async () => {
    const patch = {
      operations: [{ type: 'layout_nodes' as const, direction: 'horizontal' as const }],
    }
    mockRequestLocalAgentDecision.mockResolvedValueOnce({
      type: 'ask_confirmation',
      question: '这个操作会重新布局画布，确认执行吗？',
      pendingToolCall: {
        name: 'canvas.apply_patch',
        input: { patch },
      },
      risk: 'medium',
    })

    const result = await runLocalAgentToolLoop(
      buildContext({
        requestPayload: { localAgentMode: 'model_tool_loop' },
        message: '先给我确认后再重新布局画布。',
      })
    )

    expect(result.plan).toMatchObject({
      requiresClarification: true,
      requiresUserConfirmation: true,
      patch,
    })
    expect(result.answer).toBe('这个操作会重新布局画布，确认执行吗？')
  })

  it('executes explicit read_node calls from plan readNodeIds', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Read missing node',
      risk: 'low',
      requiresClarification: false,
      steps: [
        {
          id: 'read',
          title: 'Read explicitly referenced node',
          intent: 'inspect',
          toolHints: ['canvas.read_node'],
          expectedObservation: 'Node detail or missing node error',
        },
      ],
      successCriteria: ['Do not patch missing nodes'],
      readNodeIds: ['node-does-not-exist'],
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)

    const result = await runLocalAgentToolLoop(buildLegacyContext())

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.read_node',
      input: { nodeId: 'node-does-not-exist' },
    })
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'canvas.apply_patch' })
    )
    expect(result.observations.at(-1)).toMatchObject({
      toolName: 'canvas.read_node',
      success: false,
    })
  })

  it('stops before subsequent tools when the abort signal is raised during execution', async () => {
    const abortController = new AbortController()
    const plan: LocalAgentPlan = {
      goal: 'Apply and verify patch',
      risk: 'low',
      requiresClarification: false,
      steps: [
        {
          id: 'apply',
          title: 'Apply patch',
          intent: 'update',
          toolHints: ['canvas.apply_patch'],
          expectedObservation: 'Patch applied',
        },
        {
          id: 'verify',
          title: 'Verify patch',
          intent: 'verify',
          toolHints: ['canvas.verify_patch'],
          expectedObservation: 'Patch verified',
        },
      ],
      successCriteria: ['Patch is verified'],
      patch: { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] },
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)
    mockExecuteLocalAgentTool.mockImplementationOnce(async () => {
      abortController.abort()
      return {
        name: 'canvas.read_summary',
        success: true,
        output: {},
        summary: 'Canvas summary read',
      }
    })

    const context = buildLegacyContext({
      options: { abortSignal: abortController.signal },
      streamContext: { wasAborted: false } as LocalAgentContext['streamContext'],
    })
    const result = await runLocalAgentToolLoop(context)

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledTimes(1)
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.read_summary',
      input: {},
    })
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'canvas.apply_patch' })
    )
    expect(context.streamContext.wasAborted).toBe(true)
    expect(result.observations.at(-1)).toMatchObject({
      success: false,
      summary: 'Stopped because the request was cancelled.',
    })
  })

  it('does not auto-apply a proposal-only patch plan', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Propose a risky patch',
      risk: 'medium',
      requiresClarification: false,
      steps: [
        {
          id: 'propose',
          title: 'Propose patch',
          intent: 'update',
          toolHints: ['canvas.propose_patch'],
          expectedObservation: 'Patch proposal is available for review',
        },
      ],
      successCriteria: ['No canvas mutation occurs before confirmation'],
      patch: { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] },
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)
    mockExecuteLocalAgentTool.mockResolvedValue({
      name: 'canvas.propose_patch',
      success: true,
      output: { operationCount: 1 },
      summary: 'Prepared canvas patch proposal',
    })

    await runLocalAgentToolLoop(buildLegacyContext())

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.read_summary',
      input: {},
    })
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.propose_patch',
      input: { patch: plan.patch },
    })
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'canvas.apply_patch' })
    )
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'canvas.verify_patch' })
    )
  })

  it('does not execute mutation tools when the plan is read-only', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Discuss a workflow design',
      risk: 'low',
      userIntent: 'consult_design',
      mutationPolicy: 'read_only',
      canvasReadPolicy: 'none',
      requiresClarification: false,
      steps: [
        {
          id: 'bad_apply',
          title: 'Model accidentally tries to apply',
          intent: 'update',
          toolHints: ['canvas.apply_patch'],
          expectedObservation: 'Should not run',
        },
      ],
      successCriteria: ['No canvas mutation occurs'],
      patch: { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] },
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)

    await runLocalAgentToolLoop(
      buildLegacyContext({
        message: '先和我讨论这个小红书视频工作流怎么设计。',
      })
    )

    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalled()
    expect(mockBuildLocalAgentAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        plan,
        observations: expect.arrayContaining([
          expect.objectContaining({ toolName: 'planner', success: true }),
        ]),
      })
    )
  })

  it('does not execute verify calls for read-only plans with stale patch hints', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Inspect current canvas only',
      risk: 'low',
      userIntent: 'inspect_canvas',
      mutationPolicy: 'read_only',
      canvasReadPolicy: 'required',
      requiresClarification: false,
      steps: [
        {
          id: 'read',
          title: 'Read canvas',
          intent: 'inspect',
          toolHints: ['canvas.read_summary', 'canvas.verify_patch'],
          expectedObservation: 'Canvas is read without verification side effects',
        },
      ],
      successCriteria: ['No mutation or verify runs'],
      patch: { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] },
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)
    mockExecuteLocalAgentTool.mockResolvedValue({
      name: 'canvas.read_summary',
      success: true,
      output: {},
      summary: 'Canvas summary read',
    })

    await runLocalAgentToolLoop(buildLegacyContext({ message: '总结当前画布。' }))

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.read_summary',
      input: {},
    })
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'canvas.verify_patch' })
    )
  })

  it('executes multiple planned tool hints from the same step', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Search current canvas',
      risk: 'low',
      requiresClarification: false,
      steps: [
        {
          id: 'search',
          title: 'Read and search canvas',
          intent: 'inspect',
          toolHints: ['canvas.read_summary', 'canvas.search_nodes'],
          expectedObservation: 'Canvas summary and search matches are available',
        },
      ],
      successCriteria: ['Find matching nodes'],
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.read_summary',
        success: true,
        output: {},
        summary: 'Canvas summary read',
      })
      .mockResolvedValueOnce({
        name: 'canvas.search_nodes',
        success: true,
        output: [],
        summary: 'Search completed',
      })

    await runLocalAgentToolLoop(buildLegacyContext({ message: '找到包含“城市霓虹漫游”的节点。' }))

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.read_summary',
      input: {},
    })
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.search_nodes',
      input: { query: '找到包含“城市霓虹漫游”的节点。' },
    })
  })

  it('does not continue to mutation tools after an inspection failure', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Read missing node and update it',
      risk: 'low',
      requiresClarification: false,
      steps: [
        {
          id: 'read',
          title: 'Read explicitly referenced node',
          intent: 'inspect',
          toolHints: ['canvas.read_node'],
          expectedObservation: 'Node detail or missing node error',
        },
        {
          id: 'apply',
          title: 'Apply update',
          intent: 'update',
          toolHints: ['canvas.apply_patch'],
          expectedObservation: 'Patch applied only if the node exists',
        },
      ],
      successCriteria: ['Do not patch missing nodes'],
      readNodeIds: ['node-does-not-exist'],
      patch: {
        operations: [
          {
            type: 'update_node',
            nodeId: 'node-does-not-exist',
            fields: { contentHtml: '<p>updated</p>' },
          },
        ],
      },
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)

    const result = await runLocalAgentToolLoop(buildLegacyContext())

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledTimes(1)
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.read_node',
      input: { nodeId: 'node-does-not-exist' },
    })
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'canvas.apply_patch' })
    )
    expect(result.observations.at(-1)).toMatchObject({
      toolName: 'canvas.read_node',
      success: false,
    })
  })

  it('verifies generated output with the target node id and written field', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Generate selected image',
      risk: 'medium',
      requiresClarification: false,
      steps: [],
      successCriteria: ['Generated file is written'],
      generateNodeIds: ['image-1'],
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.read_summary',
        success: true,
        output: {},
        summary: 'Canvas summary read',
      })
      .mockResolvedValueOnce({
        name: 'canvas.generate_node_output',
        success: true,
        output: { nodeId: 'image-1', kind: 'image', verifiedField: 'file' },
        summary: 'Generated image node',
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        output: { success: true },
        summary: 'Verified generated image',
      })

    await runLocalAgentToolLoop(buildLegacyContext())

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.verify_patch',
      input: { generation: { nodeId: 'image-1', field: 'file' } },
    })
  })

  it('verifies each generated node with its own target node id and written field', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Generate selected text and video nodes',
      risk: 'medium',
      requiresClarification: false,
      steps: [],
      successCriteria: ['Generated outputs are written'],
      generateNodeIds: ['text-1', 'video-1'],
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.read_summary',
        success: true,
        output: {},
        summary: 'Canvas summary read',
      })
      .mockResolvedValueOnce({
        name: 'canvas.generate_node_output',
        success: true,
        output: { nodeId: 'text-1', kind: 'text', verifiedField: 'contentHtml' },
        summary: 'Generated text node',
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        output: { success: true },
        summary: 'Verified generated text',
      })
      .mockResolvedValueOnce({
        name: 'canvas.generate_node_output',
        success: true,
        output: { nodeId: 'video-1', kind: 'video', verifiedField: 'file' },
        summary: 'Generated video node',
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        output: { success: true },
        summary: 'Verified generated video',
      })

    await runLocalAgentToolLoop(buildLegacyContext())

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.verify_patch',
      input: { generation: { nodeId: 'text-1', field: 'contentHtml' } },
    })
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.verify_patch',
      input: { generation: { nodeId: 'video-1', field: 'file' } },
    })
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.verify_patch',
      input: {},
    })
  })

  it('records an observation when the max step limit is reached', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Generate many nodes',
      risk: 'low',
      requiresClarification: false,
      steps: [],
      successCriteria: ['Stop safely at the step limit'],
      generateNodeIds: Array.from({ length: 12 }, (_, index) => `node-${index}`),
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)
    mockExecuteLocalAgentTool.mockResolvedValue({
      name: 'canvas.generate_node_output',
      success: true,
      output: {},
      summary: 'Generated node',
    })

    const result = await runLocalAgentToolLoop(buildLegacyContext())

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledTimes(10)
    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: expect.stringContaining('max step limit'),
        }),
      ])
    )
  })
})
