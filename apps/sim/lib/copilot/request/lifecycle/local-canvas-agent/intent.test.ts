/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { classifyLocalCanvasUserIntent } from '@/lib/copilot/request/lifecycle/local-canvas-agent/intent'
import type {
  LocalAgentContext,
  LocalAgentMemoryData,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

function buildMemory(): LocalAgentMemoryData {
  return {
    version: 1,
    scope: 'personal',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    agentCode: 'local_canvas_agent',
    chatId: 'chat-1',
    conversationSummary: '用户正在讨论小红书小猫 AI 视频工作流。',
    taskState: {
      goal: '讨论小红书小猫 AI 视频工作流',
      completedSteps: [],
      openQuestions: ['用户希望内容偏种草、剧情、治愈，还是教程说明？'],
      lastObservation: '已先讨论方案，尚未修改画布。',
    },
    canvasSummary: '',
    recentObservations: [],
    updatedAt: '2026-06-08T00:00:00.000Z',
  }
}

function buildContext(overrides: Partial<LocalAgentContext> = {}): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    chatId: 'chat-1',
    message: '总结当前画布。',
    sessionScope: 'personal',
    agent: { code: 'local_canvas_agent', name: 'Canvas Agent', description: '', systemPrompt: '' },
    discipline: { id: '', code: 'canvas_runtime', name: 'Canvas Runtime' },
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
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
    },
    streamContext: {} as LocalAgentContext['streamContext'],
    options: {},
    ...overrides,
  }
}

describe('local canvas intent policy', () => {
  it('keeps design discussion requests read-only without reading canvas by default', () => {
    const decision = classifyLocalCanvasUserIntent(
      buildContext({
        message:
          '你好，我想做一个小红书的小猫ai视频生成工作流，先告诉我工作流如何设计，和我讨论一下',
      })
    )

    expect(decision).toMatchObject({
      userIntent: 'consult_design',
      mutationPolicy: 'read_only',
      canvasReadPolicy: 'none',
      requiresUserConfirmation: false,
    })
    expect(decision.confidence).toBeGreaterThan(0.8)
    expect(decision.evidence).toEqual(
      expect.arrayContaining(['consult_signal', 'explicit_read_only_signal'])
    )
  })

  it('allows explicit canvas content-chain creation even when the subject is exam-related', () => {
    const decision = classifyLocalCanvasUserIntent(
      buildContext({ message: '以高考为主题创建短视频内容链。' })
    )

    expect(decision).toMatchObject({
      userIntent: 'mutate_canvas',
      mutationPolicy: 'allow_mutation',
      canvasReadPolicy: 'required',
    })
    expect(decision.evidence).toEqual(
      expect.arrayContaining(['mutation_signal', 'non_canvas_topic_used_as_canvas_subject'])
    )
  })

  it('does not treat text-to-image workflow wording as an explicit read-only boundary', () => {
    const decision = classifyLocalCanvasUserIntent(
      buildContext({
        message:
          '生成一个文生图工作流，首先生成舞台灯光效果的设计文案，然后用这个设计文案生成效果图',
      })
    )

    expect(decision.requiresUserConfirmation).toBe(false)
    expect(decision.evidence).not.toContain('explicit_read_only_signal')
    expect(decision.evidence).not.toContain('propose_only_signal')
  })

  it('allows selected node prompt edits when the user only forbids generation', () => {
    const decision = classifyLocalCanvasUserIntent(
      buildContext({
        message: '把选中图片节点的提示词改成更明亮、更治愈的夏日午后风格，但不要生成图片。',
        selectedNodeIds: ['image-1'],
      })
    )

    expect(decision).toMatchObject({
      userIntent: 'mutate_canvas',
      mutationPolicy: 'allow_mutation',
      canvasReadPolicy: 'required',
      requiresUserConfirmation: false,
    })
  })

  it('allows content-chain creation when the user only asks not to generate outputs yet', () => {
    const decision = classifyLocalCanvasUserIntent(
      buildContext({
        message:
          '创建一个以松林午茶8109为主题的短视频内容链，创建文本、图片、视频、音频节点，建立引用关系并从左到右排好布局，但先不要生成内容。',
      })
    )

    expect(decision).toMatchObject({
      userIntent: 'mutate_canvas',
      mutationPolicy: 'allow_mutation',
      canvasReadPolicy: 'required',
      requiresUserConfirmation: false,
    })
  })

  it('classifies plain exam questions as non-canvas read-only requests', () => {
    const decision = classifyLocalCanvasUserIntent(
      buildContext({ message: '高考可能会考什么内容？' })
    )

    expect(decision).toMatchObject({
      userIntent: 'non_canvas',
      mutationPolicy: 'read_only',
      canvasReadPolicy: 'none',
    })
    expect(decision.evidence).toContain('non_canvas_signal')
  })

  it('keeps non-canvas questions read-only even when a canvas node is selected', () => {
    const decision = classifyLocalCanvasUserIntent(
      buildContext({ message: '高考可能会考什么内容？', selectedNodeIds: ['text-1'] })
    )

    expect(decision).toMatchObject({
      userIntent: 'non_canvas',
      mutationPolicy: 'read_only',
      canvasReadPolicy: 'none',
    })
  })

  it('does not treat generic programming update language as canvas mutation', () => {
    const decision = classifyLocalCanvasUserIntent(
      buildContext({ message: '帮我更新这段 TypeScript 代码的类型错误。' })
    )

    expect(decision).toMatchObject({
      userIntent: 'non_canvas',
      mutationPolicy: 'read_only',
      canvasReadPolicy: 'none',
    })
  })

  it('uses open task memory to keep preference follow-ups in discussion mode', () => {
    const decision = classifyLocalCanvasUserIntent(
      buildContext({ message: '偏治愈风，先不要创建节点。', memory: buildMemory() })
    )

    expect(decision).toMatchObject({
      userIntent: 'consult_design',
      mutationPolicy: 'read_only',
      canvasReadPolicy: 'none',
    })
    expect(decision.evidence).toEqual(
      expect.arrayContaining(['task_memory_signal', 'discussion_follow_up_signal'])
    )
  })

  it('uses open task memory to treat execution follow-ups as mutation requests', () => {
    const decision = classifyLocalCanvasUserIntent(
      buildContext({ message: '就按刚才的方案，现在创建节点。', memory: buildMemory() })
    )

    expect(decision).toMatchObject({
      userIntent: 'mutate_canvas',
      mutationPolicy: 'allow_mutation',
      canvasReadPolicy: 'required',
    })
    expect(decision.evidence).toEqual(
      expect.arrayContaining(['task_memory_signal', 'execute_follow_up_signal'])
    )
  })

  it('requires confirmation for destructive whole-canvas requests', () => {
    const decision = classifyLocalCanvasUserIntent(
      buildContext({ message: '把所有节点都删掉，清空整个画布。' })
    )

    expect(decision).toMatchObject({
      userIntent: 'propose_plan',
      mutationPolicy: 'propose_only',
      canvasReadPolicy: 'required',
      requiresUserConfirmation: true,
    })
    expect(decision.evidence).toContain('destructive_canvas_request')
  })
})
