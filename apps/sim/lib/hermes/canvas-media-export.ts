import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  loadCanvasSnapshot,
  readCanvasNodeDetail,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context'
import { resolveLocalAgentPermissions } from '@/lib/copilot/request/lifecycle/local-canvas-agent/permissions'
import type { CanvasNodeDetail } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import { downloadFileFromStorage, downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'

const logger = createLogger('HermesCanvasMediaExport')
const MAX_EXPORTED_IMAGE_BYTES = 20 * 1024 * 1024

export type HermesCanvasMediaExportErrorCode =
  | 'USER_PERMISSION_DENIED'
  | 'WORKFLOW_NOT_FOUND'
  | 'MEDIA_NODE_NOT_FOUND'
  | 'MEDIA_NODE_AMBIGUOUS'
  | 'MEDIA_UNSUPPORTED'
  | 'MEDIA_FILE_NOT_FOUND'
  | 'MEDIA_TOO_LARGE'
  | 'INTERNAL_ERROR'

export class HermesCanvasMediaExportError extends Error {
  constructor(
    public readonly code: HermesCanvasMediaExportErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'HermesCanvasMediaExportError'
  }
}

export interface ExportHermesCanvasNodeImageParams {
  userId: string
  workspaceId: string
  workflowId: string
  nodeId?: string
  selectedNodeIds?: string[]
}

export interface ExportHermesCanvasNodeImageResult {
  buffer: Buffer
  nodeId: string
  nodeTitle: string
  fileName: string
  contentType: string
  size: number
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function resolveTargetNodeId(
  params: Pick<ExportHermesCanvasNodeImageParams, 'nodeId' | 'selectedNodeIds'>
): string {
  if (params.nodeId?.trim()) return params.nodeId.trim()
  const selected = (params.selectedNodeIds ?? []).filter((id) => id.trim().length > 0)
  if (selected.length === 1) return selected[0]
  if (selected.length > 1) {
    throw new HermesCanvasMediaExportError(
      'MEDIA_NODE_AMBIGUOUS',
      'Multiple canvas nodes are selected; pass the exact image nodeId to export.'
    )
  }
  throw new HermesCanvasMediaExportError(
    'MEDIA_NODE_NOT_FOUND',
    'No image nodeId was provided and no single selected image node is available.'
  )
}

function getFileRecord(detail: CanvasNodeDetail): Record<string, unknown> | null {
  const directFile = asRecord(detail.file)
  if (directFile && Object.keys(directFile).length > 0) return directFile
  const fieldFile = asRecord(detail.fields.file)
  return fieldFile && Object.keys(fieldFile).length > 0 ? fieldFile : null
}

function getMimeType(file: Record<string, unknown>): string {
  const explicit = asString(file.type)
  if (explicit) return explicit
  const name = asString(file.name).toLowerCase()
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.gif')) return 'image/gif'
  return ''
}

function toUserFile(file: Record<string, unknown>, fallbackName: string): UserFile {
  const key = asString(file.key)
  const url = asString(file.url) || asString(file.path)
  const name = asString(file.name) || fallbackName
  return {
    id: asString(file.id) || key || url || name,
    name,
    url,
    size: typeof file.size === 'number' ? file.size : 0,
    type: getMimeType(file) || 'application/octet-stream',
    key,
    ...(asString(file.context) ? { context: asString(file.context) } : {}),
  }
}

async function fetchImageBuffer(params: {
  detail: CanvasNodeDetail
  file: Record<string, unknown>
}): Promise<Buffer> {
  const userFile = toUserFile(params.file, `${params.detail.name}.png`)
  if (userFile.key) {
    return downloadFileFromStorage(userFile, `hermes-canvas-media-${params.detail.id}`, logger)
  }
  if (userFile.url) {
    return downloadFileFromUrl(userFile.url, 15_000)
  }
  throw new HermesCanvasMediaExportError(
    'MEDIA_FILE_NOT_FOUND',
    'The image node has file metadata but no readable storage key or URL.'
  )
}

export async function exportHermesCanvasNodeImage(
  params: ExportHermesCanvasNodeImageParams
): Promise<ExportHermesCanvasNodeImageResult> {
  const permissions = await resolveLocalAgentPermissions({
    userId: params.userId,
    workflowId: params.workflowId,
  })
  if (!permissions.canRead) {
    throw new HermesCanvasMediaExportError(
      'USER_PERMISSION_DENIED',
      permissions.readonlyReason ?? 'Canvas access denied for this user.'
    )
  }

  const nodeId = resolveTargetNodeId(params)
  const snapshot = await loadCanvasSnapshot({
    workspaceId: params.workspaceId,
    workflowId: params.workflowId,
  })
  const detail = readCanvasNodeDetail(snapshot, nodeId, params.selectedNodeIds ?? [])
  if (!detail) {
    throw new HermesCanvasMediaExportError(
      'MEDIA_NODE_NOT_FOUND',
      `Node "${nodeId}" was not found.`
    )
  }
  if (detail.kind !== 'image') {
    throw new HermesCanvasMediaExportError(
      'MEDIA_UNSUPPORTED',
      `Node "${nodeId}" is ${detail.kind}, not an image node.`
    )
  }

  const file = getFileRecord(detail)
  if (!file) {
    throw new HermesCanvasMediaExportError(
      'MEDIA_FILE_NOT_FOUND',
      `Image node "${nodeId}" has no generated image file.`
    )
  }

  const contentType = getMimeType(file)
  if (!contentType.startsWith('image/')) {
    throw new HermesCanvasMediaExportError(
      'MEDIA_UNSUPPORTED',
      `Image node "${nodeId}" file is not an image MIME type.`
    )
  }

  try {
    const buffer = await fetchImageBuffer({ detail, file })
    if (buffer.length > MAX_EXPORTED_IMAGE_BYTES) {
      throw new HermesCanvasMediaExportError(
        'MEDIA_TOO_LARGE',
        `Image node "${nodeId}" is too large to export for Hermes vision.`
      )
    }
    return {
      buffer,
      nodeId: detail.id,
      nodeTitle: detail.name,
      fileName: asString(file.name) || `${detail.name}.png`,
      contentType,
      size: buffer.length,
    }
  } catch (error) {
    if (error instanceof HermesCanvasMediaExportError) throw error
    const err = toError(error)
    throw new HermesCanvasMediaExportError('INTERNAL_ERROR', err.message)
  }
}
