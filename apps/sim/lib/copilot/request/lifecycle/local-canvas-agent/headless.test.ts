/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CanvasNodeDetail,
  CanvasNodeSummary,
  CanvasSnapshot,
  LocalAgentContext,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const {
  mockBuildCanvasSummaryTextFromParts,
  mockLoadCanvasSnapshot,
  mockLoadLocalAgentMemory,
  mockPersistLocalAgentSessionMetadata,
  mockReadCanvasNodeDetail,
  mockResolveLocalAgentContext,
  mockRunLocalAgentToolLoop,
  mockSummarizeCanvas,
} = vi.hoisted(() => ({
  mockBuildCanvasSummaryTextFromParts: vi.fn(),
  mockLoadCanvasSnapshot: vi.fn(),
  mockLoadLocalAgentMemory: vi.fn(),
  mockPersistLocalAgentSessionMetadata: vi.fn(),
  mockReadCanvasNodeDetail: vi.fn(),
  mockResolveLocalAgentContext: vi.fn(),
  mockRunLocalAgentToolLoop: vi.fn(),
  mockSummarizeCanvas: vi.fn(),
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context', () => ({
  buildCanvasSummaryTextFromParts: mockBuildCanvasSummaryTextFromParts,
  loadCanvasSnapshot: mockLoadCanvasSnapshot,
  readCanvasNodeDetail: mockReadCanvasNodeDetail,
  summarizeCanvas: mockSummarizeCanvas,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/context-manager', () => ({
  resolveLocalAgentContext: mockResolveLocalAgentContext,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/memory', () => ({
  loadLocalAgentMemory: mockLoadLocalAgentMemory,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/session', () => ({
  persistLocalAgentSessionMetadata: mockPersistLocalAgentSessionMetadata,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/tool-loop', () => ({
  runLocalAgentToolLoop: mockRunLocalAgentToolLoop,
}))

import { runLocalCanvasAgentHeadless } from '@/lib/copilot/request/lifecycle/local-canvas-agent/headless'

const nodeSummary: CanvasNodeSummary = {
  id: 'node-1',
  name: 'Hook',
  blockType: 'content',
  kind: 'text',
  position: { x: 10, y: 20 },
  selected: true,
  summary: 'A selected hook node',
  capabilities: {
    canRead: true,
    canWrite: true,
    canGenerate: true,
    canReferenceFile: true,
  },
}

const nodeDetail: CanvasNodeDetail = {
  ...nodeSummary,
  fields: { content: 'hello' },
  textContent: 'hello',
  file: null,
}

const snapshot: CanvasSnapshot = {
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  nodes: [],
  edges: [{ source: 'node-1', target: 'node-2' }],
}

function buildLocalContext(overrides: Partial<LocalAgentContext> = {}): Partial<LocalAgentContext> {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    chatId: 'chat-1',
    selectedNodeIds: ['node-1'],
    permissions: { canRead: true, canWrite: false, canPublish: false },
    agent: { code: 'chief_director', name: 'Chief Director', description: '', systemPrompt: '' },
    workgroup: {
      id: 'workgroup-1',
      name: 'Workgroup',
      organizationId: 'org-1',
      teamWorkspaceId: null,
    },
    discipline: { id: 'discipline-1', code: 'chief_director', name: 'Chief Director' },
    sessionScope: 'personal',
    message: 'read canvas',
    conversationHistory: [],
    skills: [],
    model: { model: 'test-model', mode: 'structured' },
    confirmationMode: 'manual',
    thinkingLevel: 'standard',
    requestPayload: {},
    ...overrides,
  }
}

