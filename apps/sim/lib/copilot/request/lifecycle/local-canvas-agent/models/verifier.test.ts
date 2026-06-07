/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { verifyLocalAgentFinalAnswer } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/verifier'
import type {
  LocalAgentContext,
  LocalAgentObservation,
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
    message: '总结当前画布里有哪些内容节点，以及它们之间的关系。',
    sessionScope: 'personal',
    agent: {
      code: 'chief_director',
      name: '总导演',
      description: '',
      systemPrompt: '你是总导演 Agent，需要以总导演身份发言。',
    },
    discipline: { id: '', code: 'chief_director', name: '总导演' },
    workgroup: {
      id: '',
      name: 'Workspace',
      organizationId: '',
      teamWorkspaceId: null,
    },
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
  }
}

describe('local canvas verifier', () => {
  it('keeps safe read-only answers without persona model rewriting', async () => {
    const plan: LocalAgentPlan = {
      goal: 'summarize canvas',
      risk: 'low',
      requiresClarification: false,
      steps: [
        {
          id: 'inspect',
          title: 'Read canvas summary',
          intent: 'inspect',
          toolHints: ['canvas.read_summary'],
          expectedObservation: 'Canvas summary is available',
        },
      ],
      successCriteria: ['Answer based on current canvas'],
    }
    const observations: LocalAgentObservation[] = [
      {
        toolName: 'canvas.read_summary',
        success: true,
        timestamp: '2026-06-06T00:00:00.000Z',
        summary: 'Read canvas summary with 2 nodes and 1 connections',
      },
    ]

    const answer = await verifyLocalAgentFinalAnswer({
      context: buildContext(),
      plan,
      observations,
      answer: '当前画布包含文本节点和图片节点，并且文本节点连接到图片节点。',
    })

    expect(answer).toBe('当前画布包含文本节点和图片节点，并且文本节点连接到图片节点。')
    expect(mockExecuteLocalAgentModelRequest).not.toHaveBeenCalled()
  })

  it('does not report completion when generation fails', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Generate selected node output',
      risk: 'medium',
      requiresClarification: false,
      steps: [],
      successCriteria: ['Generated output is written back'],
      generateNodeIds: ['image-1'],
    }

    const answer = await verifyLocalAgentFinalAnswer({
      context: buildContext(),
      plan,
      observations: [
        {
          toolName: 'canvas.generate_node_output',
          success: false,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'Image generation provider failed',
        },
      ],
      answer: '已生成内容并写回选中节点，验证也已完成。',
    })

    expect(answer).toContain('我已停止在安全边界内执行')
    expect(answer).toContain('Image generation provider failed')
    expect(answer).not.toContain('已生成内容并写回')
  })

  it('keeps selected-node read answers when optional file context lookup fails', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Inspect selected image node',
      risk: 'low',
      requiresClarification: false,
      steps: [
        {
          id: 'inspect-selected',
          title: 'Read selected node',
          intent: 'inspect',
          toolHints: ['canvas.read_selected_nodes', 'read_file'],
          expectedObservation: 'Selected node detail is available',
        },
      ],
      successCriteria: ['Answer from selected node detail'],
    }
    const context = {
      ...buildContext(),
      message: '只读说明这个图片节点的生成设置和已有文件名，不要修改画布。',
      selectedNodeIds: ['image-1'],
    }
    const observations: LocalAgentObservation[] = [
      {
        toolName: 'canvas.read_selected_nodes',
        success: true,
        timestamp: '2026-06-06T00:00:00.000Z',
        summary: 'Read 1 selected node detail(s)',
        output: [
          {
            id: 'image-1',
            name: '视觉画面',
            blockType: 'content',
            kind: 'image',
            position: { x: 0, y: 0 },
            selected: true,
            summary: 'Generated image node',
            capabilities: {
              canRead: true,
              canWrite: true,
              canGenerate: true,
              canReferenceFile: true,
            },
            fields: {
              aiPrompt: '春季发布会主视觉',
              aiModel: 'jimeng-4.5',
              aiAspectRatio: 'auto',
              file: { name: 'generated-image.png' },
            },
            file: { name: 'generated-image.png' },
          },
        ],
      },
      {
        toolName: 'read_file',
        success: false,
        timestamp: '2026-06-06T00:00:00.000Z',
        summary: 'No matching attached file context was found',
      },
    ]

    const answer = await verifyLocalAgentFinalAnswer({
      context,
      plan,
      observations,
      answer:
        '选中的视觉画面（图片）提示词是春季发布会主视觉，已有文件：generated-image.png。我没有修改画布。',
    })

    expect(answer).toContain('generated-image.png')
    expect(answer).not.toContain('我已停止在安全边界内执行')
    expect(answer).not.toContain('No matching attached file context')
  })
})
