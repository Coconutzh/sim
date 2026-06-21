import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type {
  HermesPresentationArtifactErrorCode,
  ParsedHermesPresentationArtifactUploadBody,
} from '@/lib/api/contracts/internal/hermes-presentation-artifacts'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { getWorkspaceMembershipAccess } from '@/app/api/workflows/utils'
import type { UserFile } from '@/executor/types'

const logger = createLogger('HermesPresentationArtifacts')
const PPTX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const MANIFEST_CONTENT_TYPE = 'application/json'
const MAX_PPTX_BYTES = 100 * 1024 * 1024
const MAX_COVER_IMAGE_BYTES = 20 * 1024 * 1024

interface DecodableFile {
  fileName: string
  contentType?: string
  base64: string
  size?: number
}

interface DecodedFile {
  buffer: Buffer
  fileName: string
  contentType: string
  size: number
}

export interface StoredHermesPresentationArtifact {
  pptxFile: UserFile
  coverImageFile?: UserFile
  manifestFile: UserFile
  manifest: {
    title: string
    source: string
    slideCount?: number
    selectedStyle?: string
    styleBrief?: string
    imageBackend?: string
    imageProvider?: string
    imageModel?: string
    imageBaseUrl?: string
    outlineMarkdown?: string
    speechMarkdown?: string
    targetNodeId?: string
    createdAt: string
  }
}

export class HermesPresentationArtifactError extends Error {
  constructor(
    public readonly code: HermesPresentationArtifactErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'HermesPresentationArtifactError'
  }
}

function sanitizeFileName(value: string, fallback: string): string {
  const trimmed = value.trim()
  const safe = trimmed.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ')
  return safe || fallback
}

function ensureExtension(fileName: string, extension: string): string {
  return fileName.toLowerCase().endsWith(extension) ? fileName : `${fileName}${extension}`
}

function decodeBase64File(params: {
  file: DecodableFile
  fallbackContentType: string
  fallbackFileName: string
  maxBytes: number
}): DecodedFile {
  const compactBase64 = params.file.base64.replace(/\s/g, '')
  if (!compactBase64 || compactBase64.length % 4 === 1) {
    throw new HermesPresentationArtifactError(
      'PRESENTATION_FILE_INVALID',
      `Invalid base64 content for ${params.file.fileName}`
    )
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compactBase64)) {
    throw new HermesPresentationArtifactError(
      'PRESENTATION_FILE_INVALID',
      `Invalid base64 content for ${params.file.fileName}`
    )
  }

  const buffer = Buffer.from(compactBase64, 'base64')
  if (buffer.length === 0) {
    throw new HermesPresentationArtifactError(
      'PRESENTATION_FILE_INVALID',
      `Decoded file ${params.file.fileName} is empty`
    )
  }
  if (buffer.length > params.maxBytes) {
    throw new HermesPresentationArtifactError(
      'PRESENTATION_FILE_TOO_LARGE',
      `${params.file.fileName} exceeds the ${params.maxBytes} byte upload limit`
    )
  }
  if (typeof params.file.size === 'number' && params.file.size !== buffer.length) {
    throw new HermesPresentationArtifactError(
      'PRESENTATION_FILE_INVALID',
      `${params.file.fileName} size mismatch: declared ${params.file.size}, decoded ${buffer.length}`
    )
  }

  return {
    buffer,
    fileName: sanitizeFileName(params.file.fileName, params.fallbackFileName),
    contentType: params.file.contentType?.trim() || params.fallbackContentType,
    size: buffer.length,
  }
}

