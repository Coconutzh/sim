import { resolveUserFileUrl } from '@/lib/core/utils/user-file'

export interface PresentationArtifactFileValue {
  id?: string
  name?: string
  url?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
  base64?: string
}

export interface PresentationArtifactManifestValue {
  title?: string
  source?: string
  backendName?: string
  backendType?: 'editable' | 'image_based'
  renderer?: string
  editable?: boolean
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
  createdAt?: string
}

export interface PresentationArtifactValue {
  pptxFile?: PresentationArtifactFileValue | null
  originalPptxFile?: PresentationArtifactFileValue | null
  editablePptxFile?: PresentationArtifactFileValue | null
  editableStatus?: 'not_requested' | 'queued' | 'processing' | 'complete' | 'error'
  editableTaskId?: string | null
  editableError?: string | null
  coverImageFile?: PresentationArtifactFileValue | null
  manifestFile?: PresentationArtifactFileValue | null
  manifest?: PresentationArtifactManifestValue | null
  auditId?: string
  traceId?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizeFile(value: unknown): PresentationArtifactFileValue | null {
  const record = asRecord(value)
  if (!record) return null
  const key = typeof record.key === 'string' ? record.key.trim() : ''
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const url = resolveUserFileUrl(record)
  if (!key && !name && !url) return null

  return {
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    ...(name ? { name } : {}),
    ...(url ? { url, path: url } : {}),
    ...(key ? { key } : {}),
    ...(typeof record.size === 'number' ? { size: record.size } : {}),
    ...(typeof record.type === 'string' ? { type: record.type } : {}),
    ...(typeof record.context === 'string' ? { context: record.context } : {}),
    ...(typeof record.base64 === 'string' ? { base64: record.base64 } : {}),
  }
}

function normalizeManifest(value: unknown): PresentationArtifactManifestValue | null {
  const record = asRecord(value)
  if (!record) return null

  return {
    ...(typeof record.title === 'string' ? { title: record.title } : {}),
    ...(typeof record.source === 'string' ? { source: record.source } : {}),
    ...(typeof record.backendName === 'string' ? { backendName: record.backendName } : {}),
    ...(record.backendType === 'editable' || record.backendType === 'image_based'
      ? { backendType: record.backendType }
      : {}),
    ...(typeof record.renderer === 'string' ? { renderer: record.renderer } : {}),
    ...(typeof record.editable === 'boolean' ? { editable: record.editable } : {}),
    ...(typeof record.slideCount === 'number' ? { slideCount: record.slideCount } : {}),
    ...(typeof record.selectedStyle === 'string' ? { selectedStyle: record.selectedStyle } : {}),
    ...(typeof record.styleBrief === 'string' ? { styleBrief: record.styleBrief } : {}),
    ...(typeof record.imageBackend === 'string' ? { imageBackend: record.imageBackend } : {}),
    ...(typeof record.imageProvider === 'string' ? { imageProvider: record.imageProvider } : {}),
    ...(typeof record.imageModel === 'string' ? { imageModel: record.imageModel } : {}),
    ...(typeof record.imageBaseUrl === 'string' ? { imageBaseUrl: record.imageBaseUrl } : {}),
    ...(typeof record.outlineMarkdown === 'string'
      ? { outlineMarkdown: record.outlineMarkdown }
      : {}),
    ...(typeof record.speechMarkdown === 'string' ? { speechMarkdown: record.speechMarkdown } : {}),
    ...(typeof record.targetNodeId === 'string' ? { targetNodeId: record.targetNodeId } : {}),
    ...(typeof record.createdAt === 'string' ? { createdAt: record.createdAt } : {}),
  }
}

export function normalizePresentationArtifact(value: unknown): PresentationArtifactValue | null {
  const rawValue =
    typeof value === 'string' && value.trim()
      ? (() => {
          try {
            return JSON.parse(value) as unknown
          } catch {
            return null
          }
        })()
      : value
  const record = asRecord(rawValue)
  if (!record) return null

  const pptxFile = normalizeFile(record.pptxFile)
  const originalPptxFile = normalizeFile(record.originalPptxFile) ?? pptxFile
  const editablePptxFile = normalizeFile(record.editablePptxFile)
  const coverImageFile = normalizeFile(record.coverImageFile)
  const manifestFile = normalizeFile(record.manifestFile)
  const manifest = normalizeManifest(record.manifest)

  if (!pptxFile && !originalPptxFile && !editablePptxFile && !coverImageFile && !manifest)
    return null

  return {
    ...(pptxFile ? { pptxFile } : {}),
    ...(originalPptxFile ? { originalPptxFile } : {}),
    ...(editablePptxFile ? { editablePptxFile } : {}),
    ...(record.editableStatus === 'not_requested' ||
    record.editableStatus === 'queued' ||
    record.editableStatus === 'processing' ||
    record.editableStatus === 'complete' ||
    record.editableStatus === 'error'
      ? { editableStatus: record.editableStatus }
      : {}),
    ...(typeof record.editableTaskId === 'string' ? { editableTaskId: record.editableTaskId } : {}),
    ...(typeof record.editableError === 'string' ? { editableError: record.editableError } : {}),
    ...(coverImageFile ? { coverImageFile } : {}),
    ...(manifestFile ? { manifestFile } : {}),
    ...(manifest ? { manifest } : {}),
    ...(typeof record.auditId === 'string' ? { auditId: record.auditId } : {}),
    ...(typeof record.traceId === 'string' ? { traceId: record.traceId } : {}),
  }
}

export function resolvePresentationArtifactFileUrl(
  file: PresentationArtifactFileValue | null | undefined
): string {
  return resolveUserFileUrl(file)
}
