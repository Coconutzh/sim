import { z } from 'zod'
import { agentCodeSchema } from '@/lib/api/contracts/collaboration'
import { nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const hermesSkillProposalOperationSchema = z.enum([
  'list_published',
  'read',
  'propose_create',
  'propose_patch',
  'submit_review',
  'compare',
])
export type HermesSkillProposalOperation = z.output<typeof hermesSkillProposalOperationSchema>

export const hermesSkillProposalTypeSchema = z.enum(['create', 'patch', 'deprecate'])
export type HermesSkillProposalType = z.output<typeof hermesSkillProposalTypeSchema>

export const hermesSkillProposalRiskSchema = z.enum(['low', 'medium', 'high'])
export type HermesSkillProposalRisk = z.output<typeof hermesSkillProposalRiskSchema>

export const hermesSkillProposalStatusSchema = z.enum([
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'published',
])
export type HermesSkillProposalStatus = z.output<typeof hermesSkillProposalStatusSchema>

export const hermesSkillProposalErrorCodeSchema = z.enum([
  'UNAUTHENTICATED_SERVICE',
  'USER_PERMISSION_DENIED',
  'ORGANIZATION_NOT_FOUND',
  'SKILL_NOT_FOUND',
  'PROPOSAL_NOT_FOUND',
  'INVALID_PROPOSAL',
  'INTERNAL_ERROR',
])
export type HermesSkillProposalErrorCode = z.output<typeof hermesSkillProposalErrorCodeSchema>

const hermesSkillProposalCommonBodySchema = z.object({
  userId: nonEmptyIdSchema,
  organizationId: nonEmptyIdSchema,
  traceId: z.string().trim().min(1).max(200).optional(),
  hermesRunId: z.string().trim().min(1).max(200).optional(),
})

const hermesSkillProposalListPublishedBodySchema = hermesSkillProposalCommonBodySchema.extend({
  operation: z.literal('list_published'),
  agentCode: agentCodeSchema.optional(),
  workgroupId: nonEmptyIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
})

const hermesSkillProposalReadBodySchema = hermesSkillProposalCommonBodySchema.extend({
  operation: z.literal('read'),
  skillId: nonEmptyIdSchema,
})

const skillProposalEvidenceRefsSchema = z
  .array(z.string().trim().min(1).max(500))
  .max(50)
  .optional()
  .default([])

const hermesSkillProposalProposeCreateBodySchema = hermesSkillProposalCommonBodySchema.extend({
  operation: z.literal('propose_create'),
  workspaceId: nonEmptyIdSchema.optional(),
  workgroupId: nonEmptyIdSchema.optional(),
  agentCode: agentCodeSchema.optional(),
  title: z.string().trim().min(1, 'Proposal title is required').max(160),
  description: z.string().trim().min(1, 'Proposal description is required').max(2000),
  proposedContent: z.string().trim().min(1, 'proposedContent is required').max(60000),
  evidenceRefs: skillProposalEvidenceRefsSchema,
  risk: hermesSkillProposalRiskSchema.optional().default('low'),
  status: z.enum(['draft', 'pending_review']).optional().default('pending_review'),
})

const hermesSkillProposalProposePatchBodySchema = hermesSkillProposalCommonBodySchema
  .extend({
    operation: z.literal('propose_patch'),
    workspaceId: nonEmptyIdSchema.optional(),
    workgroupId: nonEmptyIdSchema.optional(),
    agentCode: agentCodeSchema.optional(),
    targetSkillId: nonEmptyIdSchema,
    title: z.string().trim().min(1, 'Proposal title is required').max(160),
    description: z.string().trim().min(1, 'Proposal description is required').max(2000),
    proposedContent: z.string().trim().max(60000).optional(),
    proposedDiff: z.string().trim().max(60000).optional(),
    evidenceRefs: skillProposalEvidenceRefsSchema,
    risk: hermesSkillProposalRiskSchema.optional().default('medium'),
    status: z.enum(['draft', 'pending_review']).optional().default('pending_review'),
  })
  .superRefine((value, context) => {
    if (!value.proposedContent && !value.proposedDiff) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposedContent'],
        message: 'proposedContent or proposedDiff is required',
      })
    }
  })

const hermesSkillProposalSubmitReviewBodySchema = hermesSkillProposalCommonBodySchema.extend({
  operation: z.literal('submit_review'),
  proposalId: nonEmptyIdSchema,
})

