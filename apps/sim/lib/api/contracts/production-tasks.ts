import { z } from 'zod'
import { agentCodeSchema } from '@/lib/api/contracts/collaboration'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const productionTaskStatusSchema = z.enum([
  'todo',
  'in_progress',
  'submitted',
  'approved',
  'changes_requested',
  'archived',
])
export type ProductionTaskStatus = z.output<typeof productionTaskStatusSchema>

export const productionTaskScopeSchema = z.enum(['auto', 'director', 'self', 'all'])
export type ProductionTaskScope = z.output<typeof productionTaskScopeSchema>

export const productionTaskAttachmentSourceSchema = z.enum(['url', 'workspace_file'])
export type ProductionTaskAttachmentSource = z.output<typeof productionTaskAttachmentSourceSchema>

export const productionTaskParamsSchema = z.object({
  taskId: z.string().trim().min(1, 'taskId is required'),
})

export const productionTaskAttachmentParamsSchema = productionTaskParamsSchema.extend({
  attachmentId: z.string().trim().min(1, 'attachmentId is required'),
})

export const productionTaskAttachmentKindSchema = z.enum(['task', 'submission'])
export type ProductionTaskAttachmentKind = z.output<typeof productionTaskAttachmentKindSchema>

export const productionTaskAttachmentDownloadQuerySchema = z.object({
  kind: productionTaskAttachmentKindSchema,
})

export const productionTasksQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  workflowId: z.string().trim().min(1).optional(),
  scope: productionTaskScopeSchema.optional(),
  status: productionTaskStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
export type ProductionTasksQuery = z.output<typeof productionTasksQuerySchema>

export const productionTaskAttachmentInputSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('url'),
    name: z.string().trim().min(1, 'attachment name is required').max(160),
    url: z.string().trim().min(1, 'attachment url is required').max(2048),
  }),
  z.object({
    source: z.literal('workspace_file'),
    name: z.string().trim().min(1, 'attachment name is required').max(160),
    workspaceFileId: z.string().trim().min(1, 'workspaceFileId is required'),
    url: z.string().trim().max(2048).optional(),
    key: z.string().trim().max(2048).optional(),
    contentType: z.string().trim().max(255).optional(),
    size: z.number().int().nonnegative().optional(),
  }),
])
export type ProductionTaskAttachmentInput = z.input<typeof productionTaskAttachmentInputSchema>

const legacyProductionTaskAttachmentInputSchema = z
  .object({
    name: z.string().trim().min(1, 'attachment name is required').max(160),
    url: z.string().trim().min(1, 'attachment url is required').max(2048),
  })
  .transform((value) => ({ ...value, source: 'url' as const }))

export const productionTaskAttachmentBodySchema = z.union([
  productionTaskAttachmentInputSchema,
  legacyProductionTaskAttachmentInputSchema,
])

export const createProductionTaskBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  sourceWorkflowId: z.string().trim().min(1).optional(),
  assigneeWorkgroupId: z.string().trim().min(1, 'assigneeWorkgroupId is required'),
  title: z.string().trim().min(1, 'title is required').max(160),
  description: z.string().trim().max(4000).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  dependencyTaskIds: z.array(z.string().trim().min(1)).max(50).optional(),
  attachments: z.array(productionTaskAttachmentBodySchema).max(20).optional(),
})
export type CreateProductionTaskBody = z.input<typeof createProductionTaskBodySchema>

export const updateProductionTaskBodySchema = z.object({
  title: z.string().trim().min(1, 'title cannot be empty').max(160).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assigneeWorkgroupId: z.string().trim().min(1).optional(),
  status: productionTaskStatusSchema.optional(),
  dependencyTaskIds: z.array(z.string().trim().min(1)).max(50).optional(),
  attachments: z.array(productionTaskAttachmentBodySchema).max(20).optional(),
})
export type UpdateProductionTaskBody = z.input<typeof updateProductionTaskBodySchema>

