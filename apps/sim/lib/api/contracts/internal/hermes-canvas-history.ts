import { z } from 'zod'
import { hermesToolCallAuditStatusSchema } from '@/lib/api/contracts/hermes-tool-call-audits'
import { hermesCanvasAgentModeSchema } from '@/lib/api/contracts/internal/hermes-canvas-agent'
import {
  nonEmptyIdSchema,
  workflowIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const hermesCanvasHistoryQueryKindSchema = z
  .enum(['recent_operations', 'pending_actions', 'operation_detail'])
  .optional()
  .default('recent_operations')
export type HermesCanvasHistoryQueryKind = z.output<typeof hermesCanvasHistoryQueryKindSchema>

export const hermesCanvasHistoryQueryBodySchema = z.object({
  userId: nonEmptyIdSchema,
  organizationId: nonEmptyIdSchema.optional(),
  workspaceId: workspaceIdSchema,
  workflowId: workflowIdSchema,
  chatId: nonEmptyIdSchema.optional(),
  query: hermesCanvasHistoryQueryKindSchema,
  auditId: nonEmptyIdSchema.optional(),
  mode: hermesCanvasAgentModeSchema.optional(),
  status: hermesToolCallAuditStatusSchema.optional(),
  limit: z.number().int().min(1).max(50).optional().default(10),
  traceId: z.string().trim().min(1).max(200).optional(),
  hermesRunId: z.string().trim().min(1).max(200).optional(),
})
export type HermesCanvasHistoryQueryBody = z.input<typeof hermesCanvasHistoryQueryBodySchema>
export type ParsedHermesCanvasHistoryQueryBody = z.output<typeof hermesCanvasHistoryQueryBodySchema>

export const hermesCanvasHistoryItemSchema = z.object({
  auditId: nonEmptyIdSchema,
  traceId: z.string().nullable(),
  hermesRunId: z.string().nullable(),
  simRequestId: z.string().nullable(),
  toolName: z.string(),
  mode: z.string().nullable(),
  status: hermesToolCallAuditStatusSchema,
  risk: z.string().nullable(),
  requiresConfirmation: z.boolean().nullable(),
  pendingActionId: z.string().nullable(),
  changedNodeIds: z.array(z.string()),
  generatedNodeIds: z.array(z.string()),
  verificationSummary: z.string().nullable(),
  inputSummary: z.record(z.string(), z.unknown()),
  outputSummary: z.record(z.string(), z.unknown()),
  errorCode: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  evidenceRef: z.string(),
})
export type HermesCanvasHistoryItem = z.output<typeof hermesCanvasHistoryItemSchema>

export const hermesCanvasHistoryQueryResponseSchema = z.object({
  success: z.boolean(),
  traceId: z.string().optional(),
  scope: z.object({
    userId: z.string(),
    organizationId: z.string().optional(),
    workspaceId: z.string(),
    workflowId: z.string(),
    chatId: z.string().optional(),
    query: z.enum(['recent_operations', 'pending_actions', 'operation_detail']),
  }),
  summary: z.object({
    total: z.number().int().min(0),
    successCount: z.number().int().min(0),
    errorCount: z.number().int().min(0),
    pendingConfirmationCount: z.number().int().min(0),
    changedNodeIds: z.array(z.string()),
    generatedNodeIds: z.array(z.string()),
    latestVerificationSummary: z.string().nullable(),
  }),
  items: z.array(hermesCanvasHistoryItemSchema),
  evidenceRefs: z.array(z.string()),
  errorCode: z.string().optional(),
  error: z.string().optional(),
})
export type HermesCanvasHistoryQueryResponse = z.output<
  typeof hermesCanvasHistoryQueryResponseSchema
>

export const hermesCanvasHistoryQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/hermes/canvas-history/query',
  body: hermesCanvasHistoryQueryBodySchema,
  response: {
    mode: 'json',
    schema: hermesCanvasHistoryQueryResponseSchema,
    status: [200, 400, 401, 500],
  },
})