function buildManifest(params: {
  body: ParsedHermesPresentationArtifactUploadBody
  createdAt: string
}) {
  return {
    title: params.body.title,
    source: params.body.source,
    ...(params.body.slideCount ? { slideCount: params.body.slideCount } : {}),
    ...(params.body.selectedStyle ? { selectedStyle: params.body.selectedStyle } : {}),
    ...(params.body.styleBrief ? { styleBrief: params.body.styleBrief } : {}),
    ...(params.body.imageBackend ? { imageBackend: params.body.imageBackend } : {}),
    ...(params.body.imageProvider ? { imageProvider: params.body.imageProvider } : {}),
    ...(params.body.imageModel ? { imageModel: params.body.imageModel } : {}),
    ...(params.body.imageBaseUrl ? { imageBaseUrl: params.body.imageBaseUrl } : {}),
    ...(params.body.outlineMarkdown ? { outlineMarkdown: params.body.outlineMarkdown } : {}),
    ...(params.body.speechMarkdown ? { speechMarkdown: params.body.speechMarkdown } : {}),
    ...(params.body.targetNodeId ? { targetNodeId: params.body.targetNodeId } : {}),
    createdAt: params.createdAt,
  }
}

async function assertWorkspaceWriteAccess(params: { userId: string; workspaceId: string }) {
  const access = await getWorkspaceMembershipAccess(params.userId, params.workspaceId)
  if (!access.exists) {
    throw new HermesPresentationArtifactError('WORKSPACE_NOT_FOUND', 'Canvas not found')
  }
  if (!access.hasAccess || !access.canWrite) {
    throw new HermesPresentationArtifactError(
      'USER_PERMISSION_DENIED',
      'User does not have write access to this canvas'
    )
  }
}

export async function storeHermesPresentationArtifact(
  body: ParsedHermesPresentationArtifactUploadBody
): Promise<StoredHermesPresentationArtifact> {
  await assertWorkspaceWriteAccess({ userId: body.userId, workspaceId: body.workspaceId })

  const titleFileBase = sanitizeFileName(body.title, 'presentation')
  const pptx = decodeBase64File({
    file: body.pptx,
    fallbackContentType: PPTX_CONTENT_TYPE,
    fallbackFileName: `${titleFileBase}.pptx`,
    maxBytes: MAX_PPTX_BYTES,
  })
  const pptxFileName = ensureExtension(pptx.fileName, '.pptx')

  const coverImage = body.coverImage
    ? decodeBase64File({
        file: body.coverImage,
        fallbackContentType: body.coverImage.contentType || 'image/png',
        fallbackFileName: `${titleFileBase}-cover.png`,
        maxBytes: MAX_COVER_IMAGE_BYTES,
      })
    : null

  try {
    const pptxFile = await uploadWorkspaceFile(
      body.workspaceId,
      body.userId,
      pptx.buffer,
      pptxFileName,
      pptx.contentType
    )
    const coverImageFile = coverImage
      ? await uploadWorkspaceFile(
          body.workspaceId,
          body.userId,
          coverImage.buffer,
          coverImage.fileName,
          coverImage.contentType
        )
      : undefined
    const manifest = buildManifest({ body, createdAt: new Date().toISOString() })
    const manifestBuffer = Buffer.from(
      JSON.stringify(
        {
          ...manifest,
          pptxFile: {
            id: pptxFile.id,
            name: pptxFile.name,
            size: pptxFile.size,
            type: pptxFile.type,
          },
          coverImageFile: coverImageFile
            ? {
                id: coverImageFile.id,
                name: coverImageFile.name,
                size: coverImageFile.size,
                type: coverImageFile.type,
              }
            : null,
        },
        null,
        2
      )
    )
    const manifestFile = await uploadWorkspaceFile(
      body.workspaceId,
      body.userId,
      manifestBuffer,
      `${titleFileBase}-manifest.json`,
      MANIFEST_CONTENT_TYPE
    )

    logger.info('Stored Hermes presentation artifact', {
      userId: body.userId,
      workspaceId: body.workspaceId,
      workflowId: body.workflowId,
      pptxFileId: pptxFile.id,
      coverImageFileId: coverImageFile?.id,
      manifestFileId: manifestFile.id,
      slideCount: body.slideCount,
      source: body.source,
    })

    return { pptxFile, coverImageFile, manifestFile, manifest }
  } catch (error) {
    throw new HermesPresentationArtifactError(
      'PRESENTATION_UPLOAD_FAILED',
      `Failed to store presentation artifact: ${toError(error).message}`
    )
  }
}
