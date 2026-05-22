import { z } from 'zod'
import {
  nonEmptyIdSchema,
  workflowIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workflowStateSchema } from '@/lib/api/contracts/workflows'

export const workgroupRoleSchema = z.enum(['admin', 'member'])
export const agentCodeSchema = z.enum([
  'chief_director',
  'show_director',
  'stage_design',
  'visual',
  'broadcast_camera',
  'lighting_sound',
  'special_effects',
  'music',
  'props_costume',
  'production',
])
export const publicationVisibilitySchema = z.enum(['organization', 'selected_workgroups'])
export const publicationStatusSchema = z.enum([
  'draft',
  'published',
  'superseded',
  'archived',
  'retracted',
])

export const organizationParamsSchema = z.object({ id: nonEmptyIdSchema })
export const workgroupParamsSchema = z.object({ workgroupId: nonEmptyIdSchema })
export const workgroupMemberParamsSchema = z.object({
  workgroupId: nonEmptyIdSchema,
  userId: nonEmptyIdSchema,
})
export const publicationParamsSchema = z.object({ publicationVersionId: nonEmptyIdSchema })

export const disciplineSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  agentCode: agentCodeSchema,
  sortOrder: z.number(),
})
export type Discipline = z.output<typeof disciplineSchema>

export const agentProfileSchema = z.object({
  code: agentCodeSchema,
  name: z.string(),
  description: z.string(),
  defaultSystemPrompt: z.string().optional(),
  disciplineCodes: z.array(z.string()).optional(),
  defaultSkills: z
    .array(z.object({ id: z.string(), name: z.string(), description: z.string().nullable() }))
    .optional(),
})
export type AgentProfile = z.output<typeof agentProfileSchema>

export const workgroupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  organizationId: z.string(),
  discipline: z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    agentCode: agentCodeSchema,
  }),
  role: workgroupRoleSchema,
  teamWorkspaceId: z.string(),
  memberCount: z.number(),
})
export type WorkgroupSummary = z.output<typeof workgroupSummarySchema>

export const workgroupAdminSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  disciplineId: z.string(),
  disciplineName: z.string(),
  agentCode: agentCodeSchema,
  teamWorkspaceId: z.string(),
  memberCount: z.number(),
  currentUserRole: z.enum(['admin', 'member', 'org_admin']).nullable(),
})
export type WorkgroupAdminSummary = z.output<typeof workgroupAdminSummarySchema>

export const canvasWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  logoUrl: z.string().nullable(),
  ownerId: z.string(),
  organizationId: z.string().nullable(),
  workgroupId: z.string().nullable(),
  workspaceMode: z.enum(['personal', 'organization', 'grandfathered_shared']),
  billedAccountUserId: z.string(),
  allowPersonalApiKeys: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type CanvasWorkspace = z.output<typeof canvasWorkspaceSchema>

export const workgroupMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  role: workgroupRoleSchema,
  joinedAt: z.string(),
})
export type WorkgroupMember = z.output<typeof workgroupMemberSchema>

export const createWorkgroupBodySchema = z.object({
  name: z.string().trim().min(1, 'Team name is required').max(120),
  disciplineId: nonEmptyIdSchema,
})
export type CreateWorkgroupBody = z.input<typeof createWorkgroupBodySchema>

export const setActiveWorkgroupBodySchema = z.object({ workgroupId: nonEmptyIdSchema })
export type SetActiveWorkgroupBody = z.input<typeof setActiveWorkgroupBodySchema>

export const upsertWorkgroupMemberBodySchema = z
  .object({
    userId: nonEmptyIdSchema.optional(),
    email: z.string().trim().email('Valid email is required').optional(),
    role: workgroupRoleSchema,
  })
  .superRefine((value, ctx) => {
    if (!value.userId && !value.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'User ID or email is required',
        path: ['userId'],
      })
    }
  })
export type UpsertWorkgroupMemberBody = z.input<typeof upsertWorkgroupMemberBodySchema>

export const updateWorkgroupMemberBodySchema = z.object({ role: workgroupRoleSchema })
export type UpdateWorkgroupMemberBody = z.input<typeof updateWorkgroupMemberBodySchema>

export const createPersonalWorkspaceBodySchema = z.object({
  name: z.string().trim().min(1, 'Canvas name is required').max(120),
})
export type CreatePersonalWorkspaceBody = z.input<typeof createPersonalWorkspaceBodySchema>

export const publishWorkflowVersionBodySchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  visibility: publicationVisibilitySchema.default('organization'),
  targetWorkgroupIds: z.array(nonEmptyIdSchema).optional().default([]),
  parentVersionId: z.string().nullable().optional(),
})
export type PublishWorkflowVersionBody = z.input<typeof publishWorkflowVersionBodySchema>

