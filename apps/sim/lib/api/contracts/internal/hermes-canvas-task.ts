import { z } from 'zod'
import {
  hermesCanvasAgentErrorCodeSchema,
  hermesCanvasAgentRiskSchema,
  hermesCanvasNodeDetailSchema,
  hermesCanvasNodeSummarySchema,
} from '@/lib/api/contracts/internal/hermes-canvas-agent'
import {
  nonEmptyIdSchema,
  workflowIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const hermesCanvasTaskOperationSchema = z.enum([
  'query',
  'propose',
  'apply_pending',
  'preview_create',
  'preview_update',
  'preview_commit',
  'preview_discard',
])
export type HermesCanvasTaskOperation = z.output<typeof hermesCanvasTaskOperationSchema>

export const hermesCanvasTaskQueryTypeSchema = z
  .enum([
    'summary',
    'read_node',
    'read_selected',
    'search_nodes',
    'inspect_schema',
    'inspect_capabilities',
  ])
  .optional()
  .default('summary')
export type HermesCanvasTaskQueryType = z.output<typeof hermesCanvasTaskQueryTypeSchema>

export const hermesCanvasTaskTypeSchema = z.enum([
  'canvas_query',
  'node_create',
  'node_update',
  'node_delete',
  'edge_connect',
  'edge_disconnect',
  'content_reference_attach',
  'content_reference_remove',
  'output_generate',
  'workflow_run',
  'layout_nodes',
  'batch',
  'preview_create',
  'preview_update',
  'preview_commit',
  'preview_discard',
  'create_nodes',
  'update_nodes',
  'delete_nodes',
  'connect_nodes',
  'reference_nodes',
  'create_chain',
  'generate_outputs',
])
export type HermesCanvasTaskType = z.output<typeof hermesCanvasTaskTypeSchema>

const canvasNodeRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('existing_node'), nodeId: nonEmptyIdSchema }),
  z.object({ type: z.literal('created_node'), clientNodeId: z.string().trim().min(1).max(200) }),
  z.object({
    type: z.literal('selected_node'),
    index: z.number().int().nonnegative().max(199).optional(),
  }),
  z.object({
    type: z.literal('previous_tool_result'),
    resultId: z.string().trim().min(1).max(200),
  }),
])
export type HermesCanvasNodeRef = z.output<typeof canvasNodeRefSchema>

const canvasResourceRefSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('node_output'),
    node: canvasNodeRefSchema,
    outputId: z.string().trim().min(1).max(200).optional(),
  }),
  z.object({
    type: z.literal('uploaded_attachment'),
    attachmentId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(500).optional(),
    mediaType: z.string().trim().min(1).max(200).optional(),
    key: z.string().trim().min(1).max(2000).optional(),
    url: z.string().trim().url().max(4000).optional(),
  }),
  z.object({ type: z.literal('url'), url: z.string().trim().url().max(4000) }),
  z.object({
    type: z.literal('pdf'),
    fileId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(500).optional(),
    mediaType: z.string().trim().min(1).max(200).optional(),
    key: z.string().trim().min(1).max(2000).optional(),
    url: z.string().trim().url().max(4000).optional(),
  }),
  z.object({
    type: z.literal('image'),
    fileId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(500).optional(),
    mediaType: z.string().trim().min(1).max(200).optional(),
    key: z.string().trim().min(1).max(2000).optional(),
    url: z.string().trim().url().max(4000).optional(),
  }),
])
export type HermesCanvasResourceRef = z.output<typeof canvasResourceRefSchema>

const canvasOutputTypeSchema = z.enum([
  'image',
  'video',
  'text',
  'audio',
  'document',
  'structured_data',
])
export type HermesCanvasOutputType = z.output<typeof canvasOutputTypeSchema>

const canvasNodeKindSchema = z.enum(['text', 'image', 'video', 'audio', 'presentation'])
const canvasTargetSchema = z
  .object({
    mode: z.enum(['selected', 'node_ids', 'search', 'new']).optional().default('new'),
    nodeIds: z.array(nonEmptyIdSchema).max(100).optional().default([]),
    query: z.string().trim().max(1000).optional(),
  })
  .optional()

