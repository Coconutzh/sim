import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const hermesHealthStatusSchema = z.enum([
  'unconfigured',
  'healthy',
  'degraded',
  'unreachable',
])
export type HermesHealthStatus = z.output<typeof hermesHealthStatusSchema>

export const hermesRuntimeBuildInfoSchema = z.object({
  version: z.string().optional(),
  commit: z.string().nullable().optional(),
  release: z.string().nullable().optional(),
  buildTime: z.string().nullable().optional(),
})
export type HermesRuntimeBuildInfo = z.output<typeof hermesRuntimeBuildInfoSchema>

export const hermesCapabilitySummarySchema = z.object({
  chatCompletions: z.boolean(),
  responsesApi: z.boolean(),
  skillsApi: z.boolean(),
  sessionKeyHeader: z.string().optional(),
})
export type HermesCapabilitySummary = z.output<typeof hermesCapabilitySummarySchema>

export const hermesToolsetSummarySchema = z.object({
  checked: z.boolean(),
  required: z.array(z.string()),
  enabled: z.array(z.string()),
  missing: z.array(z.string()),
})
export type HermesToolsetSummary = z.output<typeof hermesToolsetSummarySchema>

export const hermesHealthCheckResponseSchema = z.object({
  configured: z.boolean(),
  ok: z.boolean(),
  status: hermesHealthStatusSchema,
  checkedAt: z.string(),
  baseUrl: z.string().url().optional(),
  version: z.string().optional(),
  commit: z.string().nullable().optional(),
  build: hermesRuntimeBuildInfoSchema.optional(),
  capabilities: hermesCapabilitySummarySchema.optional(),
  toolsets: hermesToolsetSummarySchema.optional(),
  responseStatus: z.number().int().optional(),
  error: z.string().optional(),
})
export type HermesHealthCheckResponse = z.output<typeof hermesHealthCheckResponseSchema>

export const hermesHealthCheckErrorResponseSchema = z.object({
  error: z.string(),
})

export const hermesHealthCheckRouteResponseSchema = z.union([
  hermesHealthCheckResponseSchema,
  hermesHealthCheckErrorResponseSchema,
])
export type HermesHealthCheckRouteResponse = z.output<typeof hermesHealthCheckRouteResponseSchema>

export const hermesHealthCheckContract = defineRouteContract({
  method: 'GET',
  path: '/api/internal/hermes/health',
  response: {
    mode: 'json',
    schema: hermesHealthCheckRouteResponseSchema,
    status: [200, 401, 503],
  },
})