export const publicationListQuerySchema = z.object({
  disciplineCode: z.string().optional(),
  sourceWorkgroupId: z.string().optional(),
  agentCode: agentCodeSchema.optional(),
  status: publicationStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export const publicationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  sourceWorkgroup: z.object({ id: z.string(), name: z.string() }),
  sourceDiscipline: z.object({ code: z.string(), name: z.string() }),
  agentCode: agentCodeSchema,
  versionNumber: z.number(),
  status: publicationStatusSchema,
  visibility: publicationVisibilitySchema,
  publishedBy: z.object({ id: z.string(), name: z.string(), avatarUrl: z.string().nullable() }),
  publishedAt: z.string(),
})
export type PublicationSummary = z.output<typeof publicationSummarySchema>

export const publicationSnapshotMetadataSchema = z
  .object({
    sourceWorkflowName: z.string().nullable().optional(),
    sourceWorkflowDescription: z.string().nullable().optional(),
  })
  .catchall(z.unknown())
export type PublicationSnapshotMetadata = z.output<typeof publicationSnapshotMetadataSchema>

export const publicationDetailSchema = publicationSummarySchema.omit({ publishedBy: true }).extend({
  parentVersionId: z.string().nullable(),
  snapshotState: workflowStateSchema,
  snapshotMetadata: publicationSnapshotMetadataSchema,
})
export type PublicationDetail = z.output<typeof publicationDetailSchema>

export const publicationTreeSchema = z.object({
  rootVersionId: z.string(),
  versions: z.array(
    z.object({
      id: z.string(),
      parentVersionId: z.string().nullable(),
      title: z.string(),
      description: z.string().nullable(),
      versionNumber: z.number(),
      status: publicationStatusSchema,
      visibility: publicationVisibilitySchema,
      sourceWorkgroup: z.object({ id: z.string(), name: z.string() }),
      sourceDiscipline: z.object({ code: z.string(), name: z.string() }),
      agentCode: agentCodeSchema,
      dependsOnPublicationIds: z.array(z.string()),
      sourceWorkgroupName: z.string(),
      sourceDisciplineName: z.string(),
      publishedAt: z.string(),
    })
  ),
})
export type PublicationTree = z.output<typeof publicationTreeSchema>

export const updatePublicationLifecycleBodySchema = z.object({
  action: z.enum(['archive', 'retract']),
  reason: z.string().trim().max(1000).optional(),
})
export type UpdatePublicationLifecycleBody = z.input<typeof updatePublicationLifecycleBodySchema>

export const publicationLifecycleSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: publicationStatusSchema,
  archivedAt: z.string().nullable(),
  retractedAt: z.string().nullable(),
  lifecycleUpdatedAt: z.string(),
  publishedAt: z.string(),
})
export type PublicationLifecycle = z.output<typeof publicationLifecycleSchema>

export const agentSkillBindingSchema = z.object({
  id: z.string().nullable(),
  skillId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  scope: z.enum(['team_override']),
})
export type AgentSkillBinding = z.output<typeof agentSkillBindingSchema>

export const updateAgentSkillBindingBodySchema = z.object({
  skillId: nonEmptyIdSchema,
  enabled: z.boolean(),
})
export type UpdateAgentSkillBindingBody = z.input<typeof updateAgentSkillBindingBodySchema>

export const copySelectionBodySchema = z.object({
  source: z.object({
    type: z.enum(['personal', 'team', 'showcase']),
    workflowId: workflowIdSchema.optional(),
    publicationVersionId: nonEmptyIdSchema.optional(),
  }),
  target: z.object({
    type: z.enum(['personal', 'team']),
    workspaceId: workspaceIdSchema,
    workflowId: workflowIdSchema,
  }),
  selection: z.object({
    blockIds: z.array(z.string()).default([]),
    edgeIds: z.array(z.string()).default([]),
  }),
  placement: z
    .object({
      offsetX: z.number().finite().min(-2000).max(2000).default(80),
      offsetY: z.number().finite().min(-2000).max(2000).default(80),
    })
    .optional()
    .default({ offsetX: 80, offsetY: 80 }),
})
export type CopySelectionBody = z.input<typeof copySelectionBodySchema>

export const listDisciplinesContract = defineRouteContract({
  method: 'GET',
  path: '/api/disciplines',
  response: { mode: 'json', schema: z.object({ disciplines: z.array(disciplineSchema) }) },
})

export const listAgentProfilesContract = defineRouteContract({
  method: 'GET',
  path: '/api/agents/profiles',
  response: { mode: 'json', schema: z.object({ agents: z.array(agentProfileSchema) }) },
})

export const getCopilotAgentProfileContract = defineRouteContract({
  method: 'GET',
  path: '/api/copilot/agent-profile',
  query: z.object({ workspaceId: workspaceIdSchema }),
  response: {
    mode: 'json',
    schema: z.object({
      agent: z.object({
        code: agentCodeSchema,
        name: z.string(),
        description: z.string(),
        systemPrompt: z.string(),
      }),
      discipline: z.object({ id: z.string(), code: z.string(), name: z.string() }),
      workgroup: z.object({ id: z.string(), name: z.string() }),
      skills: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          enabled: z.boolean(),
        })
      ),
    }),
  },
})

