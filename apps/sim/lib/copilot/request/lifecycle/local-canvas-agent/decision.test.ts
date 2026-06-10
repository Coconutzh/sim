/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildLocalAgentDecisionPrompt,
  parseLocalAgentDecision,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/decision'
import type {
  LocalAgentContext,
  LocalAgentObservation,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

function buildContext(overrides: Partial<LocalAgentContext> = {}): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    message: '描述当前画布',
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

describe('local canvas agent decision', () => {
  it('parses tool call decisions from wrapped model JSON', () => {
    const decision = parseLocalAgentDecision(`
      Here is the JSON:
      {"type":"tool_call","toolName":"canvas.read_summary","toolInput":{},"userVisibleReason":"我先读取画布。","risk":"low"}
    `)

    expect(decision).toEqual({
      type: 'tool_call',
      toolName: 'canvas.read_summary',
      toolInput: {},
      userVisibleReason: '我先读取画布。',
      risk: 'low',
    })
  })

  it('rejects unknown tools instead of letting the model invent capabilities', () => {
    expect(() =>
      parseLocalAgentDecision(
        '{"type":"tool_call","toolName":"canvas.delete_everything","toolInput":{},"userVisibleReason":"x","risk":"high"}'
      )
    ).toThrow('Invalid AgentDecision')
  })

  it('parses final-answer thread memory updates with a narrow schema', () => {
    const decision = parseLocalAgentDecision(
      JSON.stringify({
        type: 'final_answer',
        answer: '已完成总结。',
        memoryUpdate: {
          conversationSummary: '用户正在推进高考主题短视频内容链。',
          canvasSummary: '画布已有脚本、主视觉、视频和配乐节点。',
          taskState: {
            goal: '继续优化高考主题短视频',
            openQuestions: ['是否继续生成各节点输出？'],
            lastObservation: '内容链已验证。',
          },
        },
      })
    )

    expect(decision).toMatchObject({
      type: 'final_answer',
      memoryUpdate: {
        taskState: {
          openQuestions: ['是否继续生成各节点输出？'],
        },
      },
    })
  })

  it('parses bounded parallel read-only tool decisions', () => {
    const decision = parseLocalAgentDecision(
      JSON.stringify({
        type: 'tool_calls',
        userVisibleReason: '我会并行读取画布摘要和选中节点。',
        risk: 'low',
        toolCalls: [
          { toolName: 'canvas.read_summary', toolInput: {} },
          {
            toolName: 'canvas.read_selected_nodes',
            toolInput: {},
            userVisibleReason: '读取选中节点。',
          },
        ],
      })
    )

    expect(decision).toMatchObject({
      type: 'tool_calls',
      toolCalls: [
        { toolName: 'canvas.read_summary', toolInput: {} },
        { toolName: 'canvas.read_selected_nodes', toolInput: {} },
      ],
    })
  })

  it('normalizes common model decision variants without changing tool policy', () => {
    const decision = parseLocalAgentDecision(
      JSON.stringify({
        type: 'action',
        tool_name: 'canvas.read_summary',
        tool_input: {},
        user_visible_reason: '先读取画布摘要。',
      })
    )

    expect(decision).toEqual({
      type: 'tool_call',
      toolName: 'canvas.read_summary',
      toolInput: {},
      userVisibleReason: '先读取画布摘要。',
      risk: 'low',
    })
  })

  it('normalizes pending confirmation tool calls from model variants', () => {
    const decision = parseLocalAgentDecision(
      JSON.stringify({
        kind: 'confirmation',
        question: '确认创建这个内容链吗？',
        pending_tool_call: {
          tool_name: 'canvas.apply_patch',
          tool_input: { patch: { operations: [] } },
        },
      })
    )

    expect(decision).toMatchObject({
      type: 'ask_confirmation',
      question: '确认创建这个内容链吗？',
      pendingToolCall: {
        name: 'canvas.apply_patch',
        input: { patch: { operations: [] } },
      },
      risk: 'medium',
    })
  })

  it('parses model-owned intent confidence and reason fields', () => {
    const decision = parseLocalAgentDecision(
      JSON.stringify({
        type: 'tool_call',
        intent: 'mutate_canvas',
        intent_confidence: '0.86',
        intent_reason: '用户选择了上一轮提供的垂直排版方案。',
        toolName: 'canvas.apply_patch',
        toolInput: { patch: { operations: [{ type: 'layout_nodes', direction: 'vertical' }] } },
        userVisibleReason: '我会更新画布布局。',
        risk: 'low',
      })
    )

    expect(decision).toMatchObject({
      type: 'tool_call',
      intent: 'mutate_canvas',
      confidence: 0.86,
      intentReason: '用户选择了上一轮提供的垂直排版方案。',
    })
  })

  it('budgets large tool outputs in the prompt with a stable output ref', () => {
    const observations: LocalAgentObservation[] = [
      {
        toolName: 'canvas.read_summary',
        summary: 'Read canvas summary',
        success: true,
        timestamp: '2026-06-08T00:00:00.000Z',
        output: { text: 'A'.repeat(4000) },
      },
    ]

    const prompt = buildLocalAgentDecisionPrompt({
      context: buildContext(),
      observations,
      policy: {
        userIntent: 'inspect_canvas',
        mutationPolicy: 'read_only',
        canvasReadPolicy: 'required',
      },
    })

    expect(prompt).toContain('outputRef: tool_result_0_canvas_read_summary')
    expect(prompt).toContain('...[truncated]')
    expect(prompt.length).toBeLessThan(12000)
  })

  it('includes persisted tool result refs from thread memory without exposing storage keys', () => {
    const prompt = buildLocalAgentDecisionPrompt({
      context: buildContext({
        memory: {
          version: 2,
          scope: 'thread',
          userId: 'user-1',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          agentCode: 'chief_director',
          chatId: 'chat-1',
          conversationSummary: '',
          taskState: { completedSteps: [], openQuestions: [] },
          canvasSummary: '',
          recentObservations: [],
          toolResultRefs: [
            {
              id: 'tool_result_prev',
              toolName: 'canvas.read_summary',
              summary: 'Read canvas summary',
              storageKey:
                'local-canvas-agent:v2:tool-result:user-1:workspace-1:workflow-1:chief_director:chat-1:tool_result_prev',
              outputPreview: '{"nodes":[{"name":"脚本"}]}',
              outputSizeChars: 2048,
              createdAt: '2026-06-09T00:00:00.000Z',
            },
          ],
          updatedAt: '2026-06-09T00:00:00.000Z',
        },
      }),
      observations: [],
      policy: {
        userIntent: 'inspect_canvas',
        mutationPolicy: 'read_only',
        canvasReadPolicy: 'required',
      },
    })

    expect(prompt).toContain('persistentToolResultRefs')
    expect(prompt).toContain('tool_result_prev')
    expect(prompt).toContain('Read canvas summary')
    expect(prompt).not.toContain('local-canvas-agent:v2:tool-result')
  })

  it('includes the high-level canvas patch protocol for model-driven mutations', () => {
    const prompt = buildLocalAgentDecisionPrompt({
      context: buildContext({ message: '以高考为主题创建短视频内容链。' }),
      observations: [],
      policy: {
        userIntent: 'mutate_canvas',
        mutationPolicy: 'allow_mutation',
        canvasReadPolicy: 'required',
      },
    })

    expect(prompt).toContain('Patch protocol for canvas.propose_patch and canvas.apply_patch')
    expect(prompt).toContain('create_node')
    expect(prompt).toContain('clientNodeId')
    expect(prompt).toContain('text')
    expect(prompt).toContain('image')
    expect(prompt).toContain('video')
    expect(prompt).toContain('audio')
    expect(prompt).toContain('Do not set file')
    expect(prompt).toContain('canvas.generate_node_output')
  })

  it('frames patch examples as adaptable recipes instead of fixed templates', () => {
    const prompt = buildLocalAgentDecisionPrompt({
      context: buildContext({
        message: '把选中的视频节点提示词改成慢镜头推进。',
        selectedNodeIds: ['video-1'],
      }),
      observations: [],
      policy: {
        userIntent: 'mutate_canvas',
        mutationPolicy: 'allow_mutation',
        canvasReadPolicy: 'required',
      },
    })

    expect(prompt).toContain('Patch examples are recipes, not fixed templates')
    expect(prompt).toContain('For selected-node edits')
    expect(prompt).toContain('your first tool call should be canvas.apply_patch')
    expect(prompt).toContain('Direct selected edit field map')
    expect(prompt).toContain('For media description')
    expect(prompt).toContain('call media.analyze_node_media directly')
    expect(prompt).toContain('binaryAnalysisDiagnostics.truncated')
    expect(prompt).toContain('canDescribeActualMedia is false')
    expect(prompt).toContain('Do not force text->image->video->audio')
    expect(prompt).toContain('operations must be JSON objects, not JSON-encoded strings')
    expect(prompt).toContain('pendingToolCall.input.patch.operations must be an array')
    expect(prompt).toContain('Use type=tool_calls only for independent read-only')
    expect(prompt).toContain('Confirmation mode: auto')
    expect(prompt).toContain('Runtime constraints')
    expect(prompt).toContain('Include intent and confidence in every AgentDecision')
    expect(prompt).not.toContain('Runtime intent hint')
    expect(prompt).toContain('If confirmation mode is manual')
  })
})
