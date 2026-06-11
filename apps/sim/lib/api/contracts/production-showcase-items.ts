import { z } from 'zod'
import {
  productionTaskAttachmentBodySchema,
  productionTaskAttachmentSchema,
  productionTaskUserSchema,
  productionTaskWorkgroupSchema,
} from '@/lib/api/contracts/production-tasks'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const productionShowcaseCategorySchema = z.enum([
  'copywriting',
  'lighting',
  'sound',
  'stage_design',
  'visual',
  'video',
  'image',
  'document',
  'parameter',
  'other',
])
export type ProductionShowcaseCategory = z.output<typeof productionShowcaseCategorySchema>

export const productionShowcaseStatusSchema = z.enum(['published', 'withdrawn'])
export type ProductionShowcaseStatus = z.output<typeof productionShowcaseStatusSchema>

export const productionShowcaseItemParamsSchema = z.object({
  itemId: z.string().trim().min(1, 'itemId is required'),
})

export const productionShowcaseAttachmentParamsSchema = productionShowcaseItemParamsSchema.extend({
  attachmentId: z.string().trim().min(1, 'attachmentId is required'),
})

export const productionShowcaseItemsQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  category: productionShowcaseCategorySchema.optional(),
  includeWithdrawn: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
export type ProductionShowcaseItemsQuery = z.output<typeof productionShowcaseItemsQuerySchema>

export const createProductionShowcaseItemBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  title: z.string().trim().min(1, 'title is required').max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  category: productionShowcaseCategorySchema.default('other'),
  content: z.string().trim().max(10000).nullable().optional(),
  taskId: z.string().trim().min(1).nullable().optional(),
  submissionId: z.string().trim().min(1).nullable().optional(),
  attachments: z.array(productionTaskAttachmentBodySchema).max(20).optional(),
})
export type CreateProductionShowcaseItemBody = z.input<
  typeof createProductionShowcaseItemBodySchema
>

export const withdrawProductionShowcaseItemBodySchema = z.object({
  workspaceId: workspaceIdSchema,
})
export type WithdrawProductionShowcaseItemBody = z.input<
  typeof withdrawProductionShowcaseItemBodySchema
>

export const productionShowcaseItemSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  sourceWorkspaceId: z.string().nullable(),
  sourceWorkgroup: productionTaskWorkgroupSchema,
  taskId: z.string().nullable(),
  submissionId: z.string().nullable(),
  submissionVersionNumber: z.number().int().min(1).nullable(),
  title: z.string(),
  description: z.string().nullable(),
  category: productionShowcaseCategorySchema,
  content: z.string().nullable(),
  status: productionShowcaseStatusSchema,
  createdBy: productionTaskUserSchema.nullable(),
  withdrawnBy: productionTaskUserSchema.nullable(),
  withdrawnAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  attachments: z.array(productionTaskAttachmentSchema),
  permissions: z.object({
    canWithdraw: z.boolean(),
  }),
})
export type ProductionShowcaseItem = z.output<typeof productionShowcaseItemSchema>

export const productionShowcaseItemsResponseSchema = z.object({
  items: z.array(productionShowcaseItemSchema),
})
export type ProductionShowcaseItemsResponse = z.output<
  typeof productionShowcaseItemsResponseSchema
>

export const productionShowcaseItemResponseSchema = z.object({
  item: productionShowcaseItemSchema,
})
export type ProductionShowcaseItemResponse = z.output<typeof productionShowcaseItemResponseSchema>

export const listProductionShowcaseItemsContract = defineRouteContract({
  method: 'GET',
  path: '/api/production-showcase-items',
  query: productionShowcaseItemsQuerySchema,
  response: { mode: 'json', schema: productionShowcaseItemsResponseSchema },
})

export const createProductionShowcaseItemContract = defineRouteContract({
  method: 'POST',
  path: '/api/production-showcase-items',
  body: createProductionShowcaseItemBodySchema,
  response: { mode: 'json', schema: productionShowcaseItemResponseSchema },
})

export const withdrawProductionShowcaseItemContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/production-showcase-items/[itemId]',
  params: productionShowcaseItemParamsSchema,
  body: withdrawProductionShowcaseItemBodySchema,
  response: { mode: 'json', schema: productionShowcaseItemResponseSchema },
})

export const downloadProductionShowcaseAttachmentContract = defineRouteContract({
  method: 'GET',
  path: '/api/production-showcase-items/[itemId]/attachments/[attachmentId]/download',
  params: productionShowcaseAttachmentParamsSchema,
  response: { mode: 'binary' },
})
