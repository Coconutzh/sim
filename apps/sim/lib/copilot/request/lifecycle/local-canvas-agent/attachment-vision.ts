import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { executeLocalAgentModelRequest } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/config'
import { buildLocalAgentRoleSystemPrompt } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/prompts'
import { renderPdfPagesToImages } from '@/lib/copilot/request/lifecycle/local-canvas-agent/pdf-renderer'
import type {
  LocalAgentAttachedContext,
  LocalAgentAttachment,
  LocalAgentContext,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import { prepareImageForVision } from '@/lib/copilot/vfs/file-reader'
import {
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import type { Message } from '@/providers/types'
import { getProviderFromModel } from '@/providers/utils'

const logger = createLogger('LocalCanvasAgentAttachmentVision')
const DEFAULT_MAX_FILES = 3
const DEFAULT_MAX_PDF_PAGES = 3
const MAX_IMAGE_DIMENSION = 1568
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
])
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])

type VisionMessagePart = NonNullable<Message['parts']>[number]

export interface AttachmentVisionBundle {
  contexts: LocalAgentAttachedContext[]
  limitations: string[]
  analyzedFileCount: number
  analyzedImageCount: number
}

function supportsImageMessageParts(context: LocalAgentContext): boolean {
  return (
    context.model.provider === 'google' || getProviderFromModel(context.model.model) === 'google'
  )
}

