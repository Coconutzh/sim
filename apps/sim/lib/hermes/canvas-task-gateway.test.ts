/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteLocalAgentTool, mockLoadCanvasSnapshot, mockResolveLocalAgentContext } =
  vi.hoisted(() => ({
    mockExecuteLocalAgentTool: vi.fn(),
    mockLoadCanvasSnapshot: vi.fn(),
    mockResolveLocalAgentContext: vi.fn(),
  }))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/tool-executor-bridge', () => ({
  executeLocalAgentTool: mockExecuteLocalAgentTool,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context', () => ({
  buildCanvasSummaryTextFromParts: vi.fn(() => 'Canvas summary'),
  loadCanvasSnapshot: mockLoadCanvasSnapshot,
  readCanvasNodeDetail: vi.fn(() => null),
  searchCanvasNodes: vi.fn(() => []),
  summarizeCanvas: vi.fn(() => []),
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/context-manager', () => ({
  resolveLocalAgentContext: mockResolveLocalAgentContext,
}))

import { hermesCanvasTaskRunBodySchema } from '@/lib/api/contracts/internal/hermes-canvas-task'
import { consumeLocalAgentPendingPlan } from '@/lib/copilot/request/lifecycle/local-canvas-agent/pending-plan'
import type {
  CanvasSnapshot,
  LocalAgentContext,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import { runHermesCanvasTaskGateway } from '@/lib/hermes/canvas-task-gateway'

function createSnapshot(): CanvasSnapshot {
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    nodes: [
      {
        id: 'selected-car',
        name: 'Selected Car',
        blockType: 'content',
        kind: 'image',
        position: { x: 0, y: 0 },
        values: {
          file: {
            id: 'car-file',
            name: 'car.png',
            type: 'image/png',
            key: 'workspace/workspace-1/car.png',
          },
        },
        raw: {},
      },
    ],
    edges: [],
  }
}

