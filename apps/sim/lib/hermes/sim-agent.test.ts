/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockHermesClientError,
  mockCallHermesResponse,
  mockEnv,
  mockLoggerWarn,
  mockSelect,
  mockUpdate,
} = vi.hoisted(() => ({
  MockHermesClientError: class HermesClientError extends Error {
    constructor(
      message: string,
      public readonly status?: number
    ) {
      super(message)
      this.name = 'HermesClientError'
    }
  },
  mockCallHermesResponse: vi.fn(),
  mockEnv: {} as Record<string, boolean | number | string | undefined>,
  mockLoggerWarn: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ warn: mockLoggerWarn, info: vi.fn(), error: vi.fn() }),
  runWithRequestContext: (_context: unknown, callback: () => unknown) => callback(),
}))

vi.mock('@/lib/hermes/client', () => ({
  callHermesResponse: mockCallHermesResponse,
  HermesClientError: MockHermesClientError,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: mockEnv,
  isTruthy: (value: string | boolean | number | undefined) =>
    typeof value === 'string' ? value.toLowerCase() === 'true' || value === '1' : Boolean(value),
}))

import { callHermesSimAgent } from '@/lib/hermes/sim-agent'

function createUpdateChain() {
  const chain: Record<string, unknown> = {}
  ;(chain as any).set = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => Promise.resolve([]))
  return chain
}

