'use client'

import type { ChangeEvent, ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import { createElement, memo, useCallback, useEffect, useRef, useState } from 'react'
import { Copy as CopyIcon, ImagePlus, List, Pilcrow, Type } from 'lucide-react'
import { useParams } from 'next/navigation'
import type { NodeProps } from 'reactflow'
import { cn } from '@/lib/core/utils/cn'
import {
  DEFAULT_IMAGE_AI_MODEL,
  DEFAULT_IMAGE_ASPECT_RATIO,
  getNearestSupportedImageAspectRatio,
  getResolvedImageAspectRatio,
  type ImageAspectRatioValue,
  type ImageGenerationModelId,
} from '@/lib/generated-media/image/image-generation-utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-context'
import { ActionBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/action-bar'
import { ContentNodeAiComposer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-node-ai-composer'
import { MediaContentAiComposer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/media-content-ai-composer'
import { DEFAULT_TEXT_AI_MODEL } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/text-content-ai-utils'
import { useImageContentAiSession } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-image-content-ai-session'
import { useTextContentAiSession } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-text-content-ai-session'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WorkflowBlockProps } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/types'
import { useBlockVisual } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useBlockDimensions } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-block-dimensions'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

type ContentVariant = 'text' | 'image' | 'video' | 'audio'
type StoredValueRecord = Record<string, { value?: unknown } | unknown> | undefined

interface ContentBlockNodeData extends WorkflowBlockProps {}

interface UploadedFileValue {
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
}

const DEFAULT_TEXT_HTML = '<p></p>'
const DEFAULT_TEXT_WIDTH = 320
const DEFAULT_TEXT_HEIGHT = 160
const MIN_TEXT_WIDTH = 220
const MAX_TEXT_WIDTH = 640
const MIN_TEXT_HEIGHT = 120
const MAX_TEXT_HEIGHT = 720
const DEFAULT_BACKGROUND_COLOR = '#FFF8C5'
const DEFAULT_FONT_SIZE = 16
const IMAGE_CARD_WIDTH = 320
const IMAGE_CARD_HEIGHT = 240
const VIDEO_CARD_WIDTH = 360
const VIDEO_CARD_HEIGHT = 240
const AUDIO_CARD_WIDTH = 360
const AUDIO_CARD_HEIGHT = 132

const FONT_SIZE_OPTIONS = [14, 16, 18, 20, 24, 32] as const
const BACKGROUND_COLORS = ['#FFF8C5', '#FEE2E2', '#DBEAFE', '#DCFCE7', '#F3E8FF'] as const

function extractStoredValue<T>(source: StoredValueRecord, key: string, fallback: T): T {
  const rawValue = source?.[key]
  if (rawValue && typeof rawValue === 'object' && 'value' in rawValue) {
    return ((rawValue as { value?: T }).value ?? fallback) as T
  }
  return (rawValue ?? fallback) as T
}

function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function clampTextWidth(value: number): number {
  return Math.max(MIN_TEXT_WIDTH, Math.min(MAX_TEXT_WIDTH, value))
}

function clampTextHeight(value: number): number {
  return Math.max(MIN_TEXT_HEIGHT, Math.min(MAX_TEXT_HEIGHT, value))
}

function normalizeVariant(value: unknown): ContentVariant | null {
  return value === 'image' || value === 'text' || value === 'video' || value === 'audio'
    ? value
    : null
}

function hasUploadedFileValue(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      ('path' in value || 'key' in value || 'name' in value) &&
      (typeof (value as UploadedFileValue).path === 'string' ||
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

  const fileName = `${file.name ?? ''} ${file.path ?? ''}`.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?|$)/.test(fileName)) return 'image'
  if (/\.(mp4|webm|mov|m4v|ogv|avi|mkv)(\?|$)/.test(fileName)) return 'video'
  if (/\.(mp3|wav|ogg|m4a|aac|flac|webm)(\?|$)/.test(fileName)) return 'audio'

  return null
}

function matchesVariantFile(value: unknown, variant: ContentVariant): boolean {
  return inferVariantFromFile(value) === variant
}

function resolveContentVariant(
  variant: unknown,
  sourceValues: StoredValueRecord,
  fileValue?: unknown
): ContentVariant {
  const directVariant = normalizeVariant(variant)
  if (directVariant) return directVariant

  const storedVariant = normalizeVariant(extractStoredValue(sourceValues, 'contentVariant', null))
  if (storedVariant) return storedVariant

  return (
    inferVariantFromFile(fileValue) ??
    inferVariantFromFile(extractStoredValue(sourceValues, 'file', null)) ??
    'text'
  )
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
  const output = doc.createElement('div')
  const inlineTags = new Set(['strong', 'em', 'br'])
  const blockTags = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li'])

  const sanitizeNode = (node: ChildNode, parent: HTMLElement) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(doc.createTextNode(node.textContent ?? ''))
      return
    }

    if (!(node instanceof HTMLElement)) {
      return
    }

    let tagName = node.tagName.toLowerCase()
    if (tagName === 'b') tagName = 'strong'
    if (tagName === 'i') tagName = 'em'
    if (tagName === 'div') tagName = 'p'
    if (tagName === 'font' || tagName === 'span') {
      Array.from(node.childNodes).forEach((child) => sanitizeNode(child, parent))
      return
    }

    if (!inlineTags.has(tagName) && !blockTags.has(tagName)) {
      Array.from(node.childNodes).forEach((child) => sanitizeNode(child, parent))
      return
    }

    const element = doc.createElement(tagName)
    Array.from(node.childNodes).forEach((child) => sanitizeNode(child, element))
    parent.appendChild(element)
  }

  Array.from(doc.body.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const paragraph = doc.createElement('p')
      sanitizeNode(node, paragraph)
      output.appendChild(paragraph)
      return
    }
    sanitizeNode(node, output)
  })

  const sanitized = output.innerHTML.trim()
  return isMeaningfulHtml(sanitized) ? sanitized : DEFAULT_TEXT_HTML
}