describe('runLocalCanvasAgentHeadless', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveLocalAgentContext.mockResolvedValue(buildLocalContext())
    mockLoadCanvasSnapshot.mockResolvedValue(snapshot)
    mockLoadLocalAgentMemory.mockResolvedValue({
      version: 2,
      scope: 'thread',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      agentCode: 'chief_director',
      chatId: 'chat-1',
      conversationSummary: '',
      taskState: { completedSteps: [], openQuestions: [] },
      canvasSummary: '',
      recentObservations: [],
      updatedAt: '2026-06-13T00:00:00.000Z',
    })
    mockRunLocalAgentToolLoop.mockResolvedValue({
      plan: {
        goal: 'Create a hook node',
        risk: 'medium',
        userIntent: 'mutate_canvas',
        mutationPolicy: 'propose_only',
        requiresUserConfirmation: true,
        requiresClarification: false,
        steps: [
          {
            id: 'step-1',
            title: 'Create a new hook node',
            intent: 'create',
            toolHints: ['canvas.propose_patch'],
            expectedObservation: 'Patch is proposed',
          },
        ],
        successCriteria: ['User can review the patch'],
        patch: {
          operations: [
            {
              type: 'create_node',
              operationId: 'create-hook',
              clientNodeId: 'hook-1',
              kind: 'text',
              name: 'Hook',
              fields: { content: 'hello' },
            },
          ],
        },
      },
      observations: [],
      answer: 'A Hook node can be proposed.',
    })
    mockSummarizeCanvas.mockReturnValue([nodeSummary])
    mockReadCanvasNodeDetail.mockReturnValue(nodeDetail)
    mockBuildCanvasSummaryTextFromParts.mockReturnValue('summary text')
  })

  it('returns read-only canvas summary without requiring confirmation', async () => {
    const result = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'what is on the canvas?',
      selectedNodeIds: ['node-1'],
      mode: 'read_only',
      traceId: 'trace-1',
      auditId: 'audit-1',
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.auditId).toBe('audit-1')
    expect(result.traceId).toBe('trace-1')
    expect(result.requiresConfirmation).toBe(false)
    expect(result.changedNodeIds).toEqual([])
    expect(result.generatedNodeIds).toEqual([])
    expect(result.canvas?.nodeCount).toBe(1)
    expect(result.canvas?.edgeCount).toBe(1)
    expect(result.canvas?.selectedNodeDetails).toEqual([nodeDetail])
    expect(mockPersistLocalAgentSessionMetadata).toHaveBeenCalledOnce()
  })

  it('denies read-only access when local permissions cannot read the canvas', async () => {
    mockResolveLocalAgentContext.mockResolvedValue(
      buildLocalContext({
        permissions: {
          canRead: false,
          canWrite: false,
          canPublish: false,
          readonlyReason: 'Access denied',
        },
      })
    )

    const result = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      message: 'read canvas',
      mode: 'read_only',
      auditId: 'audit-2',
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected permission denial')
    expect(result.errorCode).toBe('USER_PERMISSION_DENIED')
    expect(result.error).toBe('Access denied')
    expect(mockLoadCanvasSnapshot).not.toHaveBeenCalled()
  })

  it('returns proposal details without applying canvas mutations', async () => {
    const result = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      message: 'create a hook node',
      mode: 'propose',
      auditId: 'audit-propose',
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.mode).toBe('propose')
    expect(result.risk).toBe('medium')
    expect(result.requiresConfirmation).toBe(true)
    expect(result.changedNodeIds).toEqual([])
    expect(result.generatedNodeIds).toEqual([])
    expect(result.proposedPatchSummary).toContain('Patch operations (1): create_node')
    expect(result.verificationSummary).toBe(
      'Proposal-only request; no canvas mutation was executed.'
    )
    expect(mockRunLocalAgentToolLoop).toHaveBeenCalledOnce()
  })

  it('refuses mutating modes until the SIM approval flow is implemented', async () => {
    const result = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      message: 'change canvas',
      mode: 'apply_after_confirm',
      auditId: 'audit-3',
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected not implemented result')
    expect(result.errorCode).toBe('TOOL_EXECUTION_FAILED')
    expect(result.requiresConfirmation).toBe(true)
    expect(mockResolveLocalAgentContext).not.toHaveBeenCalled()
  })
})
