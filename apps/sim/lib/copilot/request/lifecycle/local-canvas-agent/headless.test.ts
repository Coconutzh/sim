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
              fields: { contentHtml: '<p>hello</p>' },
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

  it('returns read-only canvas summary when no node is selected', async () => {
    mockResolveLocalAgentContext.mockResolvedValue(buildLocalContext({ selectedNodeIds: [] }))
    mockReadCanvasNodeDetail.mockReturnValue(null)

    const result = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'what is on the canvas?',
      selectedNodeIds: [],
      mode: 'read_only',
      traceId: 'trace-no-selection',
      auditId: 'audit-no-selection',
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.auditId).toBe('audit-no-selection')
    expect(result.traceId).toBe('trace-no-selection')
    expect(result.requiresConfirmation).toBe(false)
    expect(result.changedNodeIds).toEqual([])
    expect(result.generatedNodeIds).toEqual([])
    expect(result.canvas?.selectedNodeIds).toEqual([])
    expect(result.canvas?.selectedNodeDetails).toEqual([])
    expect(result.answer).toContain('当前没有选中节点')
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

  it('stores business checkpoint proposals as pending confirmations and resumes on approval', async () => {
    mockRunLocalAgentToolLoop
      .mockResolvedValueOnce({
        plan: {
          goal: 'Draft the show planning structure',
          risk: 'medium',
          userIntent: 'mutate_canvas',
          mutationPolicy: 'allow_mutation',
          requiresUserConfirmation: false,
          requiresClarification: false,
          steps: [
            {
              id: 'step-1',
              title: 'Write structure section',
              intent: 'update',
              toolHints: ['canvas.apply_patch'],
              expectedObservation: 'Structure node is updated',
            },
          ],
          successCriteria: ['Structure is ready for review'],
          checkpoint: {
            kind: 'business_checkpoint',
            stage: 'structure_review',
            question: '请确认整体结构后继续。',
            resumeMessage: '整体结构已确认，请继续生成节目方案。',
            targetNodeIds: ['planning-structure'],
          },
        },
        observations: [],
        answer: 'Structure draft is ready for review.',
      })
      .mockResolvedValueOnce({
        plan: {
          goal: 'Continue after structure approval',
          risk: 'medium',
          userIntent: 'mutate_canvas',
          mutationPolicy: 'allow_mutation',
          requiresUserConfirmation: false,
          requiresClarification: false,
          steps: [
            {
              id: 'step-2',
              title: 'Write program section',
              intent: 'update',
              toolHints: ['canvas.apply_patch'],
              expectedObservation: 'Program node is updated',
            },
          ],
          successCriteria: ['Program section is generated'],
        },
        observations: [],
        answer: 'Program section generated.',
      })

    const proposal = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'start planning',
      mode: 'propose',
      auditId: 'audit-business-checkpoint-propose',
    })

    expect(proposal.success).toBe(true)
    if (!proposal.success) throw new Error(proposal.error)
    expect(proposal.requiresConfirmation).toBe(true)
    expect(proposal.pendingActionId).toEqual(expect.any(String))

    const resumed = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'continue',
      mode: 'apply_after_confirm',
      pendingActionId: proposal.pendingActionId,
      auditId: 'audit-business-checkpoint-apply',
    })

    expect(resumed.success).toBe(true)
    if (!resumed.success) throw new Error(resumed.error)
    expect(resumed.requiresConfirmation).toBe(false)
    expect(resumed.answer).toContain('Program section generated.')
    expect(mockRunLocalAgentToolLoop).toHaveBeenCalledTimes(2)
    expect(mockRunLocalAgentToolLoop).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: '整体结构已确认，请继续生成节目方案。',
        requestPayload: expect.objectContaining({
          approvedCheckpointStage: 'structure_review',
          message: '整体结构已确认，请继续生成节目方案。',
        }),
      })
    )
  })

  it('creates and generates program production nodes before resuming a program review checkpoint', async () => {
    mockExecuteLocalAgentTool.mockReset()
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'planning-programs',
          name: '节目方案',
          blockType: 'content',
          kind: 'text',
          position: { x: 1320, y: 120 },
          values: {
            planningData: {
              programs: [
                { name: '《月起西湖》', chapter: '第一章', priority: 'key', needsVideo: true },
                { name: '《玉鸟来信》', chapter: '第二章', priority: 'normal' },
              ],
            },
            contentHtml: '<p>节目方案</p>',
          },
          raw: {},
        },
        {
          id: 'planning-visual',
          name: '视觉系统总控',
          blockType: 'content',
          kind: 'text',
          position: { x: 2120, y: 120 },
          values: {},
          raw: {},
        },
        {
          id: 'planning-summary',
          name: '总策划案',
          blockType: 'content',
          kind: 'text',
          position: { x: 2520, y: 120 },
          values: {},
          raw: {},
        },
        {
          id: 'planning-presentation',
          name: '策划提案 PPT',
          blockType: 'content',
          kind: 'presentation',
          position: { x: 2520, y: 420 },
          values: {},
          raw: {},
        },
      ],
      edges: [],
    } satisfies CanvasSnapshot)
    const createdNodeMap = {
      'planning-program-detail-1': 'planning-program-detail-1',
      'planning-program-detail-2': 'planning-program-detail-2',
      'planning-program-visual-plan-1': 'planning-program-visual-plan-1',
      'planning-program-visual-plan-2': 'planning-program-visual-plan-2',
      'planning-program-image-1': 'planning-program-image-1',
      'planning-program-image-2': 'planning-program-image-2',
      'planning-program-video-1': 'planning-program-video-1',
      'planning-visual-summary': 'planning-visual-summary',
    }
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.apply_patch',
        success: true,
        summary: 'Program production nodes created',
        output: {
          machineSummary: {
            createdNodeMap,
          },
        },
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        summary: 'Program production nodes verified',
        output: {},
      })
      .mockImplementation(async (_context, call) => {
        if (call.name === 'canvas.generate_node_output') {
          const nodeId = typeof call.input.nodeId === 'string' ? call.input.nodeId : 'unknown-node'
          const verifiedField =
            nodeId.includes('image') || nodeId.includes('video') ? 'file' : 'contentHtml'
          return {
            name: 'canvas.generate_node_output',
            success: true,
            summary: `Generated ${nodeId}`,
            output: { nodeId, kind: 'text', verifiedField },
          }
        }
        if (call.name === 'canvas.verify_patch') {
          return {
            name: 'canvas.verify_patch',
            success: true,
            summary: 'Generated output verified',
            output: {},
          }
        }
        return {
          name: call.name,
          success: true,
          summary: 'ok',
          output: {},
        }
      })
    mockRunLocalAgentToolLoop
      .mockResolvedValueOnce({
        plan: {
          goal: 'Draft program section',
          risk: 'medium',
          userIntent: 'mutate_canvas',
          mutationPolicy: 'allow_mutation',
          requiresUserConfirmation: false,
          requiresClarification: false,
          steps: [
            {
              id: 'step-1',
              title: 'Write program section',
              intent: 'update',
              toolHints: ['canvas.apply_patch'],
              expectedObservation: 'Program node is updated',
            },
          ],
          successCriteria: ['Program is ready for review'],
          checkpoint: {
            kind: 'business_checkpoint',
            stage: 'program_review',
            question: '请确认节目方案后继续。',
            resumeMessage: '节目方案已确认，请继续生成后续节点。',
            targetNodeIds: ['planning-programs'],
          },
        },
        observations: [],
        answer: 'Program draft is ready for review.',
      })
      .mockResolvedValueOnce({
        plan: {
          goal: 'Continue after program approval',
          risk: 'medium',
          userIntent: 'mutate_canvas',
          mutationPolicy: 'allow_mutation',
          requiresUserConfirmation: false,
          requiresClarification: false,
          steps: [],
          successCriteria: ['Lineup, visual system, and summary are generated'],
        },
        observations: [],
        answer: 'Lineup, visual system, and summary generated.',
      })

    const proposal = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'continue planning',
      mode: 'propose',
      auditId: 'audit-program-checkpoint-propose',
    })

    expect(proposal.success).toBe(true)
    if (!proposal.success) throw new Error(proposal.error)

    const resumed = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'continue',
      mode: 'apply_after_confirm',
      pendingActionId: proposal.pendingActionId,
      auditId: 'audit-program-checkpoint-apply',
    })

    expect(resumed.success).toBe(true)
    if (!resumed.success) throw new Error(resumed.error)
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'canvas.apply_patch',
        input: expect.objectContaining({
          patch: expect.objectContaining({
            operations: expect.arrayContaining([
              expect.objectContaining({
                type: 'create_node',
                nodeId: 'planning-program-detail-1',
              }),
              expect.objectContaining({
                type: 'create_node',
                nodeId: 'planning-program-visual-plan-1',
              }),
              expect.objectContaining({
                type: 'create_node',
                nodeId: 'planning-program-image-1',
              }),
              expect.objectContaining({
                type: 'create_node',
                nodeId: 'planning-program-video-1',
              }),
              expect.objectContaining({
                type: 'create_node',
                nodeId: 'planning-program-detail-2',
              }),
              expect.objectContaining({
                type: 'create_node',
                nodeId: 'planning-program-visual-plan-2',
              }),
              expect.objectContaining({
                type: 'create_node',
                nodeId: 'planning-program-image-2',
              }),
              expect.objectContaining({
                type: 'create_node',
                nodeId: 'planning-visual-summary',
              }),
            ]),
          }),
        }),
      })
    )
    expect(resumed.changedNodeIds).toEqual(
      expect.arrayContaining([
        'planning-program-detail-1',
        'planning-program-visual-plan-1',
        'planning-program-image-1',
        'planning-program-video-1',
        'planning-program-detail-2',
        'planning-program-visual-plan-2',
        'planning-program-image-2',
        'planning-visual-summary',
      ])
    )
    expect(resumed.generatedNodeIds).toEqual(
      expect.arrayContaining([
        'planning-program-detail-1',
        'planning-program-visual-plan-1',
        'planning-program-image-1',
        'planning-program-video-1',
        'planning-program-detail-2',
        'planning-program-visual-plan-2',
        'planning-program-image-2',
        'planning-visual-summary',
      ])
    )
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'canvas.generate_node_output',
        input: { nodeId: 'planning-program-detail-1' },
      })
    )
    expect(mockRunLocalAgentToolLoop).toHaveBeenCalledTimes(2)
  })

  it('compiles a Hermes structured patch into a pending proposal without model reasoning', async () => {
    const result = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'compile this patch',
      mode: 'compile_patch',
      auditId: 'audit-compile',
      structuredTask: {
        goal: 'Create a hook node',
        expectedChanges: ['A new hook node is ready for confirmation'],
        patch: {
          operations: [
            {
              type: 'create_node',
              operationId: 'create-hook',
              clientNodeId: 'hook-1',
              kind: 'text',
              title: 'Hook',
              fields: { contentHtml: '<p>hello</p>' },
            },
          ],
        },
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.mode).toBe('compile_patch')
    expect(result.requiresConfirmation).toBe(true)
    expect(result.pendingActionId).toEqual(expect.any(String))
    expect(result.changedNodeIds).toEqual([])
    expect(result.generatedNodeIds).toEqual([])
    expect(result.proposedPatchSummary).toContain('Patch operations (1): create_node')
    expect(result.verificationSummary).toBe(
      'compile_patch validated the patch; no canvas mutation was executed.'
    )
    expect(mockLoadCanvasSnapshot).toHaveBeenCalledOnce()
    expect(mockRunLocalAgentToolLoop).not.toHaveBeenCalled()
  })

  it('rejects compile_patch when Hermes omits the structured patch', async () => {
    const result = await runLocalCanvasAgentHeadless({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      message: 'compile this patch',
      mode: 'compile_patch',
      auditId: 'audit-compile-missing-patch',
      structuredTask: {
        goal: 'Create a hook node',
      },
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected compile_patch validation failure')
    expect(result.errorCode).toBe('PATCH_VALIDATION_FAILED')
    expect(mockLoadCanvasSnapshot).not.toHaveBeenCalled()
    expect(mockRunLocalAgentToolLoop).not.toHaveBeenCalled()
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

  it('rejects a superseded pending action id for apply-after-confirm without deleting the latest pending plan', async () => {
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
    if (result.success) throw new Error('expected superseded confirmation')
    expect(result.errorCode).toBe('CONFIRMATION_SUPERSEDED')
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalled()
  })
})
