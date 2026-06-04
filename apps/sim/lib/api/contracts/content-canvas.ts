import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const capabilityAvailabilitySchema = z.object({
  enabledModelIds: z.array(z.string()),
  defaultModelId: z.string().nullable(),
})

export const contentCanvasModelsResponseSchema = z.object({
  success: z.literal(true),
  models: z.object({
    text: capabilityAvailabilitySchema,
    image: capabilityAvailabilitySchema,
    audio: capabilityAvailabilitySchema,
    video: capabilityAvailabilitySchema,
  }),
})
export type ContentCanvasCapabilityAvailability = z.output<typeof capabilityAvailabilitySchema>
export type ContentCanvasModelAvailabilitySnapshot = z.output<
  typeof contentCanvasModelsResponseSchema
>['models']

export const getContentCanvasModelsContract = defineRouteContract({
  method: 'GET',
  path: '/api/content-canvas/models',
  query: z.object({
    workspaceId: z.string().min(1),
  }),
  response: {
    mode: 'json',
    schema: contentCanvasModelsResponseSchema,
  },
})

export const generateContentCanvasTextContract = defineRouteContract({
  method: 'POST',
  path: '/api/content-canvas/text',
  body: z.object({
    workspaceId: z.string().min(1),
    model: z.string().min(1),
    prompt: z.string().min(1),
    referenceContextText: z.string().optional(),
    referenceImages: z
      .array(
        z.object({
          mimeType: z.string().min(1),
          data: z.string().min(1),
        })
      )
      .optional(),
  }),
  response: {
    mode: 'json',
    schema: z.object({
      content: z.string(),
    }),
  },
})
