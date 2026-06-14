/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCallHermesResponse, mockEnv, mockLoggerWarn, mockSelect, mockUpdate } = vi.hoisted(
  () => ({
    mockCallHermesResponse: vi.fn(),
    mockEnv: {} as Record<string, boolean | number | string | undefined>,
    mockLoggerWarn: vi.fn(),
    mockSelect: vi.fn(),
    mockUpdate: vi.fn(),
  })
)

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
        instructions: expect.stringContaining('must call sim_canvas_agent_run'),
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
  })

  it('enables Hermes native conversation chain when the feature flag and chat scope are present', async () => {
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
        conversation:
          'sim:org:org-1:user:user-1:workspace:workspace-1:workflow:workflow-1:chat:chat-1:gen:2',
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
