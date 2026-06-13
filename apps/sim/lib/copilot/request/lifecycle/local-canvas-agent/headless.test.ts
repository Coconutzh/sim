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
  mockBuildLocalAgentAnswer,
  mockExecuteLocalAgentTool,
} = vi.hoisted(() => ({
  mockBuildCanvasSummaryTextFromParts: vi.fn(),
  mockLoadCanvasSnapshot: vi.fn(),
  mockLoadLocalAgentMemory: vi.fn(),
  mockPersistLocalAgentSessionMetadata: vi.fn(),
  mockReadCanvasNodeDetail: vi.fn(),
  mockResolveLocalAgentContext: vi.fn(),
  mockRunLocalAgentToolLoop: vi.fn(),
  mockSummarizeCanvas: vi.fn(),
  mockBuildLocalAgentAnswer: vi.fn(),
  mockExecuteLocalAgentTool: vi.fn(),
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

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/models/actor', () => ({
  buildLocalAgentAnswer: mockBuildLocalAgentAnswer,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/session', () => ({
  persistLocalAgentSessionMetadata: mockPersistLocalAgentSessionMetadata,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/tool-executor-bridge', () => ({
  executeLocalAgentTool: mockExecuteLocalAgentTool,
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
    permissions: { canRead: true, canWrite: true, canPublish: false },
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
    streamContext: { wasAborted: false } as LocalAgentContext['streamContext'],
    options: {},
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
              title: 'Hook',
              fields: { content: 'hello' },
            },
          ],
        },
      },
      observations: [],
      answer: 'A Hook node can be proposed.',
    })
    mockBuildLocalAgentAnswer.mockResolvedValue('已完成画布修改，并完成验证。')
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.apply_patch',
        success: true,
        output: {
          patch: {
            operations: [
              {
                type: 'create_node',
                operationId: 'create-hook',
                clientNodeId: 'hook-1',
                kind: 'text',
                title: 'Hook',
                fields: { content: 'hello' },
              },
            ],
          },
          verification: {
            success: true,
            operationResults: [{ operationId: 'create-hook', nodeId: 'node-created' }],
          },
          createdNodeMap: { 'hook-1': 'node-created' },
          machineSummary: {
            createdNodeMap: { 'hook-1': 'node-created' },
            writeBackFields: [{ nodeId: 'node-created', field: 'content', status: 'verified' }],
            deletedNodeIds: [],
            referenceChanges: [],
          },
        },
        summary: 'Applied canvas patch',
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        output: { success: true, summary: 'Verified canvas patch' },
        summary: 'Verified canvas patch',
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
    expect(result.pendingActionId).toEqual(expect.any(String))
    expect(result.changedNodeIds).toEqual([])
    expect(result.generatedNodeIds).toEqual([])
    expect(result.proposedPatchSummary).toContain('Patch operations (1): create_node')
    expect(result.verificationSummary).toBe(
      'Proposal-only request; no canvas mutation was executed.'
    )
    expect(mockRunLocalAgentToolLoop).toHaveBeenCalledOnce()
  })

  it('requires a pending action id before applying a proposed canvas mutation', async () => {
    const result = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      message: 'change canvas',
      mode: 'apply_after_confirm',
      auditId: 'audit-3',
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected confirmation requirement')
    expect(result.errorCode).toBe('CONFIRMATION_REQUIRED')
    expect(result.requiresConfirmation).toBe(true)
    expect(mockResolveLocalAgentContext).toHaveBeenCalledOnce()
  })

  it('applies a confirmed proposal through SIM tools and returns verification evidence', async () => {
    const proposal = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'create a hook node',
      mode: 'propose',
      auditId: 'audit-propose-apply',
    })
    expect(proposal.success).toBe(true)
    if (!proposal.success) throw new Error(proposal.error)
    expect(proposal.pendingActionId).toEqual(expect.any(String))

    const result = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'confirmed by user',
      mode: 'apply_after_confirm',
      pendingActionId: proposal.pendingActionId,
      auditId: 'audit-apply',
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.mode).toBe('apply_after_confirm')
    expect(result.requiresConfirmation).toBe(false)
    expect(result.pendingActionId).toBe(proposal.pendingActionId)
    expect(result.changedNodeIds).toEqual(['node-created'])
    expect(result.generatedNodeIds).toEqual([])
    expect(result.verificationSummary).toContain('canvas.verify_patch: success')
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ name: 'canvas.apply_patch' })
    )
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ name: 'canvas.verify_patch' })
    )
  })

  it('generates output for confirmed newly created nodes after patch verification', async () => {
    mockRunLocalAgentToolLoop.mockResolvedValueOnce({
      plan: {
        goal: 'Create and generate a hook node',
        risk: 'medium',
        userIntent: 'generate_output',
        mutationPolicy: 'propose_only',
        requiresUserConfirmation: true,
        requiresClarification: false,
        steps: [
          {
            id: 'step-1',
            title: 'Create a hook node and generate text',
            intent: 'generate',
            toolHints: ['canvas.propose_patch'],
            expectedObservation: 'Patch and generation target are proposed',
          },
        ],
        successCriteria: ['Generated node output is verified'],
        patch: {
          operations: [
            {
              type: 'create_node',
              operationId: 'create-hook',
              clientNodeId: 'hook-1',
              kind: 'text',
              title: 'Hook',
              fields: { aiPrompt: 'write a hook' },
            },
          ],
        },
        generationTargets: [{ clientNodeId: 'hook-1', reason: 'Generate the new hook text' }],
      },
      observations: [],
      answer: 'A generated Hook node can be proposed.',
    })
    mockExecuteLocalAgentTool.mockReset()
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.apply_patch',
        success: true,
        output: {
          patch: {
            operations: [
              {
                type: 'create_node',
                operationId: 'create-hook',
                clientNodeId: 'hook-1',
                kind: 'text',
                title: 'Hook',
                fields: { aiPrompt: 'write a hook' },
              },
            ],
          },
          verification: {
            success: true,
            operationResults: [{ operationId: 'create-hook', nodeId: 'node-created' }],
          },
          machineSummary: {
            createdNodeMap: { 'hook-1': 'node-created' },
            writeBackFields: [{ nodeId: 'node-created', field: 'aiPrompt', status: 'verified' }],
            deletedNodeIds: [],
            referenceChanges: [],
          },
        },
        summary: 'Applied canvas patch',
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        output: { success: true, summary: 'Verified canvas patch' },
        summary: 'Verified canvas patch',
      })
      .mockResolvedValueOnce({
        name: 'canvas.generate_node_output',
        success: true,
        output: {
          nodeId: 'node-created',
          kind: 'text',
          verifiedField: 'contentHtml',
          contentHtml: '<p>Generated hook</p>',
        },
        summary: 'Generated output for text node',
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        output: { success: true, summary: 'Verified generated field' },
        summary: 'Verified generated field',
      })

    const proposal = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'create and generate a hook node',
      mode: 'propose',
      auditId: 'audit-generate-propose',
    })
    expect(proposal.success).toBe(true)
    if (!proposal.success) throw new Error(proposal.error)

    const result = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'confirmed by user',
      mode: 'apply_after_confirm',
      pendingActionId: proposal.pendingActionId,
      auditId: 'audit-generate-apply',
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.changedNodeIds).toEqual(['node-created'])
    expect(result.generatedNodeIds).toEqual(['node-created'])
    expect(result.verificationSummary).toContain('canvas.generate_node_output: success')
    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(
      3,
      expect.any(Object),
      expect.objectContaining({
        name: 'canvas.generate_node_output',
        input: { nodeId: 'node-created' },
      })
    )
    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(
      4,
      expect.any(Object),
      expect.objectContaining({
        name: 'canvas.verify_patch',
        input: { generation: { nodeId: 'node-created', field: 'contentHtml' } },
      })
    )
  })

  it('does not report success when confirmed apply verification fails', async () => {
    const proposal = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'create a hook node',
      mode: 'propose',
      auditId: 'audit-propose-verify-fail',
    })
    expect(proposal.success).toBe(true)
    if (!proposal.success) throw new Error(proposal.error)

    mockExecuteLocalAgentTool.mockReset()
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.apply_patch',
        success: true,
        output: {
          patch: {
            operations: [
              {
                type: 'create_node',
                operationId: 'create-hook',
                clientNodeId: 'hook-1',
                kind: 'text',
                title: 'Hook',
                fields: { content: 'hello' },
              },
            ],
          },
          verification: {
            success: true,
            operationResults: [{ operationId: 'create-hook', nodeId: 'node-created' }],
          },
          createdNodeMap: { 'hook-1': 'node-created' },
          machineSummary: {
            createdNodeMap: { 'hook-1': 'node-created' },
            writeBackFields: [{ nodeId: 'node-created', field: 'content', status: 'verified' }],
            deletedNodeIds: [],
            referenceChanges: [],
          },
        },
        summary: 'Applied canvas patch',
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: false,
        output: { success: false, summary: 'Verification failed' },
        summary: 'Verification failed',
      })

    const result = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'confirmed by user',
      mode: 'apply_after_confirm',
      pendingActionId: proposal.pendingActionId,
      auditId: 'audit-verify-fail',
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected verification failure')
    expect(result.errorCode).toBe('VERIFY_FAILED')
    expect(result.changedNodeIds).toEqual(['node-created'])
    expect(result.verificationSummary).toContain('canvas.verify_patch: failed')
  })

  it('checks write permission again before confirmed apply', async () => {
    const proposal = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'create a hook node',
      mode: 'propose',
      auditId: 'audit-propose-permission',
    })
    expect(proposal.success).toBe(true)
    if (!proposal.success) throw new Error(proposal.error)

    mockResolveLocalAgentContext.mockResolvedValue(
      buildLocalContext({
        permissions: {
          canRead: true,
          canWrite: false,
          canPublish: false,
          readonlyReason: 'Write denied',
        },
      })
    )

    const result = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'confirmed by user',
      mode: 'apply_after_confirm',
      pendingActionId: proposal.pendingActionId,
      auditId: 'audit-permission',
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected permission failure')
    expect(result.errorCode).toBe('USER_PERMISSION_DENIED')
    expect(result.error).toBe('Write denied')
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalled()
  })

  it('rejects an unknown pending action id for apply-after-confirm', async () => {
    const result = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'confirmed by user',
      mode: 'apply_after_confirm',
      pendingActionId: 'missing-action',
      auditId: 'audit-missing-action',
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected expired confirmation')
    expect(result.errorCode).toBe('CONFIRMATION_EXPIRED')
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalled()
  })
})