export const listMyWorkgroupsContract = defineRouteContract({
  method: 'GET',
  path: '/api/me/workgroups',
  response: {
    mode: 'json',
    schema: z.object({
      workgroups: z.array(workgroupSummarySchema),
      defaultWorkgroupId: z.string().nullable(),
    }),
  },
})

export const setActiveWorkgroupContract = defineRouteContract({
  method: 'POST',
  path: '/api/me/active-workgroup',
  body: setActiveWorkgroupBodySchema,
  response: { mode: 'json', schema: z.object({ activeWorkgroupId: z.string() }) },
})

export const listOrganizationWorkgroupsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/workgroups',
  params: organizationParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ workgroups: z.array(workgroupAdminSummarySchema) }),
  },
})

export const createOrganizationWorkgroupContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/workgroups',
  params: organizationParamsSchema,
  body: createWorkgroupBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      workgroup: z.object({
        id: z.string(),
        name: z.string(),
        disciplineId: z.string(),
        teamWorkspaceId: z.string(),
      }),
    }),
  },
})

export const getWorkgroupMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/workgroups/[workgroupId]/members',
  params: workgroupParamsSchema,
  response: { mode: 'json', schema: z.object({ members: z.array(workgroupMemberSchema) }) },
})

export const addWorkgroupMemberContract = defineRouteContract({
  method: 'POST',
  path: '/api/workgroups/[workgroupId]/members',
  params: workgroupParamsSchema,
  body: upsertWorkgroupMemberBodySchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})

export const updateWorkgroupMemberContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workgroups/[workgroupId]/members/[userId]',
  params: workgroupMemberParamsSchema,
  body: updateWorkgroupMemberBodySchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})

export const removeWorkgroupMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workgroups/[workgroupId]/members/[userId]',
  params: workgroupMemberParamsSchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})

export const getPersonalWorkspaceContract = defineRouteContract({
  method: 'GET',
  path: '/api/workgroups/[workgroupId]/personal-workspace',
  params: workgroupParamsSchema,
  response: { mode: 'json', schema: z.object({ workspace: canvasWorkspaceSchema }) },
})

export const createPersonalWorkspaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/workgroups/[workgroupId]/personal-workspace',
  params: workgroupParamsSchema,
  body: createPersonalWorkspaceBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      workspace: canvasWorkspaceSchema,
      defaultWorkflowId: workflowIdSchema,
    }),
  },
})

export const getTeamWorkspaceContract = defineRouteContract({
  method: 'GET',
  path: '/api/workgroups/[workgroupId]/team-workspace',
  params: workgroupParamsSchema,
  response: { mode: 'json', schema: z.object({ workspace: canvasWorkspaceSchema }) },
})

export const createTeamWorkspaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/workgroups/[workgroupId]/team-workspace',
  params: workgroupParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      workspace: canvasWorkspaceSchema,
      defaultWorkflowId: workflowIdSchema.nullable(),
    }),
  },
})

export const listWorkgroupAgentSkillsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workgroups/[workgroupId]/agent-skills',
  params: workgroupParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      agent: z.object({ code: agentCodeSchema, name: z.string(), description: z.string() }),
      skills: z.array(agentSkillBindingSchema),
    }),
  },
})

export const updateWorkgroupAgentSkillContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workgroups/[workgroupId]/agent-skills',
  params: workgroupParamsSchema,
  body: updateAgentSkillBindingBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ binding: agentSkillBindingSchema }),
  },
})

export const publishWorkflowVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/publish',
  params: z.object({ id: workflowIdSchema }),
  body: publishWorkflowVersionBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      publicationVersion: z.object({
        id: z.string(),
        title: z.string(),
        versionNumber: z.number(),
        parentVersionId: z.string().nullable(),
        publishedAt: z.string(),
      }),
    }),
  },
})

export const listShowcasePublicationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workgroups/[workgroupId]/published-workflows',
  params: workgroupParamsSchema,
  query: publicationListQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      publications: z.array(publicationSummarySchema),
      nextCursor: z.string().nullable(),
    }),
  },
})

export const getPublicationContract = defineRouteContract({
  method: 'GET',
  path: '/api/publications/[publicationVersionId]',
  params: publicationParamsSchema,
  response: { mode: 'json', schema: z.object({ publication: publicationDetailSchema }) },
})

export const updatePublicationLifecycleContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/publications/[publicationVersionId]',
  params: publicationParamsSchema,
  body: updatePublicationLifecycleBodySchema,
  response: { mode: 'json', schema: z.object({ publication: publicationLifecycleSchema }) },
})

export const getPublicationTreeContract = defineRouteContract({
  method: 'GET',
  path: '/api/publications/[publicationVersionId]/tree',
  params: publicationParamsSchema,
  response: { mode: 'json', schema: publicationTreeSchema },
})

export const copySelectionContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/copy-selection',
  params: z.object({ id: workflowIdSchema }),
  body: copySelectionBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      inserted: z.object({ blockIds: z.array(z.string()), edgeIds: z.array(z.string()) }),
      mappings: z.object({
        blockIds: z.record(z.string(), z.string()),
        edgeIds: z.record(z.string(), z.string()),
      }),
    }),
  },
})
