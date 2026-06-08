/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const {
  mockEmitLocalAgentToolCall,
  mockEmitLocalAgentToolResult,
  mockExecuteCanvasTool,
  mockExecuteContextTool,
  mockExecuteMediaTool,
} = vi.hoisted(() => ({
  mockEmitLocalAgentToolCall: vi.fn(async () => 'tool-call-1'),
  mockEmitLocalAgentToolResult: vi.fn(),
  mockExecuteCanvasTool: vi.fn(),
  mockExecuteContextTool: vi.fn(),
  mockExecuteMediaTool: vi.fn(),
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/stream', () => ({
  emitLocalAgentToolCall: mockEmitLocalAgentToolCall,
  emitLocalAgentToolResult: mockEmitLocalAgentToolResult,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-tools', () => ({
  executeCanvasTool: mockExecuteCanvasTool,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/context-tools', () => ({
  executeContextTool: mockExecuteContextTool,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/media-tools', () => ({
  executeMediaTool: mockExecuteMediaTool,
}))

import { executeLocalAgentTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-executor-bridge'

function buildContext(overrides: Partial<LocalAgentContext> = {}): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    message: '描述这个视频',
    sessionScope: 'personal',
    agent: { code: 'chief_director', name: 'Canvas Agent', description: '', systemPrompt: '' },
    discipline: { id: '', code: 'chief_director', name: '总导演' },
    workgroup: { id: '', name: 'Workspace', organizationId: '', teamWorkspaceId: null },
    permissions: { canRead: true, canWrite: true, canPublish: false },
    selectedNodeIds: ['video-1'],
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

describe('local canvas tool executor bridge', () => {
  beforeEach(() => {
    mockEmitLocalAgentToolCall.mockReset()
    mockEmitLocalAgentToolResult.mockReset()
    mockExecuteCanvasTool.mockReset()
    mockExecuteContextTool.mockReset()
    mockExecuteMediaTool.mockReset()
    mockEmitLocalAgentToolCall.mockResolvedValue('tool-call-1')
  })

  it('validates descriptor output schemas before streaming successful tool results', async () => {
    mockExecuteMediaTool.mockResolvedValue({
      name: 'media.analyze_node_media',
      success: true,
      output: {
        nodeId: 'video-1',
      },
      summary: 'Invalid media analysis output',
    })

    const result = await executeLocalAgentTool(buildContext(), {
      name: 'media.analyze_node_media',
      input: { nodeId: 'video-1' },
    })

    expect(result).toMatchObject({
      name: 'media.analyze_node_media',
      success: false,
      summary: expect.stringContaining('output was invalid'),
    })
    expect(mockEmitLocalAgentToolResult).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tool-call-1',
        success: false,
        summary: expect.stringContaining('output was invalid'),
      })
    )
  })
})
