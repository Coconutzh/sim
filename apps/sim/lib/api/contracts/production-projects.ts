import { z } from 'zod'
import { nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const productionProjectStatusSchema = z.enum(['active', 'completed'])
export type ProductionProjectStatus = z.output<typeof productionProjectStatusSchema>

export const productionProjectPhaseStatusSchema = z.enum(['active', 'completed'])
export type ProductionProjectPhaseStatus = z.output<typeof productionProjectPhaseStatusSchema>

export const productionProjectParamsSchema = z.object({
  organizationId: nonEmptyIdSchema,
})

export const productionProjectPhaseInputSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1, '阶段名称不能为空').max(80, '阶段名称不能超过 80 个字符'),
  dueAt: z.string().datetime().nullable().optional(),
  status: productionProjectPhaseStatusSchema.optional(),
})
export type ProductionProjectPhaseInput = z.input<typeof productionProjectPhaseInputSchema>

export const productionProjectPhaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  dueAt: z.string().nullable(),
  status: productionProjectPhaseStatusSchema,
})
export type ProductionProjectPhase = z.output<typeof productionProjectPhaseSchema>

export const createProductionProjectBodySchema = z.object({
  name: z.string().trim().min(1, '项目名称不能为空').max(120, '项目名称不能超过 120 个字符'),
  estimatedDueAt: z.string().datetime().nullable().optional(),
  phases: z.array(productionProjectPhaseInputSchema).max(24, '项目阶段不能超过 24 个').optional(),
})
export type CreateProductionProjectBody = z.input<typeof createProductionProjectBodySchema>

export const updateProductionProjectBodySchema = z
  .object({
    status: productionProjectStatusSchema.optional(),
    estimatedDueAt: z.string().datetime().nullable().optional(),
    phases: z.array(productionProjectPhaseInputSchema).max(24, '项目阶段不能超过 24 个').optional(),
  })
  .superRefine((value, context) => {
    if (
      value.status === undefined &&
      value.estimatedDueAt === undefined &&
      value.phases === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: '至少需要更新项目状态、预估 DDL 或阶段 DDL',
      })
    }
  })
export type UpdateProductionProjectBody = z.input<typeof updateProductionProjectBodySchema>

export const productionProjectSchema = z.object({
  organizationId: z.string(),
  name: z.string(),
  status: productionProjectStatusSchema,
  estimatedDueAt: z.string().nullable(),
  phases: z.array(productionProjectPhaseSchema),
  primaryWorkgroupId: z.string().nullable(),
  teamWorkspaceId: z.string().nullable(),
})
export type ProductionProject = z.output<typeof productionProjectSchema>

export const createProductionProjectContract = defineRouteContract({
  method: 'POST',
  path: '/api/production-projects',
  body: createProductionProjectBodySchema,
  response: { mode: 'json', schema: z.object({ project: productionProjectSchema }) },
})

export const updateProductionProjectContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/production-projects/[organizationId]',
  params: productionProjectParamsSchema,
  body: updateProductionProjectBodySchema,
  response: { mode: 'json', schema: z.object({ project: productionProjectSchema }) },
})
