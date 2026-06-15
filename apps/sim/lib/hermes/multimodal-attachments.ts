import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { listChatUploads } from '@/lib/copilot/tools/handlers/upload-file-reader'
import { readFileRecord } from '@/lib/copilot/vfs/file-reader'
import type {
  HermesResponseInput,
  HermesResponseInputContentPart,
  HermesResponseInputImagePart,
  HermesResponseInputTextPart,
} from '@/lib/hermes/client'
import {
  getWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  getContentType,
  getFileExtension,
  getMimeTypeFromExtension,
  isImageFileType,
} from '@/lib/uploads/utils/file-utils'

const logger = createLogger('HermesMultimodalAttachments')
const MAX_HERMES_IMAGE_ATTACHMENTS = 4
const MAX_HERMES_DOCUMENT_ATTACHMENTS = 3
const MAX_HERMES_DOCUMENT_TEXT_CHARS = 80_000

type StorageContext = 'workspace' | 'mothership'
type HermesAttachmentKind = 'image' | 'document'

interface NormalizedHermesAttachment {
  id?: string
  workspaceFileId?: string
  key?: string
  name: string
  mediaType: string
  kind: HermesAttachmentKind
  size?: number
  storageContext?: StorageContext
}

export interface BuildHermesMultimodalInputParams {
  requestPayload: Record<string, unknown>
  message: string
  workspaceId?: string
  chatId?: string
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeMediaType(record: Record<string, unknown>, name: string): string {
  const explicit =
    readString(record, 'media_type') ?? readString(record, 'mimeType') ?? readString(record, 'type')
  if (explicit && explicit.toLowerCase() !== 'application/octet-stream') {
    return explicit.toLowerCase()
  }
  return getMimeTypeFromExtension(getFileExtension(name)).toLowerCase()
}

function fileNameFromKey(key: string): string {
  const segment = key.split('/').filter(Boolean).at(-1)
  if (!segment) return 'attached-image'
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function normalizeAttachment(value: unknown): NormalizedHermesAttachment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const key = readString(record, 'key')
  const name =
    readString(record, 'name') ??
    readString(record, 'filename') ??
    readString(record, 'fileName') ??
    (key ? fileNameFromKey(key) : undefined) ??
    'attached-image'
  const mediaType = normalizeMediaType(record, name)
  const kind = isImageFileType(mediaType)
    ? 'image'
    : getContentType(mediaType) === 'document'
      ? 'document'
      : null
  if (!kind) return null
  return {
    ...(readString(record, 'id') ? { id: readString(record, 'id') } : {}),
    ...(readString(record, 'workspaceFileId')
      ? { workspaceFileId: readString(record, 'workspaceFileId') }
      : {}),
    ...(key ? { key } : {}),
    name,
    mediaType,
    kind,
    ...(typeof record.size === 'number' && Number.isFinite(record.size)
      ? { size: record.size }
      : {}),
    ...(record.storageContext === 'workspace' || record.storageContext === 'mothership'
      ? { storageContext: record.storageContext }
      : {}),
  }
}

function clipDocumentText(content: string): { text: string; truncated: boolean } {
  if (content.length <= MAX_HERMES_DOCUMENT_TEXT_CHARS) {
    return { text: content, truncated: false }
  }
  return {
    text: content.slice(0, MAX_HERMES_DOCUMENT_TEXT_CHARS),
    truncated: true,
  }
}

function matchesAttachment(
  record: WorkspaceFileRecord,
  attachment: NormalizedHermesAttachment
): boolean {
  return (
    (Boolean(attachment.workspaceFileId) && record.id === attachment.workspaceFileId) ||
    (Boolean(attachment.id) && record.id === attachment.id) ||
    (Boolean(attachment.key) && record.key === attachment.key) ||
    record.name === attachment.name
  )
}

async function resolveAttachmentRecord(params: {
  attachment: NormalizedHermesAttachment
  workspaceId?: string
  chatId?: string
}): Promise<WorkspaceFileRecord | null> {
  const { attachment, workspaceId, chatId } = params

  if (workspaceId && attachment.workspaceFileId) {
    const record = await getWorkspaceFile(workspaceId, attachment.workspaceFileId)
    if (record) return record
  }

  if (workspaceId && attachment.storageContext !== 'mothership' && attachment.id) {
    const record = await getWorkspaceFile(workspaceId, attachment.id)
    if (record) return record
  }

  if (chatId) {
    const uploads = await listChatUploads(chatId)
    return uploads.find((record) => matchesAttachment(record, attachment)) ?? null
  }

  return null
}

async function buildImagePart(
  attachment: NormalizedHermesAttachment,
  record: WorkspaceFileRecord
): Promise<HermesResponseInputImagePart | null> {
  const result = await readFileRecord(record)
  const source = result?.attachment?.source
  if (
    result?.attachment?.type !== 'image' ||
    source?.type !== 'base64' ||
    !source.media_type ||
    !source.data
  ) {
    logger.warn('Attached image could not be prepared for Hermes multimodal input', {
      fileName: attachment.name,
      mediaType: attachment.mediaType,
    })
    return null
  }

  return {
    type: 'input_image',
    image_url: `data:${source.media_type};base64,${source.data}`,
  }
}

async function buildDocumentPart(
  attachment: NormalizedHermesAttachment,
  record: WorkspaceFileRecord
): Promise<HermesResponseInputTextPart | null> {
  const result = await readFileRecord(record)
  if (!result?.content) {
    logger.warn('Attached document could not be prepared for Hermes text input', {
      fileName: attachment.name,
      mediaType: attachment.mediaType,
    })
    return null
  }

  const { text, truncated } = clipDocumentText(result.content)
  return {
    type: 'input_text',
    text: [
      `Attached document: ${attachment.name}`,
      `Media type: ${attachment.mediaType}`,
      `Extracted lines: ${result.totalLines}`,
      truncated
        ? `Content truncated to the first ${MAX_HERMES_DOCUMENT_TEXT_CHARS} characters before sending to Hermes.`
        : '',
      'Document text:',
      text,
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

function normalizeAttachments(rawAttachments: unknown): NormalizedHermesAttachment[] {
  if (!Array.isArray(rawAttachments)) return []
  return rawAttachments
    .map(normalizeAttachment)
    .filter((attachment): attachment is NormalizedHermesAttachment => Boolean(attachment))
}

export async function buildHermesMultimodalInput(
  params: BuildHermesMultimodalInputParams
): Promise<HermesResponseInput | undefined> {
  const attachments = normalizeAttachments(params.requestPayload.fileAttachments)
  if (attachments.length === 0) return undefined

  const imageAttachments = attachments.filter((attachment) => attachment.kind === 'image')
  const documentAttachments = attachments.filter((attachment) => attachment.kind === 'document')
  const limitedImageAttachments = imageAttachments.slice(0, MAX_HERMES_IMAGE_ATTACHMENTS)
  const limitedDocumentAttachments = documentAttachments.slice(0, MAX_HERMES_DOCUMENT_ATTACHMENTS)
  const imageParts: HermesResponseInputImagePart[] = []
  const imageNames: string[] = []
  const documentParts: HermesResponseInputTextPart[] = []
  const documentNames: string[] = []

  for (const attachment of limitedImageAttachments) {
    try {
      const record = await resolveAttachmentRecord({
        attachment,
        workspaceId: params.workspaceId,
        chatId: params.chatId,
      })
      if (!record) {
        logger.warn('Attached image record was not found for Hermes multimodal input', {
          fileName: attachment.name,
          mediaType: attachment.mediaType,
        })
        continue
      }
      const part = await buildImagePart(attachment, record)
      if (!part) continue
      imageParts.push(part)
      imageNames.push(attachment.name)
    } catch (error) {
      logger.warn('Failed to prepare attached image for Hermes multimodal input', {
        fileName: attachment.name,
        mediaType: attachment.mediaType,
        error: toError(error).message,
      })
    }
  }

  for (const attachment of limitedDocumentAttachments) {
    try {
      const record = await resolveAttachmentRecord({
        attachment,
        workspaceId: params.workspaceId,
        chatId: params.chatId,
      })
      if (!record) {
        logger.warn('Attached document record was not found for Hermes text input', {
          fileName: attachment.name,
          mediaType: attachment.mediaType,
        })
        continue
      }
      const part = await buildDocumentPart(attachment, record)
      if (!part) continue
      documentParts.push(part)
      documentNames.push(attachment.name)
    } catch (error) {
      logger.warn('Failed to prepare attached document for Hermes text input', {
        fileName: attachment.name,
        mediaType: attachment.mediaType,
        error: toError(error).message,
      })
    }
  }

  if (imageParts.length === 0 && documentParts.length === 0) return undefined

  const attachmentLines = imageNames.map((name, index) => `${index + 1}. ${name}`)
  const documentLines = documentNames.map((name, index) => `${index + 1}. ${name}`)
  const omittedImageCount = Math.max(0, imageAttachments.length - limitedImageAttachments.length)
  const omittedDocumentCount = Math.max(
    0,
    documentAttachments.length - limitedDocumentAttachments.length
  )
  const text = [
    params.message,
    imageNames.length > 0 ? 'Attached images supplied to Hermes for visual analysis:' : '',
    imageNames.length > 0 ? attachmentLines.join('\n') : '',
    documentNames.length > 0 ? 'Attached documents extracted and supplied to Hermes as text:' : '',
    documentNames.length > 0 ? documentLines.join('\n') : '',
    omittedImageCount > 0
      ? `Only the first ${MAX_HERMES_IMAGE_ATTACHMENTS} image attachment(s) were supplied; ${omittedImageCount} image attachment(s) were omitted.`
      : '',
    omittedDocumentCount > 0
      ? `Only the first ${MAX_HERMES_DOCUMENT_ATTACHMENTS} document attachment(s) were supplied; ${omittedDocumentCount} document attachment(s) were omitted.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const content: HermesResponseInputContentPart[] = [
    { type: 'input_text', text },
    ...documentParts,
    ...imageParts,
  ]

  return [
    {
      role: 'user',
      content,
    },
  ]
}
