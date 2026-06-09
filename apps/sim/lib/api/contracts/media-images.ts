import { z } from 'zod'
import { userFileSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const imageGenerationModelSchema = z.enum([
  'jimeng-4.0',
  'jimeng-4.5',
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image',
  'gemini-3-pro-image-preview',
])
export const imageGenerationResolutionSchema = z.enum(['1K', '2K', '4K'])
export const imageOutpaintAspectRatioSchema = z.enum([
  'original',
  '1:1',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '21:9',
  'custom',
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

export const repaintWorkspaceImageBodySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  prompt: z.string().min(1, 'prompt is required'),
  resolution: imageGenerationResolutionSchema.default('2K'),
  sourceImage: userFileSchema,
  maskImage: userFileSchema,
  referenceImages: z.array(userFileSchema).default([]),
})

export const eraseWorkspaceImageBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  sourceImage: userFileSchema,
  maskImage: userFileSchema,
  resolution: imageGenerationResolutionSchema.default('2K'),
})

export const imageOutpaintPlacementSchema = z
  .object({
    x: z.number().nonnegative('placement.x must be greater than or equal to 0'),
    y: z.number().nonnegative('placement.y must be greater than or equal to 0'),
    width: z.number().positive('placement.width must be greater than 0'),
    height: z.number().positive('placement.height must be greater than 0'),
    canvasWidth: z.number().positive('placement.canvasWidth must be greater than 0'),
    canvasHeight: z.number().positive('placement.canvasHeight must be greater than 0'),
  })
  .superRefine((placement, context) => {
    if (placement.width > placement.canvasWidth) {
      context.addIssue({
        code: 'custom',
        path: ['width'],
        message: 'placement.width must fit within canvasWidth',
      })
    }
    if (placement.height > placement.canvasHeight) {
      context.addIssue({
        code: 'custom',
        path: ['height'],
        message: 'placement.height must fit within canvasHeight',
      })
    }
    if (placement.x + placement.width > placement.canvasWidth) {
      context.addIssue({
        code: 'custom',
        path: ['x'],
        message: 'placement.x plus width must fit within canvasWidth',
      })
    }
    if (placement.y + placement.height > placement.canvasHeight) {
      context.addIssue({
        code: 'custom',
        path: ['y'],
        message: 'placement.y plus height must fit within canvasHeight',
      })
    }
  })

export const imageOutpaintCustomAspectRatioSchema = z.object({
  width: z.number().positive('customAspectRatio.width must be greater than 0').max(1000),
  height: z.number().positive('customAspectRatio.height must be greater than 0').max(1000),
})

export const outpaintWorkspaceImageBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    sourceImage: userFileSchema,
    resolution: imageGenerationResolutionSchema.default('2K'),
    targetAspectRatio: imageOutpaintAspectRatioSchema,
    customAspectRatio: imageOutpaintCustomAspectRatioSchema.optional(),
    placement: imageOutpaintPlacementSchema,
    prompt: z.string().max(2000, 'prompt cannot exceed 2000 characters').optional().default(''),
  })
  .superRefine((body, context) => {
    if (body.targetAspectRatio === 'custom' && !body.customAspectRatio) {
      context.addIssue({
        code: 'custom',
        path: ['customAspectRatio'],
        message: 'customAspectRatio is required when targetAspectRatio is custom',
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

export const repaintWorkspaceImageContract = defineRouteContract({
  method: 'POST',
  path: '/api/media/images/repaint',
  body: repaintWorkspaceImageBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      file: generatedWorkspaceFileSchema,
      metadata: generatedImageMetadataSchema,
    }),
  },
})

export const eraseWorkspaceImageContract = defineRouteContract({
  method: 'POST',
  path: '/api/media/images/erase',
  body: eraseWorkspaceImageBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      file: generatedWorkspaceFileSchema,
      metadata: generatedImageMetadataSchema,
    }),
  },
})

export const outpaintWorkspaceImageContract = defineRouteContract({
  method: 'POST',
  path: '/api/media/images/outpaint',
  body: outpaintWorkspaceImageBodySchema,
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
export type RepaintWorkspaceImageBody = z.input<typeof repaintWorkspaceImageBodySchema>
export type EraseWorkspaceImageBody = z.input<typeof eraseWorkspaceImageBodySchema>
export type OutpaintWorkspaceImageBody = z.input<typeof outpaintWorkspaceImageBodySchema>
export type ImageGenerationResolution = z.output<typeof imageGenerationResolutionSchema>
export type ImageOutpaintAspectRatio = z.output<typeof imageOutpaintAspectRatioSchema>
