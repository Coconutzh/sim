import { z } from 'zod'
import {
  booleanQueryFlagSchema,
  nonEmptyIdSchema,
  workflowIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const projectTaskStatusSchema = z.enum([
  'todo',
  'submitted',
  'in_review',
  'completed',
  'rejected',
])
export type ProjectTaskStatus = z.output<typeof projectTaskStatusSchema>

export const projectTaskListScopeSchema = z.enum(['director', 'self'])
export type ProjectTaskListScope = z.output<typeof projectTaskListScopeSchema>

export const projectTaskReviewActionSchema = z.enum(['start', 'approve', 'reject'])
export type ProjectTaskReviewAction = z.output<typeof projectTaskReviewActionSchema>

export const projectTaskParamsSchema = z.object({ taskId: nonEmptyIdSchema })
export const organizationProjectTasksParamsSchema = z.object({ id: nonEmptyIdSchema })

export const projectTaskUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
})
export type ProjectTaskUser = z.output<typeof projectTaskUserSchema>

export const projectTaskAssigneeSchema = z.object({
  id: z.string(),
  name: z.string(),
  organizationId: z.string(),
  teamWorkspaceId: z.string().nullable(),
  discipline: z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    agentCode: z.string(),
  }),
})
export type ProjectTaskAssignee = z.output<typeof projectTaskAssigneeSchema>

export const projectTaskSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  assigneeWorkgroup: projectTaskAssigneeSchema,
  creator: projectTaskUserSchema,
  title: z.string(),
  description: z.string().nullable(),
  dueAt: z.string().nullable(),
  status: projectTaskStatusSchema,
  resultWorkspaceId: z.string().nullable(),
  resultWorkflowId: z.string().nullable(),
  resultNodeId: z.string().nullable(),
  submittedBy: projectTaskUserSchema.nullable(),
  submittedAt: z.string().nullable(),
  reviewedBy: projectTaskUserSchema.nullable(),
  reviewedAt: z.string().nullable(),
  reviewNote: z.string().nullable(),
  messageCount: z.number().int().min(0),
  lastMessageAt: z.string().nullable(),
  reminderSentAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ProjectTask = z.output<typeof projectTaskSchema>

export const projectTaskAccessSchema = z.object({
  canManage: z.boolean(),
  scope: projectTaskListScopeSchema,
  workgroupId: z.string().nullable(),
})
export type ProjectTaskAccess = z.output<typeof projectTaskAccessSchema>

export const listProjectTasksQuerySchema = z
  .object({
    scope: projectTaskListScopeSchema.default('self'),
    workgroupId: nonEmptyIdSchema.optional(),
    status: projectTaskStatusSchema.optional(),
    includeCompleted: booleanQueryFlagSchema.optional().default(false),
    includeArchived: booleanQueryFlagSchema.optional().default(false),
    limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  })
  .superRefine((value, ctx) => {
    if (value.scope === 'self' && !value.workgroupId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workgroupId'],
        message: 'Workgroup ID is required for self task views',
      })
    }
  })
export type ListProjectTasksQuery = z.output<typeof listProjectTasksQuerySchema>
export type ListProjectTasksQueryInput = z.input<typeof listProjectTasksQuerySchema>

export const projectTaskListResponseSchema = z.object({
  tasks: z.array(projectTaskSchema),
  assigneeWorkgroups: z.array(projectTaskAssigneeSchema),
  access: projectTaskAccessSchema,
})
export type ProjectTaskListResponse = z.output<typeof projectTaskListResponseSchema>

export const createProjectTaskBodySchema = z.object({
  assigneeWorkgroupId: nonEmptyIdSchema,
  title: z.string().trim().min(1, 'Task title is required').max(160),
  description: z
    .string()
    .trim()
    .max(4000, 'Description must be 4000 characters or fewer')
    .optional(),
  dueAt: z.string().datetime().nullable().optional(),
})
export type CreateProjectTaskBody = z.input<typeof createProjectTaskBodySchema>

export const updateProjectTaskBodySchema = z
  .object({
    assigneeWorkgroupId: nonEmptyIdSchema.optional(),
    title: z.string().trim().min(1, 'Task title is required').max(160).optional(),
    description: z
      .string()
      .trim()
      .max(4000, 'Description must be 4000 characters or fewer')
      .nullable()
      .optional(),
    dueAt: z.string().datetime().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one task field must be provided',
  })
export type UpdateProjectTaskBody = z.input<typeof updateProjectTaskBodySchema>

export const submitProjectTaskBodySchema = z.object({
  resultWorkspaceId: workspaceIdSchema,
  resultWorkflowId: workflowIdSchema,
  resultNodeId: nonEmptyIdSchema,
})
export type SubmitProjectTaskBody = z.input<typeof submitProjectTaskBodySchema>

export const reviewProjectTaskBodySchema = z
  .object({
    action: projectTaskReviewActionSchema,
    reviewNote: z
      .string()
      .trim()
      .max(2000, 'Review note must be 2000 characters or fewer')
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'reject' && !value.reviewNote) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reviewNote'],
        message: 'Review note is required when rejecting a task',
      })
    }
  })
export type ReviewProjectTaskBody = z.input<typeof reviewProjectTaskBodySchema>

export const listProjectTaskMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
})
export type ListProjectTaskMessagesQuery = z.output<typeof listProjectTaskMessagesQuerySchema>
export type ListProjectTaskMessagesQueryInput = z.input<typeof listProjectTaskMessagesQuerySchema>

