import { z } from 'zod'
import { userFileSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const imageGenerationModelSchema = z.enum([
  'jimeng-4.0',
  'jimeng-4.5',
  'gemini-3.1-flash-image-preview',
])
export const imageGenerationAspectRatioSchema = z.enum([
  'auto',
  '1:1',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '3:2',
  '2:3',
  '21:9',
])

export const imageReferenceContextSchema = z.object({
  text: z.array(z.string()).default([]),
  images: z.array(userFileSchema).default([]),
})

export const generateWorkspaceImageBodySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  model: imageGenerationModelSchema,
  prompt: z.string().min(1, 'prompt is required'),
  aspectRatio: imageGenerationAspectRatioSchema.default('auto'),
  referenceContext: imageReferenceContextSchema.optional(),
})

const generatedWorkspaceFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  size: z.number(),
  type: z.string(),
  key: z.string(),
  context: z.string().optional(),
})

const generatedImageMetadataSchema = z.object({
  provider: z.string(),
  providerModel: z.string(),
  revisedPrompt: z.string().optional(),
})

export const generateWorkspaceImageContract = defineRouteContract({
  method: 'POST',
  path: '/api/media/images/generate',
  body: generateWorkspaceImageBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      file: generatedWorkspaceFileSchema,
      metadata: generatedImageMetadataSchema,
    }),
  },
})

export type GenerateWorkspaceImageBody = z.input<typeof generateWorkspaceImageBodySchema>
