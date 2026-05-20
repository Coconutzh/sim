import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import { resolveFileCategory } from './file-category'

export type PreviewMode = 'editor' | 'split' | 'preview'

export type PreviewType = 'markdown' | 'html' | 'csv' | 'svg' | 'mermaid' | null

const PREVIEWABLE_MIME_TYPES: Record<string, PreviewType> = {
  'text/markdown': 'markdown',
  'text/html': 'html',
  'text/csv': 'csv',
  'image/svg+xml': 'svg',
  'text/x-mermaid': 'mermaid',
}

const PREVIEWABLE_EXTENSIONS: Record<string, PreviewType> = {
  md: 'markdown',
  html: 'html',
  htm: 'html',
  csv: 'csv',
  svg: 'svg',
  mmd: 'mermaid',
}

/** All extensions that have a rich preview renderer. */
export const RICH_PREVIEWABLE_EXTENSIONS = new Set(Object.keys(PREVIEWABLE_EXTENSIONS))

export function resolvePreviewType(mimeType: string | null, filename: string): PreviewType {
  if (mimeType && PREVIEWABLE_MIME_TYPES[mimeType]) return PREVIEWABLE_MIME_TYPES[mimeType]
  const ext = getFileExtension(filename)
  return PREVIEWABLE_EXTENSIONS[ext] ?? null
}

export function isTextEditable(file: { type: string; name: string }): boolean {
  return resolveFileCategory(file.type, file.name) === 'text-editable'
}

export function isPreviewable(file: { type: string; name: string }): boolean {
  return resolvePreviewType(file.type, file.name) !== null
}
