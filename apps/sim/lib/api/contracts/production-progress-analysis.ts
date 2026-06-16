import { z } from 'zod'
import { nonEmptyIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import {
  productionProjectPhaseSchema,
  productionProjectStatusSchema,
} from '@/lib/api/contracts/production-projects'
import { productionTaskStatusSchema } from '@/lib/api/contracts/production-tasks'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const productionProgressAnalysisSeveritySchema = z.enum(['info', 'warning', 'critical'])
export type ProductionProgressAnalysisSeverity = z.output<
  typeof productionProgressAnalysisSeveritySchema
>

export const productionProgressProjectInputSchema = z.object({
  organizationId: nonEmptyIdSchema,
  name: z.string().trim().min(1).max(160),
  teamWorkspaceId: workspaceIdSchema,
  estimatedDueAt: z.string().datetime().nullable().optional(),
  status: productionProjectStatusSchema.optional(),
  phases: z.array(productionProjectPhaseSchema).max(24).optional(),
})
export type ProductionProgressProjectInput = z.input<typeof productionProgressProjectInputSchema>

export const productionProgressAnalysisMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(4000),
})
export type ProductionProgressAnalysisMessage = z.output<
  typeof productionProgressAnalysisMessageSchema
>

export const analyzeProductionProgressBodySchema = z.object({
  projects: z.array(productionProgressProjectInputSchema).min(1).max(50),
  question: z
    .string()
    .trim()
    .min(1, 'question is required')
    .max(1000)
    .default('请分析当前所有项目的任务进度，指出异常拖延任务和原因。'),
  history: z.array(productionProgressAnalysisMessageSchema).max(12).optional(),
})
export type AnalyzeProductionProgressBody = z.input<typeof analyzeProductionProgressBodySchema>

export const productionProgressMetricsSchema = z.object({
  projectCount: z.number().int().min(0),
  taskCount: z.number().int().min(0),
  completedTaskCount: z.number().int().min(0),
  openTaskCount: z.number().int().min(0),
  overdueTaskCount: z.number().int().min(0),
  delayReasonMissingCount: z.number().int().min(0),
  dueWithin24hCount: z.number().int().min(0),
  dueWithin72hCount: z.number().int().min(0),
  submittedAwaitingReviewCount: z.number().int().min(0),
  changesRequestedCount: z.number().int().min(0),
  unplannedTaskCount: z.number().int().min(0),
})
export type ProductionProgressMetrics = z.output<typeof productionProgressMetricsSchema>

export const productionProgressRiskTaskSchema = z.object({
  taskId: z.string(),
  organizationId: z.string(),
  projectName: z.string(),
  title: z.string(),
  assigneeWorkgroupName: z.string(),
  status: productionTaskStatusSchema,
  severity: productionProgressAnalysisSeveritySchema,
  dueAt: z.string().nullable(),
  daysOverdue: z.number().int().nullable(),
  reason: z.string(),
  delayReason: z.string().nullable(),
  latestSubmissionAt: z.string().nullable(),
  reviewNote: z.string().nullable(),
})
export type ProductionProgressRiskTask = z.output<typeof productionProgressRiskTaskSchema>

export const productionProgressProjectAnalysisSchema = z.object({
  organizationId: z.string(),
  projectName: z.string(),
  health: z.enum(['normal', 'attention', 'blocked']),
  summary: z.string(),
  taskCount: z.number().int().min(0),
  completedTaskCount: z.number().int().min(0),
  overdueTaskCount: z.number().int().min(0),
  delayReasonMissingCount: z.number().int().min(0),
  dueWithin72hCount: z.number().int().min(0),
  submittedAwaitingReviewCount: z.number().int().min(0),
  changesRequestedCount: z.number().int().min(0),
})
export type ProductionProgressProjectAnalysis = z.output<
  typeof productionProgressProjectAnalysisSchema
>

export const productionProgressAnalysisSchema = z.object({
  generatedAt: z.string(),
  generatedBy: z.enum(['hermes', 'rules']),
  answer: z.string(),
  metrics: productionProgressMetricsSchema,
  projects: z.array(productionProgressProjectAnalysisSchema),
  riskTasks: z.array(productionProgressRiskTaskSchema),
  recommendations: z.array(z.string()),
})
export type ProductionProgressAnalysis = z.output<typeof productionProgressAnalysisSchema>

export const analyzeProductionProgressResponseSchema = z.object({
  analysis: productionProgressAnalysisSchema,
})
export type AnalyzeProductionProgressResponse = z.output<
  typeof analyzeProductionProgressResponseSchema
>

export const analyzeProductionProgressContract = defineRouteContract({
  method: 'POST',
  path: '/api/production-progress/analyze',
  body: analyzeProductionProgressBodySchema,
  response: { mode: 'json', schema: analyzeProductionProgressResponseSchema },
})
