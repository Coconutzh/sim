'use client'

import { createElement, memo, type ReactNode } from 'react'
import type { NodeProps } from 'reactflow'
import { cn } from '@/lib/core/utils/cn'
import {
  normalizePresentationArtifact,
  resolvePresentationArtifactFileUrl,
} from '@/lib/presentation/presentation-artifacts'

type ContentVariant = 'text' | 'image' | 'video' | 'audio' | 'presentation'

interface UploadedFileValue {
  name?: string
  url?: string
  path?: string
  key?: string
  type?: string
  size?: number
}

interface PreviewContentBlockData {
  type: string
  name: string
  contentVariant?: string
  subBlockValues?: Record<string, { value?: unknown }>
  isPreviewSelected?: boolean
  executionStatus?: 'success' | 'error' | 'not-executed'
}

const DEFAULT_TEXT_HTML = '<p></p>'

function extractStoredValue<T>(
  source: Record<string, { value?: unknown }> | undefined,
  key: string,
  fallback: T
): T {
  return ((source?.[key]?.value as T | undefined) ?? fallback) as T
}

function isMeaningfulHtml(html: string): boolean {
  return (
    html
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim().length > 0
  )
}

function normalizeContentHtml(input: string | null | undefined): string {
  if (typeof window === 'undefined') {
    return input && input.trim().length > 0 ? input : DEFAULT_TEXT_HTML
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(
    input && input.trim().length > 0 ? input : DEFAULT_TEXT_HTML,
    'text/html'
  )
  return doc.body.innerHTML.trim() || DEFAULT_TEXT_HTML
}

function renderContentHtml(input: string | null | undefined, emptyStateText: string): ReactNode {
  const normalizedHtml = normalizeContentHtml(input)

  if (!isMeaningfulHtml(normalizedHtml)) {
    return createElement('p', { style: { opacity: 0.65 } }, emptyStateText)
  }

  if (typeof window === 'undefined') {
    return normalizedHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .trim()
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(normalizedHtml, 'text/html')
  const allowedTags = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'br'])

  const renderNode = (node: ChildNode, key: string): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? ''
    }

    if (!(node instanceof HTMLElement)) {
      return null
    }

    let tagName = node.tagName.toLowerCase()
    if (tagName === 'b') tagName = 'strong'
    if (tagName === 'i') tagName = 'em'
    if (tagName === 'div') tagName = 'p'
    if (tagName === 'font' || tagName === 'span') {
      return Array.from(node.childNodes).map((child, index) => renderNode(child, `${key}-${index}`))
    }

    if (!allowedTags.has(tagName)) {
      return Array.from(node.childNodes).map((child, index) => renderNode(child, `${key}-${index}`))
    }

    if (tagName === 'br') {
      return createElement('br', { key })
    }

    return createElement(
      tagName,
      { key },
      Array.from(node.childNodes).map((child, index) => renderNode(child, `${key}-${index}`))
    )
  }

  return Array.from(doc.body.childNodes).map((child, index) => renderNode(child, `root-${index}`))
}

function normalizeVariant(value: unknown): ContentVariant | null {
  return value === 'image' ||
    value === 'text' ||
    value === 'video' ||
    value === 'audio' ||
    value === 'presentation'
    ? value
    : null
}

function hasUploadedFileValue(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      ('path' in value || 'url' in value || 'key' in value || 'name' in value) &&
      (typeof (value as UploadedFileValue).path === 'string' ||
        typeof (value as UploadedFileValue).url === 'string' ||
        typeof (value as UploadedFileValue).key === 'string' ||
        typeof (value as UploadedFileValue).name === 'string')
  )
}

function inferVariantFromFile(value: unknown): ContentVariant | null {
  if (!hasUploadedFileValue(value)) return null

  const file = value as UploadedFileValue
  const fileType = file.type?.toLowerCase()
  if (fileType?.startsWith('image/')) return 'image'
  if (fileType?.startsWith('video/')) return 'video'
  if (fileType?.startsWith('audio/')) return 'audio'
  if (fileType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    return 'presentation'
  }

  const fileName = `${file.name ?? ''} ${file.path ?? ''} ${file.url ?? ''}`.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?|$)/.test(fileName)) return 'image'
  if (/\.(mp4|webm|mov|m4v|ogv|avi|mkv)(\?|$)/.test(fileName)) return 'video'
  if (/\.(mp3|wav|ogg|m4a|aac|flac|webm)(\?|$)/.test(fileName)) return 'audio'
  if (/\.pptx(\?|$)/.test(fileName)) return 'presentation'

  return null
}

function resolveContentVariant(
  variant: unknown,
  sourceValues: Record<string, { value?: unknown }> | undefined
): ContentVariant {
  const directVariant = normalizeVariant(variant)
  if (directVariant) return directVariant

  const storedVariant = normalizeVariant(extractStoredValue(sourceValues, 'contentVariant', null))
  if (storedVariant) return storedVariant

  return (
    inferVariantFromFile(extractStoredValue(sourceValues, 'file', null)) ??
    (normalizePresentationArtifact(extractStoredValue(sourceValues, 'presentationArtifact', null))
      ? 'presentation'
      : null) ??
    'text'
  )
}