describe('runHermesCanvasTaskGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadCanvasSnapshot.mockResolvedValue(createSnapshot())
    mockResolveLocalAgentContext.mockResolvedValue({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      selectedNodeIds: ['selected-car'],
      permissions: { canRead: true, canWrite: true },
      streamContext: { wasAborted: false },
      options: {},
    })
  })

  it('rejects show-planning proposal writes that skip the required scaffold', async () => {
    mockLoadCanvasSnapshot.mockResolvedValueOnce({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    })

    const result = await runHermesCanvasTaskGateway({
      auditId: 'audit-show-planning-invalid-first-write',
      body: hermesCanvasTaskRunBodySchema.parse({
        operation: 'propose',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        message: '帮我做一个杭州中秋城市晚会的策划案和 PPT。',
        queryType: 'summary',
        task: {
          taskType: 'create_nodes',
          risk: 'medium',
          goal: 'Create a Hangzhou Mid-Autumn gala proposal canvas.',
          nodes: [
            {
              clientNodeId: 'planning-positioning',
              kind: 'text',
              title: '项目定位',
            },
          ],
          expectedChanges: ['Create planning proposal nodes'],
        },
      }),
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('INVALID_TASK')
    expect(result.error).toContain('taskType="create_chain"')
    expect(result.error).toContain('workflowPreset="show_planning_v1"')
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalled()
  })

  it('allows show-planning proposal first writes when they create the standard scaffold', async () => {
    mockLoadCanvasSnapshot.mockResolvedValueOnce({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
    })
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.apply_patch',
        success: true,
        summary: 'Show-planning scaffold applied',
        output: {
          machineSummary: {
            createdNodeMap: {
              'planning-positioning': 'planning-positioning',
              'planning-concept': 'planning-concept',
              'planning-structure': 'planning-structure',
              'planning-programs': 'planning-programs',
              'planning-lineup': 'planning-lineup',
              'planning-visual': 'planning-visual',
              'planning-summary': 'planning-summary',
              'planning-presentation': 'planning-presentation',
            },
          },
        },
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        summary: 'Scaffold verified',
        output: {},
      })

    const result = await runHermesCanvasTaskGateway({
      auditId: 'audit-show-planning-valid-first-write',
      body: hermesCanvasTaskRunBodySchema.parse({
        operation: 'propose',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        message: '帮我做一个杭州中秋城市晚会的策划案和 PPT。',
        queryType: 'summary',
        task: {
          taskType: 'create_chain',
          risk: 'medium',
          goal: 'Create a Hangzhou Mid-Autumn gala proposal canvas.',
          fields: {
            workflowPreset: 'show_planning_v1',
          },
          expectedChanges: ['Create the standard show-planning scaffold'],
        },
      }),
    })

    expect(result.success, JSON.stringify(result)).toBe(true)
    expect(result.requiresConfirmation).toBe(false)
    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(1, expect.anything(), {
      name: 'canvas.apply_patch',
      input: {
        patch: expect.objectContaining({
          operations: expect.arrayContaining([
            expect.objectContaining({
              type: 'create_node',
              clientNodeId: 'planning-positioning',
            }),
            expect.objectContaining({
              type: 'create_node',
              clientNodeId: 'planning-presentation',
            }),
          ]),
        }),
      },
    })
  })

  it('materializes external image resource refs before validating generation references', async () => {
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.apply_patch',
        success: true,
        summary: 'Patch applied',
        output: {
          createdNodeMap: { 'pipeline-image': 'image-node-1' },
          machineSummary: { createdNodeMap: { 'pipeline-image': 'image-node-1' } },
        },
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        summary: 'Patch verified',
        output: {},
      })
      .mockResolvedValueOnce({
        name: 'canvas.generate_node_output',
        success: true,
        summary: 'Image generated',
        output: { nodeId: 'image-node-1', verifiedField: 'file' },
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        summary: 'Generation verified',
        output: {},
      })

    const result = await runHermesCanvasTaskGateway({
      auditId: 'audit-1',
      body: hermesCanvasTaskRunBodySchema.parse({
        operation: 'propose',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        message: 'Create a BrickNet pipeline diagram with the uploaded car image.',
        selectedNodeIds: ['selected-car'],
        queryType: 'summary',
        task: {
          taskType: 'output_generate',
          risk: 'medium',
          nodes: [
            {
              clientNodeId: 'pipeline-image',
              kind: 'image',
              title: 'BrickNet Pipeline',
            },
          ],
          generation: {
            outputType: 'image',
            targets: [{ type: 'created_node', clientNodeId: 'pipeline-image' }],
            prompt: 'Academic BrickNet pipeline diagram using the white LEGO car.',
            references: [
              {
                type: 'image',
                fileId: 'uploaded-car-file',
                name: 'uploaded-car.png',
                mediaType: 'image/png',
                key: 'workspace/workspace-1/uploaded-car.png',
              },
            ],
          },
        },
      }),
    })

    expect(result.success, JSON.stringify(result)).toBe(true)
    expect(result.operation).toBe('propose')
    expect(result.requiresConfirmation).toBe(false)
    expect(result.proposedPatchSummary).toContain('画布修改：4 个 patch operation')
    expect(result.proposedPatchSummary).toContain('add_content_reference')
    expect(result.changedNodeIds).toContain('image-node-1')
    expect(result.generatedNodeIds).toContain('image-node-1')
  })

  it('compiles presentation nodes with prompt fields and canvas references', async () => {
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.apply_patch',
        success: true,
        summary: 'Patch applied',
        output: {
          createdNodeMap: { 'defense-deck': 'deck-node-1' },
          machineSummary: { createdNodeMap: { 'defense-deck': 'deck-node-1' } },
        },
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        summary: 'Patch verified',
        output: {},
      })

    const result = await runHermesCanvasTaskGateway({
      auditId: 'audit-1',
      body: hermesCanvasTaskRunBodySchema.parse({
        operation: 'propose',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        message: 'Create a defense deck from the selected image.',
        selectedNodeIds: ['selected-car'],
        queryType: 'summary',
        task: {
          taskType: 'create_nodes',
          risk: 'medium',
          nodes: [
            {
              clientNodeId: 'defense-deck',
              kind: 'presentation',
              title: 'Defense Deck',
              content: {
                presentationPrompt: 'Use the selected car as the visual case study.',
                presentationSlideCountMode: 'manual',
                presentationSlideCount: 10,
              },
            },
          ],
          references: [
            {
              consumer: { type: 'created_node', clientNodeId: 'defense-deck' },
              source: { type: 'selected_node', index: 0 },
              role: 'image_reference',
            },
          ],
        },
      }),
    })

    expect(result.success, JSON.stringify(result)).toBe(true)
    expect(result.requiresConfirmation).toBe(false)
    expect(result.pendingActionId).toBeUndefined()
    expect(result.changedNodeIds).toContain('deck-node-1')
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.apply_patch',
      input: {
        patch: expect.objectContaining({
          operations: expect.arrayContaining([
            expect.objectContaining({
              type: 'create_node',
              clientNodeId: 'defense-deck',
              kind: 'presentation',
              fields: expect.objectContaining({
                presentationPrompt: 'Use the selected car as the visual case study.',
                presentationSlideCountMode: 'manual',
                presentationSlideCount: 10,
              }),
            }),
            expect.objectContaining({
              type: 'add_content_reference',
              consumerNodeId: 'defense-deck',
              sourceNodeId: 'selected-car',
              role: 'image_reference',
            }),
          ]),
        }),
      },
    })
  })

  it('executes complex non-destructive batch tasks with references, layout, and generation', async () => {
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.apply_patch',
        success: true,
        summary: 'Complex patch applied',
        output: {
          createdNodeMap: {
            story: 'story-node-1',
            visual: 'visual-node-1',
          },
          machineSummary: {
            createdNodeMap: {
              story: 'story-node-1',
              visual: 'visual-node-1',
            },
            referenceChanges: [
              {
                consumerNodeId: 'visual-node-1',
                sourceNodeId: 'story-node-1',
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        summary: 'Complex patch verified',
        output: {},
      })
      .mockResolvedValueOnce({
        name: 'canvas.generate_node_output',
        success: true,
        summary: 'Visual generated',
        output: { nodeId: 'visual-node-1', verifiedField: 'file' },
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        summary: 'Generated visual verified',
        output: {},
      })

    const result = await runHermesCanvasTaskGateway({
      auditId: 'audit-1',
      body: hermesCanvasTaskRunBodySchema.parse({
        operation: 'propose',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        message: 'Create a story-to-image mini workflow and generate the image.',
        selectedNodeIds: ['selected-car'],
        queryType: 'summary',
        task: {
          taskType: 'batch',
          risk: 'medium',
          nodes: [
            {
              clientNodeId: 'story',
              kind: 'text',
              title: 'Launch Story',
              content: { textHtml: '<p>Write a concise launch story.</p>' },
            },
            {
              clientNodeId: 'visual',
              kind: 'image',
              title: 'Launch Visual',
              content: { imagePrompt: 'Premium product launch image using the story context.' },
            },
          ],
          references: [
            {
              consumer: { type: 'created_node', clientNodeId: 'visual' },
              source: { type: 'created_node', clientNodeId: 'story' },
              role: 'text_context',
            },
            {
              consumer: { type: 'created_node', clientNodeId: 'visual' },
              source: { type: 'selected_node', index: 0 },
              role: 'image_reference',
            },
          ],
          layout: {
            nodeIds: [
              { type: 'created_node', clientNodeId: 'story' },
              { type: 'created_node', clientNodeId: 'visual' },
            ],
            direction: 'horizontal',
          },
          generation: {
            outputType: 'image',
            targets: [{ type: 'created_node', clientNodeId: 'visual' }],
            prompt: 'Generate the launch visual after the nodes and references are created.',
          },
        },
      }),
    })

    expect(result.success, JSON.stringify(result)).toBe(true)
    expect(result.requiresConfirmation).toBe(false)
    expect(result.pendingActionId).toBeUndefined()
    expect(result.changedNodeIds).toEqual(expect.arrayContaining(['story-node-1', 'visual-node-1']))
    expect(result.generatedNodeIds).toEqual(['visual-node-1'])
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledTimes(4)
    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(1, expect.anything(), {
      name: 'canvas.apply_patch',
      input: {
        patch: expect.objectContaining({
          operations: expect.arrayContaining([
            expect.objectContaining({ type: 'create_node', clientNodeId: 'story' }),
            expect.objectContaining({ type: 'create_node', clientNodeId: 'visual' }),
            expect.objectContaining({
              type: 'add_content_reference',
              consumerNodeId: 'visual',
              sourceNodeId: 'story',
              role: 'text_context',
            }),
            expect.objectContaining({
              type: 'add_content_reference',
              consumerNodeId: 'visual',
              sourceNodeId: 'selected-car',
              role: 'image_reference',
            }),
            expect.objectContaining({ type: 'layout_nodes', direction: 'horizontal' }),
          ]),
        }),
      },
    })
    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(3, expect.anything(), {
      name: 'canvas.generate_node_output',
      input: { nodeId: 'visual-node-1' },
    })
  })

  it('keeps mixed batch tasks pending when any operation deletes existing canvas content', async () => {
    const result = await runHermesCanvasTaskGateway({
      auditId: 'audit-1',
      body: hermesCanvasTaskRunBodySchema.parse({
        operation: 'propose',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        message: 'Replace the selected node with a new storyboard node.',
        selectedNodeIds: ['selected-car'],
        queryType: 'summary',
        task: {
          taskType: 'batch',
          risk: 'medium',
          deleteNodeIds: ['selected-car'],
          nodes: [
            {
              clientNodeId: 'replacement-story',
              kind: 'text',
              title: 'Replacement Storyboard',
              content: { textHtml: '<p>New storyboard content.</p>' },
            },
          ],
        },
      }),
    })

    expect(result.success, JSON.stringify(result)).toBe(true)
    expect(result.requiresConfirmation).toBe(true)
    expect(result.pendingActionId).toBeTruthy()
    expect(result.changedNodeIds).toEqual([])
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalled()

    const consumed = consumeLocalAgentPendingPlan({
      context: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
      } as LocalAgentContext,
      pendingActionId: result.pendingActionId ?? '',
    })

    expect(consumed.status).toBe('found')
    expect(consumed.status === 'found' ? consumed.pending.plan.patch?.operations : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'create_node',
          clientNodeId: 'replacement-story',
        }),
        expect.objectContaining({
          type: 'delete_node',
          nodeId: 'selected-car',
        }),
      ])
    )
  })

  it('keeps delete tasks pending for explicit confirmation', async () => {
    const result = await runHermesCanvasTaskGateway({
      auditId: 'audit-1',
      body: hermesCanvasTaskRunBodySchema.parse({
        operation: 'propose',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        message: 'Delete the selected image node.',
        selectedNodeIds: ['selected-car'],
        queryType: 'summary',
        task: {
          taskType: 'delete_nodes',
          risk: 'high',
          target: { mode: 'selected' },
        },
      }),
    })

    expect(result.success, JSON.stringify(result)).toBe(true)
    expect(result.requiresConfirmation).toBe(true)
    expect(result.pendingActionId).toBeTruthy()
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalled()

    const consumed = consumeLocalAgentPendingPlan({
      context: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
      } as LocalAgentContext,
      pendingActionId: result.pendingActionId ?? '',
    })

    expect(consumed.status).toBe('found')
    expect(consumed.status === 'found' ? consumed.pending.plan.patch?.operations : []).toEqual([
      expect.objectContaining({
        type: 'delete_node',
        nodeId: 'selected-car',
      }),
    ])
  })

  it('pauses show-planning tasks at business checkpoints after verified execution', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'planning-structure',
          name: '整体结构',
          blockType: 'content',
          kind: 'text',
          position: { x: 0, y: 0 },
          values: {},
          raw: {},
        },
      ],
      edges: [],
    })
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.apply_patch',
        success: true,
        summary: 'Structure updated',
        output: {
          machineSummary: {
            writeBackFields: [{ nodeId: 'planning-structure', field: 'contentHtml' }],
          },
        },
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        summary: 'Structure verified',
        output: {},
      })

    const result = await runHermesCanvasTaskGateway({
      auditId: 'audit-show-planning-checkpoint',
      body: hermesCanvasTaskRunBodySchema.parse({
        operation: 'propose',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        message: 'Write the planning structure section.',
        queryType: 'summary',
        task: {
          taskType: 'node_update',
          risk: 'medium',
          goal: 'Write the overall structure section.',
          fields: {
            workflowPreset: 'show_planning_v1',
            planningCheckpointStage: 'structure_review',
          },
          updates: [
            {
              target: { type: 'existing_node', nodeId: 'planning-structure' },
              fields: {
                contentHtml: '<p>Structure</p>',
                planningSection: 'structure',
                planningStage: 'structure',
                planningStatus: 'draft',
              },
            },
          ],
          expectedChanges: ['Structure section is written and paused for review'],
        },
      }),
    })

    expect(result.success, JSON.stringify(result)).toBe(true)
    expect(result.requiresConfirmation).toBe(true)
    expect(result.pendingActionId).toBeTruthy()
    expect(result.changedNodeIds).toEqual(['planning-structure'])
    expect(result.answer).toContain('等待结构化确认')

    const consumed = consumeLocalAgentPendingPlan({
      context: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
      } as LocalAgentContext,
      pendingActionId: result.pendingActionId ?? '',
    })

    expect(consumed.status).toBe('found')
    if (consumed.status !== 'found') throw new Error('expected pending checkpoint plan')
    expect(consumed.pending.kind).toBe('business_checkpoint')
    expect(consumed.pending.plan.checkpoint?.stage).toBe('structure_review')
  })

  it('compiles arrange_nodes into move_node patch operations', async () => {
    mockLoadCanvasSnapshot.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      nodes: [
        {
          id: 'node-a',
          name: 'Node A',
          blockType: 'content',
          kind: 'text',
          position: { x: 0, y: 0 },
          values: {},
          raw: {},
        },
        {
          id: 'node-b',
          name: 'Node B',
          blockType: 'content',
          kind: 'image',
          position: { x: 360, y: 0 },
          values: {},
          raw: {},
        },
      ],
      edges: [],
    })
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.apply_patch',
        success: true,
        summary: 'Arrangement applied',
        output: {
          machineSummary: { movedNodeIds: ['node-a', 'node-b'] },
        },
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        summary: 'Arrangement verified',
        output: {},
      })

    const result = await runHermesCanvasTaskGateway({
      auditId: 'audit-1',
      body: hermesCanvasTaskRunBodySchema.parse({
        operation: 'propose',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        message: 'Arrange these nodes into two columns.',
        queryType: 'summary',
        task: {
          taskType: 'arrange_nodes',
          arrangement: {
            layoutMode: 'structured',
            zones: [
              {
                zoneId: 'left',
                origin: { x: 50, y: 100 },
                verticalGap: 220,
                columns: [{ x: 50, nodeIds: ['node-a'] }],
              },
              {
                zoneId: 'right',
                origin: { x: 430, y: 100 },
                verticalGap: 220,
                columns: [{ x: 430, nodeIds: ['node-b'] }],
              },
            ],
          },
        },
      }),
    })

    expect(result.success, JSON.stringify(result)).toBe(true)
    expect(result.changedNodeIds).toEqual(expect.arrayContaining(['node-a', 'node-b']))
    expect(mockExecuteLocalAgentTool).toHaveBeenNthCalledWith(1, expect.anything(), {
      name: 'canvas.apply_patch',
      input: {
        patch: expect.objectContaining({
          operations: expect.arrayContaining([
            expect.objectContaining({
              type: 'move_node',
              nodeId: 'node-a',
              position: { x: 50, y: 100 },
            }),
            expect.objectContaining({
              type: 'move_node',
              nodeId: 'node-b',
              position: { x: 430, y: 100 },
            }),
          ]),
        }),
      },
    })
  })
})
