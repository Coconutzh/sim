import { z } from 'zod'
import { hermesUserMemoryCategorySchema } from '@/lib/api/contracts/internal/hermes-user-memory'
import { nonEmptyIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export type HermesUserMemoryAdminCategory = z.output<typeof hermesUserMemoryCategorySchema>

export const hermesUserMemoryOrganizationParamsSchema = z.object({
  id: nonEmptyIdSchema,
})
export type HermesUserMemoryOrganizationParams = z.output<
  typeof hermesUserMemoryOrganizationParamsSchema
>

export const hermesUserMemoryDeleteParamsSchema = hermesUserMemoryOrganizationParamsSchema.extend({
  memoryId: nonEmptyIdSchema,
})
export type HermesUserMemoryDeleteParams = z.output<typeof hermesUserMemoryDeleteParamsSchema>

export const listHermesUserMemoriesQuerySchema = z.object({
  userId: nonEmptyIdSchema.optional(),
  workspaceId: workspaceIdSchema.optional(),
  category: hermesUserMemoryCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
})
export type ListHermesUserMemoriesQueryInput = z.input<typeof listHermesUserMemoriesQuerySchema>
export type ListHermesUserMemoriesQuery = z.output<typeof listHermesUserMemoriesQuerySchema>

export const hermesUserMemoryAdminEntrySchema = z.object({
  id: nonEmptyIdSchema,
  userId: nonEmptyIdSchema,
  organizationId: nonEmptyIdSchema,
  workspaceId: z.string().nullable(),
  category: hermesUserMemoryCategorySchema,
  content: z.string(),
  source: z.string(),
  sourceHermesRunId: z.string().nullable(),
  sourceTraceId: z.string().nullable(),
  evidenceRefs: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastSeenAt: z.string(),
})
export type HermesUserMemoryAdminEntry = z.output<typeof hermesUserMemoryAdminEntrySchema>

export const listHermesUserMemoriesResponseSchema = z.object({
  memories: z.array(hermesUserMemoryAdminEntrySchema),
})
export type ListHermesUserMemoriesResponse = z.output<typeof listHermesUserMemoriesResponseSchema>

export const deleteHermesUserMemoryBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
})
export type DeleteHermesUserMemoryBody = z.input<typeof deleteHermesUserMemoryBodySchema>

export const deleteHermesUserMemoryResponseSchema = z.object({
  memory: hermesUserMemoryAdminEntrySchema,
  deletedAt: z.string(),
})
export type DeleteHermesUserMemoryResponse = z.output<typeof deleteHermesUserMemoryResponseSchema>

export const listHermesUserMemoriesContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/hermes/user-memories',
  params: hermesUserMemoryOrganizationParamsSchema,
  query: listHermesUserMemoriesQuerySchema,
  response: {
    mode: 'json',
    schema: listHermesUserMemoriesResponseSchema,
    status: [200, 401, 403, 500],
  },
})

export const deleteHermesUserMemoryContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/hermes/user-memories/[memoryId]',
  params: hermesUserMemoryDeleteParamsSchema,
  body: deleteHermesUserMemoryBodySchema,
  response: {
    mode: 'json',
    schema: deleteHermesUserMemoryResponseSchema,
    status: [200, 401, 403, 404, 500],
  },
})