function getPlainTextFromHtml(input: string | null | undefined): string {
  const normalizedHtml = normalizeContentHtml(input)

  if (typeof window === 'undefined') {
    return normalizedHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .trim()
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(normalizedHtml, 'text/html')
  return doc.body.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

function renderContentHtml(input: string | null | undefined, emptyStateText: string): ReactNode {
  const normalizedHtml = normalizeContentHtml(input)

  if (!isMeaningfulHtml(normalizedHtml)) {
    return createElement('p', { style: { opacity: 0.65 } }, emptyStateText)
  }

  if (typeof window === 'undefined') {
    return getPlainTextFromHtml(normalizedHtml)
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

function TextToolbarButton({
  label,
  onClick,
  active = false,
  title,
  children,
}: {
  label: string
  onClick: () => void
  active?: boolean
  title?: string
  children?: ReactNode
}) {
  return (
    <button
      type='button'
      title={title ?? label}
      aria-label={label}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        'flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs transition-colors',
        active
          ? 'border-transparent bg-[var(--brand-secondary)] text-[var(--text-inverse)]'
          : 'border-[var(--border-1)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover-hover:bg-[var(--surface-3)]'
      )}
    >
      {children ?? label}
    </button>
  )
}

function TextContentCard({
  blockId,
  selected,
  canEdit,
  isPreview,
  isEmbedded,
  html,
  blockStyle,
  backgroundColor,
  fontSize,
  width,
  height,
  aiPrompt,
  aiModel,
  onChangeHtml,
  onChangeBlockStyle,
  onChangeBackgroundColor,
  onChangeFontSize,
  onChangeWidth,
  onChangeHeight,
  onChangeAiPrompt,
  onChangeAiModel,
}: {
  blockId: string
  selected: boolean
  canEdit: boolean
  isPreview: boolean
  isEmbedded: boolean
  html: string
  blockStyle: string
  backgroundColor: string
  fontSize: number
  width: number
  height: number
  aiPrompt: string
  aiModel: string
  onChangeHtml: (value: string) => void
  onChangeBlockStyle: (value: string) => void
  onChangeBackgroundColor: (value: string) => void
  onChangeFontSize: (value: number) => void
  onChangeWidth: (value: number) => void
  onChangeHeight: (value: number) => void
  onChangeAiPrompt: (value: string) => void
  onChangeAiModel: (value: string) => void
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const params = useParams<{ workspaceId: string }>()
  const [isEditing, setIsEditing] = useState(false)
  const [draftHtml, setDraftHtml] = useState(html)
  const {
    modelOptions,
    isGenerating,
    error,
    pendingGeneratedText,
    pendingActionChoice,
    submitPrompt,
    applyPendingGeneratedText,
  } = useTextContentAiSession({
    blockId,
    workspaceId: params.workspaceId,
    html,
    prompt: aiPrompt,
    model: aiModel,
    onChangeHtml,
  })

  useEffect(() => {
    if (!isEditing) {
      setDraftHtml(html)
    }
  }, [html, isEditing])

  useEffect(() => {
    if (!isEditing || !editorRef.current) return
    editorRef.current.innerHTML = html
    editorRef.current.focus()
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(editorRef.current)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [html, isEditing])

  const syncDraftFromEditor = useCallback(() => {
    const nextHtml = normalizeContentHtml(editorRef.current?.innerHTML ?? DEFAULT_TEXT_HTML)
    setDraftHtml(nextHtml)
    onChangeHtml(nextHtml)
    return nextHtml
  }, [onChangeHtml])

  const applyEditorCommand = useCallback(
    (command: string, value?: string) => {
      if (!editorRef.current) return
      editorRef.current.focus()
      document.execCommand(command, false, value)
      syncDraftFromEditor()
    },
    [syncDraftFromEditor]
  )

  const handleApplyBlockStyle = useCallback(
    (nextStyle: string) => {
      onChangeBlockStyle(nextStyle)
      if (!isEditing) return
      const formatTarget = nextStyle === 'paragraph' ? '<p>' : `<${nextStyle.toLowerCase()}>`
      applyEditorCommand('formatBlock', formatTarget)
    },
    [applyEditorCommand, isEditing, onChangeBlockStyle]
  )

  const handleCopyNode = useCallback(() => {
    useWorkflowRegistry.getState().copyBlocks([blockId])

    const plainText = getPlainTextFromHtml(isEditing ? draftHtml : html)
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(plainText).catch(() => {})
    }
  }, [blockId, draftHtml, html, isEditing])

  const startResizeSession = useCallback(
    (event: ReactPointerEvent<HTMLElement>, axis: 'width' | 'height') => {
      if (!canEdit || isPreview) return

      event.preventDefault()
      event.stopPropagation()

      const startX = event.clientX
      const startY = event.clientY
      const startWidth = width
      const startHeight = height

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (axis === 'width') {
          const nextWidth = clampTextWidth(startWidth + (moveEvent.clientX - startX))
          onChangeWidth(nextWidth)
          return
        }

        const nextHeight = clampTextHeight(startHeight + (moveEvent.clientY - startY))
        onChangeHeight(nextHeight)
      }

      const handlePointerUp = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    },
    [canEdit, height, isPreview, onChangeHeight, onChangeWidth, width]
  )

  const enterEditing = useCallback(() => {
    if (!canEdit || isPreview) return
    setIsEditing(true)
  }, [canEdit, isPreview])

  const editingContentClassName =
    'nodrag nopan px-4 py-3 text-[var(--text-primary)] outline-none [&_h1]:mb-2 [&_h1]:font-semibold [&_h1]:text-[2em] [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-[1.6em] [&_h3]:mb-2 [&_h3]:font-semibold [&_h3]:text-[1.3em] [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_p]:min-h-[1.5em] [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1'
  const displayContentClassName =
    'nopan px-4 py-3 text-[var(--text-primary)] [&_h1]:mb-2 [&_h1]:font-semibold [&_h1]:text-[2em] [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-[1.6em] [&_h3]:mb-2 [&_h3]:font-semibold [&_h3]:text-[1.3em] [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_p]:min-h-[1.5em] [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1'
  const cardMinHeight = clampTextHeight(height)

  const showToolbar = selected && !isPreview
  const normalizedHtml = normalizeContentHtml(isEditing ? draftHtml : html)
  const isEmpty = !isMeaningfulHtml(normalizedHtml)

  return (
    <div className='relative' style={{ width, minHeight: cardMinHeight }}>
      {showToolbar && (
        <div
          className='nodrag nopan absolute top-[-92px] right-0 z-50 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2 shadow-lg'
          onPointerDownCapture={(event) => {
            event.stopPropagation()
          }}
        >
          <div className='flex items-center gap-1 rounded-lg bg-[var(--surface-1)] p-1'>
            {BACKGROUND_COLORS.map((color) => (
              <button
                key={color}
                type='button'
                aria-label={`Background ${color}`}
                onMouseDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={() => onChangeBackgroundColor(color)}
                className={cn(
                  'h-6 w-6 rounded-full border transition-transform hover-hover:scale-105',
                  backgroundColor === color
                    ? 'border-[var(--brand-secondary)] ring-1 ring-[var(--brand-secondary)]'
                    : 'border-[var(--border-1)]'
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>

          <label className='flex items-center gap-1 rounded-md border border-[var(--border-1)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-secondary)] text-xs'>
            <Type className='h-3.5 w-3.5' />
            <select
              value={fontSize}
              onChange={(event) => onChangeFontSize(Number(event.target.value))}
              className='bg-transparent outline-none'
            >
              {FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}px
                </option>
              ))}
            </select>
          </label>

          <label className='flex items-center gap-1 rounded-md border border-[var(--border-1)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-secondary)] text-xs'>
            <Pilcrow className='h-3.5 w-3.5' />
            <select
              value={blockStyle}
              onChange={(event) => handleApplyBlockStyle(event.target.value)}
              className='bg-transparent outline-none'
            >
              <option value='h1'>H1</option>
              <option value='h2'>H2</option>
              <option value='h3'>H3</option>
              <option value='paragraph'>Body</option>
            </select>
          </label>

          <TextToolbarButton label='Bold' onClick={() => applyEditorCommand('bold')}>
            <span className='font-semibold'>B</span>
          </TextToolbarButton>
          <TextToolbarButton label='Italic' onClick={() => applyEditorCommand('italic')}>
            <span className='italic'>I</span>
          </TextToolbarButton>
          <TextToolbarButton label='List' onClick={() => applyEditorCommand('insertUnorderedList')}>
            <List className='h-3.5 w-3.5' />
          </TextToolbarButton>
          <TextToolbarButton label='Copy Node' onClick={handleCopyNode}>
            <CopyIcon className='h-3.5 w-3.5' />
          </TextToolbarButton>
        </div>
      )}

      <div
        className='relative rounded-2xl border border-[var(--border)] shadow-sm transition-shadow'
        style={{ backgroundColor, minHeight: cardMinHeight }}
      >
        {isEditing ? (
          <div
            key='editing'
            ref={editorRef}
            contentEditable={canEdit}
            role='textbox'
            aria-multiline='true'
            tabIndex={0}
            suppressContentEditableWarning
            onInput={() => {
              setDraftHtml(normalizeContentHtml(editorRef.current?.innerHTML ?? DEFAULT_TEXT_HTML))
            }}
            onBlur={() => {
              syncDraftFromEditor()
              setIsEditing(false)
            }}
            className={editingContentClassName}
            style={{ fontSize, minHeight: cardMinHeight }}
          />
        ) : (
          <div
            key='display'
            className={displayContentClassName}
            style={{ fontSize, minHeight: cardMinHeight }}
            onDoubleClickCapture={(event) => {
              event.stopPropagation()
              enterEditing()
            }}
          >
            {renderContentHtml(
              isEmpty ? DEFAULT_TEXT_HTML : normalizedHtml,
              'Double click to edit text'
            )}
          </div>
        )}

        {selected && canEdit && !isPreview && (
          <button
            type='button'
            aria-label='Resize text card width'
            onPointerDown={(event) => startResizeSession(event, 'width')}
            className='nodrag nopan absolute inset-y-0 right-[-8px] z-30 w-4 cursor-ew-resize'
          >
            <div className='-translate-y-1/2 absolute top-1/2 right-[5px] h-16 w-[3px] rounded-full border border-[var(--border)] bg-[var(--surface-1)] shadow-sm' />
          </button>
        )}

        {selected && canEdit && !isPreview && (
          <button
            type='button'
            aria-label='Resize text card height'
            onPointerDown={(event) => startResizeSession(event, 'height')}
            className='nodrag nopan absolute inset-x-0 bottom-[-8px] z-30 h-4 cursor-ns-resize'
          >
            <div className='-translate-x-1/2 absolute bottom-[5px] left-1/2 h-[3px] w-16 rounded-full border border-[var(--border)] bg-[var(--surface-1)] shadow-sm' />
          </button>
        )}
      </div>

      {!isPreview && !isEmbedded && (
        <ContentNodeAiComposer
          canEdit={canEdit}
          selected={selected}
          prompt={aiPrompt}
          model={aiModel}
          modelOptions={modelOptions}
          isGenerating={isGenerating}
          error={error}
          hasPendingResult={pendingActionChoice && Boolean(pendingGeneratedText)}
          onChangePrompt={onChangeAiPrompt}
          onChangeModel={onChangeAiModel}
          onSubmit={submitPrompt}
          onReplace={() => applyPendingGeneratedText('replace')}
          onAppend={() => applyPendingGeneratedText('append')}
        />
      )}
    </div>
  )
}

function MediaContentCard({
  blockId,
  variant,
  canEdit,
  isPreview,
  isEmbedded,
  file,
  selected,
  aiPrompt,
  aiModel,
  aiAspectRatio,
  onChangeFile,
  onChangeAiPrompt,
  onChangeAiModel,
  onChangeAiAspectRatio,
}: {
  blockId: string
  variant: Extract<ContentVariant, 'image' | 'video' | 'audio'>
  canEdit: boolean
  isPreview: boolean
  isEmbedded: boolean
  file: UploadedFileValue | null
  selected: boolean
  aiPrompt: string
  aiModel: string
  aiAspectRatio: ImageAspectRatioValue
  onChangeFile: (value: UploadedFileValue | null) => void
  onChangeAiPrompt: (value: string) => void
  onChangeAiModel: (value: ImageGenerationModelId) => void
  onChangeAiAspectRatio: (value: ImageAspectRatioValue) => void
}) {
  const params = useParams<{ workspaceId: string }>()
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadFileMutation = useUploadWorkspaceFile()
  const [error, setError] = useState<string | null>(null)
  const [isBroken, setIsBroken] = useState(false)
  const [inferredAspectRatio, setInferredAspectRatio] = useState<Exclude<
    ImageAspectRatioValue,
    'auto'
  > | null>(null)

  const mediaPath = file?.path ?? ''
  const canUpload = canEdit && !isPreview
  const accept = variant === 'image' ? 'image/*' : variant === 'video' ? 'video/*' : 'audio/*'
  const cardWidth =
    variant === 'image'
      ? IMAGE_CARD_WIDTH
      : variant === 'video'
        ? VIDEO_CARD_WIDTH
        : AUDIO_CARD_WIDTH
  const cardHeight =
    variant === 'image'
      ? IMAGE_CARD_HEIGHT
      : variant === 'video'
        ? VIDEO_CARD_HEIGHT
        : AUDIO_CARD_HEIGHT
  const uploadLabel =
    variant === 'image' ? 'Upload image' : variant === 'video' ? 'Upload video' : 'Upload audio'
  const emptyLabel =
    variant === 'image'
      ? 'No image available'
      : variant === 'video'
        ? 'No video available'
        : 'No audio available'
  const helperText =
    variant === 'image'
      ? 'Supports a single local image file.'
      : variant === 'video'
        ? 'Supports a single local video file.'
        : 'Supports a single local audio file.'

  useEffect(() => {
    setIsBroken(false)
  }, [mediaPath])

  useEffect(() => {
    if (variant !== 'image' || !mediaPath || typeof window === 'undefined') {
      setInferredAspectRatio(null)
      return
    }

    let cancelled = false
    const image = new window.Image()
    image.onload = () => {
      if (cancelled) return
      setInferredAspectRatio(
        getNearestSupportedImageAspectRatio(image.naturalWidth, image.naturalHeight)
      )
    }
    image.onerror = () => {
      if (cancelled) return
      setInferredAspectRatio(null)
    }
    image.src = mediaPath

    return () => {
      cancelled = true
    }
  }, [mediaPath, variant])

  const resolvedAspectRatio = getResolvedImageAspectRatio({
    storedAspectRatio: aiAspectRatio,
    inferredAspectRatio,
  })
  const {
    modelOptions,
    aspectRatioOptions,
    isGenerating,
    error: generationError,
    submitPrompt,
  } = useImageContentAiSession({
    blockId,
    workspaceId: params.workspaceId,
    prompt: aiPrompt,
    model: (aiModel || DEFAULT_IMAGE_AI_MODEL) as ImageGenerationModelId,
    aspectRatio: resolvedAspectRatio,
    onChangeFile,
  })

  const openFileDialog = useCallback(() => {
    if (!canUpload) return
    inputRef.current?.click()
  }, [canUpload])

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0]
      event.target.value = ''

      if (!nextFile) return
      if (!matchesVariantFile(nextFile, variant)) {
        setError(`Only ${variant} files are supported in this card.`)
        return
      }

      if (!params.workspaceId) {
        setError('Missing workspace context for upload.')
        return
      }

      setError(null)

      try {
        const result = await uploadFileMutation.mutateAsync({
          workspaceId: params.workspaceId,
          file: nextFile,
          skipToast: true,
        })

        onChangeFile({
          name: result.file.name,
          path: result.file.url,
          key: result.file.key,
          size: result.file.size,
          type: result.file.type,
        })
      } catch (uploadError) {
        const message =
          uploadError instanceof Error ? uploadError.message : `Failed to upload ${variant}.`
        setError(message)
      }
    },
    [accept, onChangeFile, params.workspaceId, uploadFileMutation, variant]
  )

  const hasMedia = Boolean(mediaPath) && !isBroken

  return (
    <div>
      <div
        className='relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]'
        style={{ width: cardWidth, minHeight: cardHeight }}
      >
        <input
          ref={inputRef}
          type='file'
          accept={accept}
          className='hidden'
          onChange={handleFileChange}
        />

        {hasMedia ? (
          variant === 'image' ? (
            <div className='relative flex h-[240px] w-[320px] items-center justify-center bg-[var(--surface-1)] px-3 py-3'>
              <img
                src={mediaPath}
                alt={file?.name || 'Uploaded content'}
                className='max-h-full max-w-full rounded-xl object-contain'
                onError={() => setIsBroken(true)}
              />
            </div>
          ) : variant === 'video' ? (
            <div className='flex w-[360px] flex-col gap-3 bg-[var(--surface-1)] px-3 py-3'>
              {/* biome-ignore lint/a11y/useMediaCaption: uploaded local video cards do not have a caption track in this iteration. */}
              <video
                src={mediaPath}
                controls
                preload='metadata'
                className='nodrag nopan aspect-video w-full rounded-xl bg-black object-contain'
                onPointerDown={(event) => {
                  event.stopPropagation()
                }}
                onError={() => setIsBroken(true)}
              />
            </div>
          ) : (
            <div className='flex min-h-[132px] w-[360px] flex-col justify-center gap-3 bg-[var(--surface-1)] px-4 py-4'>
              <div className='truncate font-medium text-[var(--text-primary)] text-sm'>
                {file?.name || 'Uploaded audio'}
              </div>
              {/* biome-ignore lint/a11y/useMediaCaption: uploaded local audio cards do not have a caption track in this iteration. */}
              <audio
                src={mediaPath}
                controls
                preload='metadata'
                className='nodrag nopan w-full'
                onPointerDown={(event) => {
                  event.stopPropagation()
                }}
                onError={() => setIsBroken(true)}
              />
            </div>
          )
        ) : (
          <button
            type='button'
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              openFileDialog()
            }}
            disabled={!canUpload}
            className={cn(
              'nodrag nopan flex flex-col items-center justify-center gap-3 px-6 text-center text-[var(--text-secondary)] transition-colors hover-hover:bg-[var(--surface-3)] disabled:cursor-default disabled:hover-hover:bg-transparent',
              variant === 'audio' ? 'h-[132px] w-[360px]' : 'h-[240px] w-full'
            )}
          >
            <div className='flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-4)]'>
              <ImagePlus className='h-5 w-5' />
            </div>
            <div>
              <div className='font-medium text-sm'>{canUpload ? uploadLabel : emptyLabel}</div>
              <div className='mt-1 text-[var(--text-tertiary)] text-xs'>{helperText}</div>
            </div>
          </button>
        )}

        {selected && canUpload && (
          <button
            type='button'
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              openFileDialog()
            }}
            className='nodrag nopan absolute top-3 right-3 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1 text-[var(--text-primary)] text-xs shadow-sm hover-hover:bg-[var(--surface-3)]'
          >
            Replace
          </button>
        )}

        {uploadFileMutation.isPending && (
          <div className='absolute inset-x-0 bottom-0 bg-[var(--surface-4)] px-3 py-2 text-[11px] text-[var(--text-secondary)]'>
            Uploading {variant}...
          </div>
        )}

        {error && (
          <div className='border-[var(--border)] border-t bg-[var(--surface-1)] px-3 py-2 text-[11px] text-[var(--text-error)]'>
            {error}
          </div>
        )}
      </div>

      {variant === 'image' && !isPreview && !isEmbedded && (
        <MediaContentAiComposer
          canEdit={canEdit}
          selected={selected}
          prompt={aiPrompt}
          model={(aiModel || DEFAULT_IMAGE_AI_MODEL) as ImageGenerationModelId}
          aspectRatio={resolvedAspectRatio}
          isGenerating={isGenerating}
          error={generationError}
          modelOptions={modelOptions}
          aspectRatioOptions={aspectRatioOptions}
          onChangePrompt={onChangeAiPrompt}
          onChangeModel={onChangeAiModel}
          onChangeAspectRatio={onChangeAiAspectRatio}
          onSubmit={submitPrompt}
        />
      )}
    </div>
  )
}

