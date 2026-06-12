import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import {
  productionTaskAttachmentBodySchema,
  productionTaskAttachmentSchema,
  productionTaskUserSchema,
  productionTaskWorkgroupSchema,
} from '@/lib/api/contracts/production-tasks'
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

export const productionShowcaseSourceNodeVariantSchema = z.enum([
  'text',
  'image',
  'video',
  'audio',
  'document',
  'file',
  'other',
])
export type ProductionShowcaseSourceNodeVariant = z.output<
  typeof productionShowcaseSourceNodeVariantSchema
>

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

export const productionShowcaseItemQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})
export type ProductionShowcaseItemQuery = z.output<typeof productionShowcaseItemQuerySchema>

export const createProductionShowcaseItemBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    title: z.string().trim().min(1, 'title is required').max(160),
    description: z.string().trim().max(2000).nullable().optional(),
    category: productionShowcaseCategorySchema.default('other'),
    content: z.string().trim().max(10000).nullable().optional(),
    sourceWorkflowId: z.string().trim().min(1).nullable().optional(),
    sourceNodeId: z.string().trim().min(1).nullable().optional(),
    sourceNodeVariant: productionShowcaseSourceNodeVariantSchema.nullable().optional(),
    taskId: z.string().trim().min(1).nullable().optional(),
    submissionId: z.string().trim().min(1).nullable().optional(),
    attachments: z.array(productionTaskAttachmentBodySchema).max(20).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.sourceNodeId && !value.sourceWorkflowId) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceWorkflowId'],
        message: 'sourceWorkflowId is required when sourceNodeId is provided',
      })
    }
    if (value.sourceNodeVariant && !value.sourceNodeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceNodeId'],
        message: 'sourceNodeId is required when sourceNodeVariant is provided',
      })
    }
  })
export type CreateProductionShowcaseItemBody = z.input<
  typeof createProductionShowcaseItemBodySchema
>

export const updateProductionShowcaseItemBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    title: z.string().trim().min(1, 'title cannot be empty').max(160).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    category: productionShowcaseCategorySchema.optional(),
    content: z.string().trim().max(10000).nullable().optional(),
    attachments: z.array(productionTaskAttachmentBodySchema).max(20).optional(),
  })
  .superRefine((value, ctx) => {
    const hasUpdate =
      value.title !== undefined ||
      value.description !== undefined ||
      value.category !== undefined ||
      value.content !== undefined ||
      value.attachments !== undefined

    if (!hasUpdate) {
      ctx.addIssue({
        code: 'custom',
        path: ['title'],
        message: 'Provide at least one showcase item field to update',
      })
    }
  })
export type UpdateProductionShowcaseItemBody = z.input<
  typeof updateProductionShowcaseItemBodySchema
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
  sourceWorkflowId: z.string().nullable(),
  sourceNodeId: z.string().nullable(),
  sourceNodeVariant: productionShowcaseSourceNodeVariantSchema.nullable(),
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
    canEdit: z.boolean(),
  }),
})
export type ProductionShowcaseItem = z.output<typeof productionShowcaseItemSchema>

export const productionShowcaseItemsResponseSchema = z.object({
  items: z.array(productionShowcaseItemSchema),
})
export type ProductionShowcaseItemsResponse = z.output<typeof productionShowcaseItemsResponseSchema>

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

export const getProductionShowcaseItemContract = defineRouteContract({
  method: 'GET',
  path: '/api/production-showcase-items/[itemId]',
  params: productionShowcaseItemParamsSchema,
  query: productionShowcaseItemQuerySchema,
  response: { mode: 'json', schema: productionShowcaseItemResponseSchema },
})

export const updateProductionShowcaseItemContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/production-showcase-items/[itemId]',
  params: productionShowcaseItemParamsSchema,
  body: updateProductionShowcaseItemBodySchema,
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
