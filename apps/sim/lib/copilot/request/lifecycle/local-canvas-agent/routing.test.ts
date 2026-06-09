/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  classifyLocalCanvasAgentRouting,
  shouldRunLocalCanvasAgent,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/routing'
import type { LocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

function buildContext(overrides: Partial<LocalAgentContext> = {}): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    chatId: 'chat-1',
    message: '总结当前画布',
    sessionScope: 'personal',
    agent: { code: 'chief_director', name: 'Canvas Agent', description: '', systemPrompt: '' },
    discipline: { id: '', code: 'chief_director', name: 'Chief Director' },
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
    streamContext: {
      accumulatedContent: '',
      contentBlocks: [],
      toolCalls: new Map(),
      streamComplete: false,
    } as unknown as LocalAgentContext['streamContext'],
    options: {},
    ...overrides,
  }
}

describe('local canvas agent routing', () => {
  it('classifies obvious non-canvas questions without selected canvas context', () => {
    const context = buildContext({ message: '高考可能会考什么内容？' })

    expect(classifyLocalCanvasAgentRouting(context)).toMatchObject({
      kind: 'non_canvas',
    })
    expect(shouldRunLocalCanvasAgent(context)).toBe(false)
  })

  it('does not turn non-canvas questions into canvas tasks just because a node is selected', () => {
    const context = buildContext({
      message: '高考可能会考什么内容？',
      selectedNodeIds: ['text-1'],
    })

    expect(classifyLocalCanvasAgentRouting(context)).toMatchObject({
      kind: 'non_canvas',
    })
  })

  it('keeps generic programming update requests outside canvas routing', () => {
    const context = buildContext({ message: '帮我更新这段 TypeScript 代码的类型错误。' })

    expect(classifyLocalCanvasAgentRouting(context)).toMatchObject({
      kind: 'non_canvas',
    })
  })

  it('keeps canvas requests even when the subject mentions exams', () => {
    const context = buildContext({ message: '根据高考主题创建一个短视频内容链。' })

    expect(classifyLocalCanvasAgentRouting(context)).toMatchObject({
      kind: 'canvas',
    })
    expect(shouldRunLocalCanvasAgent(context)).toBe(true)
  })

  it('keeps selected-node requests in the canvas runtime', () => {
    const context = buildContext({
      message: '这个节点适合接什么视频节点？',
      selectedNodeIds: ['image-1'],
    })

    expect(classifyLocalCanvasAgentRouting(context)).toMatchObject({
      kind: 'canvas',
    })
  })

  it('keeps selected-node mutation shorthand in the canvas runtime', () => {
    const context = buildContext({
      message: '改成更年轻一点的语气。',
      selectedNodeIds: ['text-1'],
    })

    expect(classifyLocalCanvasAgentRouting(context)).toMatchObject({
      kind: 'canvas',
    })
  })
})
