/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildTokenAwareLocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/context-manager'
import type {
  CanvasSnapshot,
  LocalAgentContext,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

function buildContext(): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    message: '读取附件 brief',
    sessionScope: 'personal',
    agent: { code: 'local_canvas_agent', name: 'Canvas Agent', description: '', systemPrompt: '' },
    discipline: { id: '', code: 'canvas_runtime', name: 'Canvas Runtime' },
    workgroup: { id: '', name: 'Workspace', organizationId: '', teamWorkspaceId: null },
    permissions: { canRead: true, canWrite: true, canPublish: false },
    selectedNodeIds: [],
    attachments: [
      {
        id: 'file-1',
        key: 'uploads/private/brief.pdf',
        name: 'brief.pdf',
        type: 'application/pdf',
        size: 1234,
        url: 'https://storage.example.test/private/brief.pdf',
      },
    ],
    attachedContexts: [
      {
        type: 'file',
        tag: '@brief.pdf',
        content: [
          'Brief content.',
          'storageKey=uploads/private/brief.pdf',
          'url=https://storage.example.test/private/brief.pdf',
          'path=/api/files/serve/uploads/private/brief.pdf?context=workspace',
          '-----BEGIN PRIVATE KEY-----',
          'secret',
          '-----END PRIVATE KEY-----',
        ].join('\n'),
      },
    ],
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
    },
    streamContext: {} as LocalAgentContext['streamContext'],
    options: {},
  }
}

describe('local canvas context manager', () => {
  it('redacts attachment storage metadata from token-aware context', () => {
    const snapshot: CanvasSnapshot = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    }

    const contextText = buildTokenAwareLocalAgentContext({ context: buildContext(), snapshot })

    expect(contextText).toContain('brief.pdf')
    expect(contextText).toContain('type=application/pdf')
    expect(contextText).toContain('size=1234')
    expect(contextText).not.toContain('uploads/private')
    expect(contextText).not.toContain('https://storage.example.test')
    expect(contextText).not.toContain('file-1')
    expect(contextText).not.toContain('/api/files/serve')
    expect(contextText).not.toContain('BEGIN PRIVATE KEY')
    expect(contextText).toContain('[redacted]')
  })

  it('compresses long conversation history while preserving memory and current request', () => {
    const snapshot: CanvasSnapshot = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    }
    const context = buildContext()
    context.message = '按刚才的小猫治愈风方案继续。'
    context.requestPayload = { localCanvasContextWindowTokens: 1000 }
    context.conversationHistory = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `history-message-${index}`,
    }))
    context.memory = {
      version: 1,
      scope: 'personal',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      agentCode: 'local_canvas_agent',
      chatId: 'chat-1',
      conversationSummary: '上一轮已经确定小猫 AI 视频要偏治愈风。',
      taskState: {
        goal: '完善小猫 AI 视频工作流',
        completedSteps: ['已讨论脚本、主视觉、视频、配乐四段链路'],
        openQuestions: ['是否现在创建节点？'],
        lastObservation: '用户选择治愈风',
      },
      canvasSummary: '画布暂未创建正式内容链。',
      recentObservations: [],
      updatedAt: '2026-06-06T00:00:00.000Z',
    }

    const contextText = buildTokenAwareLocalAgentContext({ context, snapshot })

    expect(contextText).toContain('Earlier messages compressed into memory: 6 message(s).')
    expect(contextText).not.toContain('history-message-0')
    expect(contextText).toContain('history-message-9')
    expect(contextText).toContain('上一轮已经确定小猫 AI 视频要偏治愈风')
    expect(contextText).toContain('已讨论脚本、主视觉、视频、配乐四段链路')
    expect(contextText).toContain('按刚才的小猫治愈风方案继续')
  })
})