const hermesSkillProposalCompareBodySchema = hermesSkillProposalCommonBodySchema.extend({
  operation: z.literal('compare'),
  proposalId: nonEmptyIdSchema,
})

export const hermesSkillProposalRunBodySchema = z.discriminatedUnion('operation', [
  hermesSkillProposalListPublishedBodySchema,
  hermesSkillProposalReadBodySchema,
  hermesSkillProposalProposeCreateBodySchema,
  hermesSkillProposalProposePatchBodySchema,
  hermesSkillProposalSubmitReviewBodySchema,
  hermesSkillProposalCompareBodySchema,
])
export type HermesSkillProposalRunBody = z.input<typeof hermesSkillProposalRunBodySchema>
export type ParsedHermesSkillProposalRunBody = z.output<typeof hermesSkillProposalRunBodySchema>

export const hermesPublishedSkillSchema = z.object({
  id: nonEmptyIdSchema,
  name: z.string(),
  description: z.string(),
  content: z.string().optional(),
  agentCode: agentCodeSchema,
  workgroupId: nonEmptyIdSchema,
  workgroupName: z.string(),
  teamWorkspaceId: nonEmptyIdSchema,
  enabledByDefault: z.boolean(),
})
export type HermesPublishedSkill = z.output<typeof hermesPublishedSkillSchema>

export const hermesSkillProposalSchema = z.object({
  id: nonEmptyIdSchema,
  organizationId: nonEmptyIdSchema,
  workspaceId: z.string().nullable(),
  workgroupId: z.string().nullable(),
  agentCode: agentCodeSchema.nullable(),
  sourceUserId: nonEmptyIdSchema,
  sourceHermesRunId: z.string().nullable(),
  targetSkillId: z.string().nullable(),
  publishedSkillId: z.string().nullable(),
  type: hermesSkillProposalTypeSchema,
  title: z.string(),
  description: z.string(),
  proposedContent: z.string().nullable(),
  proposedDiff: z.string().nullable(),
  evidenceRefs: z.array(z.string()),
  risk: hermesSkillProposalRiskSchema,
  status: hermesSkillProposalStatusSchema,
  reviewerId: z.string().nullable(),
  reviewNote: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type HermesSkillProposal = z.output<typeof hermesSkillProposalSchema>

export const hermesSkillRevisionSchema = z.object({
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
export type HermesSkillRevision = z.output<typeof hermesSkillRevisionSchema>

export const hermesSkillProposalComparisonSchema = z.object({
  proposalId: nonEmptyIdSchema,
  targetSkillId: z.string().nullable(),
  targetContent: z.string().nullable(),
  proposedContent: z.string().nullable(),
  proposedDiff: z.string().nullable(),
})
export type HermesSkillProposalComparison = z.output<typeof hermesSkillProposalComparisonSchema>

const hermesSkillProposalRunSuccessResponseSchema = z.object({
  success: z.literal(true),
  operation: hermesSkillProposalOperationSchema,
  answer: z.string(),
  auditId: nonEmptyIdSchema,
  traceId: z.string().optional(),
  skills: z.array(hermesPublishedSkillSchema).optional(),
  skill: hermesPublishedSkillSchema.optional(),
  proposal: hermesSkillProposalSchema.optional(),
  comparison: hermesSkillProposalComparisonSchema.optional(),
})

const hermesSkillProposalRunErrorResponseSchema = z.object({
  success: z.literal(false),
  operation: hermesSkillProposalOperationSchema.optional(),
  answer: z.string(),
  auditId: nonEmptyIdSchema,
  traceId: z.string().optional(),
  errorCode: hermesSkillProposalErrorCodeSchema,
  error: z.string(),
})

export const hermesSkillProposalRunResponseSchema = z.discriminatedUnion('success', [
  hermesSkillProposalRunSuccessResponseSchema,
  hermesSkillProposalRunErrorResponseSchema,
])
export type HermesSkillProposalRunResponse = z.output<typeof hermesSkillProposalRunResponseSchema>

export const hermesSkillProposalRunContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/hermes/skill-proposals/run',
  body: hermesSkillProposalRunBodySchema,
  response: {
    mode: 'json',
    schema: hermesSkillProposalRunResponseSchema,
    status: [200, 400, 401, 403, 404, 500],
  },
})
