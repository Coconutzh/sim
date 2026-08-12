import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import {
  normalizePresentationArtifact,
  type PresentationArtifactFileValue,
} from '@/lib/presentation/presentation-artifacts'
import { resolveStorageKeyFromFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { verifyFileAccess } from '@/app/api/files/authorization'
import type { UserFile } from '@/executor/types'

const logger = createLogger('HermesPresentationSource')
const PPTX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const MAX_SOURCE_BYTES = 200 * 1024 * 1024
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])

export type HermesPresentationSourceErrorCode =
  | 'USER_PERMISSION_DENIED'
  | 'WORKFLOW_NOT_FOUND'
  | 'PRESENTATION_NODE_NOT_FOUND'
  | 'PRESENTATION_FILE_NOT_FOUND'
  | 'PRESENTATION_FILE_INVALID'
  | 'PRESENTATION_FILE_TOO_LARGE'
  | 'INTERNAL_ERROR'

export class HermesPresentationSourceError extends Error {
  constructor(
    public readonly code: HermesPresentationSourceErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'HermesPresentationSourceError'
  }
}

export interface ExportHermesPresentationSourceParams {
  userId: string
  workspaceId: string
  workflowId: string
  nodeId: string
}

export interface ExportHermesPresentationSourceResult {
  buffer: Buffer
  fileName: string
  contentType: string
  size: number
}

function readSubBlockValue(subBlocks: unknown, id: string): unknown {
  if (!subBlocks || typeof subBlocks !== 'object' || Array.isArray(subBlocks)) return null
  const rawValue = (subBlocks as Record<string, unknown>)[id]
  return rawValue && typeof rawValue === 'object' && 'value' in rawValue
    ? (rawValue as { value?: unknown }).value
    : rawValue
}

function toUserFile(file: PresentationArtifactFileValue): UserFile {
  const key = resolveStorageKeyFromFileInput(file)
  if (!key) {
    throw new HermesPresentationSourceError(
      'PRESENTATION_FILE_NOT_FOUND',
      'The original PPT has no readable storage key.'
    )
  }

  return {
    id: file.id ?? key,
    name: file.name ?? 'original.pptx',
    url: file.url ?? file.path ?? '',
    size: file.size ?? 0,
    type: file.type ?? PPTX_CONTENT_TYPE,
    key,
    ...(file.context ? { context: file.context } : {}),
  }
}

export async function exportHermesPresentationSource(
  params: ExportHermesPresentationSourceParams
): Promise<ExportHermesPresentationSourceResult> {
  const authorization = await authorizeWorkflowByWorkspacePermission({
    userId: params.userId,
    workflowId: params.workflowId,
    action: 'write',
  })
  if (!authorization.allowed || authorization.accessSource !== 'workspace') {
    if (authorization.status === 404) {
      throw new HermesPresentationSourceError('WORKFLOW_NOT_FOUND', 'Canvas not found.')
    }
    throw new HermesPresentationSourceError(
      'USER_PERMISSION_DENIED',
      authorization.message ?? 'Canvas write access denied for this user.'
    )
  }
  if (authorization.workflow?.workspaceId !== params.workspaceId) {
    throw new HermesPresentationSourceError('WORKFLOW_NOT_FOUND', 'Canvas not found.')
  }

  const normalized = await loadWorkflowFromNormalizedTables(params.workflowId)
  if (!normalized) {
    throw new HermesPresentationSourceError('WORKFLOW_NOT_FOUND', 'Canvas not found.')
  }

  const block = normalized.blocks[params.nodeId]
  if (!block) {
    throw new HermesPresentationSourceError(
      'PRESENTATION_NODE_NOT_FOUND',
      `PPT node "${params.nodeId}" was not found.`
    )
  }

  const artifact = normalizePresentationArtifact(
    readSubBlockValue(block.subBlocks, 'presentationArtifact')
  )
  const sourceFile = artifact?.originalPptxFile ?? artifact?.pptxFile
  if (!sourceFile) {
    throw new HermesPresentationSourceError(
      'PRESENTATION_FILE_NOT_FOUND',
      `PPT node "${params.nodeId}" has no original PPT artifact.`
    )
  }

  const userFile = toUserFile(sourceFile)
  const hasFileAccess = await verifyFileAccess(
    userFile.key,
    params.userId,
    undefined,
    userFile.context as Parameters<typeof verifyFileAccess>[3]
  )
  if (!hasFileAccess) {
    throw new HermesPresentationSourceError(
      'PRESENTATION_FILE_NOT_FOUND',
      'The original PPT is unavailable or no longer accessible.'
    )
  }

  try {
    const buffer = await downloadFileFromStorage(
      userFile,
      `hermes-presentation-source-${params.nodeId}`,
      logger
    )
    if (buffer.length > MAX_SOURCE_BYTES) {
      throw new HermesPresentationSourceError(
        'PRESENTATION_FILE_TOO_LARGE',
        'The original PPT exceeds the 200 MB editable conversion limit.'
      )
    }
    if (
      buffer.length < ZIP_MAGIC.length ||
      !buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)
    ) {
      throw new HermesPresentationSourceError(
        'PRESENTATION_FILE_INVALID',
        'The original PPT is not a valid PPTX package.'
      )
    }

    return {
      buffer,
      fileName: userFile.name.toLowerCase().endsWith('.pptx')
        ? userFile.name
        : `${userFile.name}.pptx`,
      contentType: PPTX_CONTENT_TYPE,
      size: buffer.length,
    }
  } catch (error) {
    if (error instanceof HermesPresentationSourceError) throw error
    throw new HermesPresentationSourceError('INTERNAL_ERROR', toError(error).message)
  }
}
