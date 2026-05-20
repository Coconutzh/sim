'use client'

import type { MutableRefObject } from 'react'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

export type { StreamingMode } from './text-editor-state'

export type PreviewMode = 'editor' | 'split' | 'preview'

export const RICH_PREVIEWABLE_EXTENSIONS = new Set<string>()

export function isTextEditable(): boolean {
  return false
}

export function isPreviewable(): boolean {
  return false
}

interface FileViewerProps {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  previewMode?: PreviewMode
  autoFocus?: boolean
  onDirtyChange?: (isDirty: boolean) => void
  onSaveStatusChange?: (status: 'idle' | 'saving' | 'saved' | 'error') => void
  saveRef?: MutableRefObject<(() => Promise<void>) | null>
  streamingContent?: string
  streamingMode?: string
  disableStreamingAutoScroll?: boolean
  previewContextKey?: string
}

export function FileViewer({ file }: FileViewerProps) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-2 bg-[var(--surface-1)] p-8 text-center'>
      <p className='font-medium text-[14px] text-[var(--text-primary)]'>{file.name}</p>
      <p className='max-w-[360px] text-[13px] text-[var(--text-secondary)]'>
        File preview is disabled in low-memory local development mode.
      </p>
    </div>
  )
}
