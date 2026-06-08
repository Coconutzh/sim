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
    expect(prompt).toContain('update only the exact selected nodeId')
    expect(prompt).toContain('For media description')
    expect(prompt).toContain('Do not force text->image->video->audio')
    expect(prompt).toContain('Use type=tool_calls only for independent read-only')
  })
})
