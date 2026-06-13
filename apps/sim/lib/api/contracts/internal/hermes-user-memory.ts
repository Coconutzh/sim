import { z } from 'zod'
import { nonEmptyIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const hermesUserMemoryOperationSchema = z.enum(['prefetch', 'sync_turn', 'write'])
export type HermesUserMemoryOperation = z.output<typeof hermesUserMemoryOperationSchema>

export const hermesUserMemoryCategorySchema = z.enum([
  'preference',
  'communication_style',
  'content_interest',
  'workflow_habit',
  'tool_habit',
  'correction',
  'other',
])
export type HermesUserMemoryCategory = z.output<typeof hermesUserMemoryCategorySchema>

export const hermesUserMemoryErrorCodeSchema = z.enum([
  'UNAUTHENTICATED_SERVICE',
  'USER_SCOPE_DENIED',
  'INVALID_MEMORY_CONTENT',
  'INTERNAL_ERROR',
])
export type HermesUserMemoryErrorCode = z.output<typeof hermesUserMemoryErrorCodeSchema>

const traceIdSchema = z.string().trim().min(1).max(200).optional()

const hermesUserMemoryCommonBodySchema = z.object({
  userId: nonEmptyIdSchema,
  organizationId: nonEmptyIdSchema,
  workspaceId: workspaceIdSchema.optional(),
  traceId: traceIdSchema,
  hermesRunId: traceIdSchema,
})

const hermesUserMemoryPrefetchBodySchema = hermesUserMemoryCommonBodySchema.extend({
  operation: z.literal('prefetch'),
  query: z.string().trim().min(1, 'Query is required').max(2000),
  limit: z.number().int().min(1).max(20).optional().default(8),
})

const hermesUserMemorySyncTurnBodySchema = hermesUserMemoryCommonBodySchema.extend({
  operation: z.literal('sync_turn'),
  sessionId: z.string().trim().min(1).max(200).optional(),
  userContent: z.string().trim().min(1, 'User content is required').max(12000),
  assistantContent: z.string().trim().max(12000).optional().default(''),
})

const hermesUserMemoryWriteBodySchema = hermesUserMemoryCommonBodySchema.extend({
  operation: z.literal('write'),
  content: z.string().trim().min(1, 'Memory content is required').max(1000),
  category: hermesUserMemoryCategorySchema.optional().default('preference'),
  evidenceRefs: z.array(z.string().trim().min(1).max(200)).max(20).optional().default([]),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
})

export const hermesUserMemoryRunBodySchema = z.discriminatedUnion('operation', [
  hermesUserMemoryPrefetchBodySchema,
  hermesUserMemorySyncTurnBodySchema,
  hermesUserMemoryWriteBodySchema,
])
export type HermesUserMemoryRunBody = z.input<typeof hermesUserMemoryRunBodySchema>
export type ParsedHermesUserMemoryRunBody = z.output<typeof hermesUserMemoryRunBodySchema>

export const hermesUserMemoryEntrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  organizationId: z.string(),
  workspaceId: z.string().nullable(),
  category: hermesUserMemoryCategorySchema,
  content: z.string(),
  source: z.string(),
  sourceHermesRunId: z.string().nullable(),
  sourceTraceId: z.string().nullable(),
  evidenceRefs: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastSeenAt: z.string(),
})
export type HermesUserMemoryEntry = z.output<typeof hermesUserMemoryEntrySchema>

const hermesUserMemoryRunSuccessResponseSchema = z.object({
  success: z.literal(true),
  operation: hermesUserMemoryOperationSchema,
  answer: z.string(),
  memories: z.array(hermesUserMemoryEntrySchema).optional(),
  context: z.string().optional(),
  created: z.number().int().nonnegative().optional(),
  skippedReason: z.string().optional(),
  memory: hermesUserMemoryEntrySchema.optional(),
  traceId: z.string().optional(),
})

const hermesUserMemoryRunErrorResponseSchema = z.object({
  success: z.literal(false),
  operation: hermesUserMemoryOperationSchema.optional(),
  answer: z.string(),
  errorCode: hermesUserMemoryErrorCodeSchema,
  error: z.string(),
  traceId: z.string().optional(),
})

export const hermesUserMemoryRunResponseSchema = z.discriminatedUnion('success', [
  hermesUserMemoryRunSuccessResponseSchema,
  hermesUserMemoryRunErrorResponseSchema,
])
export type HermesUserMemoryRunResponse = z.output<typeof hermesUserMemoryRunResponseSchema>

export const hermesUserMemoryRunContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/hermes/memory/run',
  body: hermesUserMemoryRunBodySchema,
  response: {
    mode: 'json',
    schema: hermesUserMemoryRunResponseSchema,
    status: [200, 400, 401, 403, 500],
  },
})
