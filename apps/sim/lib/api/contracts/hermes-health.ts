import { z } from 'zod'
import {
  hermesHealthCheckErrorResponseSchema,
  hermesHealthCheckResponseSchema,
  hermesHealthCheckRouteResponseSchema,
} from '@/lib/api/contracts/internal/hermes-health'
import { booleanQueryFlagSchema, nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const hermesHealthOrganizationParamsSchema = z.object({
  id: nonEmptyIdSchema,
})
export type HermesHealthOrganizationParams = z.output<typeof hermesHealthOrganizationParamsSchema>

export const hermesHealthQuerySchema = z.object({
  includeToolsets: booleanQueryFlagSchema.optional().default(true),
})
export type HermesHealthQueryInput = z.input<typeof hermesHealthQuerySchema>
export type HermesHealthQuery = z.output<typeof hermesHealthQuerySchema>

export {
  hermesHealthCheckErrorResponseSchema,
  hermesHealthCheckResponseSchema,
  hermesHealthCheckRouteResponseSchema,
}

export type HermesAdminHealthResponse = z.output<typeof hermesHealthCheckResponseSchema>
export type HermesAdminHealthErrorResponse = z.output<typeof hermesHealthCheckErrorResponseSchema>
export type HermesAdminHealthRouteResponse = z.output<typeof hermesHealthCheckRouteResponseSchema>

export const hermesAdminHealthContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/hermes/health',
  params: hermesHealthOrganizationParamsSchema,
  query: hermesHealthQuerySchema,
  response: {
    mode: 'json',
    schema: hermesHealthCheckRouteResponseSchema,
    status: [200, 401, 403],
  },
})