export const PreviewContentBlock = memo(function PreviewContentBlock({
  data,
}: NodeProps<PreviewContentBlockData>) {
  const variant = resolveContentVariant(data.contentVariant, data.subBlockValues)
  const html = normalizeContentHtml(
    extractStoredValue<string>(data.subBlockValues, 'contentHtml', DEFAULT_TEXT_HTML)
  )
  const backgroundColor = extractStoredValue<string>(
    data.subBlockValues,
    'backgroundColor',
    '#FFF8C5'
  )
  const fontSize = extractStoredValue<number>(data.subBlockValues, 'fontSize', 16)
  const width = extractStoredValue<number>(data.subBlockValues, 'width', 320)
  const height = extractStoredValue<number>(data.subBlockValues, 'height', 160)
  const file = extractStoredValue<UploadedFileValue | null>(data.subBlockValues, 'file', null)
  const presentationArtifact = normalizePresentationArtifact(
    extractStoredValue(data.subBlockValues, 'presentationArtifact', null)
  )
  const presentationPptxFile = presentationArtifact?.pptxFile ?? file
  const presentationCoverImageUrl = resolvePresentationArtifactFileUrl(
    presentationArtifact?.coverImageFile
  )
  const presentationPptxUrl = resolvePresentationArtifactFileUrl(presentationPptxFile)
  const hasSuccess = data.executionStatus === 'success'
  const hasError = data.executionStatus === 'error'

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] shadow-sm',
        data.isPreviewSelected && 'ring-[1.75px] ring-[var(--brand-secondary)]',
        !data.isPreviewSelected && hasSuccess && 'ring-[1.75px] ring-[var(--brand-accent)]',
        !data.isPreviewSelected && hasError && 'ring-[1.75px] ring-[var(--text-error)]'
      )}
      style={
        variant === 'image'
          ? { width: 320, minHeight: 240 }
          : variant === 'video'
            ? { width: 360, minHeight: 240 }
            : variant === 'audio'
              ? { width: 360, minHeight: 132 }
              : variant === 'presentation'
                ? { width: 380, minHeight: 260 }
                : { width, minHeight: height }
      }
    >
      {variant === 'image' ? (
        file?.path ? (
          <div className='flex h-[240px] w-[320px] items-center justify-center bg-[var(--surface-1)] px-3 py-3'>
            <img
              src={file.path}
              alt={file.name || 'Uploaded content'}
              className='max-h-full max-w-full rounded-xl object-contain'
            />
          </div>
        ) : (
          <div className='flex h-[240px] w-[320px] items-center justify-center px-6 text-center text-[var(--text-tertiary)] text-sm'>
            No image uploaded
          </div>
        )
      ) : variant === 'video' ? (
        file?.path ? (
          <div className='flex w-[360px] flex-col gap-3 bg-[var(--surface-1)] px-3 py-3'>
            {/* biome-ignore lint/a11y/useMediaCaption: preview video cards do not have a caption track in this iteration. */}
            <video
              src={file.path}
              controls
              preload='metadata'
              className='aspect-video w-full rounded-xl bg-black object-contain'
            />
          </div>
        ) : (
          <div className='flex h-[240px] w-[360px] items-center justify-center px-6 text-center text-[var(--text-tertiary)] text-sm'>
            No video uploaded
          </div>
        )
      ) : variant === 'audio' ? (
        file?.path ? (
          <div className='flex min-h-[132px] w-[360px] flex-col justify-center gap-3 bg-[var(--surface-1)] px-4 py-4'>
            <div className='truncate font-medium text-[var(--text-primary)] text-sm'>
              {file.name || 'Uploaded audio'}
            </div>
            {/* biome-ignore lint/a11y/useMediaCaption: preview audio cards do not have a caption track in this iteration. */}
            <audio src={file.path} controls preload='metadata' className='w-full' />
          </div>
        ) : (
          <div className='flex h-[132px] w-[360px] items-center justify-center px-6 text-center text-[var(--text-tertiary)] text-sm'>
            No audio uploaded
          </div>
        )
      ) : variant === 'presentation' ? (
        <div className='w-[380px] overflow-hidden bg-[var(--surface-1)]'>
          <div className='flex h-[198px] items-center justify-center'>
            {presentationCoverImageUrl ? (
              <img
                src={presentationCoverImageUrl}
                alt={presentationArtifact?.manifest?.title || presentationPptxFile?.name || 'PPT'}
                className='h-full w-full object-cover'
              />
            ) : (
              <div className='px-6 text-center text-[var(--text-tertiary)] text-sm'>
                {presentationPptxUrl ? 'PPTX artifact ready' : 'No PPT generated'}
              </div>
            )}
          </div>
          <div className='border-[var(--border)] border-t px-4 py-3'>
            <div className='truncate font-medium text-[var(--text-primary)] text-sm'>
              {presentationArtifact?.manifest?.title || presentationPptxFile?.name || 'PPT'}
            </div>
            <div className='mt-1 text-[var(--text-tertiary)] text-xs'>
              {presentationArtifact?.manifest?.slideCount ?? 8} pages
            </div>
          </div>
        </div>
      ) : (
        <div
          className='min-h-[120px] px-4 py-3 text-[var(--text-primary)] [&_h1]:mb-2 [&_h1]:font-semibold [&_h1]:text-[2em] [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-[1.6em] [&_h3]:mb-2 [&_h3]:font-semibold [&_h3]:text-[1.3em] [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_p]:min-h-[1.5em] [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1'
          style={{ backgroundColor, fontSize, minHeight: height }}
        >
          {renderContentHtml(html, 'Empty text card')}
        </div>
      )}
    </div>
  )
})
