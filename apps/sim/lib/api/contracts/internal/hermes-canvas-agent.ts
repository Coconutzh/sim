import { z } from 'zod'
import {
  nonEmptyIdSchema,
  workflowIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const hermesCanvasAgentModeSchema = z.enum(['read_only', 'propose', 'apply_after_confirm'])
export type HermesCanvasAgentMode = z.output<typeof hermesCanvasAgentModeSchema>

export const hermesCanvasAgentRiskSchema = z.enum(['low', 'medium', 'high'])
export type HermesCanvasAgentRisk = z.output<typeof hermesCanvasAgentRiskSchema>

export const hermesCanvasAgentErrorCodeSchema = z.enum([
  'UNAUTHENTICATED_SERVICE',
  'USER_PERMISSION_DENIED',
  'WORKSPACE_NOT_FOUND',
  'WORKFLOW_NOT_FOUND',
  'CANVAS_CONTEXT_UNAVAILABLE',
  'PATCH_VALIDATION_FAILED',
  'CONFIRMATION_REQUIRED',
  'CONFIRMATION_EXPIRED',
  'TOOL_EXECUTION_FAILED',
  'VERIFY_FAILED',
  'GENERATION_FAILED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
])
export type HermesCanvasAgentErrorCode = z.output<typeof hermesCanvasAgentErrorCodeSchema>

const canvasNodeCapabilitiesSchema = z.object({
  canRead: z.boolean(),
  canWrite: z.boolean(),
  canGenerate: z.boolean(),
  canReferenceFile: z.boolean(),
})

export const hermesCanvasNodeSummarySchema = z.object({
  id: nonEmptyIdSchema,
  name: z.string(),
  blockType: z.string(),
  kind: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  selected: z.boolean(),
  summary: z.string(),
  capabilities: canvasNodeCapabilitiesSchema,
})
export type HermesCanvasNodeSummary = z.output<typeof hermesCanvasNodeSummarySchema>

export const hermesCanvasNodeDetailSchema = hermesCanvasNodeSummarySchema.extend({
  fields: z.record(z.string(), z.unknown()),
  textContent: z.string().optional(),
  file: z.record(z.string(), z.unknown()).nullable().optional(),
})
export type HermesCanvasNodeDetail = z.output<typeof hermesCanvasNodeDetailSchema>

export const hermesCanvasAgentRunBodySchema = z.object({
  userId: nonEmptyIdSchema,
  organizationId: nonEmptyIdSchema.optional(),
  workspaceId: workspaceIdSchema,
  workflowId: workflowIdSchema,
  chatId: nonEmptyIdSchema.optional(),
  message: z.string().trim().min(1, 'Message is required').max(12000),
  selectedNodeIds: z.array(nonEmptyIdSchema).max(200).optional().default([]),
  mode: hermesCanvasAgentModeSchema.optional().default('read_only'),
  confirmationMode: z.enum(['auto', 'manual']).optional().default('manual'),
  pendingActionId: nonEmptyIdSchema.optional(),
  traceId: z.string().trim().min(1).max(200).optional(),
  hermesRunId: z.string().trim().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type HermesCanvasAgentRunBody = z.input<typeof hermesCanvasAgentRunBodySchema>
export type ParsedHermesCanvasAgentRunBody = z.output<typeof hermesCanvasAgentRunBodySchema>

const hermesCanvasAgentRunSuccessResponseSchema = z.object({
  success: z.literal(true),
  answer: z.string(),
  mode: hermesCanvasAgentModeSchema,
  intent: z.string().optional(),
  risk: hermesCanvasAgentRiskSchema,
  requiresConfirmation: z.boolean(),
  pendingActionId: nonEmptyIdSchema.optional(),
  proposedPatchSummary: z.string().optional(),
  changedNodeIds: z.array(z.string()),
  generatedNodeIds: z.array(z.string()),
  verificationSummary: z.string().optional(),
  auditId: z.string(),
  traceId: z.string().optional(),
  canvas: z
    .object({
      workflowId: z.string(),
      workspaceId: z.string(),
      nodeCount: z.number().int().nonnegative(),
      edgeCount: z.number().int().nonnegative(),
      selectedNodeIds: z.array(z.string()),
      nodes: z.array(hermesCanvasNodeSummarySchema),
      selectedNodeDetails: z.array(hermesCanvasNodeDetailSchema),
      summaryText: z.string(),
    })
    .optional(),
})

const hermesCanvasAgentRunErrorResponseSchema = z.object({
  success: z.literal(false),
  answer: z.string(),
  mode: hermesCanvasAgentModeSchema.optional(),
  intent: z.string().optional(),
  risk: hermesCanvasAgentRiskSchema.optional(),
  requiresConfirmation: z.boolean().optional(),
  pendingActionId: nonEmptyIdSchema.optional(),
  proposedPatchSummary: z.string().optional(),
  changedNodeIds: z.array(z.string()).optional(),
  generatedNodeIds: z.array(z.string()).optional(),
  verificationSummary: z.string().optional(),
  auditId: z.string(),
  traceId: z.string().optional(),
  errorCode: hermesCanvasAgentErrorCodeSchema,
  error: z.string(),
})

export const hermesCanvasAgentRunResponseSchema = z.discriminatedUnion('success', [
  hermesCanvasAgentRunSuccessResponseSchema,
  hermesCanvasAgentRunErrorResponseSchema,
])
export type HermesCanvasAgentRunResponse = z.output<typeof hermesCanvasAgentRunResponseSchema>

export const hermesCanvasAgentRunContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/hermes/canvas-agent/run',
  body: hermesCanvasAgentRunBodySchema,
  response: {
    mode: 'json',
    schema: hermesCanvasAgentRunResponseSchema,
    status: [200, 400, 401, 403, 404, 500],
  },
})
