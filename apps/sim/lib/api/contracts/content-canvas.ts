import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const contentCanvasCapabilityAvailabilitySchema = z.object({
  enabledModelIds: z.array(z.string()),
  defaultModelId: z.string().nullable(),
})

export const contentCanvasModelsResponseSchema = z.object({
  success: z.literal(true),
  models: z.object({
    text: contentCanvasCapabilityAvailabilitySchema,
    image: contentCanvasCapabilityAvailabilitySchema,
    audio: contentCanvasCapabilityAvailabilitySchema,
    video: contentCanvasCapabilityAvailabilitySchema,
  }),
})
export type ContentCanvasCapabilityAvailability = z.output<
  typeof contentCanvasCapabilityAvailabilitySchema
>
export type ContentCanvasModelAvailabilitySnapshot = z.output<
  typeof contentCanvasModelsResponseSchema
>['models']

export const getContentCanvasModelsQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})
export type GetContentCanvasModelsQuery = z.input<typeof getContentCanvasModelsQuerySchema>
export type ContentCanvasModelsResponse = z.output<typeof contentCanvasModelsResponseSchema>

export const getContentCanvasModelsContract = defineRouteContract({
  method: 'GET',
  path: '/api/content-canvas/models',
  query: getContentCanvasModelsQuerySchema,
  response: {
    mode: 'json',
    schema: contentCanvasModelsResponseSchema,
  },
})

export const contentCanvasReferenceImageSchema = z.object({
  mimeType: z.string().min(1, 'mimeType is required'),
  data: z.string().min(1, 'data is required'),
})
export type ContentCanvasReferenceImage = z.input<typeof contentCanvasReferenceImageSchema>

export const generateContentCanvasTextBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  model: z.string().min(1, 'model is required'),
  prompt: z.string().min(1, 'prompt is required'),
  referenceContextText: z.string().optional(),
  referenceImages: z.array(contentCanvasReferenceImageSchema).optional(),
})
export type GenerateContentCanvasTextBody = z.input<typeof generateContentCanvasTextBodySchema>

export const generateContentCanvasTextResponseSchema = z.object({
  content: z.string(),
})
export type GenerateContentCanvasTextResponse = z.output<
  typeof generateContentCanvasTextResponseSchema
>

export const generateContentCanvasTextContract = defineRouteContract({
  method: 'POST',
  path: '/api/content-canvas/text',
  body: generateContentCanvasTextBodySchema,
  response: {
    mode: 'json',
    schema: generateContentCanvasTextResponseSchema,
  },
})
