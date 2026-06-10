/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { createLocalAgentOperationTrace } from '@/lib/copilot/request/lifecycle/local-canvas-agent/observability'
import {
  applyLocalAgentToolRequestMiddleware,
  applyLocalAgentToolResultMiddleware,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-middleware'
import type {
  LocalAgentContext,
  LocalAgentToolCall,
  LocalAgentToolResult,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

function buildContext(): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    chatId: 'chat-1',
    message: 'test',
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
    },
    streamContext: {} as LocalAgentContext['streamContext'],
    options: {},
  }
}

const middlewareContext = {
  context: buildContext(),
  trace: createLocalAgentOperationTrace({ kind: 'tool', name: 'canvas.read_summary' }),
}

describe('local canvas agent tool middleware', () => {
  it('is no-op when no middlewares are registered', async () => {
    const call: LocalAgentToolCall = { name: 'canvas.read_summary', input: {} }
    const result: LocalAgentToolResult = {
      name: 'canvas.read_summary',
      success: true,
      summary: 'ok',
    }

    await expect(applyLocalAgentToolRequestMiddleware({ call, middlewareContext })).resolves.toBe(
      call
    )
    await expect(
      applyLocalAgentToolResultMiddleware({ call, result, middlewareContext })
    ).resolves.toBe(result)
  })

  it('fails open if a middleware throws', async () => {
    const call: LocalAgentToolCall = { name: 'canvas.read_summary', input: {} }
    const result: LocalAgentToolResult = {
      name: 'canvas.read_summary',
      success: true,
      summary: 'ok',
    }

    await expect(
      applyLocalAgentToolRequestMiddleware({
        call,
        middlewareContext,
        middlewares: [
          {
            beforeExecute: vi.fn(() => {
              throw new Error('boom')
            }),
          },
        ],
      })
    ).resolves.toBe(call)
    await expect(
      applyLocalAgentToolResultMiddleware({
        call,
        result,
        middlewareContext,
        middlewares: [
          {
            afterExecute: vi.fn(() => {
              throw new Error('boom')
            }),
          },
        ],
      })
    ).resolves.toBe(result)
  })
})
