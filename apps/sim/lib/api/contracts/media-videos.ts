import { z } from 'zod'
import { userFileSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const videoGenerationModelSchema = z.enum(['wan2.7-i2v', 'wan2.6-t2v', 'wan2.6-i2v-flash'])
export const videoGenerationMediaTypeSchema = z.enum(['first_frame', 'last_frame'])
export const videoGenerationResolutionSchema = z.enum(['720P', '1080P'])
export const videoFrameAspectRatioPresetSchema = z.enum(['16:9', '9:16', '1:1'])
export const videoEnhanceResolutionSchema = z.enum(['1080p', '2k', '4k'])
export const videoEnhanceFrameRateSchema = z.enum(['source', '30fps', '60fps', '90fps'])
export const videoEnhanceSlowMotionSchema = z.enum(['source', '2x'])
export const videoFrameCaptureModeSchema = z.enum(['current', 'first', 'last'])

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

export const trimWorkspaceVideoBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    sourceFile: userFileSchema,
    startSeconds: z.number().min(0, 'startSeconds must be greater than or equal to 0'),
    endSeconds: z.number().positive('endSeconds must be greater than 0'),
  })
  .superRefine((value, context) => {
    if (value.endSeconds <= value.startSeconds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endSeconds must be greater than startSeconds',
        path: ['endSeconds'],
      })
    }
  })

export const generateWorkspaceVideoThumbnailsBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  sourceFile: userFileSchema,
  durationSeconds: z.number().positive('durationSeconds must be greater than 0'),
  frameCount: z.number().int().min(1).max(24).default(12),
})

export const enhanceWorkspaceVideoBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  sourceFile: userFileSchema,
  resolution: videoEnhanceResolutionSchema,
  frameRate: videoEnhanceFrameRateSchema,
  slowMotion: videoEnhanceSlowMotionSchema,
  coverTimeSeconds: z.number().min(0).optional(),
})

export const generatedWorkspaceFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  size: z.number(),
  type: z.string(),
  key: z.string(),
  context: z.string().optional(),
})

export const generatedWorkspaceVideoFileSchema = generatedWorkspaceFileSchema

export const captureWorkspaceVideoFrameBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  sourceFile: userFileSchema,
  timeSeconds: z.number().min(0, 'timeSeconds must be greater than or equal to 0'),
  mode: videoFrameCaptureModeSchema,
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
      file: generatedWorkspaceVideoFileSchema,
      metadata: generatedVideoMetadataSchema,
    }),
  },
})

export const trimWorkspaceVideoContract = defineRouteContract({
  method: 'POST',
  path: '/api/media/videos/trim',
  body: trimWorkspaceVideoBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      file: generatedWorkspaceVideoFileSchema,
    }),
  },
})

export const enhanceWorkspaceVideoContract = defineRouteContract({
  method: 'POST',
  path: '/api/media/videos/enhance',
  body: enhanceWorkspaceVideoBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      file: generatedWorkspaceVideoFileSchema,
      metadata: z
        .object({
          provider: z.literal('ffmpeg'),
          resolution: videoEnhanceResolutionSchema,
          frameRate: videoEnhanceFrameRateSchema,
          slowMotion: videoEnhanceSlowMotionSchema,
        })
        .optional(),
    }),
  },
})

export const captureWorkspaceVideoFrameContract = defineRouteContract({
  method: 'POST',
  path: '/api/media/videos/capture-frame',
  body: captureWorkspaceVideoFrameBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      file: generatedWorkspaceFileSchema,
    }),
  },
})

export const generateWorkspaceVideoThumbnailsContract = defineRouteContract({
  method: 'POST',
  path: '/api/media/videos/thumbnails',
  body: generateWorkspaceVideoThumbnailsBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      thumbnails: z.array(z.string()),
    }),
  },
})

export type GenerateWorkspaceVideoBody = z.input<typeof generateWorkspaceVideoBodySchema>
export type TrimWorkspaceVideoBody = z.input<typeof trimWorkspaceVideoBodySchema>
export type EnhanceWorkspaceVideoBody = z.input<typeof enhanceWorkspaceVideoBodySchema>
export type CaptureWorkspaceVideoFrameBody = z.input<typeof captureWorkspaceVideoFrameBodySchema>
export type GenerateWorkspaceVideoThumbnailsBody = z.input<
  typeof generateWorkspaceVideoThumbnailsBodySchema
>
