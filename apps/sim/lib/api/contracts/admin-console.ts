import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'

const lastQueryValue = (value: unknown) => (Array.isArray(value) ? value.at(-1) : value)

const adminConsoleIdParamsSchema = z.object({
  id: z.string().min(1, 'id is required'),
})

const adminConsolePaginationQuerySchema = z.object({
  limit: z.preprocess(lastQueryValue, z.coerce.number().int().min(1).max(100)).default(25),
  offset: z.preprocess(lastQueryValue, z.coerce.number().int().min(0)).default(0),
  search: z.preprocess(lastQueryValue, z.string().trim()).optional().default(''),
})

const adminConsoleDateRangeQuerySchema = z.object({
  startDate: z.preprocess(lastQueryValue, z.string().datetime()).optional(),
  endDate: z.preprocess(lastQueryValue, z.string().datetime()).optional(),
})

export const adminConsoleProviderIdSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'gemini',
  'mistral',
  'fireworks',
  'zhipu',
  'cerebras',
  'cohere',
  'deepseek',
  'ark',
  'evolink',
  'dashscope',
  'azure-openai',
  'azure-anthropic',
])

const adminConsoleUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  banned: z.boolean(),
  banReason: z.string().nullable(),
  createdAt: z.string(),
  lastActive: z.string().nullable(),
  currentUsageLimit: z.number(),
  currentPeriodCost: z.number(),
  remainingUsage: z.number(),
  creditBalance: z.number(),
  billingBlocked: z.boolean(),
})

const adminConsoleUserDetailSchema = adminConsoleUserSchema.extend({
  totalCost: z.number(),
  totalTokensUsed: z.number(),
  totalManualExecutions: z.number(),
  totalApiCalls: z.number(),
  totalWebhookTriggers: z.number(),
  totalScheduledExecutions: z.number(),
  totalChatExecutions: z.number(),
  totalCopilotCost: z.number(),
  currentPeriodCopilotCost: z.number(),
  organizationMemberships: z.array(
    z.object({
      organizationId: z.string(),
      organizationName: z.string(),
      role: z.string(),
    })
  ),
})

const adminConsoleListUsersResponseSchema = z.object({
  users: z.array(adminConsoleUserSchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  }),
})

export const adminConsoleUserActionBodySchema = z
  .object({
    role: z.enum(['user', 'admin']).optional(),
    banned: z.boolean().optional(),
    banReason: z.string().max(500).nullable().optional(),
    billingBlocked: z.boolean().optional(),
    currentUsageLimit: z.number().min(0, 'currentUsageLimit must be non-negative').optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine(
    (body) =>
      body.role !== undefined ||
      body.banned !== undefined ||
      body.billingBlocked !== undefined ||
      body.currentUsageLimit !== undefined,
    { message: 'At least one user setting must be provided' }
  )

export type AdminConsoleUserActionBody = z.input<typeof adminConsoleUserActionBodySchema>

export const adminConsoleCreateUserBodySchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
  email: z.string().trim().email('email must be valid').max(255),
  password: z.string().min(8, 'password must be at least 8 characters').max(100),
  role: z.enum(['user', 'admin']).optional().default('user'),
})

export type AdminConsoleCreateUserBody = z.input<typeof adminConsoleCreateUserBodySchema>

export const adminConsoleCreditActionBodySchema = z.object({
  amount: z.number().finite('amount must be finite'),
  operation: z.enum(['add', 'remove']),
  reason: z.string().trim().max(500).optional(),
})

export type AdminConsoleCreditActionBody = z.input<typeof adminConsoleCreditActionBodySchema>

const adminConsoleCreditActionResponseSchema = z.object({
  success: z.literal(true),
  userId: z.string(),
  operation: z.enum(['add', 'remove']),
  amount: z.number(),
  creditBalance: z.number(),
})

const adminConsoleOrganizationMembershipSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  role: z.enum(['owner', 'admin', 'member']).or(z.string()),
})

const adminConsoleWorkgroupMembershipSchema = z.object({
  workgroupId: z.string(),
  workgroupName: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  role: z.enum(['admin', 'member']),
})

const adminConsoleOrganizationOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
})

const adminConsoleWorkgroupOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
})