export const ContentBlock = memo(function ContentBlock({
  id,
  data,
  selected,
}: NodeProps<ContentBlockNodeData>) {
  const variant = data.contentVariant as ContentVariant | undefined

  const { activeWorkflowId, handleClick, hasRing, ringStyles } = useBlockVisual({
    blockId: id,
    data,
    isSelected: selected,
  })

  const storedValues = useSubBlockStore(
    useCallback(
      (state) => {
        if (!activeWorkflowId) return undefined
        return state.workflowValues[activeWorkflowId]?.[id]
      },
      [activeWorkflowId, id]
    )
  )

  const sourceValues = data.isPreview ? (data.subBlockValues as StoredValueRecord) : storedValues

  const [contentHtmlValue, setContentHtmlValue] = useSubBlockValue<string>(id, 'contentHtml')
  const [blockStyleValue, setBlockStyleValue] = useSubBlockValue<string>(id, 'blockStyle')
  const [backgroundColorValue, setBackgroundColorValue] = useSubBlockValue<string>(
    id,
    'backgroundColor'
  )
  const [fontSizeValue, setFontSizeValue] = useSubBlockValue<number>(id, 'fontSize')
  const [widthValue, setWidthValue] = useSubBlockValue<number>(id, 'width')
  const [heightValue, setHeightValue] = useSubBlockValue<number>(id, 'height')
  const [aiPromptValue, setAiPromptValue] = useSubBlockValue<string>(id, 'aiPrompt')
  const [aiModelValue, setAiModelValue] = useSubBlockValue<string>(id, 'aiModel')
  const [aiAspectRatioValue, setAiAspectRatioValue] = useSubBlockValue<string>(id, 'aiAspectRatio')
  const [fileValue, setFileValue] = useSubBlockValue<UploadedFileValue | null>(id, 'file')

  const userPermissions = useUserPermissionsContext()
  const canEditWorkflow = userPermissions.canEdit && !data.isWorkflowLocked

  const resolvedVariant = resolveContentVariant(
    variant,
    sourceValues,
    data.isPreview ? undefined : fileValue
  )
  const resolvedHtml = extractStoredValue<string>(
    data.isPreview ? sourceValues : ({ contentHtml: contentHtmlValue } as StoredValueRecord),
    'contentHtml',
    DEFAULT_TEXT_HTML
  )
  const resolvedBlockStyle = extractStoredValue<string>(
    data.isPreview ? sourceValues : ({ blockStyle: blockStyleValue } as StoredValueRecord),
    'blockStyle',
    'paragraph'
  )
  const resolvedBackgroundColor = extractStoredValue<string>(
    data.isPreview
      ? sourceValues
      : ({ backgroundColor: backgroundColorValue } as StoredValueRecord),
    'backgroundColor',
    DEFAULT_BACKGROUND_COLOR
  )
  const resolvedFontSize = coerceNumber(
    extractStoredValue<number | string>(
      data.isPreview ? sourceValues : ({ fontSize: fontSizeValue } as StoredValueRecord),
      'fontSize',
      DEFAULT_FONT_SIZE
    ),
    DEFAULT_FONT_SIZE
  )
  const resolvedWidth = clampTextWidth(
    coerceNumber(
      extractStoredValue<number | string>(
        data.isPreview ? sourceValues : ({ width: widthValue } as StoredValueRecord),
        'width',
        DEFAULT_TEXT_WIDTH
      ),
      DEFAULT_TEXT_WIDTH
    )
  )
  const resolvedHeight = clampTextHeight(
    coerceNumber(
      extractStoredValue<number | string>(
        data.isPreview ? sourceValues : ({ height: heightValue } as StoredValueRecord),
        'height',
        DEFAULT_TEXT_HEIGHT
      ),
      DEFAULT_TEXT_HEIGHT
    )
  )
  const resolvedFile = extractStoredValue<UploadedFileValue | null>(
    data.isPreview ? sourceValues : ({ file: fileValue } as StoredValueRecord),
    'file',
    null
  )
  const resolvedAiPrompt = extractStoredValue<string>(
    data.isPreview ? sourceValues : ({ aiPrompt: aiPromptValue } as StoredValueRecord),
    'aiPrompt',
    ''
  )
  const fallbackAiModel =
    resolvedVariant === 'image' ? DEFAULT_IMAGE_AI_MODEL : DEFAULT_TEXT_AI_MODEL
  const resolvedAiModel =
    extractStoredValue<string>(
      data.isPreview ? sourceValues : ({ aiModel: aiModelValue } as StoredValueRecord),
      'aiModel',
      fallbackAiModel
    ) || fallbackAiModel
  const resolvedAiAspectRatio = extractStoredValue<string>(
    data.isPreview ? sourceValues : ({ aiAspectRatio: aiAspectRatioValue } as StoredValueRecord),
    'aiAspectRatio',
    DEFAULT_IMAGE_ASPECT_RATIO
  ) as ImageAspectRatioValue

  const cardRef = useRef<HTMLDivElement>(null)

  useBlockDimensions({
    blockId: id,
    calculateDimensions: () => {
      if (cardRef.current) {
        return {
          width: Math.ceil(cardRef.current.offsetWidth),
          height: Math.ceil(cardRef.current.offsetHeight),
        }
      }

      return resolvedVariant === 'image'
        ? { width: IMAGE_CARD_WIDTH, height: IMAGE_CARD_HEIGHT }
        : resolvedVariant === 'video'
          ? { width: VIDEO_CARD_WIDTH, height: VIDEO_CARD_HEIGHT }
          : resolvedVariant === 'audio'
            ? { width: AUDIO_CARD_WIDTH, height: AUDIO_CARD_HEIGHT }
            : { width: resolvedWidth, height: resolvedHeight }
    },
    dependencies: [
      resolvedVariant,
      resolvedWidth,
      resolvedHeight,
      resolvedHtml,
      resolvedBackgroundColor,
      resolvedFontSize,
      resolvedAiPrompt,
      resolvedAiModel,
      resolvedAiAspectRatio,
      resolvedFile?.path,
      selected,
    ],
  })

  return (
    <div className='group relative'>
      <div
        ref={cardRef}
        role='button'
        tabIndex={0}
        className='relative z-[20] cursor-grab select-none content-drag-handle [&:active]:cursor-grabbing'
        onClick={handleClick}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) {
            return
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handleClick()
          }
        }}
      >
        {!data.isPreview && !data.isEmbedded && (
          <div className='nodrag nopan'>
            <ActionBar blockId={id} blockType='content' disabled={!canEditWorkflow} />
          </div>
        )}

        {resolvedVariant === 'image' ||
        resolvedVariant === 'video' ||
        resolvedVariant === 'audio' ? (
          <MediaContentCard
            blockId={id}
            variant={resolvedVariant}
            canEdit={canEditWorkflow}
            isPreview={Boolean(data.isPreview)}
            isEmbedded={Boolean(data.isEmbedded)}
            file={resolvedFile}
            selected={selected}
            aiPrompt={resolvedAiPrompt}
            aiModel={resolvedAiModel}
            aiAspectRatio={resolvedAiAspectRatio}
            onChangeFile={(value) => {
              if (!data.isPreview) setFileValue(value)
            }}
            onChangeAiPrompt={(value) => {
              if (!data.isPreview) setAiPromptValue(value)
            }}
            onChangeAiModel={(value) => {
              if (!data.isPreview) setAiModelValue(value)
            }}
            onChangeAiAspectRatio={(value) => {
              if (!data.isPreview) setAiAspectRatioValue(value)
            }}
          />
        ) : (
          <TextContentCard
            blockId={id}
            selected={selected}
            canEdit={canEditWorkflow}
            isPreview={Boolean(data.isPreview)}
            isEmbedded={Boolean(data.isEmbedded)}
            html={normalizeContentHtml(resolvedHtml)}
            blockStyle={resolvedBlockStyle}
            backgroundColor={resolvedBackgroundColor}
            fontSize={resolvedFontSize}
            width={resolvedWidth}
            height={resolvedHeight}
            aiPrompt={resolvedAiPrompt}
            aiModel={resolvedAiModel}
            onChangeHtml={(value) => {
              if (!data.isPreview) setContentHtmlValue(value)
            }}
            onChangeBlockStyle={(value) => {
              if (!data.isPreview) setBlockStyleValue(value)
            }}
            onChangeBackgroundColor={(value) => {
              if (!data.isPreview) setBackgroundColorValue(value)
            }}
            onChangeFontSize={(value) => {
              if (!data.isPreview) setFontSizeValue(value)
            }}
            onChangeWidth={(value) => {
              if (!data.isPreview) setWidthValue(value)
            }}
            onChangeHeight={(value) => {
              if (!data.isPreview) setHeightValue(value)
            }}
            onChangeAiPrompt={(value) => {
              if (!data.isPreview) setAiPromptValue(value)
            }}
            onChangeAiModel={(value) => {
              if (!data.isPreview) setAiModelValue(value)
            }}
          />
        )}

        {hasRing && (
          <div
            className={cn('pointer-events-none absolute inset-0 z-40 rounded-2xl', ringStyles)}
          />
        )}
      </div>
    </div>
  )
})