function asLower(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function isPdfAttachment(attachment: Pick<LocalAgentAttachment, 'name' | 'type'>): boolean {
  return (
    asLower(attachment.type) === 'application/pdf' || getFileExtension(attachment.name) === 'pdf'
  )
}

function isSupportedImageAttachment(
  attachment: Pick<LocalAgentAttachment, 'name' | 'type'>
): boolean {
  const type = asLower(attachment.type)
  return (
    SUPPORTED_IMAGE_TYPES.has(type) ||
    SUPPORTED_IMAGE_EXTENSIONS.has(getFileExtension(attachment.name))
  )
}

function isVisionAttachment(attachment: LocalAgentAttachment): boolean {
  return isSupportedImageAttachment(attachment) || isPdfAttachment(attachment)
}

function textMatchesQuery(value: string | undefined, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true
  const normalizedValue = asLower(value)
  return normalizedValue.includes(normalizedQuery) || normalizedQuery.includes(normalizedValue)
}

function attachmentMatchesQuery(
  attachment: LocalAgentAttachment,
  normalizedQuery: string
): boolean {
  if (!normalizedQuery) return true
  return [attachment.name, attachment.type, attachment.id, attachment.key, attachment.url].some(
    (value) => textMatchesQuery(value, normalizedQuery)
  )
}

function redactVisionContent(
  content: string,
  context: LocalAgentContext,
  attachment: LocalAgentAttachment
): string {
  let redacted = content
  for (const value of [
    context.workspaceId,
    context.workflowId,
    context.chatId,
    attachment.id,
    attachment.key,
    attachment.url,
  ]) {
    if (typeof value === 'string' && value.trim()) {
      redacted = redacted.split(value).join('[redacted]')
    }
  }
  return redacted
}

function uniqueLimitations(limitations: string[]): string[] {
  return Array.from(new Set(limitations.filter((item) => item.trim().length > 0)))
}

async function resolveAttachmentRecord(
  context: LocalAgentContext,
  attachment: LocalAgentAttachment
): Promise<WorkspaceFileRecord | null> {
  if (!attachment.id) return null
  const record = await getWorkspaceFile(context.workspaceId, attachment.id)
  if (record) return record
  logger.warn('Workspace attachment record was not found for vision analysis', {
    fileName: attachment.name,
    mimeType: attachment.type,
  })
  return null
}

async function buildImageParts(params: {
  record: WorkspaceFileRecord
  attachment: LocalAgentAttachment
}): Promise<{ parts: VisionMessagePart[]; imageCount: number; limitations: string[] }> {
  const buffer = await fetchWorkspaceFileBuffer(params.record)
  const prepared = await prepareImageForVision(
    buffer,
    params.record.type || params.attachment.type || ''
  )
  if (!prepared) {
    return {
      parts: [],
      imageCount: 0,
      limitations: [`Attachment "${params.attachment.name}" was too large for visual analysis.`],
    }
  }

  return {
    parts: [
      {
        type: 'text',
        text: `Uploaded image "${params.attachment.name}" rendered for visual analysis.`,
      },
      {
        type: 'image',
        mimeType: prepared.mediaType,
        data: prepared.buffer.toString('base64'),
      },
    ],
    imageCount: 1,
    limitations: [],
  }
}

async function buildPdfParts(params: {
  record: WorkspaceFileRecord
  attachment: LocalAgentAttachment
  maxPdfPages: number
}): Promise<{ parts: VisionMessagePart[]; imageCount: number; limitations: string[] }> {
  const buffer = await fetchWorkspaceFileBuffer(params.record)
  const pages = await renderPdfPagesToImages({
    buffer,
    maxPages: params.maxPdfPages,
    maxDimension: MAX_IMAGE_DIMENSION,
    maxBytesPerPage: MAX_IMAGE_BYTES,
  })
  const limitations =
    pages[0] && pages[0].pageCount > params.maxPdfPages
      ? [
          `PDF "${params.attachment.name}" has ${pages[0].pageCount} page(s); only the first ${params.maxPdfPages} page(s) were analyzed visually.`,
        ]
      : []

  return {
    parts: pages.flatMap<VisionMessagePart>((page) => [
      {
        type: 'text',
        text: `PDF "${params.attachment.name}" page ${page.pageNumber} rendered image.`,
      },
      {
        type: 'image',
        mimeType: page.mimeType,
        data: page.data,
      },
    ]),
    imageCount: pages.length,
    limitations,
  }
}

async function analyzeAttachment(params: {
  context: LocalAgentContext
  question: string
  attachment: LocalAgentAttachment
  maxPdfPages: number
}): Promise<{
  context: LocalAgentAttachedContext | null
  limitations: string[]
  imageCount: number
}> {
  const record = await resolveAttachmentRecord(params.context, params.attachment)
  if (!record) {
    return {
      context: null,
      limitations: [
        `Attachment "${params.attachment.name}" could not be loaded for visual analysis.`,
      ],
      imageCount: 0,
    }
  }

  try {
    const prepared = isPdfAttachment(params.attachment)
      ? await buildPdfParts({
          record,
          attachment: params.attachment,
          maxPdfPages: params.maxPdfPages,
        })
      : await buildImageParts({ record, attachment: params.attachment })

    if (prepared.parts.length === 0 || prepared.imageCount === 0) {
      return {
        context: null,
        limitations: prepared.limitations.length
          ? prepared.limitations
          : [`Attachment "${params.attachment.name}" could not be prepared for visual analysis.`],
        imageCount: 0,
      }
    }

    const response = await executeLocalAgentModelRequest(params.context.model, {
      role: 'decision',
      workspaceId: params.context.workspaceId,
      systemPrompt: buildLocalAgentRoleSystemPrompt({
        context: params.context,
        role: 'decision',
        roleInstruction:
          'Analyze uploaded image/PDF page images for a local canvas agent. Return concise factual observations only in Chinese. Do not expose storage paths, keys, file ids, workspace ids, workflow ids, chat ids, or internal identifiers. If only part of a file was analyzed, say so clearly. If a page cannot be rendered or read, state the limitation and do not invent content.',
      }),
      prompt: params.question,
      temperature: 0,
      maxTokens: 2000,
      messages: [
        {
          role: 'user',
          content: null,
          parts: [
            {
              type: 'text',
              text: [
                `User question: ${params.question}`,
                `Attachment name: ${params.attachment.name}`,
                'Return 3-8 concise factual observations in Chinese.',
                'Only describe visible content from the provided image parts.',
              ].join('\n'),
            },
            ...prepared.parts,
          ],
        },
      ],
      abortSignal: params.context.options.abortSignal,
    })

    const limitationText = prepared.limitations.length
      ? `\n\nLimitations:\n${prepared.limitations.join('\n')}`
      : ''
    return {
      context: {
        type: 'file_vision',
        tag: `@${params.attachment.name}`,
        content: redactVisionContent(
          `${response.content.trim()}${limitationText}`,
          params.context,
          params.attachment
        ),
      },
      limitations: prepared.limitations,
      imageCount: prepared.imageCount,
    }
  } catch (error) {
    logger.warn('Attachment visual analysis failed', {
      fileName: params.attachment.name,
      mimeType: params.attachment.type,
      error: toError(error).message,
    })
    return {
      context: null,
      limitations: [
        `Attachment "${params.attachment.name}" visual analysis failed; text fallback remains available.`,
      ],
      imageCount: 0,
    }
  }
}

export async function analyzeAttachmentVision(params: {
  context: LocalAgentContext
  question: string
  fileName?: string
  maxFiles?: number
  maxPdfPages?: number
}): Promise<AttachmentVisionBundle> {
  const maxFiles = params.maxFiles ?? DEFAULT_MAX_FILES
  const maxPdfPages = params.maxPdfPages ?? DEFAULT_MAX_PDF_PAGES
  const normalizedQuery = asLower(params.fileName)
  const candidates = (params.context.attachments ?? []).filter(
    (attachment) =>
      attachment.storageContext === 'workspace' &&
      Boolean(attachment.id) &&
      isVisionAttachment(attachment) &&
      attachmentMatchesQuery(attachment, normalizedQuery)
  )
  const limitedCandidates = candidates.slice(0, maxFiles)
  const limitations: string[] =
    candidates.length > maxFiles
      ? [
          `Only the first ${maxFiles} visual attachment(s) were analyzed; ${candidates.length - maxFiles} matching attachment(s) were skipped.`,
        ]
      : []

  if (!limitedCandidates.length) {
    return { contexts: [], limitations, analyzedFileCount: 0, analyzedImageCount: 0 }
  }

  if (!supportsImageMessageParts(params.context)) {
    const provider =
      params.context.model.provider ?? getProviderFromModel(params.context.model.model) ?? 'unknown'
    const limitation = `Current model provider "${provider}" does not support attachment visual reading; text/VFS fallback remains available.`
    return {
      contexts: limitedCandidates.map((attachment) => ({
        type: 'file_vision',
        tag: `@${attachment.name}`,
        content: limitation,
      })),
      limitations: uniqueLimitations([...limitations, limitation]),
      analyzedFileCount: 0,
      analyzedImageCount: 0,
    }
  }

  const contexts: LocalAgentAttachedContext[] = []
  let analyzedFileCount = 0
  let analyzedImageCount = 0

  for (const attachment of limitedCandidates) {
    const result = await analyzeAttachment({
      context: params.context,
      question: params.question,
      attachment,
      maxPdfPages,
    })
    limitations.push(...result.limitations)
    if (result.context) {
      contexts.push(result.context)
      analyzedFileCount += 1
      analyzedImageCount += result.imageCount
    }
  }

  return {
    contexts,
    limitations: uniqueLimitations(limitations),
    analyzedFileCount,
    analyzedImageCount,
  }
}