const adminConsoleUserMembershipsResponseSchema = z.object({
  userId: z.string(),
  organizationMemberships: z.array(adminConsoleOrganizationMembershipSchema),
  workgroupMemberships: z.array(adminConsoleWorkgroupMembershipSchema),
  organizations: z.array(adminConsoleOrganizationOptionSchema),
  workgroups: z.array(adminConsoleWorkgroupOptionSchema),
})

export const adminConsoleSetOrganizationMembershipBodySchema = z.object({
  organizationId: z.string().min(1, 'organizationId is required'),
  role: z.enum(['owner', 'admin', 'member']),
  reason: z.string().trim().max(500).optional(),
})

export type AdminConsoleSetOrganizationMembershipBody = z.input<
  typeof adminConsoleSetOrganizationMembershipBodySchema
>

export const adminConsoleSetWorkgroupMembershipBodySchema = z.object({
  workgroupId: z.string().min(1, 'workgroupId is required'),
  role: z.enum(['admin', 'member']),
  reason: z.string().trim().max(500).optional(),
})

export type AdminConsoleSetWorkgroupMembershipBody = z.input<
  typeof adminConsoleSetWorkgroupMembershipBodySchema
>

export const adminConsoleProviderKeySchema = z.object({
  id: z.string(),
  providerId: adminConsoleProviderIdSchema,
  label: z.string(),
  maskedKey: z.string(),
  status: z.enum(['active', 'disabled']),
  isDefault: z.boolean(),
  priority: z.number(),
  lastUsedAt: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminConsoleProviderSummarySchema = z.object({
  providerId: adminConsoleProviderIdSchema,
  label: z.string(),
  capabilities: z.array(z.string()),
  keys: z.array(adminConsoleProviderKeySchema),
})

export const adminConsoleModelServiceSchema = z.object({
  id: z.string(),
  consumer: z.enum(['sim-canvas', 'hermes-agent', 'hermes-ppt']),
  capability: z.string(),
  family: z.string(),
  providerId: adminConsoleProviderIdSchema,
  serviceKind: z.string(),
  baseUrl: z.string().url().nullable(),
  enabledModelIds: z.array(z.string()),
  defaultModelId: z.string().nullable(),
  status: z.enum(['active', 'disabled']),
  priority: z.number(),
  configVersion: z.number(),
})
export const adminConsoleUpsertModelServiceBodySchema = z.object({
  functionId: z
    .enum([
      'canvas-text',
      'canvas-image',
      'canvas-audio',
      'canvas-video',
      'hermes-agent',
      'hermes-ppt-image',
    ])
    .optional(),
  consumer: z.enum(['sim-canvas', 'hermes-agent', 'hermes-ppt']),
  capability: z.string().min(1),
  family: z.string().min(1),
  providerId: adminConsoleProviderIdSchema,
  serviceKind: z.string().min(1),
  baseUrl: z.string().url().nullable().optional(),
  enabledModelIds: z.array(z.string().min(1)).min(1),
  defaultModelId: z.string().min(1).nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
})
export type AdminConsoleUpsertModelServiceBody = z.input<
  typeof adminConsoleUpsertModelServiceBodySchema
>

export const adminConsoleUpdateModelServiceBodySchema = adminConsoleUpsertModelServiceBodySchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'At least one service field is required')
export type AdminConsoleUpdateModelServiceBody = z.input<
  typeof adminConsoleUpdateModelServiceBodySchema
>

export const adminConsoleCreateProviderKeyBodySchema = z.object({
  providerId: adminConsoleProviderIdSchema,
  label: z.string().trim().min(1, 'label is required').max(120),
  apiKey: z.string().min(1, 'apiKey is required'),
  isDefault: z.boolean().optional().default(false),
  priority: z.number().int().min(0).max(1000).optional().default(0),
})

export type AdminConsoleCreateProviderKeyBody = z.input<
  typeof adminConsoleCreateProviderKeyBodySchema
>

export const adminConsoleUpdateProviderKeyBodySchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    apiKey: z.string().min(1).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    isDefault: z.boolean().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine(
    (body) =>
      body.label !== undefined ||
      body.apiKey !== undefined ||
      body.status !== undefined ||
      body.isDefault !== undefined ||
      body.priority !== undefined,
    { message: 'At least one provider key setting must be provided' }
  )

export type AdminConsoleUpdateProviderKeyBody = z.input<
  typeof adminConsoleUpdateProviderKeyBodySchema
>

export const adminConsoleUsageSourceSchema = z.enum([
  'workflow',
  'wand',
  'copilot',
  'workspace-chat',
  'mcp_copilot',
  'mothership_block',
  'knowledge-base',
  'voice-input',
])

const simpleJsonValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

const adminConsoleUsageLogSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userEmail: z.string().nullable(),
  category: z.enum(['model', 'fixed']),
  source: adminConsoleUsageSourceSchema,
  description: z.string(),
  cost: z.number(),
  metadata: z.record(z.string(), simpleJsonValueSchema).nullable(),
  workspaceId: z.string().nullable(),
  workflowId: z.string().nullable(),
  executionId: z.string().nullable(),
  createdAt: z.string(),
})

