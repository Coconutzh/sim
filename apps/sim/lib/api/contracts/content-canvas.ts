import { z } from 'zod'
import { hermesPresentationArtifactManifestSchema } from '@/lib/api/contracts/internal/hermes-presentation-artifacts'
import { nonEmptyIdSchema, userFileSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
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

export const generateContentCanvasPresentationBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  workflowId: nonEmptyIdSchema,
  nodeId: nonEmptyIdSchema,
  prompt: z.string().max(20_000).optional(),
  slideCount: z.number().int().min(1).max(200).optional(),
})
export type GenerateContentCanvasPresentationBody = z.input<
  typeof generateContentCanvasPresentationBodySchema
>

export const contentCanvasPresentationArtifactSchema = z.object({
  pptxFile: userFileSchema,
  coverImageFile: userFileSchema.optional(),
  manifestFile: userFileSchema,
  manifest: hermesPresentationArtifactManifestSchema,
  auditId: z.string(),
  traceId: z.string().optional(),
})
export type ContentCanvasPresentationArtifact = z.output<
  typeof contentCanvasPresentationArtifactSchema
>

export const generateContentCanvasPresentationResponseSchema = z.object({
  success: z.literal(true),
  answer: z.string(),
  nodeId: z.string(),
  presentationStatus: z.literal('complete'),
  presentationArtifact: contentCanvasPresentationArtifactSchema,
  file: userFileSchema,
  hermesResponseId: z.string().optional(),
})
export type GenerateContentCanvasPresentationResponse = z.output<
  typeof generateContentCanvasPresentationResponseSchema
>

export const generateContentCanvasPresentationContract = defineRouteContract({
  method: 'POST',
  path: '/api/content-canvas/presentations/generate',
  body: generateContentCanvasPresentationBodySchema,
  response: {
    mode: 'json',
    schema: generateContentCanvasPresentationResponseSchema,
    status: [200, 400, 401, 403, 404, 500, 503],
  },
})
