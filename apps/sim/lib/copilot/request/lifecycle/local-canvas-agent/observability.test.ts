/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildLocalAgentToolTraceFields,
  createLocalAgentOperationTrace,
  redactLocalAgentTelemetryValue,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/observability'
import type { LocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

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

describe('local canvas agent observability', () => {
  it('redacts sensitive telemetry previews', () => {
    const value = redactLocalAgentTelemetryValue({
      nodeId: 'node-1',
      apiKey: 'secret',
      nested: { contentHtml: '<p>private</p>', count: 2 },
    })

    expect(value).toEqual({
      nodeId: 'node-1',
      apiKey: '[redacted]',
      nested: { contentHtml: '[redacted]', count: 2 },
    })
  })

  it('builds stable trace fields without mutating the tool result', () => {
    const trace = createLocalAgentOperationTrace({
      kind: 'tool',
      name: 'canvas.read_summary',
      startedAtMs: 100,
    })
    const fields = buildLocalAgentToolTraceFields({
      context: buildContext(),
      trace,
      call: { name: 'canvas.read_summary', input: {} },
      result: { name: 'canvas.read_summary', success: true, output: { nodes: [] }, summary: 'ok' },
      nowMs: 150,
    })

    expect(fields).toMatchObject({
      traceId: trace.id,
      elapsedMs: 50,
      chatId: 'chat-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      toolName: 'canvas.read_summary',
      success: true,
      summary: 'ok',
    })
  })
})