const adminConsoleUsageSummaryRowSchema = z.object({
  key: z.string(),
  totalCost: z.number(),
  count: z.number(),
})

const adminConsoleUsageResponseSchema = z.object({
  logs: z.array(adminConsoleUsageLogSchema),
  summary: z.object({
    totalCost: z.number(),
    totalCount: z.number(),
    bySource: z.array(adminConsoleUsageSummaryRowSchema),
    byUser: z.array(adminConsoleUsageSummaryRowSchema),
    byProvider: z.array(adminConsoleUsageSummaryRowSchema),
  }),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    total: z.number(),
  }),
})

const adminConsoleUsageQuerySchema = adminConsolePaginationQuerySchema
  .omit({ search: true })
  .merge(adminConsoleDateRangeQuerySchema)
  .extend({
    userId: z.preprocess(lastQueryValue, z.string().trim()).optional(),
    providerId: z.preprocess(lastQueryValue, adminConsoleProviderIdSchema).optional(),
    source: z.preprocess(lastQueryValue, adminConsoleUsageSourceSchema).optional(),
    workspaceId: z.preprocess(lastQueryValue, z.string().trim()).optional(),
  })

const auditSnapshotSchema = z.record(
  z.string(),
  z.union([simpleJsonValueSchema, z.array(simpleJsonValueSchema)])
)

const adminConsoleAuditEventSchema = z.object({
  id: z.string(),
  actorUserId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  action: z.string(),
  reason: z.string().nullable(),
  before: auditSnapshotSchema.nullable(),
  after: auditSnapshotSchema.nullable(),
  createdAt: z.string(),
})

const adminConsoleAuditEventsQuerySchema = adminConsolePaginationQuerySchema
  .omit({ search: true })
  .merge(adminConsoleDateRangeQuerySchema)
  .extend({
    targetType: z.preprocess(lastQueryValue, z.string().trim()).optional(),
    targetId: z.preprocess(lastQueryValue, z.string().trim()).optional(),
  })

export const adminConsoleListUsersContract = defineRouteContract({
  method: 'GET',
  path: '/api/admin-console/users',
  query: adminConsolePaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminConsoleListUsersResponseSchema,
  },
})

export const adminConsoleCreateUserContract = defineRouteContract({
  method: 'POST',
  path: '/api/admin-console/users',
  body: adminConsoleCreateUserBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), user: adminConsoleUserSchema }),
  },
})

export const adminConsoleGetUserContract = defineRouteContract({
  method: 'GET',
  path: '/api/admin-console/users/[id]',
  params: adminConsoleIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ user: adminConsoleUserDetailSchema }),
  },
})

export const adminConsoleUpdateUserContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/admin-console/users/[id]',
  params: adminConsoleIdParamsSchema,
  body: adminConsoleUserActionBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), user: adminConsoleUserDetailSchema }),
  },
})

export const adminConsoleApplyCreditsContract = defineRouteContract({
  method: 'POST',
  path: '/api/admin-console/users/[id]/credits',
  params: adminConsoleIdParamsSchema,
  body: adminConsoleCreditActionBodySchema,
  response: {
    mode: 'json',
    schema: adminConsoleCreditActionResponseSchema,
  },
})

export const adminConsoleUserMembershipsContract = defineRouteContract({
  method: 'GET',
  path: '/api/admin-console/users/[id]/memberships',
  params: adminConsoleIdParamsSchema,
  response: {
    mode: 'json',
    schema: adminConsoleUserMembershipsResponseSchema,
  },
})

