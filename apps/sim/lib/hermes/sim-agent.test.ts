/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCallHermesResponse, mockLoggerWarn, mockSelect } = vi.hoisted(() => ({
  mockCallHermesResponse: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockSelect: vi.fn(),
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
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ warn: mockLoggerWarn, info: vi.fn(), error: vi.fn() }),
  runWithRequestContext: (_context: unknown, callback: () => unknown) => callback(),
}))

vi.mock('@/lib/hermes/client', () => ({
  callHermesResponse: mockCallHermesResponse,
}))

import { callHermesSimAgent } from '@/lib/hermes/sim-agent'

describe('callHermesSimAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCallHermesResponse.mockResolvedValue({
      content: 'ok',
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