describe('callHermesSimAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(mockEnv)) delete mockEnv[key]
    mockCallHermesResponse.mockResolvedValue({
      id: 'resp-1',
      content: 'ok',
      sessionId: 'session-1',
      sessionKey: 'key-1',
      raw: {},
    })
  })

  it('uses the provided organization id in Hermes session scope and metadata', async () => {
    mockEnv.HERMES_NATIVE_CONVERSATION_CHAIN_ENABLED = 'false'

    await callHermesSimAgent({
      userId: 'user-1',
      organizationId: 'org-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'read canvas',
      selectedNodeIds: ['node-1'],
      traceId: 'trace-1',
    })

    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        input: 'read canvas',
        instructions: expect.stringContaining('must call a SIM canvas tool'),
        store: false,
        sessionId: 'sim:chat:chat-1',
        sessionKey: 'sim:org:org-1:user:user-1',
        metadata: {
          sim: {
            userId: 'user-1',
            organizationId: 'org-1',
            workspaceId: 'workspace-1',
            workflowId: 'workflow-1',
            chatId: 'chat-1',
            selectedNodeIds: ['node-1'],
            traceId: 'trace-1',
          },
        },
      })
    )
    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining('call web_extract before answering'),
      })
    )
    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining('sim_canvas_media_prepare'),
      })
    )
    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining('vision_analyze'),
      })
    )
    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining('sim_canvas_task_propose'),
      })
    )
    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining('Do not hand-write SIM patch.operations'),
      })
    )
    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining('sim_canvas_apply_pending'),
      })
    )
    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining('kind=presentation'),
      })
    )
    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining('codex-ppt'),
      })
    )
    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining('sim_presentation_generate_slide_images'),
      })
    )
    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining('sim_presentation_assemble_deck'),
      })
    )
    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining('sim_presentation_artifact_upload'),
      })
    )
    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining('Do not ask the user for a fixed stylePreset'),
      })
    )
  })

  it('passes explicit structured Responses input when provided', async () => {
    mockEnv.HERMES_NATIVE_CONVERSATION_CHAIN_ENABLED = 'false'

    const input = [
      {
        role: 'user' as const,
        content: [
          { type: 'input_text' as const, text: 'describe this image' },
          { type: 'input_image' as const, image_url: 'data:image/png;base64,AAAA' },
        ],
      },
    ]

    await callHermesSimAgent({
      userId: 'user-1',
      organizationId: 'org-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'describe this image',
      input,
    })

    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        input,
        store: false,
      })
    )
  })

  it('uses the latest stored Hermes response id when native conversation chain is enabled', async () => {
    mockEnv.HERMES_NATIVE_CONVERSATION_CHAIN_ENABLED = 'true'
    mockSelect
      .mockReturnValueOnce(
        createSelectChain([
          {
            config: {
              hermes: {
                generation: 2,
                latestResponseId: 'resp-old',
              },
            },
          },
        ])
      )
      .mockReturnValueOnce(createSelectChain([{ config: { existing: true } }]))
    const updateChain = createUpdateChain()
    mockUpdate.mockReturnValueOnce(updateChain)

    await callHermesSimAgent({
      userId: 'user-1',
      organizationId: 'org-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'What canvas change did we discuss earlier?',
    })

    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        previousResponseId: 'resp-old',
        store: true,
        truncation: 'auto',
        instructions: expect.stringContaining('sim_canvas_history_query'),
      })
    )
    expect(updateChain.set).toHaveBeenCalledWith({
      config: expect.objectContaining({
        existing: true,
        hermes: expect.objectContaining({
          nativeConversationChainEnabled: true,
          conversation:
            'sim:org:org-1:user:user-1:workspace:workspace-1:workflow:workflow-1:chat:chat-1:gen:2',
          generation: 2,
          latestResponseId: 'resp-1',
          latestSessionId: 'session-1',
          latestSessionKey: 'key-1',
        }),
      }),
    })
  })

  it('defaults native conversation chain on and seeds from SIM history when no prior Hermes response exists', async () => {
    mockSelect
      .mockReturnValueOnce(
        createSelectChain([
          {
            config: {
              hermes: {
                generation: 1,
              },
            },
          },
        ])
      )
      .mockReturnValueOnce(createSelectChain([{ config: {} }]))
    const updateChain = createUpdateChain()
    mockUpdate.mockReturnValueOnce(updateChain)

    await callHermesSimAgent({
      userId: 'user-1',
      organizationId: 'org-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'Use this paper and car image.',
      conversationHistory: [
        { role: 'user', content: 'I uploaded BrickNet.pdf and car.png.' },
        { role: 'assistant', content: 'The image is a white futuristic LEGO car.' },
      ],
    })

    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation:
          'sim:org:org-1:user:user-1:workspace:workspace-1:workflow:workflow-1:chat:chat-1:gen:1',
        conversationHistory: [
          { role: 'user', content: 'I uploaded BrickNet.pdf and car.png.' },
          { role: 'assistant', content: 'The image is a white futuristic LEGO car.' },
        ],
        store: true,
        truncation: 'auto',
      })
    )
  })

  it('repairs a missing Hermes previous response by retrying with SIM history seed', async () => {
    mockEnv.HERMES_NATIVE_CONVERSATION_CHAIN_ENABLED = 'true'
    mockSelect
      .mockReturnValueOnce(
        createSelectChain([
          {
            config: {
              hermes: {
                generation: 0,
                latestResponseId: 'resp-missing',
              },
            },
          },
        ])
      )
      .mockReturnValueOnce(createSelectChain([{ config: {} }]))
    const updateChain = createUpdateChain()
    mockUpdate.mockReturnValueOnce(updateChain)
    mockCallHermesResponse
      .mockRejectedValueOnce(
        new MockHermesClientError('Previous response not found: resp-missing', 404)
      )
      .mockResolvedValueOnce({
        id: 'resp-repaired',
        content: 'ok',
        sessionId: 'session-2',
        sessionKey: 'key-2',
        raw: {},
      })

    await callHermesSimAgent({
      userId: 'user-1',
      organizationId: 'org-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'Continue.',
      conversationHistory: [{ role: 'user', content: 'Earlier SIM chat context.' }],
    })

    expect(mockCallHermesResponse).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        previousResponseId: 'resp-missing',
        store: true,
      })
    )
    expect(mockCallHermesResponse).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        conversation:
          'sim:org:org-1:user:user-1:workspace:workspace-1:workflow:workflow-1:chat:chat-1:gen:0',
        conversationHistory: [{ role: 'user', content: 'Earlier SIM chat context.' }],
        store: true,
      })
    )
    expect(updateChain.set).toHaveBeenCalledWith({
      config: expect.objectContaining({
        hermes: expect.objectContaining({
          latestResponseId: 'resp-repaired',
        }),
      }),
    })
  })

  it('resolves organization id from workspace when the request payload omits it', async () => {
    mockSelect.mockReturnValueOnce(createSelectChain([{ organizationId: 'org-from-workspace' }]))

    await callHermesSimAgent({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      message: 'create a proposal',
    })

    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: expect.anything() })
    )
    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'sim:org:org-from-workspace:user:user-1',
        metadata: expect.objectContaining({
          sim: expect.objectContaining({
            organizationId: 'org-from-workspace',
            workspaceId: 'workspace-1',
            workflowId: 'workflow-1',
          }),
        }),
      })
    )
  })

  it('falls back to org:none when workspace organization lookup fails', async () => {
    mockSelect.mockImplementationOnce(() => {
      throw new Error('db unavailable')
    })

    await callHermesSimAgent({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      message: 'read canvas',
    })

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Failed to resolve Hermes organization context',
      expect.objectContaining({ workspaceId: 'workspace-1', error: 'db unavailable' })
    )
    expect(mockCallHermesResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'sim:org:none:user:user-1',
        metadata: expect.objectContaining({
          sim: expect.not.objectContaining({ organizationId: expect.any(String) }),
        }),
      })
    )
  })
})
