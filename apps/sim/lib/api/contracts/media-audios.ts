import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const audioGenerationModelSchema = z.enum([
  'suno-v5-beta',
  'suno-v4.5-beta',
  'suno-v4-beta',
])

export const audioGenerationParametersSchema = z.object({
  customMode: z.boolean().default(false),
  instrumental: z.boolean().default(false),
  style: z.string().default(''),
  title: z.string().default(''),
  negativeTags: z.string().default(''),
  vocalGender: z.string().default(''),
})

export const generateWorkspaceAudioBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  model: audioGenerationModelSchema,
  prompt: z.string().min(1, 'prompt is required'),
  parameters: audioGenerationParametersSchema,
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

const generatedAudioMetadataSchema = z.object({
  provider: z.string(),
  providerModel: z.string(),
  taskId: z.string(),
})

export const generateWorkspaceAudioContract = defineRouteContract({
  method: 'POST',
  path: '/api/media/audios/generate',
  body: generateWorkspaceAudioBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      file: generatedWorkspaceFileSchema,
      metadata: generatedAudioMetadataSchema,
    }),
  },
})

export type GenerateWorkspaceAudioBody = z.input<typeof generateWorkspaceAudioBodySchema>
