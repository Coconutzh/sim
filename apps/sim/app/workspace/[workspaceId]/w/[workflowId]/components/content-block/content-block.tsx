'use client'

import type { ChangeEvent, ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy as CopyIcon,
  ImageIcon,
  List,
  Music4,
  Pilcrow,
  Plus,
  Type,
  Upload,
  Video,
} from 'lucide-react'
import { useParams } from 'next/navigation'
import { Handle, type NodeProps, Position } from 'reactflow'
import { cn } from '@/lib/core/utils/cn'
import { resolveUserFileUrl } from '@/lib/core/utils/user-file'
import type {
  AudioGenerationModelId,
  AudioGenerationParametersValue,
} from '@/lib/generated-media/audio/audio-generation-utils'
import {
  DEFAULT_AUDIO_MODEL,
  DEFAULT_AUDIO_PARAMETERS,
} from '@/lib/generated-media/audio/audio-generation-utils'
import {
  DEFAULT_IMAGE_AI_MODEL,
  DEFAULT_IMAGE_ASPECT_RATIO,
  getNearestSupportedImageAspectRatio,
  getResolvedImageAspectRatio,
  type ImageAspectRatioValue,
  type ImageGenerationModelId,
} from '@/lib/generated-media/image/image-generation-utils'
import {
  DEFAULT_VIDEO_FRAME_ASPECT_RATIO_PRESET,
  DEFAULT_VIDEO_MODEL,
  DEFAULT_VIDEO_MODEL_FAMILY,
  getVideoMediaFileForType,
  getVideoModelFamilyFromModelId,
  isVideoFrameAspectRatioPreset,
  isVideoModelFamily,
  removeVideoMediaFileForType,
  type VideoFrameAspectRatioPreset,
  type VideoGenerationModelId,
  type VideoMediaFileSlot,
  type VideoModelFamily,
} from '@/lib/generated-media/video/video-generation-utils'
import {
  CONTENT_REFERENCE_EDGE_KIND,
  getContentReferenceSourceHandleId,
  getContentReferenceTargetHandleId,
} from '@/lib/workflows/content-reference-edges'
import {
  buildContentReferencePromptContext,
  buildStructuredContentReferenceContext,
  findMatchingContentReferenceEdgeIds,
  getAllowedReferenceSourceVariants,
  getModelDisabledReason,
  inferContentReferencesFromCanvas,
  normalizeContentReferences,
  removeContentReference,
  type ContentReferenceRecord,
  type PromptContextReferencedNode,
} from '@/lib/workflows/content-references'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-context'
import { ActionBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/action-bar'
import { AudioContentAiComposer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/audio-content-ai-composer'
import {
  DEFAULT_VIDEO_PARAMETERS,
  normalizeAudioModel,
  normalizeAudioParameters,
  normalizeVideoDuration,
  normalizeVideoParameters,
  type VideoParametersValue,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-generation-parameters'
import { ContentNodeAiComposer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-node-ai-composer'
import { MediaContentAiComposer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/media-content-ai-composer'
import { DEFAULT_TEXT_AI_MODEL } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/text-content-ai-utils'
import { useAudioContentAiSession } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-audio-content-ai-session'
import { useImageContentAiSession } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-image-content-ai-session'
import { useTextContentAiSession } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-text-content-ai-session'
import { useVideoContentAiSession } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-video-content-ai-session'
import { VideoContentAiComposer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/video-content-ai-composer'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WorkflowBlockProps } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/types'
import { useBlockVisual } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useBlockDimensions } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-block-dimensions'
import { useContentCanvasModelAvailability } from '@/hooks/queries/content-canvas'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'
import { useContentReferenceSelectionStore } from '@/stores/content/content-reference-selection/store'
import { useVideoFrameSelectionStore } from '@/stores/content/video-frame-selection/store'
import { usePanelEditorStore } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import {
  EMPTY_SUBBLOCK_VALUES,
  useSubBlockStore,
} from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import type { ContentCanvasModelAvailabilitySnapshot } from '@/lib/api/contracts/content-canvas'

type ContentVariant = 'text' | 'image' | 'video' | 'audio'
type StoredValueRecord = Record<string, { value?: unknown } | unknown> | undefined

interface ContentBlockNodeData extends WorkflowBlockProps {}

interface UploadedFileValue {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
}

function getEffectiveContentModelId(params: {
  requestedModelId: string
  availability: ContentCanvasModelAvailabilitySnapshot[keyof ContentCanvasModelAvailabilitySnapshot] | null
  fallbackModelId: string
}) {
  if (!params.availability) {
    return params.requestedModelId || params.fallbackModelId
  }

  if (params.availability.enabledModelIds.includes(params.requestedModelId)) {
    return params.requestedModelId
  }

  return (
    params.availability.defaultModelId ??
    params.availability.enabledModelIds[0] ??
    params.requestedModelId ??
    params.fallbackModelId
  )
}

function getEffectiveVideoModelFamily(params: {
  requestedFamily: VideoModelFamily
  availability: ContentCanvasModelAvailabilitySnapshot['video'] | null
}) {
  if (!params.availability) return params.requestedFamily

  const enabledFamilies = new Set(
    params.availability.enabledModelIds.map((modelId) =>
      getVideoModelFamilyFromModelId(modelId as VideoGenerationModelId)
    )
  )

  if (enabledFamilies.has(params.requestedFamily)) {
    return params.requestedFamily
  }

  if (params.availability.defaultModelId) {
    return getVideoModelFamilyFromModelId(params.availability.defaultModelId as VideoGenerationModelId)
  }

  return enabledFamilies.values().next().value ?? params.requestedFamily
}

const CLEAR_VIDEO_FRAME_AUTO_LINK_EVENT = 'clear-video-frame-auto-link'
const HIDDEN_CONTENT_HANDLE_CLASSNAME =
  'pointer-events-none !h-2 !w-2 !border-0 !bg-transparent opacity-0'

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
  const numericValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
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

function isUploadedFileValue(value: unknown): value is UploadedFileValue {
  return hasUploadedFileValue(value)
}

function normalizeVideoModelFamily(value: unknown, legacyModelValue?: unknown): VideoModelFamily {
  if (isVideoModelFamily(value)) {
    return value
  }

  if (
    legacyModelValue === 'wan2.7-i2v' ||
    legacyModelValue === 'wan2.6-t2v' ||
    legacyModelValue === 'wan2.6-i2v-flash'
  ) {
    return getVideoModelFamilyFromModelId(legacyModelValue as VideoGenerationModelId)
  }

  return DEFAULT_VIDEO_MODEL_FAMILY
}

function normalizeVideoMedia(value: unknown): Array<VideoMediaFileSlot<UploadedFileValue>> {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const type = (item as { type?: unknown }).type
    const file = (item as { file?: unknown }).file
    if ((type !== 'first_frame' && type !== 'last_frame') || !isUploadedFileValue(file)) {
      return []
    }
    return [{ type, file }]
  })
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

function getReferenceChipLabel(
  reference: ContentReferenceRecord,
  node: PromptContextReferencedNode | undefined
): string {
  if (node?.name?.trim()) return node.name.trim()
  if (node?.variant === 'text' && node.textContent?.trim()) {
    return node.textContent.trim().slice(0, 36)
  }
  if (node?.file?.name?.trim()) return node.file.name.trim()
  return `${reference.sourceVariant}:${reference.sourceBlockId}`
}

function getReferenceChipPreview(node: PromptContextReferencedNode | undefined): ReactNode {
  if (node?.variant === 'image' && node.file?.url) {
    return (
      <img
        src={node.file.url}
        alt={node.file.name || node.name || 'reference image'}
        className='h-8 w-8 rounded-lg object-cover'
      />
    )
  }

  const iconClassName = 'h-3.5 w-3.5'
  const icon =
    node?.variant === 'text' ? (
      <Type className={iconClassName} />
    ) : node?.variant === 'video' ? (
      <Video className={iconClassName} />
    ) : node?.variant === 'audio' ? (
      <Music4 className={iconClassName} />
    ) : (
      <ImageIcon className={iconClassName} />
    )

  return (
    <span className='flex h-8 w-8 items-center justify-center rounded-lg bg-white/8 text-[#D6DBE5]'>
      {icon}
    </span>
  )
}

function ReferenceComposerHeader({
  canEdit,
  references,
  referencedNodes,
  onAddReference,
  onRemoveReference,
}: {
  canEdit: boolean
  references: ContentReferenceRecord[]
  referencedNodes: Record<string, PromptContextReferencedNode>
  onAddReference: () => void
  onRemoveReference: (reference: ContentReferenceRecord) => void
}) {
  return (
    <div className='flex flex-wrap items-start gap-2'>
      <button
        type='button'
        disabled={!canEdit}
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onAddReference()
        }}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[#F5F7FA] transition-colors',
          canEdit ? 'hover-hover:bg-white/10' : 'cursor-not-allowed opacity-60'
        )}
        aria-label='Add canvas reference'
      >
        <Plus className='h-4 w-4' />
      </button>

      {references.map((reference) => {
        const node = referencedNodes[reference.sourceBlockId]
        return (
          <div
            key={`${reference.sourceBlockId}:${reference.role}`}
            className='flex max-w-full items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] text-[#D6DBE5]'
          >
            {getReferenceChipPreview(node)}
            <span className='truncate'>{getReferenceChipLabel(reference, node)}</span>
            <button
              type='button'
              disabled={!canEdit}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onRemoveReference(reference)
              }}
              className={cn(
                'text-[#9FA5B2] transition-colors',
                canEdit ? 'hover-hover:text-white' : 'cursor-not-allowed opacity-60'
              )}
              aria-label='Remove reference'
            >
              x
            </button>
          </div>
        )
      })}
    </div>
  )
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
  modelAvailability,
  contentReferences,
  referencedNodes,
  onAddReference,
  onRemoveReference,
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
  modelAvailability?: ContentCanvasModelAvailabilitySnapshot | null
  contentReferences: ContentReferenceRecord[]
  referencedNodes: Record<string, PromptContextReferencedNode>
  onAddReference: () => void
  onRemoveReference: (reference: ContentReferenceRecord) => void
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
  const referenceContextText = useMemo(
    () =>
      buildContentReferencePromptContext({
        references: contentReferences,
        referencedNodes,
      }),
    [contentReferences, referencedNodes]
  )
  const structuredReferenceContext = useMemo(
    () =>
      buildStructuredContentReferenceContext({
        references: contentReferences,
        referencedNodes,
      }),
    [contentReferences, referencedNodes]
  )
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
    availability: modelAvailability,
    referenceContextText,
    referenceImages: structuredReferenceContext.images,
    onChangeHtml,
  })
  const modelOptionsWithDisabledReason = useMemo(
    () =>
      modelOptions.map((option) => ({
        ...option,
        disabledReason: getModelDisabledReason({
          targetVariant: 'text',
          model: option.id,
          references: contentReferences,
        }),
      })),
    [contentReferences, modelOptions]
  )

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
          modelOptions={modelOptionsWithDisabledReason}
          isGenerating={isGenerating}
          error={error}
          hasPendingResult={pendingActionChoice && Boolean(pendingGeneratedText)}
          header={
            <ReferenceComposerHeader
              canEdit={canEdit}
              references={contentReferences}
              referencedNodes={referencedNodes}
              onAddReference={onAddReference}
              onRemoveReference={onRemoveReference}
            />
          }
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
  modelAvailability,
  aiAspectRatio,
  audioPrompt,
  audioModel,
  audioParameters,
  videoPrompt,
  videoModelFamily,
  videoMedia,
  videoParameters,
  videoFrameAspectRatioPreset,
  contentReferences,
  referencedNodes,
  onAddReference,
  onRemoveReference,
  onChangeFile,
  onChangeAiPrompt,
  onChangeAiModel,
  onChangeAiAspectRatio,
  onChangeAudioPrompt,
  onChangeAudioModel,
  onChangeAudioParameters,
  onChangeVideoPrompt,
  onChangeVideoModelFamily,
  onChangeVideoMedia,
  onChangeVideoParameters,
  onChangeVideoFrameAspectRatioPreset,
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
  modelAvailability?: ContentCanvasModelAvailabilitySnapshot | null
  aiAspectRatio: ImageAspectRatioValue
  audioPrompt: string
  audioModel: AudioGenerationModelId
  audioParameters: AudioGenerationParametersValue
  videoPrompt: string
  videoModelFamily: VideoModelFamily
  videoMedia: Array<VideoMediaFileSlot<UploadedFileValue>>
  videoParameters: VideoParametersValue
  videoFrameAspectRatioPreset: VideoFrameAspectRatioPreset
  contentReferences: ContentReferenceRecord[]
  referencedNodes: Record<string, PromptContextReferencedNode>
  onAddReference: () => void
  onRemoveReference: (reference: ContentReferenceRecord) => void
  onChangeFile: (value: UploadedFileValue | null) => void
  onChangeAiPrompt: (value: string) => void
  onChangeAiModel: (value: ImageGenerationModelId) => void
  onChangeAiAspectRatio: (value: ImageAspectRatioValue) => void
  onChangeAudioPrompt: (value: string) => void
  onChangeAudioModel: (value: AudioGenerationModelId) => void
  onChangeAudioParameters: (value: AudioGenerationParametersValue) => void
  onChangeVideoPrompt: (value: string) => void
  onChangeVideoModelFamily: (value: VideoModelFamily) => void
  onChangeVideoMedia: (value: Array<VideoMediaFileSlot<UploadedFileValue>>) => void
  onChangeVideoParameters: (value: VideoParametersValue) => void
  onChangeVideoFrameAspectRatioPreset: (value: VideoFrameAspectRatioPreset) => void
}) {
  const params = useParams<{ workspaceId: string }>()
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadFileMutation = useUploadWorkspaceFile()
  const [error, setError] = useState<string | null>(null)
  const [isBroken, setIsBroken] = useState(false)
  const frameSelection = useVideoFrameSelectionStore((state) => state.selection)
  const beginFrameSelection = useVideoFrameSelectionStore((state) => state.beginSelection)
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const currentEditorBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const workflowBlocks = useWorkflowStore((state) => state.blocks)
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
  const referencedVideoBlockId = frameSelection?.targetBlockId ?? currentEditorBlockId
  const referencedVideoBlock = referencedVideoBlockId
    ? workflowBlocks[referencedVideoBlockId]
    : null
  const referencedVideoMediaValue = useSubBlockStore(
    useCallback(
      (state) => {
        if (!activeWorkflowId || !referencedVideoBlockId) return undefined
        return state.workflowValues[activeWorkflowId]?.[referencedVideoBlockId]?.videoMedia
      },
      [activeWorkflowId, referencedVideoBlockId]
    )
  )
  const referencedVideoMedia = normalizeVideoMedia(
    referencedVideoBlock
      ? (referencedVideoMediaValue ?? referencedVideoBlock.subBlocks?.videoMedia?.value)
      : []
  )
  const isReferencedFirstFrame =
    variant === 'image' &&
    Boolean(file?.key) &&
    getVideoMediaFileForType(referencedVideoMedia, 'first_frame')?.key === file?.key
  const isReferencedLastFrame =
    variant === 'image' &&
    Boolean(file?.key) &&
    getVideoMediaFileForType(referencedVideoMedia, 'last_frame')?.key === file?.key

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
  const structuredReferenceContext = useMemo(
    () =>
      buildStructuredContentReferenceContext({
        references: contentReferences,
        referencedNodes,
      }),
    [contentReferences, referencedNodes]
  )
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
    availability: modelAvailability,
    aspectRatio: resolvedAspectRatio,
    referenceContext: structuredReferenceContext,
    onChangeFile,
  })
  const {
    modelOptions: videoModelOptions,
    aspectRatioOptions: videoAspectRatioOptions,
    resolutionOptions: videoResolutionOptions,
    durationOptions: videoDurationOptions,
    isGenerating: isVideoGenerating,
    error: videoGenerationError,
    submitPrompt: submitVideoPrompt,
  } = useVideoContentAiSession({
    blockId,
    workspaceId: params.workspaceId,
    prompt: videoPrompt,
    modelFamily: videoModelFamily,
    availability: modelAvailability,
    aspectRatioPreset: videoFrameAspectRatioPreset,
    resolution: videoParameters.resolution,
    durationSeconds: videoParameters.duration,
    firstFrameFile: getVideoMediaFileForType(videoMedia, 'first_frame'),
    lastFrameFile: getVideoMediaFileForType(videoMedia, 'last_frame'),
    onChangeFile,
  })
  const {
    modelOptions: audioModelOptions,
    isGenerating: isAudioGenerating,
    error: audioGenerationError,
    submitPrompt: submitAudioPrompt,
  } = useAudioContentAiSession({
    blockId,
    workspaceId: params.workspaceId,
    prompt: audioPrompt,
    model: audioModel,
    availability: modelAvailability,
    parameters: audioParameters,
    referenceContext: { text: structuredReferenceContext.text },
    onChangeFile,
  })
  const imageModelOptionsWithDisabledReason = useMemo(
    () =>
      modelOptions.map((option) => ({
        ...option,
        disabledReason: getModelDisabledReason({
          targetVariant: 'image',
          model: option.id,
          references: contentReferences,
        }),
      })),
    [contentReferences, modelOptions]
  )
  const audioModelOptionsWithDisabledReason = useMemo(
    () =>
      audioModelOptions.map((option) => ({
        ...option,
        disabledReason: getModelDisabledReason({
          targetVariant: 'audio',
          model: option.id,
          references: contentReferences,
        }),
      })),
    [audioModelOptions, contentReferences]
  )

  const openFileDialog = useCallback(() => {
    if (!canUpload) return
    inputRef.current?.click()
  }, [canUpload])

  const uploadActionLabel = mediaPath ? 'Replace' : 'Upload'
  const emptyStateIcon =
    variant === 'image' ? (
      <ImageIcon className='h-7 w-7' />
    ) : variant === 'video' ? (
      <Video className='h-7 w-7' />
    ) : (
      <Music4 className='h-7 w-7' />
    )

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
          id: result.file.id,
          name: result.file.name,
          path: result.file.url,
          key: result.file.key,
          size: result.file.size,
          type: result.file.type,
          context: result.file.context,
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
    <div className='relative'>
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
          className='nodrag nopan -translate-x-1/2 absolute top-[-38px] left-1/2 z-40 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-[var(--text-primary)] text-xs shadow-sm hover-hover:bg-[var(--surface-3)]'
        >
          <Upload className='h-3.5 w-3.5' />
          <span>{uploadActionLabel}</span>
        </button>
      )}

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
            <div
              className={cn(
                'relative flex h-[240px] w-[320px] items-center justify-center bg-[var(--surface-1)] px-3 py-3',
                (isReferencedFirstFrame || isReferencedLastFrame) &&
                  'ring-2 ring-[#F4B740] ring-offset-0'
              )}
            >
              <img
                src={mediaPath}
                alt={file?.name || 'Uploaded content'}
                className='max-h-full max-w-full rounded-xl object-contain'
                onError={() => setIsBroken(true)}
              />
              {(isReferencedFirstFrame || isReferencedLastFrame) && (
                <div className='pointer-events-none absolute top-3 left-3 flex flex-wrap gap-2'>
                  {isReferencedFirstFrame ? (
                    <span className='rounded-full bg-[#2A2417] px-2 py-1 text-[#F4C86A] text-[10px]'>
                      当前首帧
                    </span>
                  ) : null}
                  {isReferencedLastFrame ? (
                    <span className='rounded-full bg-[#2A2417] px-2 py-1 text-[#F4C86A] text-[10px]'>
                      当前尾帧
                    </span>
                  ) : null}
                </div>
              )}
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
          <div
            className={cn(
              'nopan flex flex-col items-center justify-center gap-3 px-6 text-center text-[var(--text-secondary)]',
              variant === 'audio' ? 'h-[132px] w-[360px]' : 'h-[240px] w-full'
            )}
          >
            <div className='flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-4)]'>
              {emptyStateIcon}
            </div>
            <div>
              <div className='font-medium text-sm'>{emptyLabel}</div>
              <div className='mt-1 text-[var(--text-tertiary)] text-xs'>{helperText}</div>
            </div>
          </div>
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
          header={
            <ReferenceComposerHeader
              canEdit={canEdit}
              references={contentReferences}
              referencedNodes={referencedNodes}
              onAddReference={onAddReference}
              onRemoveReference={onRemoveReference}
            />
          }
          modelOptions={imageModelOptionsWithDisabledReason}
          aspectRatioOptions={aspectRatioOptions}
          onChangePrompt={onChangeAiPrompt}
          onChangeModel={onChangeAiModel}
          onChangeAspectRatio={onChangeAiAspectRatio}
          onSubmit={submitPrompt}
        />
      )}

      {variant === 'video' && !isPreview && !isEmbedded && (
        <div className='mt-3 flex flex-col gap-3'>
          <ReferenceComposerHeader
            canEdit={canEdit}
            references={contentReferences}
            referencedNodes={referencedNodes}
            onAddReference={onAddReference}
            onRemoveReference={onRemoveReference}
          />
          <VideoContentAiComposer
            canEdit={canEdit}
            selected={selected}
            prompt={videoPrompt}
            modelFamily={videoModelFamily}
            aspectRatioPreset={videoFrameAspectRatioPreset}
            resolution={videoParameters.resolution}
            durationSeconds={videoParameters.duration}
            firstFrameFile={getVideoMediaFileForType(videoMedia, 'first_frame')}
            lastFrameFile={getVideoMediaFileForType(videoMedia, 'last_frame')}
            isGenerating={isVideoGenerating}
            error={videoGenerationError}
            isSelectingFrame={frameSelection?.targetBlockId === blockId}
            selectedFrameSlot={frameSelection?.targetBlockId === blockId ? frameSelection.slot : null}
            modelOptions={videoModelOptions}
            aspectRatioOptions={videoAspectRatioOptions}
            resolutionOptions={videoResolutionOptions}
            durationOptions={videoDurationOptions}
            onChangePrompt={onChangeVideoPrompt}
            onChangeModelFamily={onChangeVideoModelFamily}
            onChangeAspectRatioPreset={onChangeVideoFrameAspectRatioPreset}
            onChangeResolution={(value) =>
              onChangeVideoParameters({
                ...videoParameters,
                resolution: value,
                promptExtend: true,
                watermark: false,
              })
            }
            onChangeDurationSeconds={(value) =>
              onChangeVideoParameters({
                ...videoParameters,
                duration: normalizeVideoDuration(value),
                promptExtend: true,
                watermark: false,
              })
            }
            onSelectFrame={(slot) =>
              beginFrameSelection({
                targetBlockId: blockId,
                slot,
                modelFamily: videoModelFamily,
                requiredAspectRatioPreset: videoFrameAspectRatioPreset,
              })
            }
            onClearFrame={(slot) => {
              const mediaType = slot === 'first' ? 'first_frame' : 'last_frame'
              onChangeVideoMedia(removeVideoMediaFileForType(videoMedia, mediaType))
              window.dispatchEvent(
                new CustomEvent(CLEAR_VIDEO_FRAME_AUTO_LINK_EVENT, {
                  detail: {
                    blockId,
                    autoLinkType: slot === 'first' ? 'video_first_frame' : 'video_last_frame',
                  },
                })
              )
            }}
            onSubmit={submitVideoPrompt}
          />
        </div>
      )}

      {variant === 'audio' && !isPreview && !isEmbedded && (
        <AudioContentAiComposer
          canEdit={canEdit}
          selected={selected}
          prompt={audioPrompt}
          model={audioModel}
          parameters={audioParameters}
          isGenerating={isAudioGenerating}
          error={audioGenerationError}
          header={
            <ReferenceComposerHeader
              canEdit={canEdit}
              references={contentReferences}
              referencedNodes={referencedNodes}
              onAddReference={onAddReference}
              onRemoveReference={onRemoveReference}
            />
          }
          modelOptions={audioModelOptionsWithDisabledReason}
          onChangePrompt={onChangeAudioPrompt}
          onChangeModel={onChangeAudioModel}
          onChangeParameters={onChangeAudioParameters}
          onSubmit={submitAudioPrompt}
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
  const params = useParams<{ workspaceId: string }>()
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
  const [audioPromptValue, setAudioPromptValue] = useSubBlockValue<string>(id, 'audioPrompt')
  const [audioModelValue, setAudioModelValue] = useSubBlockValue<string>(id, 'audioModel')
  const [audioParametersValue, setAudioParametersValue] =
    useSubBlockValue<AudioGenerationParametersValue>(id, 'audioParameters')
  const [videoPromptValue, setVideoPromptValue] = useSubBlockValue<string>(id, 'videoPrompt')
  const [videoModelValue, setVideoModelValue] = useSubBlockValue<string>(id, 'videoModel')
  const [videoModelFamilyValue, setVideoModelFamilyValue] = useSubBlockValue<string>(
    id,
    'videoModelFamily'
  )
  const [videoMediaValue, setVideoMediaValue] = useSubBlockValue<
    Array<VideoMediaFileSlot<UploadedFileValue>>
  >(id, 'videoMedia')
  const [videoParametersValue, setVideoParametersValue] = useSubBlockValue<VideoParametersValue>(
    id,
    'videoParameters'
  )
  const [videoFrameAspectRatioPresetValue, setVideoFrameAspectRatioPresetValue] =
    useSubBlockValue<string>(id, 'videoFrameAspectRatioPreset')
  const [fileValue, setFileValue] = useSubBlockValue<UploadedFileValue | null>(id, 'file')
  const [contentReferencesValue, setContentReferencesValue] = useSubBlockValue<
    ContentReferenceRecord[]
  >(id, 'contentReferences')

  const userPermissions = useUserPermissionsContext()
  const canEditWorkflow = userPermissions.canEdit && !data.isWorkflowLocked
  const contentReferenceSelection = useContentReferenceSelectionStore((state) => state.selection)
  const beginContentReferenceSelection = useContentReferenceSelectionStore(
    (state) => state.beginSelection
  )
  const frameSelection = useVideoFrameSelectionStore((state) => state.selection)
  const beginFrameSelection = useVideoFrameSelectionStore((state) => state.beginSelection)
  const workflowBlocks = useWorkflowStore((state) => state.blocks)
  const workflowEdges = useWorkflowStore((state) => state.edges)
  const workflowValues = useSubBlockStore(
    useCallback(
      (state) => (activeWorkflowId ? state.workflowValues[activeWorkflowId] ?? EMPTY_SUBBLOCK_VALUES : EMPTY_SUBBLOCK_VALUES),
      [activeWorkflowId]
    )
  )
  const { collaborativeBatchRemoveEdges, collaborativeBatchAddEdges } = useCollaborativeWorkflow()

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
  const resolvedAudioPrompt = extractStoredValue<string>(
    data.isPreview ? sourceValues : ({ audioPrompt: audioPromptValue } as StoredValueRecord),
    'audioPrompt',
    ''
  )
  const resolvedAudioModel = normalizeAudioModel(
    extractStoredValue<string>(
      data.isPreview ? sourceValues : ({ audioModel: audioModelValue } as StoredValueRecord),
      'audioModel',
      DEFAULT_AUDIO_MODEL
    )
  )
  const resolvedAudioParameters = normalizeAudioParameters(
    extractStoredValue<unknown>(
      data.isPreview
        ? sourceValues
        : ({ audioParameters: audioParametersValue } as StoredValueRecord),
      'audioParameters',
      DEFAULT_AUDIO_PARAMETERS
    )
  )
  const resolvedVideoPrompt = extractStoredValue<string>(
    data.isPreview ? sourceValues : ({ videoPrompt: videoPromptValue } as StoredValueRecord),
    'videoPrompt',
    ''
  )
  const resolvedLegacyVideoModel = extractStoredValue<string>(
    data.isPreview ? sourceValues : ({ videoModel: videoModelValue } as StoredValueRecord),
    'videoModel',
    DEFAULT_VIDEO_MODEL
  )
  const resolvedVideoModelFamily = normalizeVideoModelFamily(
    extractStoredValue<string>(
      data.isPreview
        ? sourceValues
        : ({ videoModelFamily: videoModelFamilyValue } as StoredValueRecord),
      'videoModelFamily',
      DEFAULT_VIDEO_MODEL_FAMILY
    ),
    resolvedLegacyVideoModel
  )
  const resolvedVideoMedia = normalizeVideoMedia(
    extractStoredValue<unknown>(
      data.isPreview ? sourceValues : ({ videoMedia: videoMediaValue } as StoredValueRecord),
      'videoMedia',
      []
    )
  )
  const resolvedVideoParameters = normalizeVideoParameters(
    extractStoredValue<unknown>(
      data.isPreview
        ? sourceValues
        : ({ videoParameters: videoParametersValue } as StoredValueRecord),
      'videoParameters',
      DEFAULT_VIDEO_PARAMETERS
    )
  )
  const resolvedVideoFrameAspectRatioPreset = isVideoFrameAspectRatioPreset(
    extractStoredValue<string>(
      data.isPreview
        ? sourceValues
        : ({
            videoFrameAspectRatioPreset: videoFrameAspectRatioPresetValue,
          } as StoredValueRecord),
      'videoFrameAspectRatioPreset',
      DEFAULT_VIDEO_FRAME_ASPECT_RATIO_PRESET
    )
  )
    ? (extractStoredValue<string>(
        data.isPreview
          ? sourceValues
          : ({
              videoFrameAspectRatioPreset: videoFrameAspectRatioPresetValue,
            } as StoredValueRecord),
        'videoFrameAspectRatioPreset',
        DEFAULT_VIDEO_FRAME_ASPECT_RATIO_PRESET
      ) as VideoFrameAspectRatioPreset)
    : DEFAULT_VIDEO_FRAME_ASPECT_RATIO_PRESET
  const resolvedContentReferences = normalizeContentReferences(
    extractStoredValue<unknown>(
      data.isPreview
        ? sourceValues
        : ({ contentReferences: contentReferencesValue } as StoredValueRecord),
      'contentReferences',
      []
    )
  )
  const modelAvailability = useContentCanvasModelAvailability(params.workspaceId)
  const effectiveTextModel = getEffectiveContentModelId({
    requestedModelId: resolvedAiModel,
    availability: modelAvailability?.text ?? null,
    fallbackModelId: DEFAULT_TEXT_AI_MODEL,
  })
  const effectiveImageModel = getEffectiveContentModelId({
    requestedModelId: resolvedAiModel,
    availability: modelAvailability?.image ?? null,
    fallbackModelId: DEFAULT_IMAGE_AI_MODEL,
  })
  const effectiveAudioModel = getEffectiveContentModelId({
    requestedModelId: resolvedAudioModel,
    availability: modelAvailability?.audio ?? null,
    fallbackModelId: DEFAULT_AUDIO_MODEL,
  }) as AudioGenerationModelId
  const effectiveVideoModelFamily = getEffectiveVideoModelFamily({
    requestedFamily: resolvedVideoModelFamily,
    availability: modelAvailability?.video ?? null,
  })
  const videoReferenceModelId =
    effectiveVideoModelFamily === 'wan2.7' ? 'wan2.7-i2v' : 'wan2.6-i2v-flash'
  const selectionModel =
    resolvedVariant === 'text'
      ? effectiveTextModel
      : resolvedVariant === 'image'
        ? effectiveImageModel
        : resolvedVariant === 'audio'
          ? effectiveAudioModel
          : videoReferenceModelId
  const allowedReferenceSourceVariants = getAllowedReferenceSourceVariants(
    resolvedVariant,
    selectionModel
  )

  const resolveBlockSourceValues = useCallback(
    (blockId: string): StoredValueRecord => {
      const liveValues = workflowValues[blockId]
      if (liveValues) {
        return liveValues as StoredValueRecord
      }
      const block = workflowBlocks[blockId]
      return (block?.subBlocks as StoredValueRecord) ?? undefined
    },
    [workflowBlocks, workflowValues]
  )
  const resolveBlockVariant = useCallback(
    (blockId: string): ContentVariant | null => {
      const block = workflowBlocks[blockId]
      if (block?.type !== 'content') return null
      const source = resolveBlockSourceValues(blockId)
      return resolveContentVariant(block?.subBlocks?.contentVariant?.value, source, source?.file)
    },
    [resolveBlockSourceValues, workflowBlocks]
  )
  const resolveBlockFileKey = useCallback(
    (blockId: string): string | null => {
      const source = resolveBlockSourceValues(blockId)
      const file = extractStoredValue<UploadedFileValue | null>(source, 'file', null)
      return file?.key ?? null
    },
    [resolveBlockSourceValues]
  )
  const referencedNodes = useMemo(() => {
    const nodes: Record<string, PromptContextReferencedNode> = {}
    for (const reference of resolvedContentReferences) {
      const block = workflowBlocks[reference.sourceBlockId]
      if (block?.type !== 'content') continue
      const source = resolveBlockSourceValues(reference.sourceBlockId)
      const variant = resolveBlockVariant(reference.sourceBlockId)
      if (!variant) continue
      nodes[reference.sourceBlockId] = {
        name: block.name,
        variant,
        textContent:
          variant === 'text'
            ? getPlainTextFromHtml(extractStoredValue<string>(source, 'contentHtml', DEFAULT_TEXT_HTML))
            : null,
        file:
          variant === 'text'
            ? null
            : (() => {
                const file = extractStoredValue<UploadedFileValue | null>(source, 'file', null)
                if (!file?.key) return null
                return {
                  id: file.id ?? '',
                  name: file.name ?? file.key,
                  url: resolveUserFileUrl(file),
                  key: file.key,
                  size: file.size ?? 0,
                  type: file.type,
                  context: file.context,
                }
              })(),
      }
    }
    return nodes
  }, [resolveBlockSourceValues, resolveBlockVariant, resolvedContentReferences, workflowBlocks])

  const cardRef = useRef<HTMLDivElement>(null)
  const showContentReferenceHandles =
    canEditWorkflow && !data.isPreview && !data.isEmbedded && !frameSelection
  const isContentReferenceSource = contentReferenceSelection?.sourceBlockId === id
  const isReferenceSelectionTarget =
    Boolean(contentReferenceSelection) &&
    !isContentReferenceSource &&
    contentReferenceSelection?.allowedSourceVariants.includes(resolvedVariant)
  const isReferenceSelectionDisabled =
    Boolean(contentReferenceSelection) &&
    !isContentReferenceSource &&
    !contentReferenceSelection?.allowedSourceVariants.includes(resolvedVariant)
  const isFrameSelectionDisabled = Boolean(frameSelection) && resolvedVariant !== 'image'
  const frameSelectionBadgeLabel =
    frameSelection && !isFrameSelectionDisabled
      ? frameSelection.slot === 'first'
        ? '点击设置首帧'
        : '点击设置尾帧'
      : null
  const startReferenceSelection = useCallback(
    (anchor: 'left' | 'right' = 'left') => {
      if (!canEditWorkflow || data.isPreview || data.isEmbedded) return

      if (resolvedVariant === 'video') {
        const hasFirstFrame = Boolean(getVideoMediaFileForType(resolvedVideoMedia, 'first_frame')?.key)
        const slot =
          resolvedVideoModelFamily === 'wan2.7' && hasFirstFrame ? 'last' : 'first'
        beginFrameSelection({
          targetBlockId: id,
          slot,
          modelFamily: resolvedVideoModelFamily,
          requiredAspectRatioPreset: resolvedVideoFrameAspectRatioPreset,
        })
        return
      }

      beginContentReferenceSelection({
        sourceBlockId: id,
        sourceVariant: resolvedVariant,
        sourceModel: selectionModel,
        allowedSourceVariants: allowedReferenceSourceVariants,
        sourceAnchor: anchor,
        mode: CONTENT_REFERENCE_EDGE_KIND,
      })
    },
    [
      allowedReferenceSourceVariants,
      beginContentReferenceSelection,
      beginFrameSelection,
      canEditWorkflow,
      data.isEmbedded,
      data.isPreview,
      id,
      resolvedVariant,
      resolvedVideoFrameAspectRatioPreset,
      resolvedVideoMedia,
      resolvedVideoModelFamily,
      selectionModel,
    ]
  )
  const removeReferenceAndEdges = useCallback(
    (reference: ContentReferenceRecord) => {
      if (data.isPreview || data.isEmbedded) return

      const nextReferences = removeContentReference(resolvedContentReferences, reference)
      setContentReferencesValue(nextReferences)

      if (resolvedVariant === 'video') {
        if (reference.role === 'video_first_frame') {
          setVideoMediaValue(removeVideoMediaFileForType(resolvedVideoMedia, 'first_frame'))
        }
        if (reference.role === 'video_last_frame') {
          setVideoMediaValue(removeVideoMediaFileForType(resolvedVideoMedia, 'last_frame'))
        }
      }

      const edgeIds = findMatchingContentReferenceEdgeIds({
        targetBlockId: id,
        reference,
        edges: workflowEdges,
      })
      if (edgeIds.length > 0) {
        collaborativeBatchRemoveEdges(edgeIds)
      }
    },
    [
      collaborativeBatchRemoveEdges,
      data.isEmbedded,
      data.isPreview,
      id,
      resolvedContentReferences,
      resolvedVariant,
      resolvedVideoMedia,
      setContentReferencesValue,
      setVideoMediaValue,
      workflowEdges,
    ]
  )

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
      resolvedAudioPrompt,
      resolvedAudioModel,
      resolvedAudioParameters.customMode,
      resolvedAudioParameters.instrumental,
      resolvedAudioParameters.style,
      resolvedAudioParameters.title,
      resolvedAudioParameters.negativeTags,
      resolvedAudioParameters.vocalGender,
      resolvedVideoPrompt,
      resolvedVideoModelFamily,
      resolvedVideoParameters.resolution,
      resolvedVideoParameters.duration,
      resolvedVideoFrameAspectRatioPreset,
      getVideoMediaFileForType(resolvedVideoMedia, 'first_frame')?.path,
      getVideoMediaFileForType(resolvedVideoMedia, 'last_frame')?.path,
      resolvedFile?.path,
      selected,
    ],
  })

  useEffect(() => {
    if (data.isPreview || data.isEmbedded || resolvedContentReferences.length > 0) return

    const inferredReferences = inferContentReferencesFromCanvas({
      targetBlockId: id,
      targetVariant: resolvedVariant,
      model: selectionModel,
      edges: workflowEdges,
      candidateBlockIds: Object.keys(workflowBlocks),
      resolveVariant: resolveBlockVariant,
      resolveFileKey: resolveBlockFileKey,
      videoMedia: resolvedVideoMedia.map((item) => ({
        type: item.type,
        file: { key: item.file?.key ?? null },
      })),
    })

    if (inferredReferences.length > 0) {
      setContentReferencesValue(inferredReferences)
    }
  }, [
    data.isEmbedded,
    data.isPreview,
    id,
    resolveBlockFileKey,
    resolveBlockVariant,
    resolvedContentReferences.length,
    resolvedVariant,
    resolvedVideoMedia,
    selectionModel,
    setContentReferencesValue,
    workflowBlocks,
    workflowEdges,
  ])

  useEffect(() => {
    if (data.isPreview || data.isEmbedded || resolvedContentReferences.length === 0) return

    const missingEdges = resolvedContentReferences.flatMap((reference) => {
      if (
        findMatchingContentReferenceEdgeIds({
          targetBlockId: id,
          reference,
          edges: workflowEdges,
        }).length > 0
      ) {
        return []
      }

      const isVideoRole =
        reference.role === 'video_first_frame' || reference.role === 'video_last_frame'
      const sourceBlockId = isVideoRole ? reference.sourceBlockId : id
      const targetBlockId = isVideoRole ? id : reference.sourceBlockId
      const sourceX = workflowBlocks[sourceBlockId]?.position.x ?? 0
      const targetX = workflowBlocks[targetBlockId]?.position.x ?? 0

      return [
        {
          id: `${sourceBlockId}:${targetBlockId}:${reference.role}`,
          source: sourceBlockId,
          target: targetBlockId,
          sourceHandle: getContentReferenceSourceHandleId(targetX >= sourceX ? 'right' : 'left'),
          targetHandle: getContentReferenceTargetHandleId(targetX >= sourceX ? 'left' : 'right'),
          type: 'workflowEdge',
          data: {
            kind: CONTENT_REFERENCE_EDGE_KIND,
            ...(reference.role === 'video_first_frame'
              ? { autoLinkType: 'video_first_frame' as const }
              : reference.role === 'video_last_frame'
                ? { autoLinkType: 'video_last_frame' as const }
                : {}),
          },
        },
      ]
    })

    if (missingEdges.length > 0) {
      collaborativeBatchAddEdges(missingEdges, { skipUndoRedo: true })
    }
  }, [
    collaborativeBatchAddEdges,
    data.isEmbedded,
    data.isPreview,
    id,
    resolvedContentReferences,
    workflowBlocks,
    workflowEdges,
  ])

  return (
    <div className='group relative'>
      {!data.isPreview &&
        !data.isEmbedded &&
        (['left', 'right'] as const).flatMap((anchor) => [
          <Handle
            key={`source-${anchor}`}
            id={getContentReferenceSourceHandleId(anchor)}
            type='source'
            position={anchor === 'left' ? Position.Left : Position.Right}
            isConnectable={false}
            className={HIDDEN_CONTENT_HANDLE_CLASSNAME}
          />,
          <Handle
            key={`target-${anchor}`}
            id={getContentReferenceTargetHandleId(anchor)}
            type='target'
            position={anchor === 'left' ? Position.Left : Position.Right}
            isConnectable={false}
            className={HIDDEN_CONTENT_HANDLE_CLASSNAME}
          />,
        ])}

      {showContentReferenceHandles && (
        <>
          {(['left', 'right'] as const).map((anchor) => (
            <button
              key={anchor}
              type='button'
              aria-label={
                anchor === 'left' ? 'Start content link from left' : 'Start content link from right'
              }
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                startReferenceSelection(anchor)
              }}
              className={cn(
                'nodrag nopan -translate-y-1/2 absolute top-1/2 z-50 flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] shadow-sm transition-all hover-hover:bg-[var(--surface-3)]',
                anchor === 'left' ? 'left-[-18px]' : 'right-[-18px]',
                selected || isContentReferenceSource
                  ? 'opacity-100'
                  : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100',
                isContentReferenceSource &&
                  'border-[var(--brand-secondary)] text-[var(--brand-secondary)]'
              )}
            >
              <Plus className='h-3.5 w-3.5' />
            </button>
          ))}
        </>
      )}

        <div
          ref={cardRef}
          role='button'
          tabIndex={0}
          className={cn(
            'relative z-[20] cursor-grab select-none content-drag-handle transition-opacity [&:active]:cursor-grabbing',
            (isReferenceSelectionDisabled || isFrameSelectionDisabled) && 'opacity-45'
          )}
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
            aiModel={effectiveImageModel}
            modelAvailability={modelAvailability}
            aiAspectRatio={resolvedAiAspectRatio}
            audioPrompt={resolvedAudioPrompt}
            audioModel={effectiveAudioModel}
            audioParameters={resolvedAudioParameters}
            videoPrompt={resolvedVideoPrompt}
            videoModelFamily={effectiveVideoModelFamily}
            videoMedia={resolvedVideoMedia}
            videoParameters={resolvedVideoParameters}
            videoFrameAspectRatioPreset={resolvedVideoFrameAspectRatioPreset}
            contentReferences={resolvedContentReferences}
            referencedNodes={referencedNodes}
            onAddReference={() => startReferenceSelection()}
            onRemoveReference={removeReferenceAndEdges}
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
            onChangeAudioPrompt={(value) => {
              if (!data.isPreview) setAudioPromptValue(value)
            }}
            onChangeAudioModel={(value) => {
              if (!data.isPreview) setAudioModelValue(value)
            }}
            onChangeAudioParameters={(value) => {
              if (!data.isPreview) setAudioParametersValue(value)
            }}
            onChangeVideoPrompt={(value) => {
              if (!data.isPreview) setVideoPromptValue(value)
            }}
            onChangeVideoModelFamily={(value) => {
              if (!data.isPreview) setVideoModelFamilyValue(value)
            }}
            onChangeVideoMedia={(value) => {
              if (!data.isPreview) setVideoMediaValue(value)
            }}
            onChangeVideoParameters={(value) => {
              if (!data.isPreview) setVideoParametersValue(value)
            }}
            onChangeVideoFrameAspectRatioPreset={(value) => {
              if (!data.isPreview) setVideoFrameAspectRatioPresetValue(value)
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
            aiModel={effectiveTextModel}
            modelAvailability={modelAvailability}
            contentReferences={resolvedContentReferences}
            referencedNodes={referencedNodes}
            onAddReference={() => startReferenceSelection()}
            onRemoveReference={removeReferenceAndEdges}
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

        {isReferenceSelectionTarget && (
          <div className='pointer-events-none absolute top-3 right-3 z-40 rounded-full border border-emerald-400/30 bg-emerald-500/20 px-2.5 py-1 text-[11px] text-emerald-100 shadow-sm backdrop-blur'>
            点击引用
          </div>
        )}

        {frameSelectionBadgeLabel && resolvedVariant === 'image' && (
          <div className='pointer-events-none absolute top-3 right-3 z-40 rounded-full border border-amber-400/30 bg-amber-500/20 px-2.5 py-1 text-[11px] text-amber-100 shadow-sm backdrop-blur'>
            {frameSelectionBadgeLabel}
          </div>
        )}

        {isContentReferenceSource && (
          <div className='pointer-events-none absolute inset-0 z-30 rounded-2xl ring-2 ring-[var(--brand-secondary)] ring-offset-0' />
        )}
      </div>
    </div>
  )
})
