import { z } from 'zod'
import { nonEmptyIdSchema, userFileSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

const MAX_BASE64_CHARS = 140 * 1024 * 1024
const lastQueryValue = (value: unknown) => (Array.isArray(value) ? value.at(-1) : value)

export const hermesPresentationArtifactFileSchema = z.object({
  fileName: z.string().trim().min(1, 'File name is required').max(500),
  contentType: z.string().trim().min(1).max(200).optional(),
  base64: z.string().trim().min(1, 'File content is required').max(MAX_BASE64_CHARS),
  size: z.number().int().nonnegative().optional(),
})
export type HermesPresentationArtifactFile = z.input<typeof hermesPresentationArtifactFileSchema>

export const hermesPresentationArtifactUploadBodySchema = z.object({
  userId: nonEmptyIdSchema,
  organizationId: nonEmptyIdSchema.optional(),
  workspaceId: workspaceIdSchema,
  workflowId: nonEmptyIdSchema.optional(),
  chatId: nonEmptyIdSchema.optional(),
  targetNodeId: nonEmptyIdSchema.optional(),
  title: z.string().trim().min(1, 'Presentation title is required').max(500),
  source: z.string().trim().min(1).max(200).optional().default('codex-ppt-skill'),
  backendName: z.string().trim().min(1).max(200).optional(),
  backendType: z.enum(['editable', 'image_based']).optional(),
  renderer: z.string().trim().min(1).max(200).optional(),
  editable: z.boolean().optional(),
  slideCount: z.number().int().min(1).max(200).optional(),
  selectedStyle: z.string().trim().min(1).max(200).optional(),
  styleBrief: z.string().trim().min(1).max(4000).optional(),
  imageBackend: z.string().trim().min(1).max(200).optional(),
  imageProvider: z.string().trim().min(1).max(100).optional(),
  imageModel: z.string().trim().min(1).max(100).optional(),
  imageBaseUrl: z.string().trim().url().max(500).optional(),
  outlineMarkdown: z.string().max(100_000).optional(),
  speechMarkdown: z.string().max(200_000).optional(),
  pptx: hermesPresentationArtifactFileSchema,
  coverImage: hermesPresentationArtifactFileSchema.optional(),
  traceId: z.string().trim().min(1).max(200).optional(),
  hermesRunId: z.string().trim().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type HermesPresentationArtifactUploadBody = z.input<
  typeof hermesPresentationArtifactUploadBodySchema
>
export type ParsedHermesPresentationArtifactUploadBody = z.output<
  typeof hermesPresentationArtifactUploadBodySchema
>

export const hermesPresentationArtifactErrorCodeSchema = z.enum([
  'UNAUTHENTICATED_SERVICE',
  'USER_PERMISSION_DENIED',
  'WORKSPACE_NOT_FOUND',
  'PRESENTATION_FILE_INVALID',
  'PRESENTATION_FILE_TOO_LARGE',
  'PRESENTATION_UPLOAD_FAILED',
  'INTERNAL_ERROR',
])
export type HermesPresentationArtifactErrorCode = z.output<
  typeof hermesPresentationArtifactErrorCodeSchema
>

export const hermesPresentationArtifactManifestSchema = z.object({
  title: z.string(),
  source: z.string(),
  backendName: z.string().optional(),
  backendType: z.enum(['editable', 'image_based']).optional(),
  renderer: z.string().optional(),
  editable: z.boolean().optional(),
  slideCount: z.number().int().positive().optional(),
  selectedStyle: z.string().optional(),
  styleBrief: z.string().optional(),
  imageBackend: z.string().optional(),
  imageProvider: z.string().optional(),
  imageModel: z.string().optional(),
  imageBaseUrl: z.string().optional(),
  outlineMarkdown: z.string().optional(),
  speechMarkdown: z.string().optional(),
  targetNodeId: z.string().optional(),
  createdAt: z.string(),
})

const hermesPresentationArtifactUploadSuccessResponseSchema = z.object({
  success: z.literal(true),
  answer: z.string(),
  auditId: z.string(),
  traceId: z.string().optional(),
  pptxFile: userFileSchema,
  coverImageFile: userFileSchema.optional(),
  manifestFile: userFileSchema,
  manifest: hermesPresentationArtifactManifestSchema,
})

const hermesPresentationArtifactUploadErrorResponseSchema = z.object({
  success: z.literal(false),
  answer: z.string(),
  auditId: z.string(),
  traceId: z.string().optional(),
  errorCode: hermesPresentationArtifactErrorCodeSchema,
  error: z.string(),
})

export const hermesPresentationArtifactUploadResponseSchema = z.discriminatedUnion('success', [
  hermesPresentationArtifactUploadSuccessResponseSchema,
  hermesPresentationArtifactUploadErrorResponseSchema,
])
export type HermesPresentationArtifactUploadResponse = z.output<
  typeof hermesPresentationArtifactUploadResponseSchema
>

export const hermesPresentationArtifactUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/hermes/presentation-artifacts/upload',
  body: hermesPresentationArtifactUploadBodySchema,
  response: {
    mode: 'json',
    schema: hermesPresentationArtifactUploadResponseSchema,
    status: [200, 400, 401, 403, 404, 413, 500],
  },
})

export const hermesPresentationSourceQuerySchema = z.object({
  userId: z.preprocess(lastQueryValue, nonEmptyIdSchema),
  organizationId: z.preprocess(lastQueryValue, nonEmptyIdSchema.optional()),
  workspaceId: z.preprocess(lastQueryValue, workspaceIdSchema),
  workflowId: z.preprocess(lastQueryValue, nonEmptyIdSchema),
  nodeId: z.preprocess(lastQueryValue, nonEmptyIdSchema),
  traceId: z.preprocess(lastQueryValue, z.string().trim().min(1).max(200).optional()),
})
export type ParsedHermesPresentationSourceQuery = z.output<
  typeof hermesPresentationSourceQuerySchema
>

export const hermesPresentationSourceContract = defineRouteContract({
  method: 'GET',
  path: '/api/internal/hermes/presentation-artifacts/source',
  query: hermesPresentationSourceQuerySchema,
  response: {
    mode: 'binary',
    status: [200, 400, 401, 403, 404, 413, 500],
  },
})
