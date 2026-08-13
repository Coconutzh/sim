import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const lastQueryValue = (value: unknown) => (Array.isArray(value) ? value.at(-1) : value)

export const hermesRuntimeConsumerSchema = z.enum(['hermes-agent', 'hermes-ppt'])
export type HermesRuntimeConsumer = z.output<typeof hermesRuntimeConsumerSchema>

const hermesRuntimeConfigQuerySchema = z.object({
  consumer: z.preprocess(lastQueryValue, hermesRuntimeConsumerSchema),
  capability: z.preprocess(lastQueryValue, z.string().trim().min(1).max(100)),
  family: z.preprocess(lastQueryValue, z.string().trim().min(1).max(100)),
})

const hermesRuntimeConfigSchema = z.object({
  providerId: z.string(),
  serviceKind: z.string(),
  baseUrl: z.string().nullable(),
  apiKey: z.string(),
  enabledModelIds: z.array(z.string()),
  defaultModelId: z.string().nullable(),
  configVersion: z.number(),
})

export const hermesRuntimeConfigContract = defineRouteContract({
  method: 'GET',
  path: '/api/internal/hermes/runtime-config',
  query: hermesRuntimeConfigQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({ config: hermesRuntimeConfigSchema.nullable() }),
  },
})

export type HermesRuntimeConfigResponse = z.output<typeof hermesRuntimeConfigSchema>