export const createProjectTaskMessageBodySchema = z.object({
  content: z.string().trim().min(1, 'Message cannot be empty').max(2000),
})
export type CreateProjectTaskMessageBody = z.input<typeof createProjectTaskMessageBodySchema>

export const projectTaskMessageSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  sender: projectTaskUserSchema,
  content: z.string(),
  createdAt: z.string(),
})
export type ProjectTaskMessage = z.output<typeof projectTaskMessageSchema>

export const projectTaskResponseSchema = z.object({ task: projectTaskSchema })
export type ProjectTaskResponse = z.output<typeof projectTaskResponseSchema>

export const projectTaskMessagesResponseSchema = z.object({
  messages: z.array(projectTaskMessageSchema),
  messageCount: z.number().int().min(0),
})
export type ProjectTaskMessagesResponse = z.output<typeof projectTaskMessagesResponseSchema>

export const projectTaskMessageResponseSchema = z.object({
  message: projectTaskMessageSchema,
})
export type ProjectTaskMessageResponse = z.output<typeof projectTaskMessageResponseSchema>

export const archivedProjectTaskResponseSchema = z.object({
  task: projectTaskSchema,
  archived: z.literal(true),
})
export type ArchivedProjectTaskResponse = z.output<typeof archivedProjectTaskResponseSchema>

export const projectTaskEventTypeSchema = z.enum([
  'created',
  'updated',
  'archived',
  'submitted',
  'review_started',
  'approved',
  'rejected',
  'message_created',
  'due_reminder',
])
export type ProjectTaskEventType = z.output<typeof projectTaskEventTypeSchema>

export const projectTaskEventSchema = z.object({
  id: z.string(),
  type: projectTaskEventTypeSchema,
  taskId: z.string(),
  organizationId: z.string(),
  assigneeWorkgroupId: z.string(),
  actorUserId: z.string(),
  taskStatus: projectTaskStatusSchema,
  timestamp: z.string(),
})
export type ProjectTaskEvent = z.output<typeof projectTaskEventSchema>

export const projectTaskEventsQuerySchema = z
  .object({
    organizationId: nonEmptyIdSchema,
    scope: projectTaskListScopeSchema.default('self'),
    workgroupId: nonEmptyIdSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === 'self' && !value.workgroupId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workgroupId'],
        message: 'Workgroup ID is required for self task events',
      })
    }
  })
export type ProjectTaskEventsQuery = z.output<typeof projectTaskEventsQuerySchema>
export type ProjectTaskEventsQueryInput = z.input<typeof projectTaskEventsQuerySchema>

export const projectTaskDueReminderResponseSchema = z.object({
  matchedCount: z.number().int().min(0),
  notifiedCount: z.number().int().min(0),
  taskIds: z.array(z.string()),
})
export type ProjectTaskDueReminderResponse = z.output<typeof projectTaskDueReminderResponseSchema>

export const listProjectTasksContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/project-tasks',
  params: organizationProjectTasksParamsSchema,
  query: listProjectTasksQuerySchema,
  response: { mode: 'json', schema: projectTaskListResponseSchema },
})

export const createProjectTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/project-tasks',
  params: organizationProjectTasksParamsSchema,
  body: createProjectTaskBodySchema,
  response: { mode: 'json', schema: projectTaskResponseSchema, status: [200, 201] },
})

export const getProjectTaskContract = defineRouteContract({
  method: 'GET',
  path: '/api/project-tasks/[taskId]',
  params: projectTaskParamsSchema,
  response: { mode: 'json', schema: projectTaskResponseSchema },
})

export const updateProjectTaskContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/project-tasks/[taskId]',
  params: projectTaskParamsSchema,
  body: updateProjectTaskBodySchema,
  response: { mode: 'json', schema: projectTaskResponseSchema },
})

export const archiveProjectTaskContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/project-tasks/[taskId]',
  params: projectTaskParamsSchema,
  response: { mode: 'json', schema: archivedProjectTaskResponseSchema },
})

export const submitProjectTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/project-tasks/[taskId]/submit',
  params: projectTaskParamsSchema,
  body: submitProjectTaskBodySchema,
  response: { mode: 'json', schema: projectTaskResponseSchema },
})

export const reviewProjectTaskContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/project-tasks/[taskId]/review',
  params: projectTaskParamsSchema,
  body: reviewProjectTaskBodySchema,
  response: { mode: 'json', schema: projectTaskResponseSchema },
})

export const listProjectTaskMessagesContract = defineRouteContract({
  method: 'GET',
  path: '/api/project-tasks/[taskId]/messages',
  params: projectTaskParamsSchema,
  query: listProjectTaskMessagesQuerySchema,
  response: { mode: 'json', schema: projectTaskMessagesResponseSchema },
})

export const createProjectTaskMessageContract = defineRouteContract({
  method: 'POST',
  path: '/api/project-tasks/[taskId]/messages',
  params: projectTaskParamsSchema,
  body: createProjectTaskMessageBodySchema,
  response: { mode: 'json', schema: projectTaskMessageResponseSchema, status: [200, 201] },
})

export const projectTaskEventsContract = defineRouteContract({
  method: 'GET',
  path: '/api/project-tasks/events',
  query: projectTaskEventsQuerySchema,
  response: { mode: 'stream' },
})

export const dispatchProjectTaskDueRemindersContract = defineRouteContract({
  method: 'GET',
  path: '/api/cron/project-task-due-reminders',
  response: { mode: 'json', schema: projectTaskDueReminderResponseSchema },
})
