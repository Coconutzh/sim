/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MothershipStreamV1EventType } from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamingContext } from '@/lib/copilot/request/types'

const { mockCallHermesSimAgent } = vi.hoisted(() => ({
  mockCallHermesSimAgent: vi.fn(),
}))

vi.mock('@/lib/hermes/sim-agent', () => ({
  callHermesSimAgent: mockCallHermesSimAgent,
}))

import { runHermesAgent } from '@/lib/copilot/request/lifecycle/hermes-agent'

function createContext(): StreamingContext {
  return {
    chatId: 'chat-1',
    requestId: 'trace-1',
    messageId: 'message-1',
    accumulatedContent: '',
    contentBlocks: [],
    toolCalls: new Map(),
    pendingToolPromises: new Map(),
    currentThinkingBlock: null,
    currentSubagentThinkingBlock: null,
    isInThinkingBlock: false,
    subAgentParentStack: [],
    subAgentContent: {},
    subAgentToolCalls: {},
    pendingContent: '',
    streamComplete: false,
    wasAborted: false,
    errors: [],
    trace: {} as StreamingContext['trace'],
  }
}

describe('runHermesAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCallHermesSimAgent.mockResolvedValue({
      id: 'chatcmpl-1',
      content: 'Hermes response',
      sessionId: 'sim:chat:chat-1',
      sessionKey: 'sim:org:none:user:user-1',
      usage: { prompt: 10, completion: 5, total: 15 },
      raw: {},
    })
  })

  it('calls Hermes with SIM metadata and emits assistant text', async () => {
    const context = createContext()
    const onEvent = vi.fn()

    await runHermesAgent({
      requestPayload: {
        message: 'read the selected node',
        organizationId: 'org-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        model: 'hermes-agent',
        autoSelectionContexts: [{ kind: 'blocks', blockIds: ['node-1'], label: 'Selected' }],
      },
      context,
      execContext: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
      },
      options: { onEvent },
    })

    expect(mockCallHermesSimAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        organizationId: 'org-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        message: 'read the selected node',
        selectedNodeIds: ['node-1'],
        traceId: 'trace-1',
      })
    )
    expect(context.accumulatedContent).toBe('Hermes response')
    expect(context.usage).toEqual({ prompt: 10, completion: 5 })
    expect(context.streamComplete).toBe(true)
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.text,
        payload: expect.objectContaining({ text: 'Hermes response' }),
      })
    )
  })

  it('surfaces Hermes errors as explicit unavailable responses', async () => {
    mockCallHermesSimAgent.mockRejectedValue(new Error('connection refused'))
    const context = createContext()

    await runHermesAgent({
      requestPayload: { message: 'hello' },
      context,
      execContext: { userId: 'user-1', workspaceId: 'workspace-1', workflowId: 'workflow-1' },
      options: {},
    })

    expect(context.errors).toEqual(['Hermes Agent is unavailable: connection refused'])
    expect(context.accumulatedContent).toBe('Hermes Agent is unavailable: connection refused')
    expect(context.streamComplete).toBe(true)
  })
})