export const submitProductionTaskBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    workflowId: z.string().trim().min(1, 'workflowId is required').optional(),
    nodeId: z.string().trim().min(1, 'nodeId is required').optional(),
    submissionNote: z.string().trim().max(4000).nullable().optional(),
    attachments: z.array(productionTaskAttachmentBodySchema).max(20).optional(),
  })
  .superRefine((value, ctx) => {
    const hasWorkflow = Boolean(value.workflowId)
    const hasNode = Boolean(value.nodeId)
    if (hasWorkflow !== hasNode) {
      ctx.addIssue({
        code: 'custom',
        path: hasWorkflow ? ['nodeId'] : ['workflowId'],
        message: 'workflowId and nodeId must be submitted together',
      })
    }

    const hasNodeSubmission = hasWorkflow && hasNode
    const hasTextSubmission = Boolean(value.submissionNote?.trim())
    const hasAttachmentSubmission = (value.attachments?.length ?? 0) > 0
    if (!hasNodeSubmission && !hasTextSubmission && !hasAttachmentSubmission) {
      ctx.addIssue({
        code: 'custom',
        path: ['attachments'],
        message: 'Submit a node, note, or attachment',
      })
    }
  })
export type SubmitProductionTaskBody = z.input<typeof submitProductionTaskBodySchema>

export const reviewProductionTaskBodySchema = z.object({
  action: z.enum(['approve', 'request_changes']),
  reviewNote: z.string().trim().max(2000).nullable().optional(),
})
export type ReviewProductionTaskBody = z.input<typeof reviewProductionTaskBodySchema>

export const createProductionTaskMessageBodySchema = z.object({
  body: z.string().trim().min(1, 'message cannot be empty').max(4000),
})
export type CreateProductionTaskMessageBody = z.input<typeof createProductionTaskMessageBodySchema>

export const markProductionTaskReadBodySchema = z.object({})
export type MarkProductionTaskReadBody = z.input<typeof markProductionTaskReadBodySchema>

export const productionTaskWorkgroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  discipline: z.object({
    id: z.string().nullable(),
    code: z.string().nullable(),
    name: z.string().nullable(),
    agentCode: agentCodeSchema.nullable(),
  }),
})
export type ProductionTaskWorkgroup = z.output<typeof productionTaskWorkgroupSchema>

export const productionTaskUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
})
export type ProductionTaskUser = z.output<typeof productionTaskUserSchema>

export const productionTaskDependencySchema = z.object({
  taskId: z.string(),
  title: z.string(),
  status: productionTaskStatusSchema,
  dueAt: z.string().nullable(),
})
export type ProductionTaskDependency = z.output<typeof productionTaskDependencySchema>

export const productionTaskAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  downloadUrl: z.string().nullable(),
  source: productionTaskAttachmentSourceSchema,
  workspaceFileId: z.string().nullable(),
  key: z.string().nullable(),
  contentType: z.string().nullable(),
  size: z.number().int().nonnegative().nullable(),
  createdBy: productionTaskUserSchema.nullable(),
  createdAt: z.string(),
})
export type ProductionTaskAttachment = z.output<typeof productionTaskAttachmentSchema>

export const productionTaskSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  sourceWorkspaceId: z.string().nullable(),
  sourceWorkflowId: z.string().nullable(),
  sourceWorkgroup: productionTaskWorkgroupSchema,
  assigneeWorkgroup: productionTaskWorkgroupSchema,
  createdBy: productionTaskUserSchema.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  dueAt: z.string().nullable(),
  status: productionTaskStatusSchema,
  resultWorkflowId: z.string().nullable(),
  resultNodeId: z.string().nullable(),
  submissionNote: z.string().nullable(),
  reviewNote: z.string().nullable(),
  submittedBy: productionTaskUserSchema.nullable(),
  submittedAt: z.string().nullable(),
  reviewedBy: productionTaskUserSchema.nullable(),
  reviewedAt: z.string().nullable(),
  reminderSentAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messageCount: z.number().int().min(0),
  unreadMessageCount: z.number().int().min(0),
  blockedBy: z.array(productionTaskDependencySchema),
  attachments: z.array(productionTaskAttachmentSchema),
  submissionAttachments: z.array(productionTaskAttachmentSchema),
  permissions: z.object({
    canEdit: z.boolean(),
    canSubmit: z.boolean(),
    canReview: z.boolean(),
    canMessage: z.boolean(),
  }),
})
export type ProductionTask = z.output<typeof productionTaskSchema>

