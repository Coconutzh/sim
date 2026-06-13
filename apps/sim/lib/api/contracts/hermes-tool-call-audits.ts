import { z } from 'zod'
import { nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const hermesToolCallAuditOrganizationParamsSchema = z.object({
  id: nonEmptyIdSchema,
})
export type HermesToolCallAuditOrganizationParams = z.output<
  typeof hermesToolCallAuditOrganizationParamsSchema
>

export const hermesToolCallAuditStatusSchema = z.enum(['success', 'error', 'unauthenticated'])
export type HermesToolCallAuditStatus = z.output<typeof hermesToolCallAuditStatusSchema>

export const listHermesToolCallAuditsQuerySchema = z.object({
  status: hermesToolCallAuditStatusSchema.optional(),
  toolName: z.string().trim().min(1).max(120).optional(),
  workflowId: nonEmptyIdSchema.optional(),
  hermesRunId: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
})
export type ListHermesToolCallAuditsQueryInput = z.input<typeof listHermesToolCallAuditsQuerySchema>
export type ListHermesToolCallAuditsQuery = z.output<typeof listHermesToolCallAuditsQuerySchema>

export const hermesToolCallAuditSummarySchema = z.record(z.string(), z.unknown())
export type HermesToolCallAuditSummary = z.output<typeof hermesToolCallAuditSummarySchema>

export const hermesToolCallAuditEntrySchema = z.object({
  id: nonEmptyIdSchema,
  traceId: z.string().nullable(),
  hermesRunId: z.string().nullable(),
  simRequestId: z.string().nullable(),
  userId: z.string().nullable(),
  organizationId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  workflowId: z.string().nullable(),
  toolName: z.string(),
  mode: z.string().nullable(),
  operation: z.string().nullable(),
  status: hermesToolCallAuditStatusSchema,
  inputSummary: hermesToolCallAuditSummarySchema,
  outputSummary: hermesToolCallAuditSummarySchema,
  risk: z.string().nullable(),
  requiresConfirmation: z.boolean().nullable(),
  changedNodeIds: z.array(z.string()),
  generatedNodeIds: z.array(z.string()),
  verificationSummary: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
})
export type HermesToolCallAuditEntry = z.output<typeof hermesToolCallAuditEntrySchema>

export const listHermesToolCallAuditsResponseSchema = z.object({
  audits: z.array(hermesToolCallAuditEntrySchema),
})
export type ListHermesToolCallAuditsResponse = z.output<
  typeof listHermesToolCallAuditsResponseSchema
>

export const listHermesToolCallAuditsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/hermes/tool-call-audits',
  params: hermesToolCallAuditOrganizationParamsSchema,
  query: listHermesToolCallAuditsQuerySchema,
  response: {
    mode: 'json',
    schema: listHermesToolCallAuditsResponseSchema,
    status: [200, 401, 403, 500],
  },
})
