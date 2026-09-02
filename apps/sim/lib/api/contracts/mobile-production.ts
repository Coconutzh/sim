import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import {
  productionShowcaseCategorySchema,
  productionShowcaseStatusSchema,
} from '@/lib/api/contracts/production-showcase-items'
import {
  productionTaskAttachmentSchema,
  productionTaskStatusSchema,
  productionTaskWorkgroupSchema,
} from '@/lib/api/contracts/production-tasks'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const mobileProjectParamsSchema = z.object({
  workspaceId: workspaceIdSchema,
})

export const mobileTaskFilterSchema = z.enum(['all', 'in_progress', 'pending_review', 'completed'])
export type MobileTaskFilter = z.output<typeof mobileTaskFilterSchema>

export const mobileProjectDetailQuerySchema = z.object({
  taskFilter: mobileTaskFilterSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(10000).optional(),
})
export type MobileProjectDetailQuery = z.output<typeof mobileProjectDetailQuerySchema>

export const mobileProjectMetricsSchema = z.object({
  total: z.number().int().min(0),
  completed: z.number().int().min(0),
  overdue: z.number().int().min(0),
  dueSoon: z.number().int().min(0),
  pendingReview: z.number().int().min(0),
  unreadMessages: z.number().int().min(0),
  adoptedResults: z.number().int().min(0),
})
export type MobileProjectMetrics = z.output<typeof mobileProjectMetricsSchema>

export const mobileProjectSummarySchema = z.object({
  workspaceId: z.string(),
  organizationId: z.string(),
  name: z.string(),
  status: z.enum(['active', 'completed']),
  estimatedDueAt: z.string().nullable(),
  canCreateProductionTask: z.boolean(),
  metrics: mobileProjectMetricsSchema,
})
export type MobileProjectSummary = z.output<typeof mobileProjectSummarySchema>

export const mobileTaskSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: productionTaskStatusSchema,
  dueAt: z.string().nullable(),
  delayReason: z.string().nullable(),
  unreadMessageCount: z.number().int().min(0),
  assigneeWorkgroup: productionTaskWorkgroupSchema,
})
export type MobileTaskSummary = z.output<typeof mobileTaskSummarySchema>

export const mobileShowcaseItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  content: z.string().nullable(),
  category: productionShowcaseCategorySchema,
  status: productionShowcaseStatusSchema,
  sourceWorkgroup: productionTaskWorkgroupSchema,
  createdAt: z.string(),
  attachments: z.array(productionTaskAttachmentSchema),
})
export type MobileShowcaseItem = z.output<typeof mobileShowcaseItemSchema>

export const mobileAssignableWorkgroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  disciplineName: z.string().nullable(),
})
export type MobileAssignableWorkgroup = z.output<typeof mobileAssignableWorkgroupSchema>

export const mobileProjectsResponseSchema = z.object({
  projects: z.array(mobileProjectSummarySchema),
})
export type MobileProjectsResponse = z.output<typeof mobileProjectsResponseSchema>

export const mobileProjectDetailResponseSchema = z.object({
  project: mobileProjectSummarySchema,
  tasks: z.array(mobileTaskSummarySchema),
  taskPage: z.object({
    total: z.number().int().min(0),
    offset: z.number().int().min(0),
    limit: z.number().int().min(1),
    hasMore: z.boolean(),
  }),
  showcaseItems: z.array(mobileShowcaseItemSchema),
  assignableWorkgroups: z.array(mobileAssignableWorkgroupSchema),
})
export type MobileProjectDetailResponse = z.output<typeof mobileProjectDetailResponseSchema>

export const listMobileProjectsContract = defineRouteContract({
  method: 'GET',
  path: '/api/mobile/production/projects',
  response: { mode: 'json', schema: mobileProjectsResponseSchema },
})

export const getMobileProjectContract = defineRouteContract({
  method: 'GET',
  path: '/api/mobile/production/projects/[workspaceId]',
  params: mobileProjectParamsSchema,
  query: mobileProjectDetailQuerySchema,
  response: { mode: 'json', schema: mobileProjectDetailResponseSchema },
})
