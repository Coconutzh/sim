/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MothershipStreamV1EventType } from '@/lib/copilot/generated/mothership-stream-v1'
import { ContentBlockType, type StreamingContext } from '@/lib/copilot/request/types'

const { mockBuildHermesMultimodalInput, mockCallHermesSimAgent } = vi.hoisted(() => ({
  mockBuildHermesMultimodalInput: vi.fn(),
  mockCallHermesSimAgent: vi.fn(),
}))

vi.mock('@/lib/hermes/multimodal-attachments', () => ({
  buildHermesMultimodalInput: mockBuildHermesMultimodalInput,
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
    mockBuildHermesMultimodalInput.mockResolvedValue(undefined)
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

  it('passes structured multimodal input to Hermes when image attachments are prepared', async () => {
    const context = createContext()
    const multimodalInput = [
      {
        role: 'user' as const,
        content: [
          { type: 'input_text' as const, text: 'describe attached image' },
          { type: 'input_image' as const, image_url: 'data:image/png;base64,AAAA' },
        ],
      },
    ]
    mockBuildHermesMultimodalInput.mockResolvedValueOnce(multimodalInput)

    await runHermesAgent({
      requestPayload: {
        message: 'describe attached image',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        fileAttachments: [
          {
            id: 'attachment-1',
            workspaceFileId: 'wf_image',
            key: 'workspace/workspace-1/image.png',
            filename: 'image.png',
            media_type: 'image/png',
            size: 12,
            storageContext: 'workspace',
          },
        ],
      },
      context,
      execContext: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
      },
      options: {},
    })

    expect(mockBuildHermesMultimodalInput).toHaveBeenCalledWith({
      requestPayload: expect.objectContaining({
        message: 'describe attached image',
        fileAttachments: expect.any(Array),
      }),
      message: 'describe attached image',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
    })
    expect(mockCallHermesSimAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'describe attached image',
        input: multimodalInput,
      })
    )
  })

  it('passes a bounded SIM chat history seed to Hermes', async () => {
    const context = createContext()

    await runHermesAgent({
      requestPayload: {
        message: 'use this paper and this car image',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        conversationHistory: [
          {
            role: 'user',
            content: 'I uploaded the BrickNet paper and a car image.',
            fileAttachments: [
              {
                id: 'file-1',
                workspaceFileId: 'workspace-file-1',
                filename: 'BrickNet.pdf',
                media_type: 'application/pdf',
                size: 1024,
              },
              {
                id: 'file-2',
                workspaceFileId: 'workspace-file-2',
                filename: 'car.png',
                media_type: 'image/png',
                size: 2048,
              },
            ],
          },
          {
            role: 'assistant',
            contentBlocks: [{ type: 'text', content: 'The image is a white LEGO car.' }],
          },
        ],
      },
      context,
      execContext: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
      },
      options: {},
    })

    expect(mockCallHermesSimAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationHistory: [
          {
            role: 'user',
            content: expect.stringContaining('I uploaded the BrickNet paper and a car image.'),
          },
          {
            role: 'assistant',
            content: 'The image is a white LEGO car.',
          },
        ],
      })
    )
    const conversationHistory = mockCallHermesSimAgent.mock.calls[0][0].conversationHistory
    expect(conversationHistory[0].content).toContain('BrickNet.pdf')
    expect(conversationHistory[0].content).toContain('ref=workspace-file-1')
    expect(conversationHistory[0].content).toContain('car.png')
    expect(conversationHistory[0].content).toContain('ref=workspace-file-2')
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

  it('renders a confirmation option when Hermes returns a SIM canvas proposal', async () => {
    mockCallHermesSimAgent.mockResolvedValue({
      id: 'resp-1',
      content: 'Hermes prepared a canvas proposal.',
      sessionId: 'sim:chat:chat-1',
      sessionKey: 'sim:org:none:user:user-1',
      raw: {
        output: [
          {
            type: 'function_call_output',
            output: JSON.stringify({
              success: true,
              operation: 'propose',
              requiresConfirmation: true,
              pendingActionId: 'pending-1',
            }),
          },
        ],
      },
    })
    const context = createContext()
    const onEvent = vi.fn()

    await runHermesAgent({
      requestPayload: { message: 'add a canvas node' },
      context,
      execContext: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
      },
      options: { onEvent },
    })

    expect(context.accumulatedContent).toContain('Hermes prepared a canvas proposal.')
    expect(context.accumulatedContent).toContain('__local_canvas_confirm__:pending-1')
    expect(context.contentBlocks.some((block) => block.type === ContentBlockType.options)).toBe(
      true
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.text,
        payload: expect.objectContaining({
          text: expect.stringContaining('__local_canvas_confirm__:pending-1'),
        }),
      })
    )
  })

  it('does not render a stale confirmation option when the same Hermes turn already applied it', async () => {
    mockCallHermesSimAgent.mockResolvedValue({
      id: 'resp-1',
      content: 'Canvas change was applied.',
      sessionId: 'sim:chat:chat-1',
      sessionKey: 'sim:org:none:user:user-1',
      raw: {
        output: [
          {
            type: 'function_call_output',
            output: JSON.stringify({
              success: true,
              operation: 'propose',
              requiresConfirmation: true,
              pendingActionId: 'pending-old',
            }),
          },
          {
            type: 'function_call_output',
            output: JSON.stringify({
              success: true,
              operation: 'apply_pending',
              requiresConfirmation: false,
              pendingActionId: 'pending-old',
            }),
          },
        ],
      },
    })
    const context = createContext()

    await runHermesAgent({
      requestPayload: { message: 'apply the confirmed canvas change' },
      context,
      execContext: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
      },
      options: {},
    })

    expect(context.accumulatedContent).toBe('Canvas change was applied.')
    expect(context.contentBlocks.some((block) => block.type === ContentBlockType.options)).toBe(
      false
    )
  })

  it('renders only the latest still-pending Hermes canvas proposal', async () => {
    mockCallHermesSimAgent.mockResolvedValue({
      id: 'resp-1',
      content: 'Hermes prepared a revised proposal.',
      sessionId: 'sim:chat:chat-1',
      sessionKey: 'sim:org:none:user:user-1',
      raw: {
        output: [
          {
            type: 'function_call_output',
            output: JSON.stringify({
              success: true,
              operation: 'propose',
              requiresConfirmation: true,
              pendingActionId: 'pending-old',
            }),
          },
          {
            type: 'function_call_output',
            output: JSON.stringify({
              success: true,
              operation: 'propose',
              requiresConfirmation: true,
              pendingActionId: 'pending-new',
            }),
          },
        ],
      },
    })
    const context = createContext()

    await runHermesAgent({
      requestPayload: { message: 'revise the proposal' },
      context,
      execContext: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
      },
      options: {},
    })

    expect(context.accumulatedContent).toContain('__local_canvas_confirm__:pending-new')
    expect(context.accumulatedContent).not.toContain('__local_canvas_confirm__:pending-old')
  })

  it('turns a Hermes canvas confirmation option into apply_pending instructions', async () => {
    const context = createContext()

    await runHermesAgent({
      requestPayload: { message: '__local_canvas_confirm__:pending-1' },
      context,
      execContext: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
      },
      options: {},
    })

    expect(mockCallHermesSimAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('sim_canvas_apply_pending'),
      })
    )
    expect(mockCallHermesSimAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('pending-1'),
      })
    )
  })

  it('renders preview confirm and discard options when Hermes creates a SIM canvas preview', async () => {
    mockCallHermesSimAgent.mockResolvedValue({
      id: 'resp-1',
      content: 'Hermes prepared a canvas preview.',
      sessionId: 'sim:chat:chat-1',
      sessionKey: 'sim:org:none:user:user-1',
      raw: {
        output: [
          {
            type: 'function_call_output',
            output: JSON.stringify({
              success: true,
              operation: 'preview_create',
              requiresConfirmation: true,
              previewActionId: 'preview-1',
            }),
          },
        ],
      },
    })
    const context = createContext()

    await runHermesAgent({
      requestPayload: { message: 'preview a canvas image' },
      context,
      execContext: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
      },
      options: {},
    })

    expect(context.accumulatedContent).toContain('__local_canvas_preview_confirm__:preview-1')
    expect(context.accumulatedContent).toContain('__local_canvas_preview_discard__:preview-1')
    expect(context.contentBlocks.some((block) => block.type === ContentBlockType.options)).toBe(
      true
    )
  })

  it('turns preview confirmation options into preview commit or discard instructions', async () => {
    const confirmContext = createContext()
    await runHermesAgent({
      requestPayload: { message: '__local_canvas_preview_confirm__:preview-1' },
      context: confirmContext,
      execContext: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
      },
      options: {},
    })

    expect(mockCallHermesSimAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('sim_canvas_preview_commit'),
      })
    )
    expect(mockCallHermesSimAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('preview-1'),
      })
    )

    const discardContext = createContext()
    await runHermesAgent({
      requestPayload: { message: '__local_canvas_preview_discard__:preview-2' },
      context: discardContext,
      execContext: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
      },
      options: {},
    })

    expect(mockCallHermesSimAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('sim_canvas_preview_discard'),
      })
    )
    expect(mockCallHermesSimAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('preview-2'),
      })
    )
  })
})