export const productionTaskMessageSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  senderUser: productionTaskUserSchema.nullable(),
  senderAgentCode: agentCodeSchema.nullable(),
  body: z.string(),
  createdAt: z.string(),
})
export type ProductionTaskMessage = z.output<typeof productionTaskMessageSchema>

export const productionTasksResponseSchema = z.object({
  tasks: z.array(productionTaskSchema),
})
export type ProductionTasksResponse = z.output<typeof productionTasksResponseSchema>

export const productionTaskResponseSchema = z.object({
  task: productionTaskSchema,
})
export type ProductionTaskResponse = z.output<typeof productionTaskResponseSchema>

export const productionTaskMessagesResponseSchema = z.object({
  messages: z.array(productionTaskMessageSchema),
})
export type ProductionTaskMessagesResponse = z.output<typeof productionTaskMessagesResponseSchema>

export const productionTaskReminderScanResponseSchema = z.object({
  scannedAt: z.string(),
  remindedCount: z.number().int().min(0),
  taskIds: z.array(z.string()),
})
export type ProductionTaskReminderScanResponse = z.output<
  typeof productionTaskReminderScanResponseSchema
>

export const listProductionTasksContract = defineRouteContract({
  method: 'GET',
  path: '/api/production-tasks',
  query: productionTasksQuerySchema,
  response: { mode: 'json', schema: productionTasksResponseSchema },
})

export const createProductionTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/production-tasks',
  body: createProductionTaskBodySchema,
  response: { mode: 'json', schema: productionTaskResponseSchema },
})

export const updateProductionTaskContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/production-tasks/[taskId]',
  params: productionTaskParamsSchema,
  body: updateProductionTaskBodySchema,
  response: { mode: 'json', schema: productionTaskResponseSchema },
})

export const submitProductionTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/production-tasks/[taskId]/submit',
  params: productionTaskParamsSchema,
  body: submitProductionTaskBodySchema,
  response: { mode: 'json', schema: productionTaskResponseSchema },
})

export const downloadProductionTaskAttachmentContract = defineRouteContract({
  method: 'GET',
  path: '/api/production-tasks/[taskId]/attachments/[attachmentId]/download',
  params: productionTaskAttachmentParamsSchema,
  query: productionTaskAttachmentDownloadQuerySchema,
  response: { mode: 'binary' },
})

export const reviewProductionTaskContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/production-tasks/[taskId]/review',
  params: productionTaskParamsSchema,
  body: reviewProductionTaskBodySchema,
  response: { mode: 'json', schema: productionTaskResponseSchema },
})

export const listProductionTaskMessagesContract = defineRouteContract({
  method: 'GET',
  path: '/api/production-tasks/[taskId]/messages',
  params: productionTaskParamsSchema,
  response: { mode: 'json', schema: productionTaskMessagesResponseSchema },
})

export const createProductionTaskMessageContract = defineRouteContract({
  method: 'POST',
  path: '/api/production-tasks/[taskId]/messages',
  params: productionTaskParamsSchema,
  body: createProductionTaskMessageBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ message: productionTaskMessageSchema }),
  },
})

export const markProductionTaskReadContract = defineRouteContract({
  method: 'POST',
  path: '/api/production-tasks/[taskId]/read',
  params: productionTaskParamsSchema,
  body: markProductionTaskReadBodySchema,
  response: { mode: 'json', schema: z.object({ readAt: z.string() }) },
})

export const scanProductionTaskRemindersContract = defineRouteContract({
  method: 'POST',
  path: '/api/production-tasks/reminders/scan',
  response: { mode: 'json', schema: productionTaskReminderScanResponseSchema },
})

export const scanProductionTaskRemindersCronContract = defineRouteContract({
  method: 'GET',
  path: '/api/production-tasks/reminders/scan',
  response: { mode: 'json', schema: productionTaskReminderScanResponseSchema },
})
