import { describe, expect, it } from 'vitest'
import { hermesCanvasTaskRunBodySchema } from '@/lib/api/contracts/internal/hermes-canvas-task'

describe('hermes canvas task contract', () => {
  it('accepts a business-level create and generate canvas task', () => {
    const parsed = hermesCanvasTaskRunBodySchema.parse({
      operation: 'propose',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      message: 'Create a pipeline image.',
      task: {
        taskType: 'create_nodes',
        nodes: [
          {
            clientId: 'diagram',
            kind: 'image',
            title: 'Pipeline Diagram',
            content: {
              imagePrompt: 'Academic pipeline diagram',
            },
          },
        ],
        generation: {
          targets: ['diagram'],
        },
      },
    })

    expect(parsed.task?.taskType).toBe('create_nodes')
    expect(parsed.task?.nodes[0]?.kind).toBe('image')
  })

  it('accepts strongly typed node refs and output generation references', () => {
    const parsed = hermesCanvasTaskRunBodySchema.parse({
      operation: 'propose',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      message: 'Use the selected car image to generate a BrickNet pipeline diagram.',
      selectedNodeIds: ['car-image-node'],
      task: {
        taskType: 'output_generate',
        nodeRefs: [{ type: 'created_node', clientNodeId: 'pipeline-image' }],
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
          prompt: 'Academic pipeline diagram using the selected LEGO car as the running example.',
          references: [
            { type: 'node_output', node: { type: 'selected_node', index: 0 } },
            {
              type: 'image',
              fileId: 'workspace-file-car',
              name: 'car.png',
              mediaType: 'image/png',
              key: 'workspace/workspace-1/car.png',
            },
          ],
          params: { aiAspectRatio: '16:9' },
        },
      },
    })

    expect(parsed.task?.taskType).toBe('output_generate')
    expect(parsed.task?.generation?.targets[0]).toEqual({
      type: 'created_node',
      clientNodeId: 'pipeline-image',
    })
    expect(parsed.task?.generation?.references[0]).toEqual({
      type: 'node_output',
      node: { type: 'selected_node', index: 0 },
    })
    expect(parsed.task?.generation?.references[1]).toEqual({
      type: 'image',
      fileId: 'workspace-file-car',
      name: 'car.png',
      mediaType: 'image/png',
      key: 'workspace/workspace-1/car.png',
    })
  })

  it('accepts capability discovery queries', () => {
    const parsed = hermesCanvasTaskRunBodySchema.parse({
      operation: 'query',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      message: 'What canvas capabilities are available?',
      queryType: 'inspect_capabilities',
    })

    expect(parsed.queryType).toBe('inspect_capabilities')
  })

  it('accepts preview lifecycle operations with previewActionId', () => {
    const create = hermesCanvasTaskRunBodySchema.parse({
      operation: 'preview_create',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      message: 'Preview a new image node.',
      task: {
        taskType: 'preview_create',
        nodes: [{ clientNodeId: 'preview-image', kind: 'image', title: 'Preview Image' }],
        generation: {
          targets: [{ type: 'created_node', clientNodeId: 'preview-image' }],
          outputType: 'image',
          prompt: 'Preview image',
        },
      },
    })
    const commit = hermesCanvasTaskRunBodySchema.parse({
      operation: 'preview_commit',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      message: 'Commit the preview.',
      previewActionId: 'preview-1',
    })

    expect(create.operation).toBe('preview_create')
    expect(commit.previewActionId).toBe('preview-1')
  })

  it('rejects raw patch payloads from the narrow task interface', () => {
    const parsed = hermesCanvasTaskRunBodySchema.safeParse({
      operation: 'propose',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      message: 'Create a node.',
      task: {
        taskType: 'create_nodes',
        patch: {
          operations: [{ type: 'create_node', kind: 'image', title: 'Bad raw patch' }],
        },
      },
    })

    expect(parsed.success).toBe(false)
  })
})