const canvasTaskContentSchema = z
  .object({
    text: z.string().max(12000).optional(),
    textHtml: z.string().max(12000).optional(),
    html: z.string().max(12000).optional(),
    imagePrompt: z.string().max(12000).optional(),
    videoPrompt: z.string().max(12000).optional(),
    audioPrompt: z.string().max(12000).optional(),
    presentationPrompt: z.string().max(20000).optional(),
    presentationSlideCountMode: z.enum(['auto', 'manual']).optional(),
    presentationSlideCount: z.number().int().min(1).max(200).optional(),
    prompt: z.string().max(12000).optional(),
    aiPrompt: z.string().max(12000).optional(),
    aiModel: z.string().trim().max(200).optional(),
    aiAspectRatio: z.string().trim().max(100).optional(),
    videoModelFamily: z.string().trim().max(100).optional(),
    videoParameters: z.record(z.string(), z.unknown()).optional(),
    videoFrameAspectRatioPreset: z.string().trim().max(100).optional(),
    audioModel: z.string().trim().max(200).optional(),
    audioParameters: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const canvasTaskNodeSpecSchema = z
  .object({
    clientId: z.string().trim().min(1).max(200).optional(),
    clientNodeId: z.string().trim().min(1).max(200).optional(),
    nodeId: nonEmptyIdSchema.optional(),
    kind: canvasNodeKindSchema,
    title: z.string().trim().min(1).max(200),
    content: canvasTaskContentSchema.optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    position: z
      .object({
        x: z.number(),
        y: z.number(),
      })
      .optional(),
  })
  .passthrough()

const canvasTaskUpdateSpecSchema = z
  .object({
    nodeId: nonEmptyIdSchema.optional(),
    clientId: z.string().trim().min(1).max(200).optional(),
    target: canvasNodeRefSchema.optional(),
    title: z.string().trim().max(200).optional(),
    kindHint: canvasNodeKindSchema.optional(),
    content: canvasTaskContentSchema.optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const canvasTaskConnectionSpecSchema = z
  .object({
    source: z.string().trim().min(1).max(200).optional(),
    target: z.string().trim().min(1).max(200).optional(),
    sourceNode: canvasNodeRefSchema.optional(),
    targetNode: canvasNodeRefSchema.optional(),
  })
  .passthrough()

const canvasTaskReferenceRoleSchema = z.enum([
  'text_context',
  'image_reference',
  'video_first_frame',
  'video_last_frame',
  'audio_reference',
])

const canvasTaskReferenceSpecSchema = z
  .object({
    consumer: z.union([z.string().trim().min(1).max(200), canvasNodeRefSchema]),
    source: z.union([
      z.string().trim().min(1).max(200),
      canvasNodeRefSchema,
      canvasResourceRefSchema,
    ]),
    role: canvasTaskReferenceRoleSchema,
  })
  .passthrough()

const canvasTaskLayoutSchema = z
  .object({
    nodeIds: z
      .array(z.union([z.string().trim().min(1).max(200), canvasNodeRefSchema]))
      .max(100)
      .optional(),
    direction: z.enum(['horizontal', 'vertical', 'grid']).optional().default('horizontal'),
  })
  .optional()

const canvasTaskGenerationSchema = z
  .object({
    targets: z
      .array(z.union([z.string().trim().min(1).max(200), canvasNodeRefSchema]))
      .max(100)
      .optional()
      .default([]),
    outputType: canvasOutputTypeSchema.optional(),
    prompt: z.string().trim().max(12000).optional(),
    references: z.array(canvasResourceRefSchema).max(100).optional().default([]),
    params: z.record(z.string(), z.unknown()).optional(),
    runAfterApply: z.boolean().optional().default(true),
  })
  .optional()

const canvasTaskPayloadSchema = z
  .object({
    taskType: hermesCanvasTaskTypeSchema,
    goal: z.string().trim().min(1).max(4000).optional(),
    target: canvasTargetSchema,
    nodes: z.array(canvasTaskNodeSpecSchema).max(100).optional().default([]),
    updates: z.array(canvasTaskUpdateSpecSchema).max(100).optional().default([]),
    deleteNodeIds: z.array(nonEmptyIdSchema).max(100).optional().default([]),
    connections: z.array(canvasTaskConnectionSpecSchema).max(200).optional().default([]),
    references: z.array(canvasTaskReferenceSpecSchema).max(200).optional().default([]),
    layout: canvasTaskLayoutSchema,
    generation: canvasTaskGenerationSchema,
    content: canvasTaskContentSchema.optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    outputType: canvasOutputTypeSchema.optional(),
    nodeRefs: z.array(canvasNodeRefSchema).max(100).optional().default([]),
    resourceRefs: z.array(canvasResourceRefSchema).max(100).optional().default([]),
    constraints: z.array(z.string().trim().min(1).max(1000)).max(50).optional().default([]),
    expectedChanges: z.array(z.string().trim().min(1).max(1000)).max(50).optional().default([]),
    userPreferences: z.array(z.string().trim().min(1).max(1000)).max(50).optional().default([]),
    risk: hermesCanvasAgentRiskSchema.optional().default('medium'),
  })
  .strict()

export type HermesCanvasTaskPayload = z.output<typeof canvasTaskPayloadSchema>

export const hermesCanvasTaskRunBodySchema = z.object({
  operation: hermesCanvasTaskOperationSchema,
  userId: nonEmptyIdSchema,
  organizationId: nonEmptyIdSchema.optional(),
  workspaceId: workspaceIdSchema,
  workflowId: workflowIdSchema,
  chatId: nonEmptyIdSchema.optional(),
  message: z.string().trim().min(1, 'Message is required').max(12000),
  selectedNodeIds: z.array(nonEmptyIdSchema).max(200).optional().default([]),
  queryType: hermesCanvasTaskQueryTypeSchema,
  nodeId: nonEmptyIdSchema.optional(),
  query: z.string().trim().max(1000).optional(),
  task: canvasTaskPayloadSchema.optional(),
  pendingActionId: nonEmptyIdSchema.optional(),
  previewActionId: nonEmptyIdSchema.optional(),
  traceId: z.string().trim().min(1).max(200).optional(),
  hermesRunId: z.string().trim().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type HermesCanvasTaskRunBody = z.input<typeof hermesCanvasTaskRunBodySchema>
export type ParsedHermesCanvasTaskRunBody = z.output<typeof hermesCanvasTaskRunBodySchema>

const hermesCanvasTaskQueryResultSchema = z
  .object({
    queryType: z.enum([
      'summary',
      'read_node',
      'read_selected',
      'search_nodes',
      'inspect_schema',
      'inspect_capabilities',
    ]),
    workflowId: z.string(),
    workspaceId: z.string(),
    nodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    summaryText: z.string().optional(),
    nodes: z.array(hermesCanvasNodeSummarySchema).optional(),
    node: hermesCanvasNodeDetailSchema.nullable().optional(),
    selectedNodeDetails: z.array(hermesCanvasNodeDetailSchema).optional(),
    schema: z
      .object({
        kind: z.string(),
        blockType: z.string(),
        capabilities: z.record(z.string(), z.unknown()),
        writableFields: z.array(z.string()),
        editableFields: z.array(z.record(z.string(), z.unknown())),
        generation: z.record(z.string(), z.unknown()),
      })
      .optional(),
    capabilityManifest: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const hermesCanvasTaskRunSuccessResponseSchema = z.object({
  success: z.literal(true),
  operation: hermesCanvasTaskOperationSchema,
  answer: z.string(),
  risk: hermesCanvasAgentRiskSchema.optional(),
  requiresConfirmation: z.boolean().optional(),
  pendingActionId: nonEmptyIdSchema.optional(),
  proposedPatchSummary: z.string().optional(),
  changedNodeIds: z.array(z.string()).optional(),
  generatedNodeIds: z.array(z.string()).optional(),
  createdNodeMap: z.record(z.string(), z.string()).optional(),
  generatedOutputs: z.array(z.record(z.string(), z.unknown())).optional(),
  usedReferences: z.array(z.record(z.string(), z.unknown())).optional(),
  previewActionId: nonEmptyIdSchema.optional(),
  verificationSummary: z.string().optional(),
  auditId: z.string(),
  traceId: z.string().optional(),
  queryResult: hermesCanvasTaskQueryResultSchema.optional(),
})

const hermesCanvasTaskRunErrorResponseSchema = z.object({
  success: z.literal(false),
  operation: hermesCanvasTaskOperationSchema.optional(),
  answer: z.string(),
  risk: hermesCanvasAgentRiskSchema.optional(),
  requiresConfirmation: z.boolean().optional(),
  pendingActionId: nonEmptyIdSchema.optional(),
  proposedPatchSummary: z.string().optional(),
  changedNodeIds: z.array(z.string()).optional(),
  generatedNodeIds: z.array(z.string()).optional(),
  createdNodeMap: z.record(z.string(), z.string()).optional(),
  generatedOutputs: z.array(z.record(z.string(), z.unknown())).optional(),
  usedReferences: z.array(z.record(z.string(), z.unknown())).optional(),
  previewActionId: nonEmptyIdSchema.optional(),
  verificationSummary: z.string().optional(),
  auditId: z.string(),
  traceId: z.string().optional(),
  errorCode: hermesCanvasAgentErrorCodeSchema.or(z.literal('INVALID_TASK')),
  error: z.string(),
})

export const hermesCanvasTaskRunResponseSchema = z.discriminatedUnion('success', [
  hermesCanvasTaskRunSuccessResponseSchema,
  hermesCanvasTaskRunErrorResponseSchema,
])
export type HermesCanvasTaskRunResponse = z.output<typeof hermesCanvasTaskRunResponseSchema>

export const hermesCanvasTaskRunContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/hermes/canvas-task/run',
  body: hermesCanvasTaskRunBodySchema,
  response: {
    mode: 'json',
    schema: hermesCanvasTaskRunResponseSchema,
    status: [200, 400, 401, 403, 404, 500],
  },
})
