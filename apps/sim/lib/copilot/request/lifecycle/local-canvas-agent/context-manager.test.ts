/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildTokenAwareLocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/context-manager'
import type {
  CanvasSnapshot,
  LocalAgentContext,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

function buildContext(): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    message: '读取附件 brief',
    sessionScope: 'personal',
    agent: { code: 'local_canvas_agent', name: 'Canvas Agent', description: '', systemPrompt: '' },
    discipline: { id: '', code: 'canvas_runtime', name: 'Canvas Runtime' },
    workgroup: { id: '', name: 'Workspace', organizationId: '', teamWorkspaceId: null },
    permissions: { canRead: true, canWrite: true, canPublish: false },
    selectedNodeIds: [],
    attachments: [
      {
        id: 'file-1',
        key: 'uploads/private/brief.pdf',
        name: 'brief.pdf',
        type: 'application/pdf',
        size: 1234,
        url: 'https://storage.example.test/private/brief.pdf',
      },
    ],
    attachedContexts: [],
    conversationHistory: [],
    skills: [],
    model: { model: 'test-model', mode: 'structured' },
    confirmationMode: 'auto',
    thinkingLevel: 'standard',
    requestPayload: {},
    execContext: {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    },
    streamContext: {} as LocalAgentContext['streamContext'],
    options: {},
  }
}

describe('local canvas context manager', () => {
  it('redacts attachment storage metadata from token-aware context', () => {
    const snapshot: CanvasSnapshot = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    }

    const contextText = buildTokenAwareLocalAgentContext({ context: buildContext(), snapshot })

    expect(contextText).toContain('brief.pdf')
    expect(contextText).toContain('type=application/pdf')
    expect(contextText).toContain('size=1234')
    expect(contextText).not.toContain('uploads/private')
    expect(contextText).not.toContain('https://storage.example.test')
    expect(contextText).not.toContain('file-1')
  })
})