export const adminConsoleSetOrganizationMembershipContract = defineRouteContract({
  method: 'PUT',
  path: '/api/admin-console/users/[id]/organizations',
  params: adminConsoleIdParamsSchema,
  body: adminConsoleSetOrganizationMembershipBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      memberships: adminConsoleUserMembershipsResponseSchema,
    }),
  },
})

export const adminConsoleSetWorkgroupMembershipContract = defineRouteContract({
  method: 'PUT',
  path: '/api/admin-console/users/[id]/workgroups',
  params: adminConsoleIdParamsSchema,
  body: adminConsoleSetWorkgroupMembershipBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      memberships: adminConsoleUserMembershipsResponseSchema,
    }),
  },
})

export const adminConsoleListProviderKeysContract = defineRouteContract({
  method: 'GET',
  path: '/api/admin-console/provider-keys',
  response: {
    mode: 'json',
    schema: z.object({
      keys: z.array(adminConsoleProviderKeySchema),
      providers: z.array(adminConsoleProviderSummarySchema),
    }),
  },
})

export const adminConsoleCreateProviderKeyContract = defineRouteContract({
  method: 'POST',
  path: '/api/admin-console/provider-keys',
  body: adminConsoleCreateProviderKeyBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), key: adminConsoleProviderKeySchema }),
  },
})

export const adminConsoleUpdateProviderKeyContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/admin-console/provider-keys/[id]',
  params: adminConsoleIdParamsSchema,
  body: adminConsoleUpdateProviderKeyBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), key: adminConsoleProviderKeySchema }),
  },
})

export const adminConsoleDeleteProviderKeyContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/admin-console/provider-keys/[id]',
  params: adminConsoleIdParamsSchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})

export const adminConsoleListModelServicesContract = defineRouteContract({
  method: 'GET',
  path: '/api/admin-console/model-services',
  response: {
    mode: 'json',
    schema: z.object({ services: z.array(adminConsoleModelServiceSchema) }),
  },
})
export const adminConsoleUpsertModelServiceContract = defineRouteContract({
  method: 'POST',
  path: '/api/admin-console/model-services',
  body: adminConsoleUpsertModelServiceBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), service: adminConsoleModelServiceSchema }),
  },
})
export const adminConsoleUpdateModelServiceContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/admin-console/model-services/[id]',
  params: adminConsoleIdParamsSchema,
  body: adminConsoleUpdateModelServiceBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), service: adminConsoleModelServiceSchema }),
  },
})
export const adminConsoleDeleteModelServiceContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/admin-console/model-services/[id]',
  params: adminConsoleIdParamsSchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})
export const adminConsoleTestModelServiceContract = defineRouteContract({
  method: 'POST',
  path: '/api/admin-console/model-services/[id]/test',
  params: adminConsoleIdParamsSchema,
  response: { mode: 'json', schema: z.object({ success: z.boolean(), message: z.string() }) },
})

export const adminConsoleUsageContract = defineRouteContract({
  method: 'GET',
  path: '/api/admin-console/usage',
  query: adminConsoleUsageQuerySchema,
  response: {
    mode: 'json',
    schema: adminConsoleUsageResponseSchema,
  },
})

export const adminConsoleAuditEventsContract = defineRouteContract({
  method: 'GET',
  path: '/api/admin-console/audit-events',
  query: adminConsoleAuditEventsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      events: z.array(adminConsoleAuditEventSchema),
      pagination: z.object({ limit: z.number(), offset: z.number(), total: z.number() }),
    }),
  },
})

export type AdminConsoleListUsersResponse = ContractJsonResponse<
  typeof adminConsoleListUsersContract
>
export type AdminConsoleUser = z.output<typeof adminConsoleUserSchema>
export type AdminConsoleUserDetail = z.output<typeof adminConsoleUserDetailSchema>
export type AdminConsoleUserMembershipsResponse = ContractJsonResponse<
  typeof adminConsoleUserMembershipsContract
>
export type AdminConsoleProviderKey = z.output<typeof adminConsoleProviderKeySchema>
export type AdminConsoleModelService = z.output<typeof adminConsoleModelServiceSchema>
export type AdminConsoleUsageResponse = ContractJsonResponse<typeof adminConsoleUsageContract>
export type AdminConsoleAuditEventsResponse = ContractJsonResponse<
  typeof adminConsoleAuditEventsContract
>
