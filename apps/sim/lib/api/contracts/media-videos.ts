import { z } from 'zod'
import { userFileSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const videoGenerationModelSchema = z.enum([
  'wan2.7-i2v',
  'wan2.6-t2v',
  'wan2.6-i2v-flash',
])
export const videoGenerationMediaTypeSchema = z.enum(['first_frame', 'last_frame'])
export const videoGenerationResolutionSchema = z.enum(['720P', '1080P'])
export const videoFrameAspectRatioPresetSchema = z.enum(['16:9', '9:16', '1:1'])

export const videoGenerationMediaSchema = z.object({
  type: videoGenerationMediaTypeSchema,
  file: userFileSchema,
})

export const videoGenerationParametersSchema = z.object({
  aspectRatioPreset: videoFrameAspectRatioPresetSchema,
  resolution: videoGenerationResolutionSchema,
  duration: z.number().int().min(2).max(15),
  promptExtend: z.boolean().default(true),
  watermark: z.boolean().default(false),
})

export const generateWorkspaceVideoBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    model: videoGenerationModelSchema,
    prompt: z.string().min(1, 'prompt is required'),
    media: z.array(videoGenerationMediaSchema).max(2, 'too many media items'),
    parameters: videoGenerationParametersSchema,
  })
  .superRefine((value, ctx) => {
    const types = new Set(value.media.map((item) => item.type))

    if (value.model === 'wan2.7-i2v') {
      if (!types.has('first_frame')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'first_frame is required',
          path: ['media'],
        })
      }
      if (!types.has('last_frame')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'last_frame is required',
          path: ['media'],
        })
      }
      return
    }

    if (value.model === 'wan2.6-i2v-flash') {
      if (!types.has('first_frame')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'first_frame is required',
          path: ['media'],
        })
      }
      if (types.has('last_frame')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'last_frame is not supported for wan2.6-i2v-flash',
          path: ['media'],
        })
      }
      return
    }

    if (value.media.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'media is not supported for wan2.6-t2v',
        path: ['media'],
      })
    }
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

const generatedVideoMetadataSchema = z.object({
  provider: z.string(),
  providerModel: z.string(),
  taskId: z.string(),
  revisedPrompt: z.string().optional(),
})

export const generateWorkspaceVideoContract = defineRouteContract({
  method: 'POST',
  path: '/api/media/videos/generate',
  body: generateWorkspaceVideoBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      file: generatedWorkspaceFileSchema,
      metadata: generatedVideoMetadataSchema,
    }),
  },
})

export type GenerateWorkspaceVideoBody = z.input<typeof generateWorkspaceVideoBodySchema>
