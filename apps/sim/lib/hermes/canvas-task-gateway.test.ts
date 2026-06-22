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
})
