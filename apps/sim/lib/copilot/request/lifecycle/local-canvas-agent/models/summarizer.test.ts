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
  })
})
