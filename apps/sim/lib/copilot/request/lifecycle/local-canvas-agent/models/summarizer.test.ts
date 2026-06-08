/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { summarizeLocalAgentRun } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/summarizer'
import type {
  LocalAgentContext,
  LocalAgentMemoryData,
  LocalAgentPlan,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const { mockExecuteLocalAgentModelRequest } = vi.hoisted(() => ({
  mockExecuteLocalAgentModelRequest: vi.fn(),
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/models/config', () => ({
  executeLocalAgentModelRequest: mockExecuteLocalAgentModelRequest,
}))

function buildContext(): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    chatId: 'chat-1',
    message: '总结当前画布。',
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
      chatId: 'chat-1',
    },
    streamContext: {} as LocalAgentContext['streamContext'],
    options: {},
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

describe('local canvas summarizer', () => {
  it('stores canvas summary text from read_summary observations', async () => {
    mockExecuteLocalAgentModelRequest.mockRejectedValue(new Error('model unavailable'))
    const plan: LocalAgentPlan = {
      goal: 'Summarize canvas',
      risk: 'low',
      requiresClarification: false,
      steps: [],
      successCriteria: ['Canvas summary is available'],
    }

    const summary = await summarizeLocalAgentRun({
      context: buildContext(),
      memory: buildMemory(),
      plan,
      observations: [
        {
          toolName: 'canvas.read_summary',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'Read canvas summary with 2 nodes and 1 connections',
          output: {
            summaryText:
              '- text-1 "脚本" kind=text selected=false summary=春季发布会主视觉脚本\n- image-1 "主视觉" kind=image selected=false summary=舞台灯光主视觉',
          },
        },
      ],
    })

    expect(summary.canvasSummary).toContain('春季发布会主视觉脚本')
    expect(summary.canvasSummary).toContain('舞台灯光主视觉')
    expect(summary.canvasSummary).not.toBe('Read canvas summary with 2 nodes and 1 connections')
    expect(summary.taskState.completedSteps).toEqual([])
  })

  it('keeps consult-design turns as task state without marking canvas work complete', async () => {
    mockExecuteLocalAgentModelRequest.mockRejectedValue(new Error('model unavailable'))
    const plan: LocalAgentPlan = {
      goal: '讨论小红书小猫 AI 视频工作流',
      risk: 'low',
      userIntent: 'consult_design',
      mutationPolicy: 'read_only',
      canvasReadPolicy: 'none',
      requiresClarification: false,
      steps: [],
      successCriteria: ['先讨论方案'],
    }

    const summary = await summarizeLocalAgentRun({
      context: {
        ...buildContext(),
        message: '你好，我想做一个小红书的小猫ai视频生成工作流，先告诉我工作流如何设计，和我讨论一下',
      },
      memory: buildMemory(),
      plan,
      observations: [
        {
          toolName: 'planner',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: plan.goal,
        },
      ],
    })

    expect(summary.conversationSummary).toContain('小红书')
    expect(summary.taskState.goal).toBe(plan.goal)
    expect(summary.taskState.completedSteps).toEqual([])
    expect(summary.taskState.openQuestions).toEqual(
      expect.arrayContaining([expect.stringContaining('种草')])
    )
  })

  it('merges structured model memory updates for conversation, canvas, and task state', async () => {
    mockExecuteLocalAgentModelRequest.mockResolvedValue({
      content: JSON.stringify({
        conversationSummary: '用户要持续推进小红书小猫视频工作流。',
        canvasSummary: '画布已有脚本 -> 主视觉 -> 视频 -> 配乐。',
        taskState: {
          goal: '完善小猫视频内容链',
          completedSteps: ['已创建四节点内容链并验证连接'],
          openQuestions: ['是否继续生成各节点输出？'],
          lastObservation: '画布修改已验证',
        },
      }),
    })
    const plan: LocalAgentPlan = {
      goal: '创建小红书小猫内容链',
      risk: 'medium',
      userIntent: 'mutate_canvas',
      mutationPolicy: 'allow_mutation',
      canvasReadPolicy: 'required',
      requiresClarification: false,
      steps: [],
      successCriteria: ['完成内容链'],
      patch: { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] },
    }

    const summary = await summarizeLocalAgentRun({
      context: buildContext(),
      memory: buildMemory(),
      plan,
      observations: [
        {
          toolName: 'canvas.apply_patch',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'Applied canvas patch',
        },
      ],
    })

    expect(summary.conversationSummary).toContain('小红书小猫')
    expect(summary.canvasSummary).toContain('脚本 -> 主视觉')
    expect(summary.taskState.goal).toBe('完善小猫视频内容链')
    expect(summary.taskState.completedSteps).toContain('已创建四节点内容链并验证连接')
    expect(summary.taskState.openQuestions).toContain('是否继续生成各节点输出？')
    expect(mockExecuteLocalAgentModelRequest.mock.calls[0]?.[1]?.responseFormat).toBeDefined()
  })
})
