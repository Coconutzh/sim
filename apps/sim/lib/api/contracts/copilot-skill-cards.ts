import { z } from 'zod'
import { agentCodeSchema } from '@/lib/api/contracts/collaboration'
import { nonEmptyIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const copilotSkillCardActionKindSchema = z.enum(['prompt', 'create_task', 'submit_task'])
export type CopilotSkillCardActionKind = z.output<typeof copilotSkillCardActionKindSchema>

export const copilotSkillCardParamsSchema = z.object({
  cardId: nonEmptyIdSchema,
})

export const organizationCopilotSkillCardParamsSchema = z.object({
  id: nonEmptyIdSchema,
})

export const runtimeCopilotSkillCardsQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})
export type RuntimeCopilotSkillCardsQuery = z.output<typeof runtimeCopilotSkillCardsQuerySchema>

export const organizationCopilotSkillCardsQuerySchema = z.object({
  agentCode: agentCodeSchema.optional(),
  workgroupId: nonEmptyIdSchema.optional(),
})
export type OrganizationCopilotSkillCardsQuery = z.output<
  typeof organizationCopilotSkillCardsQuerySchema
>

export const copilotSkillCardTaskDraftSchema = z.object({
  title: z.string().trim().min(1, 'task title is required').max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  dueAtOffsetHours: z.number().int().min(1).max(24 * 90).nullable().optional(),
})
export type CopilotSkillCardTaskDraft = z.output<typeof copilotSkillCardTaskDraftSchema>

export const createCopilotSkillCardBodySchema = z.object({
  agentCode: agentCodeSchema,
  workgroupId: nonEmptyIdSchema.nullable().optional(),
  title: z.string().trim().min(1, 'title is required').max(40),
  description: z.string().trim().min(1, 'description is required').max(120),
  prompt: z.string().trim().min(1, 'prompt is required').max(4000),
  actionKind: copilotSkillCardActionKindSchema.optional().default('prompt'),
  taskDraft: copilotSkillCardTaskDraftSchema.nullable().optional(),
  enabled: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).max(10000).optional().default(0),
})
export type CreateCopilotSkillCardBody = z.input<typeof createCopilotSkillCardBodySchema>

export const updateCopilotSkillCardBodySchema = z.object({
  title: z.string().trim().min(1, 'title cannot be empty').max(40).optional(),
  description: z.string().trim().min(1, 'description cannot be empty').max(120).optional(),
  prompt: z.string().trim().min(1, 'prompt cannot be empty').max(4000).optional(),
  actionKind: copilotSkillCardActionKindSchema.optional(),
  taskDraft: copilotSkillCardTaskDraftSchema.nullable().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
})
export type UpdateCopilotSkillCardBody = z.input<typeof updateCopilotSkillCardBodySchema>

export const copilotSkillCardWorkgroupSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const copilotSkillCardSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  agentCode: agentCodeSchema,
  workgroupId: z.string().nullable(),
  workgroup: copilotSkillCardWorkgroupSchema.nullable(),
  title: z.string(),
  description: z.string(),
  prompt: z.string(),
  actionKind: copilotSkillCardActionKindSchema,
  taskDraft: copilotSkillCardTaskDraftSchema.nullable(),
  enabled: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type CopilotSkillCard = z.output<typeof copilotSkillCardSchema>

export const copilotSkillCardsResponseSchema = z.object({
  cards: z.array(copilotSkillCardSchema),
})
export type CopilotSkillCardsResponse = z.output<typeof copilotSkillCardsResponseSchema>

export const copilotSkillCardResponseSchema = z.object({
  card: copilotSkillCardSchema,
})
export type CopilotSkillCardResponse = z.output<typeof copilotSkillCardResponseSchema>

export const listRuntimeCopilotSkillCardsContract = defineRouteContract({
  method: 'GET',
  path: '/api/copilot/skill-cards',
  query: runtimeCopilotSkillCardsQuerySchema,
  response: { mode: 'json', schema: copilotSkillCardsResponseSchema },
})

export const listOrganizationCopilotSkillCardsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/copilot-skill-cards',
  params: organizationCopilotSkillCardParamsSchema,
  query: organizationCopilotSkillCardsQuerySchema,
  response: { mode: 'json', schema: copilotSkillCardsResponseSchema },
})

export const createCopilotSkillCardContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/copilot-skill-cards',
  params: organizationCopilotSkillCardParamsSchema,
  body: createCopilotSkillCardBodySchema,
  response: { mode: 'json', schema: copilotSkillCardResponseSchema },
})

export const updateCopilotSkillCardContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/copilot/skill-cards/[cardId]',
  params: copilotSkillCardParamsSchema,
  body: updateCopilotSkillCardBodySchema,
  response: { mode: 'json', schema: copilotSkillCardResponseSchema },
})

export const deleteCopilotSkillCardContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/copilot/skill-cards/[cardId]',
  params: copilotSkillCardParamsSchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})
