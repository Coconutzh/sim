import { z } from 'zod'
import {
  hermesPublishedSkillSchema,
  hermesSkillProposalSchema,
  hermesSkillProposalStatusSchema,
} from '@/lib/api/contracts/internal/hermes-skill-proposals'
import { nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const skillProposalOrganizationParamsSchema = z.object({
  id: nonEmptyIdSchema,
})
export type SkillProposalOrganizationParams = z.output<typeof skillProposalOrganizationParamsSchema>

export const skillProposalParamsSchema = skillProposalOrganizationParamsSchema.extend({
  proposalId: nonEmptyIdSchema,
})
export type SkillProposalParams = z.output<typeof skillProposalParamsSchema>

export const skillRollbackParamsSchema = skillProposalOrganizationParamsSchema.extend({
  skillId: nonEmptyIdSchema,
})
export type SkillRollbackParams = z.output<typeof skillRollbackParamsSchema>

export const skillProposalListQuerySchema = z.object({
  status: hermesSkillProposalStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
})
export type SkillProposalListQueryInput = z.input<typeof skillProposalListQuerySchema>
export type SkillProposalListQuery = z.output<typeof skillProposalListQuerySchema>

export const skillProposalReviewBodySchema = z.object({
  action: z.enum(['approve', 'reject']),
  reviewNote: z.string().trim().max(2000).optional(),
})
export type SkillProposalReviewBody = z.input<typeof skillProposalReviewBodySchema>

export const skillProposalPublishBodySchema = z.object({
  enableBinding: z.boolean().optional().default(true),
})
export type SkillProposalPublishBody = z.input<typeof skillProposalPublishBodySchema>

export const skillRollbackBodySchema = z.object({
  version: z.coerce.number().int().min(1),
  reason: z.string().trim().max(2000).optional(),
})
export type SkillRollbackBody = z.input<typeof skillRollbackBodySchema>

export const skillRevisionSchema = z.object({
  id: nonEmptyIdSchema,
  skillId: nonEmptyIdSchema,
  version: z.number().int().min(1),
  content: z.string(),
  diff: z.string().nullable(),
  authorType: z.enum(['user', 'admin', 'hermes']),
  authorId: z.string().nullable(),
  sourceProposalId: z.string().nullable(),
  rollbackTargetRevisionId: z.string().nullable(),
  createdAt: z.string(),
})
export type SkillRevision = z.output<typeof skillRevisionSchema>

export const listSkillProposalsResponseSchema = z.object({
  proposals: z.array(hermesSkillProposalSchema),
})
export type ListSkillProposalsResponse = z.output<typeof listSkillProposalsResponseSchema>

export const reviewSkillProposalResponseSchema = z.object({
  proposal: hermesSkillProposalSchema,
})
export type ReviewSkillProposalResponse = z.output<typeof reviewSkillProposalResponseSchema>

export const publishSkillProposalResponseSchema = z.object({
  proposal: hermesSkillProposalSchema,
  skill: hermesPublishedSkillSchema,
  revision: skillRevisionSchema,
})
export type PublishSkillProposalResponse = z.output<typeof publishSkillProposalResponseSchema>

export const rollbackSkillRevisionResponseSchema = z.object({
  skill: hermesPublishedSkillSchema,
  revision: skillRevisionSchema,
})
export type RollbackSkillRevisionResponse = z.output<typeof rollbackSkillRevisionResponseSchema>

export const listSkillProposalsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/skill-proposals',
  params: skillProposalOrganizationParamsSchema,
  query: skillProposalListQuerySchema,
  response: {
    mode: 'json',
    schema: listSkillProposalsResponseSchema,
    status: [200, 401, 403, 500],
  },
})

export const reviewSkillProposalContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/skill-proposals/[proposalId]/review',
  params: skillProposalParamsSchema,
  body: skillProposalReviewBodySchema,
  response: {
    mode: 'json',
    schema: reviewSkillProposalResponseSchema,
    status: [200, 400, 401, 403, 404, 500],
  },
})

export const publishSkillProposalContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/skill-proposals/[proposalId]/publish',
  params: skillProposalParamsSchema,
  body: skillProposalPublishBodySchema,
  response: {
    mode: 'json',
    schema: publishSkillProposalResponseSchema,
    status: [200, 400, 401, 403, 404, 409, 500],
  },
})

export const rollbackSkillRevisionContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/skills/[skillId]/rollback',
  params: skillRollbackParamsSchema,
  body: skillRollbackBodySchema,
  response: {
    mode: 'json',
    schema: rollbackSkillRevisionResponseSchema,
    status: [200, 400, 401, 403, 404, 500],
  },
})
