/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLoadCanvasSnapshot, mockResolveLocalAgentContext } = vi.hoisted(() => ({
  mockLoadCanvasSnapshot: vi.fn(),
  mockResolveLocalAgentContext: vi.fn(),
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
    })
  })

  it('materializes external image resource refs before validating generation references', async () => {
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
    expect(result.requiresConfirmation).toBe(true)
    expect(result.proposedPatchSummary).toContain('画布修改：4 个 patch operation')
    expect(result.proposedPatchSummary).toContain('add_content_reference')
  })

  it('compiles presentation nodes with prompt fields and canvas references', async () => {
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
    expect(result.pendingActionId).toBeTruthy()

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
      ])
    )
  })
})
