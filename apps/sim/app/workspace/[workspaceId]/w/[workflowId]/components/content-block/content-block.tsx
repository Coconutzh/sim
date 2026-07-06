'use client'

import type {
  ChangeEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react'
import {
  createElement,
  Fragment,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { generateId } from '@sim/utils/id'
import {
  Box as BoxIcon,
  Brush,
  Camera,
  Check,
  Copy as CopyIcon,
  Crop as CropIcon,
  Download,
  Eraser,
  Expand,
  FileText,
  ImageIcon,
  List,
  Loader2,
  Music4,
  Pilcrow,
  Plus,
  Scissors,
  Settings2,
  Sparkles,
  Type,
  Upload,
  UploadCloud,
  Video,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Handle, type NodeProps, Position, useReactFlow, useViewport } from 'reactflow'
import { Button, Input, toast } from '@/components/emcn'
import { requestJson } from '@/lib/api/client/request'
import type { ContentCanvasModelAvailabilitySnapshot } from '@/lib/api/contracts/content-canvas'
import type { ImageOutpaintAspectRatio } from '@/lib/api/contracts/media-images'
import {
  type CaptureWorkspaceVideoFrameBody,
  captureWorkspaceVideoFrameContract,
  type EnhanceWorkspaceVideoBody,
  enhanceWorkspaceVideoContract,
  type TrimWorkspaceVideoBody,
  trimWorkspaceVideoContract,
} from '@/lib/api/contracts/media-videos'
import type {
  ProductionShowcaseCategory,
  ProductionShowcaseSourceNodeVariant,
} from '@/lib/api/contracts/production-showcase-items'
import type { ProductionTaskAttachmentInput } from '@/lib/api/contracts/production-tasks'
import { getContentCanvasModelsByFamily } from '@/lib/content-canvas/model-catalog'
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
  DEFAULT_IMAGE_CUTOUT_MODEL,
  DEFAULT_IMAGE_REPAINT_MODEL,
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
  upsertVideoMediaFile,
  type VideoFrameAspectRatioPreset,
  type VideoGenerationModelId,
  type VideoMediaFileSlot,
  type VideoModelFamily,
} from '@/lib/generated-media/video/video-generation-utils'
import {
  normalizePresentationArtifact,
  type PresentationArtifactValue,
  resolvePresentationArtifactFileUrl,
} from '@/lib/presentation/presentation-artifacts'
import { getContentNodePreset } from '@/lib/product/content-node-presets'
import { resolveStorageKeyFromFileInput } from '@/lib/uploads/utils/file-utils'
import {
  CONTENT_REFERENCE_EDGE_KIND,
  createContentReferenceEdge,
  getContentReferenceAnchorForTarget,
  getContentReferenceAutoLinkType,
  getContentReferenceSourceHandleId,
  getContentReferenceTargetHandleId,
  getOrdinaryContentReferenceHandles,
  isContentReferenceEdge,
} from '@/lib/workflows/content-reference-edges'
import {
  buildContentReferencePromptContext,
  buildStructuredContentReferenceContext,
  type ContentReferenceRecord,
  type ContentReferenceRole,
  findMatchingContentReferenceEdgeIds,
  getAllowedReferenceSourceVariants,
  getDefaultReferenceRole,
  getModelDisabledReason,
  inferContentReferencesFromCanvas,
  normalizeContentReferences,
  type PromptContextReferencedNode,
  removeContentReference,
} from '@/lib/workflows/content-references'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-context'
import { ActionBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/action-bar'
import { AudioContentAiComposer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/audio-content-ai-composer'
import {
  ComposerSendButton,
  ContentAiComposerShell,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-ai-composer-shell'
import {
  DEFAULT_VIDEO_PARAMETERS,
  normalizeAudioModel,
  normalizeAudioParameters,
  normalizeVideoDuration,
  normalizeVideoParameters,
  type VideoParametersValue,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-generation-parameters'
import { ContentNodeAiComposer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-node-ai-composer'
import { ContentNodeTitleBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-node-title-bar'
import {
  getContentReferenceCreateTargetVariants,
  getContentReferenceRoleForTarget,
  getNextContentReferencesForSource,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-reference-flow-utils'
import { ImageCropOverlay } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-crop-overlay'
import {
  buildImageErasePendingSubBlockValues,
  buildImagePerspectivePendingSubBlockValues,
  buildImageRepaintPendingSubBlockValues,
  createMaskImageFile,
  type DerivedImageGenerationKind,
  getImageEraseRequestMetadata,
  getImagePerspectiveRequestMetadata,
  getImageRepaintRequestMetadata,
  type ImageEraseGenerationRequest,
  type ImagePerspectiveGenerationRequest,
  type ImageRepaintGenerationRequest,
  runImageEraseRequest,
  runImagePerspectiveRequest,
  runImageRepaintRequest,
  type SubmitImageEraseParams,
  type SubmitImageRepaintParams,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-derived-generation-utils'
import { ImageEraseOverlay } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-erase-overlay'
import {
  normalizeImageGenerationKind,
  shouldShowImageComposer,
  type ToolbarDerivedImageGenerationKind,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-generation-kind-utils'
import { createImageOutpaintReferenceEdge } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-outpaint-content-reference'
import { ImageOutpaintOverlay } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-outpaint-overlay'
import { ImagePerspectiveMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-perspective-menu'
import { ImageRepaintOverlay } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-repaint-overlay'
import { ImageToolbarActions } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-toolbar-actions'
import { MediaContentAiComposer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/media-content-ai-composer'
import { DEFAULT_TEXT_AI_MODEL } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/text-content-ai-utils'
import { useAudioContentAiSession } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-audio-content-ai-session'
import { useImageContentAiSession } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-image-content-ai-session'
import { useImageCutoutSession } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-image-cutout-session'
import {
  buildImageOutpaintPendingSubBlockValues,
  getImageOutpaintRequestMetadata,
  runImageOutpaintRequest,
  type SubmitImageOutpaintParams,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-image-outpaint-session'
import { useTextContentAiSession } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-text-content-ai-session'
import { useVideoContentAiSession } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-video-content-ai-session'
import { VideoContentAiComposer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/video-content-ai-composer'
import { VideoEnhancePanel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/video-enhance-panel'
import {
  DEFAULT_VIDEO_ENHANCE_PARAMETERS,
  normalizeVideoEnhanceGenerationKind,
  normalizeVideoEnhanceGenerationStatus,
  normalizeVideoEnhanceParameters,
  type VideoEnhanceGenerationKind,
  type VideoEnhanceGenerationStatus,
  type VideoEnhanceParametersValue,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/video-enhance-utils'
import { VideoFrameCaptureMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/video-frame-capture-menu'
import {
  resolveVideoFrameCaptureTime,
  type VideoFrameCaptureMode,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/video-frame-capture-utils'
import { VideoTrimOverlay } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/video-trim-overlay'
import type { VideoTrimRange } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/video-trim-utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WorkflowBlockProps } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/types'
import { useBlockVisual } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useBlockDimensions } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-block-dimensions'
import { getBlockConfigFromCatalog } from '@/blocks/catalog'
import {
  useContentCanvasModelAvailability,
  useGenerateContentCanvasPresentation,
} from '@/hooks/queries/content-canvas'
import { useCreateProductionShowcaseItem } from '@/hooks/queries/production-showcase-items'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'
import { useCanvasViewport } from '@/hooks/use-canvas-viewport'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useContentReferenceSelectionStore } from '@/stores/content/content-reference-selection/store'
import { useVideoFrameSelectionStore } from '@/stores/content/video-frame-selection/store'
import { usePanelEditorStore } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { EMPTY_SUBBLOCK_VALUES, useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getUniqueBlockName, prepareBlockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

type ContentVariant = 'text' | 'image' | 'video' | 'audio' | 'presentation'
type ImageGenerationStatus = 'pending' | 'complete' | 'error'
type PresentationGenerationStatus = 'idle' | 'pending' | 'complete' | 'error'
type PresentationSlideCountMode = 'auto' | 'manual'
type ContentGenerationStatus = ImageGenerationStatus | VideoEnhanceGenerationStatus
type ContentGenerationKind = ToolbarDerivedImageGenerationKind | VideoEnhanceGenerationKind
type StoredValueRecord = Record<string, { value?: unknown } | unknown> | undefined

interface ContentBlockNodeData extends WorkflowBlockProps {}

interface UploadedFileValue {
  id?: string
  name?: string
  url?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
}

interface ContentReferenceDragState {
  anchor: 'left' | 'right'
  start: { x: number; y: number }
  current: { x: number; y: number }
  isDragging: boolean
  targetBlockId: string | null
  canConnect: boolean
}

function getEffectiveContentModelId(params: {
  requestedModelId: string
  availability:
    | ContentCanvasModelAvailabilitySnapshot[keyof ContentCanvasModelAvailabilitySnapshot]
    | null
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
    return getVideoModelFamilyFromModelId(
      params.availability.defaultModelId as VideoGenerationModelId
    )
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
const SCROLLBAR_HIT_TARGET_SIZE = 18
const VIDEO_CARD_WIDTH = 360
const VIDEO_CARD_HEIGHT = 240
const AUDIO_CARD_WIDTH = 360
const AUDIO_CARD_HEIGHT = 132
const PRESENTATION_CARD_WIDTH = 380
const PRESENTATION_CARD_HEIGHT = 260
const CONTENT_REFERENCE_CREATE_GAP = 80
const CONTENT_REFERENCE_DRAG_THRESHOLD = 6
const FONT_SIZE_OPTIONS = [14, 16, 18, 20, 24, 32] as const
const BACKGROUND_COLORS = ['#FFF8C5', '#FEE2E2', '#DBEAFE', '#DCFCE7', '#F3E8FF'] as const

const CONTENT_NODE_MENU_ITEMS: ReadonlyArray<{
  variant: ContentVariant
  label: string
  icon: typeof Type
}> = [
  { variant: 'text', label: 'Text', icon: Type },
  { variant: 'image', label: 'Image', icon: ImageIcon },
  { variant: 'video', label: 'Video', icon: Video },
  { variant: 'audio', label: 'Audio', icon: Music4 },
  { variant: 'presentation', label: 'PPT', icon: FileText },
] as const

function getContentCardWidth(variant: ContentVariant): number {
  if (variant === 'presentation') return PRESENTATION_CARD_WIDTH
  if (variant === 'video') return VIDEO_CARD_WIDTH
  if (variant === 'audio') return AUDIO_CARD_WIDTH
  if (variant === 'image') return IMAGE_CARD_WIDTH
  return DEFAULT_TEXT_WIDTH
}

function getDefaultReferenceModelForVariant(variant: ContentVariant): string {
  if (variant === 'image') return DEFAULT_IMAGE_AI_MODEL
  if (variant === 'audio') return DEFAULT_AUDIO_MODEL
  if (variant === 'video') return 'wan2.6-i2v-flash'
  if (variant === 'presentation') return 'codex-ppt-skill'
  return DEFAULT_TEXT_AI_MODEL
}

function mapOutpaintAspectRatioToImageAspectRatio(
  targetAspectRatio: ImageOutpaintAspectRatio
): ImageAspectRatioValue {
  if (targetAspectRatio === 'custom' || targetAspectRatio === 'original') return 'auto'
  return targetAspectRatio
}

function getVideoModelFamilyForInitialReference(sourceVariant: ContentVariant): VideoModelFamily {
  return sourceVariant === 'image' ? 'wan2.6' : DEFAULT_VIDEO_MODEL_FAMILY
}

function getCompatibleModelOptions<TOption extends { id: string }>(params: {
  targetVariant: ContentVariant
  currentModel: string
  references: ContentReferenceRecord[]
  options: ReadonlyArray<TOption>
}): Array<TOption & { disabledReason?: string | null }> {
  const optionsWithReasons = params.options.map((option) => ({
    ...option,
    disabledReason: getModelDisabledReason({
      targetVariant: params.targetVariant,
      model: option.id,
      references: params.references,
    }),
  }))
  const compatibleOptions = optionsWithReasons.filter((option) => !option.disabledReason)
  const currentOption = optionsWithReasons.find(
    (option) => option.id === params.currentModel && option.disabledReason
  )

  if (!currentOption) return compatibleOptions

  return [currentOption, ...compatibleOptions.filter((option) => option.id !== params.currentModel)]
}

function getVideoFamilyDisabledReason(params: {
  family: VideoModelFamily
  references: ContentReferenceRecord[]
}): string | null {
  const models = getContentCanvasModelsByFamily('video', params.family)
  if (
    models.some(
      (model) =>
        !getModelDisabledReason({
          targetVariant: 'video',
          model: model.id,
          references: params.references,
        })
    )
  ) {
    return null
  }

  return (
    models
      .map((model) =>
        getModelDisabledReason({
          targetVariant: 'video',
          model: model.id,
          references: params.references,
        })
      )
      .find((reason): reason is string => Boolean(reason)) ??
    'This model does not support the current references.'
  )
}

function getCompatibleVideoFamilyOptions<TOption extends { id: VideoModelFamily }>(params: {
  currentFamily: VideoModelFamily
  references: ContentReferenceRecord[]
  options: ReadonlyArray<TOption>
}): Array<TOption & { disabledReason?: string | null }> {
  const optionsWithReasons = params.options.map((option) => ({
    ...option,
    disabledReason: getVideoFamilyDisabledReason({
      family: option.id,
      references: params.references,
    }),
  }))
  const compatibleOptions = optionsWithReasons.filter((option) => !option.disabledReason)
  const currentOption = optionsWithReasons.find(
    (option) => option.id === params.currentFamily && option.disabledReason
  )

  if (!currentOption) return compatibleOptions

  return [
    currentOption,
    ...compatibleOptions.filter((option) => option.id !== params.currentFamily),
  ]
}

function extractStoredValue<T>(source: StoredValueRecord, key: string, fallback: T): T {
  const rawValue = source?.[key]
  if (rawValue && typeof rawValue === 'object' && 'value' in rawValue) {
    return ((rawValue as { value?: T }).value ?? fallback) as T
  }
  return (rawValue ?? fallback) as T
}

function getNodeSubBlockValues(data: unknown): StoredValueRecord {
  if (!data || typeof data !== 'object' || !('subBlockValues' in data)) {
    return undefined
  }

  const subBlockValues = (data as { subBlockValues?: unknown }).subBlockValues
  return subBlockValues && typeof subBlockValues === 'object'
    ? (subBlockValues as StoredValueRecord)
    : undefined
}

function mergeStoredValueRecords(...sources: StoredValueRecord[]): StoredValueRecord {
  const merged = sources.reduce<Record<string, { value?: unknown } | unknown>>((result, source) => {
    if (!source) return result
    return {
      ...result,
      ...source,
    }
  }, {})

  return Object.keys(merged).length > 0 ? merged : undefined
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
  return value === 'image' ||
    value === 'text' ||
    value === 'video' ||
    value === 'audio' ||
    value === 'presentation'
    ? value
    : null
}

function normalizeImageGenerationStatus(value: unknown): ImageGenerationStatus | null {
  return value === 'pending' || value === 'complete' || value === 'error' ? value : null
}

function normalizePresentationGenerationStatus(value: unknown): PresentationGenerationStatus {
  return value === 'pending' || value === 'complete' || value === 'error' ? value : 'idle'
}

function normalizePresentationSlideCountMode(value: unknown): PresentationSlideCountMode {
  return value === 'manual' ? 'manual' : 'auto'
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

function matchesVariantFile(value: unknown, variant: ContentVariant): boolean {
  return inferVariantFromFile(value) === variant
}

function isUploadedFileValue(value: unknown): value is UploadedFileValue {
  return hasUploadedFileValue(value)
}

function toTrimRequestFile(file: UploadedFileValue): TrimWorkspaceVideoBody['sourceFile'] | null {
  if (!file.key) return null

  return {
    id: file.id ?? '',
    name: file.name ?? 'video',
    url: file.path ?? file.url ?? '',
    key: file.key,
    size: file.size ?? 0,
    type: file.type ?? 'video/mp4',
    context: file.context,
  }
}

function toEnhanceRequestFile(
  file: UploadedFileValue
): EnhanceWorkspaceVideoBody['sourceFile'] | null {
  const sourceFile = toTrimRequestFile(file)
  return sourceFile ? { ...sourceFile } : null
}

function toFrameCaptureRequestFile(
  file: UploadedFileValue
): CaptureWorkspaceVideoFrameBody['sourceFile'] | null {
  const sourceFile = toTrimRequestFile(file)
  return sourceFile ? { ...sourceFile } : null
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
    (normalizePresentationArtifact(extractStoredValue(sourceValues, 'presentationArtifact', null))
      ? 'presentation'
      : null) ??
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

function truncateShowcaseText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

function getTemporaryShowcaseTitle(): string {
  return `临时成果 ${new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())}`
}

function getShowcaseTitleFromText(plainText: string): string {
  const title = plainText.trim()
  return title ? truncateShowcaseText(title, 48) : getTemporaryShowcaseTitle()
}

function getShowcaseTitleFromFile(file: UploadedFileValue | null, prompt: string): string {
  const title = file?.name?.trim() || prompt.trim()
  return title ? truncateShowcaseText(title, 80) : getTemporaryShowcaseTitle()
}

function getShowcaseCategory(variant: ContentVariant): ProductionShowcaseCategory {
  if (variant === 'text') return 'copywriting'
  if (variant === 'image') return 'image'
  if (variant === 'video') return 'video'
  if (variant === 'audio') return 'sound'
  if (variant === 'presentation') return 'document'
  return 'other'
}

function getShowcaseSourceNodeVariant(
  variant: ContentVariant
): ProductionShowcaseSourceNodeVariant {
  return variant === 'presentation' ? 'document' : variant
}

function getShowcasePromptForVariant(params: {
  variant: ContentVariant
  aiPrompt: string
  audioPrompt: string
  videoPrompt: string
  presentationPrompt: string
}): string {
  if (params.variant === 'presentation') return params.presentationPrompt
  if (params.variant === 'audio') return params.audioPrompt
  if (params.variant === 'video') return params.videoPrompt
  return params.aiPrompt
}

function getShowcaseAttachmentsFromFile(
  file: UploadedFileValue | null
): ProductionTaskAttachmentInput[] {
  if (!file) return []

  const url = resolveUserFileUrl(file)
  const name = file.name?.trim() || file.key?.split('/').filter(Boolean).at(-1) || '画布文件'

  if (file.id?.trim()) {
    return [
      {
        source: 'workspace_file',
        name,
        workspaceFileId: file.id.trim(),
        url,
        key: file.key,
        contentType: file.type,
        size: file.size,
      },
    ]
  }

  return url ? [{ source: 'url', name, url }] : []
}

function normalizeReferencedNodeFile(
  file: UploadedFileValue | null,
  fallbackName: string
): PromptContextReferencedNode['file'] {
  if (!file) return null

  const url = resolveUserFileUrl(file)
  const key =
    resolveStorageKeyFromFileInput({
      key: file.key,
      path: file.path,
      url,
    }) ?? ''

  if (!url && !key) return null

  return {
    id: file.id ?? '',
    name: file.name?.trim() || fallbackName || key || 'reference image',
    url,
    key,
    path: file.path,
    size: file.size ?? 0,
    type: file.type,
    context: file.context,
  }
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
    ) : node?.variant === 'presentation' ? (
      <FileText className={iconClassName} />
    ) : (
      <ImageIcon className={iconClassName} />
    )

  return (
    <span className='flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-4)] text-[var(--text-secondary)]'>
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
          'flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-primary)] transition-colors',
          canEdit ? 'hover-hover:bg-[var(--surface-3)]' : 'cursor-not-allowed opacity-60'
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
            className='flex max-w-full items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)]'
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
                'text-[var(--text-muted)] transition-colors',
                canEdit ? 'hover-hover:text-[var(--text-primary)]' : 'cursor-not-allowed opacity-60'
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

function isPointerOnScrollableScrollbar(
  element: HTMLElement,
  event: ReactPointerEvent<HTMLElement>
): boolean {
  const hasVerticalScrollbar = element.scrollHeight > element.clientHeight
  const hasHorizontalScrollbar = element.scrollWidth > element.clientWidth
  if (!hasVerticalScrollbar && !hasHorizontalScrollbar) return false

  const rect = element.getBoundingClientRect()
  const isOnVerticalScrollbar =
    hasVerticalScrollbar && event.clientX >= rect.right - SCROLLBAR_HIT_TARGET_SIZE
  const isOnHorizontalScrollbar =
    hasHorizontalScrollbar && event.clientY >= rect.bottom - SCROLLBAR_HIT_TARGET_SIZE

  return isOnVerticalScrollbar || isOnHorizontalScrollbar
}

function ContentGenerationLoadingState({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'nopan flex flex-col items-center justify-center gap-3 bg-[var(--surface-1)] px-6 text-center text-[var(--text-secondary)]',
        className
      )}
    >
      <Loader2 className='h-6 w-6 animate-spin text-[var(--brand-secondary)]' />
      <div className='font-medium text-sm'>{label}</div>
    </div>
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
  const showTextGenerationCompleteToast = useCallback(() => {
    toast.success('文本已生成，选中文本节点后可选择追加或替换')
  }, [])
  const showTextGenerationErrorToast = useCallback((message: string) => {
    toast.error(message)
  }, [])
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
    onGenerationComplete: showTextGenerationCompleteToast,
    onGenerationError: showTextGenerationErrorToast,
  })
  const currentModelDisabledReason = useMemo(
    () =>
      getModelDisabledReason({
        targetVariant: 'text',
        model: aiModel,
        references: contentReferences,
      }),
    [aiModel, contentReferences]
  )
  const modelOptionsWithDisabledReason = useMemo(
    () =>
      getCompatibleModelOptions({
        targetVariant: 'text',
        currentModel: aiModel,
        references: contentReferences,
        options: modelOptions,
      }),
    [aiModel, contentReferences, modelOptions]
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
  const handleSubmitPrompt = useCallback(() => {
    if (currentModelDisabledReason) return
    submitPrompt()
  }, [currentModelDisabledReason, submitPrompt])

  const handleTextContentWheelCapture = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!selected && !isEditing) return
      event.stopPropagation()
    },
    [isEditing, selected]
  )

  const handleTextContentPointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isPointerOnScrollableScrollbar(event.currentTarget, event)) return
      event.stopPropagation()
    },
    []
  )

  const editingContentClassName =
    'nodrag nopan allow-scroll h-full min-h-0 overflow-y-auto break-words px-4 py-3 text-[#111827] outline-none overscroll-contain [&_h1]:mb-2 [&_h1]:font-semibold [&_h1]:text-[2em] [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-[1.6em] [&_h3]:mb-2 [&_h3]:font-semibold [&_h3]:text-[1.3em] [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_p]:min-h-[1.5em] [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1'
  const displayContentClassName =
    'nopan h-full min-h-0 overflow-y-auto break-words px-4 py-3 text-[#111827] overscroll-contain [&_h1]:mb-2 [&_h1]:font-semibold [&_h1]:text-[2em] [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-[1.6em] [&_h3]:mb-2 [&_h3]:font-semibold [&_h3]:text-[1.3em] [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_p]:min-h-[1.5em] [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1'
  const cardHeight = clampTextHeight(height)

  const showToolbar = selected && !isPreview
  const normalizedHtml = normalizeContentHtml(isEditing ? draftHtml : html)
  const isEmpty = !isMeaningfulHtml(normalizedHtml)

  return (
    <div className='relative overflow-visible' style={{ width }}>
      {showToolbar && (
        <div
          className='nodrag nopan -translate-x-1/2 absolute top-[-92px] left-1/2 z-[70] inline-flex w-max flex-nowrap items-center gap-2 whitespace-nowrap rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2 shadow-lg'
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
        style={{ backgroundColor, height: cardHeight }}
      >
        {isGenerating ? (
          <ContentGenerationLoadingState label='文本生成中...' className='h-full' />
        ) : isEditing ? (
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
            onPointerDownCapture={handleTextContentPointerDownCapture}
            onWheelCapture={handleTextContentWheelCapture}
            className={editingContentClassName}
            style={{ fontSize }}
          />
        ) : (
          <div
            key='display'
            className={cn(displayContentClassName, selected && 'allow-scroll')}
            style={{ fontSize }}
            onPointerDownCapture={handleTextContentPointerDownCapture}
            onWheelCapture={handleTextContentWheelCapture}
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
          error={error ?? currentModelDisabledReason}
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
          onSubmit={handleSubmitPrompt}
          onReplace={() => applyPendingGeneratedText('replace')}
          onAppend={() => applyPendingGeneratedText('append')}
        />
      )}
    </div>
  )
}

function PresentationContentAiComposer({
  canEdit,
  selected,
  prompt,
  slideCountMode,
  slideCount,
  isGenerating,
  error,
  header,
  hasReferences,
  onChangePrompt,
  onChangeSlideCountMode,
  onChangeSlideCount,
  onSubmit,
}: {
  canEdit: boolean
  selected: boolean
  prompt: string
  slideCountMode: PresentationSlideCountMode
  slideCount: number
  isGenerating: boolean
  error: string | null
  header?: ReactNode
  hasReferences: boolean
  onChangePrompt: (value: string) => void
  onChangeSlideCountMode: (value: PresentationSlideCountMode) => void
  onChangeSlideCount: (value: number) => void
  onSubmit: () => void
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const slideCountInputId = useId()
  const isManual = slideCountMode === 'manual'
  const summary = isManual ? `${slideCount} pages` : 'Auto pages'

  return (
    <ContentAiComposerShell
      canEdit={canEdit}
      selected={selected}
      prompt={prompt}
      placeholder='描述 PPT 目标、受众、内容来源、页数和风格。风格或页数不填时，Hermes 会自动规划。'
      isGenerating={isGenerating}
      loadingLabel='Hermes is generating the PPT...'
      error={error}
      widthClassName='w-[520px]'
      header={
        <div className='flex flex-col gap-3'>
          {header}
          <div className='flex items-start gap-2 rounded-[18px] bg-[var(--surface-1)] px-3 py-2 text-[var(--text-secondary)] text-xs'>
            <FileText className='mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--brand-secondary)]' />
            <span>
              {hasReferences
                ? '引用的文本会作为 PPT 主要内容。图片和媒体用于指导视觉设计。'
                : '可以引用画布内容，或直接描述要生成的 PPT。'}
            </span>
          </div>
        </div>
      }
      onChangePrompt={onChangePrompt}
      onSubmit={onSubmit}
      footer={
        <div className='flex items-center justify-between gap-3'>
          <Button
            type='button'
            variant='default'
            size='md'
            disabled={!canEdit || isGenerating}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setSettingsOpen((current) => !current)
            }}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-xs transition-colors',
              !canEdit || isGenerating
                ? 'cursor-not-allowed text-[var(--text-muted)]'
                : 'text-[var(--text-secondary)] hover-hover:bg-[var(--surface-3)] hover-hover:text-[var(--text-primary)]'
            )}
          >
            <Settings2 className='h-3.5 w-3.5 shrink-0 text-[var(--brand-secondary)]' />
            <span className='truncate'>{summary}</span>
            {settingsOpen ? (
              <Check className='h-3.5 w-3.5 shrink-0 text-[var(--brand-accent)]' />
            ) : null}
          </Button>

          <ComposerSendButton
            canEdit={canEdit}
            isGenerating={isGenerating}
            onSubmit={onSubmit}
            ariaLabel='Generate PPT with Hermes'
          />
        </div>
      }
      afterFooter={
        settingsOpen ? (
          <div className='border-[var(--border)] border-t bg-[var(--surface-1)] px-4 py-4'>
            <div className='flex flex-col gap-4'>
              <div className='flex items-center justify-between gap-3'>
                <div>
                  <div className='font-medium text-[var(--text-primary)] text-sm'>
                    PPT generation settings
                  </div>
                  <div className='mt-1 text-[11px] text-[var(--text-muted)]'>
                    Auto lets Hermes infer page count from prompt and referenced content.
                  </div>
                </div>
                <Button
                  type='button'
                  variant='default'
                  size='sm'
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setSettingsOpen(false)
                  }}
                  className='rounded-full border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover-hover:bg-[var(--surface-3)]'
                >
                  Close
                </Button>
              </div>

              <div className='grid grid-cols-2 rounded-[18px] bg-[var(--surface-2)] p-1'>
                {(['auto', 'manual'] as const).map((mode) => (
                  <Button
                    key={mode}
                    type='button'
                    variant={slideCountMode === mode ? 'active' : 'ghost-secondary'}
                    size='md'
                    disabled={!canEdit || isGenerating}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onChangeSlideCountMode(mode)
                    }}
                    className={cn(
                      'rounded-[14px] px-3 py-2 text-xs capitalize transition-colors',
                      slideCountMode === mode
                        ? 'bg-[var(--surface-5)] text-[var(--text-primary)]'
                        : 'text-[var(--text-muted)] hover-hover:bg-[var(--surface-3)]',
                      (!canEdit || isGenerating) && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    {mode}
                  </Button>
                ))}
              </div>

              {isManual ? (
                <label htmlFor={slideCountInputId} className='flex flex-col gap-2'>
                  <span className='text-[var(--text-secondary)] text-xs'>Slides</span>
                  <Input
                    id={slideCountInputId}
                    type='number'
                    min={1}
                    max={30}
                    step={1}
                    value={slideCount}
                    disabled={!canEdit || isGenerating}
                    onChange={(event) => onChangeSlideCount(Number(event.target.value))}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    className='rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text-primary)] text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60'
                  />
                </label>
              ) : null}
            </div>
          </div>
        ) : null
      }
    />
  )
}

function PresentationContentCard({
  canEdit,
  isPreview,
  isEmbedded,
  selected,
  prompt,
  slideCountMode,
  slideCount,
  status,
  errorMessage,
  artifact,
  fallbackFile,
  contentReferences,
  referencedNodes,
  isGeneratePending,
  onAddReference,
  onRemoveReference,
  onChangePrompt,
  onChangeSlideCountMode,
  onChangeSlideCount,
  onGenerate,
}: {
  canEdit: boolean
  isPreview: boolean
  isEmbedded: boolean
  selected: boolean
  prompt: string
  slideCountMode: PresentationSlideCountMode
  slideCount: number
  status: PresentationGenerationStatus
  errorMessage: string | null
  artifact: PresentationArtifactValue | null
  fallbackFile: UploadedFileValue | null
  contentReferences: ContentReferenceRecord[]
  referencedNodes: Record<string, PromptContextReferencedNode>
  isGeneratePending: boolean
  onAddReference: () => void
  onRemoveReference: (reference: ContentReferenceRecord) => void
  onChangePrompt: (value: string) => void
  onChangeSlideCountMode: (value: PresentationSlideCountMode) => void
  onChangeSlideCount: (value: number) => void
  onGenerate: () => void
}) {
  const pptxFile = artifact?.pptxFile ?? fallbackFile
  const coverImageFile = artifact?.coverImageFile ?? null
  const pptxUrl = resolvePresentationArtifactFileUrl(pptxFile)
  const coverImageUrl = resolvePresentationArtifactFileUrl(coverImageFile)
  const title = artifact?.manifest?.title?.trim() || pptxFile?.name?.trim() || 'PPT 生成节点'
  const manifestSlideCount = artifact?.manifest?.slideCount
  const resolvedSlideCount =
    typeof manifestSlideCount === 'number' && manifestSlideCount > 0
      ? manifestSlideCount
      : slideCount
  const selectedStyle = artifact?.manifest?.selectedStyle?.trim()
  const isGenerating = status === 'pending' || isGeneratePending
  const hasArtifact = Boolean(pptxUrl)
  const slideCountSummary = hasArtifact
    ? `${resolvedSlideCount} pages`
    : slideCountMode === 'manual'
      ? `${slideCount} pages`
      : 'Auto pages'

  return (
    <div className='relative'>
      <div
        className='relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]'
        style={{ width: PRESENTATION_CARD_WIDTH, minHeight: PRESENTATION_CARD_HEIGHT }}
      >
        <div className='relative flex h-[198px] w-full items-center justify-center overflow-hidden bg-[var(--surface-1)]'>
          {coverImageUrl ? (
            <img
              src={coverImageUrl}
              alt={coverImageFile?.name || title}
              className='h-full w-full object-cover'
            />
          ) : isGenerating ? (
            <div className='flex flex-col items-center gap-3 text-[var(--text-secondary)]'>
              <Loader2 className='h-7 w-7 animate-spin text-[var(--brand-secondary)]' />
              <span className='font-medium text-sm'>正在生成 PPT...</span>
            </div>
          ) : status === 'error' ? (
            <div className='max-w-[300px] px-6 text-center text-[var(--text-error)] text-xs'>
              {errorMessage || 'PPT 生成失败，请调整提示词后重试。'}
            </div>
          ) : (
            <div className='flex flex-col items-center gap-3 text-center text-[var(--text-secondary)]'>
              <div className='flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface-5)] text-[var(--brand-secondary)]'>
                <FileText className='h-7 w-7' />
              </div>
              <div>
                <div className='font-medium text-[var(--text-primary)] text-sm'>
                  {hasArtifact ? 'PPTX ready' : '等待生成 PPT'}
                </div>
                <div className='mt-1 text-[var(--text-tertiary)] text-xs'>
                  仅展示最终 PPT 产物，不展开中间页图
                </div>
              </div>
            </div>
          )}

          {hasArtifact ? (
            <div className='absolute right-3 bottom-3 flex items-center gap-2 rounded-full bg-[var(--surface-inverted)] px-3 py-1.5 text-[var(--text-inverse)] text-xs backdrop-blur'>
              <FileText className='h-3.5 w-3.5' />
              <span>{resolvedSlideCount} 页</span>
            </div>
          ) : null}
        </div>

        <div className='space-y-3 px-4 py-3'>
          <div className='flex items-start justify-between gap-3'>
            <div className='min-w-0'>
              <div className='truncate font-medium text-[var(--text-primary)] text-sm'>{title}</div>
              <div className='mt-1 flex flex-wrap gap-2 text-[11px] text-[var(--text-tertiary)]'>
                <span>{slideCountSummary}</span>
                <span>{selectedStyle || 'Hermes 自动选风格'}</span>
              </div>
            </div>
            {pptxUrl ? (
              <a
                href={pptxUrl}
                target='_blank'
                rel='noreferrer'
                className='nodrag nopan inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[var(--text-primary)] text-xs shadow-sm hover-hover:bg-[var(--surface-3)]'
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <Download className='h-3.5 w-3.5' />
                <span>下载</span>
              </a>
            ) : null}
          </div>

          {!isPreview && !isEmbedded && !hasArtifact ? (
            <div className='rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[var(--text-secondary)] text-xs'>
              Select this node to write a prompt, attach references, and generate the PPT.
            </div>
          ) : null}
        </div>
      </div>

      {!isPreview && !isEmbedded ? (
        <PresentationContentAiComposer
          canEdit={canEdit}
          selected={selected}
          prompt={prompt}
          slideCountMode={slideCountMode}
          slideCount={slideCount}
          isGenerating={isGenerating}
          error={errorMessage}
          hasReferences={contentReferences.length > 0}
          header={
            <ReferenceComposerHeader
              canEdit={canEdit}
              references={contentReferences}
              referencedNodes={referencedNodes}
              onAddReference={onAddReference}
              onRemoveReference={onRemoveReference}
            />
          }
          onChangePrompt={onChangePrompt}
          onChangeSlideCountMode={onChangeSlideCountMode}
          onChangeSlideCount={onChangeSlideCount}
          onSubmit={onGenerate}
        />
      ) : null}
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
  videoEnhanceSourceFile,
  videoEnhanceParameters,
  contentReferences,
  referencedNodes,
  generationStatus,
  generationKind,
  generationErrorMessage,
  nodeName,
  isImageCropMode,
  isImageRepaintMode,
  isImageEraseMode,
  isImageOutpaintMode,
  isVideoTrimMode,
  isImageCropProcessing,
  isVideoTrimProcessing,
  videoTrimError,
  onAddReference,
  onRemoveReference,
  onStartImageCrop,
  onStartImageRepaint,
  onStartImageErase,
  onStartImageOutpaint,
  onStartImageCutout,
  onStartVideoTrim,
  onStartVideoEnhance,
  onCaptureVideoFrame,
  onCancelImageCrop,
  onCancelImageRepaint,
  onCancelImageErase,
  onCancelImageOutpaint,
  onCancelVideoTrim,
  onConfirmImageCrop,
  onConfirmVideoTrim,
  onConfirmVideoEnhance,
  onCreateImagePerspectiveVariant,
  onCreateImageRepaintVariant,
  onCreateImageEraseVariant,
  onSubmitImageOutpaint,
  onRetryImageCutout,
  onRetryImageOutpaint,
  onRetryDerivedImageGeneration,
  onRetryVideoFrameCapture,
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
  onChangeVideoEnhanceParameters,
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
  videoEnhanceSourceFile: EnhanceWorkspaceVideoBody['sourceFile'] | null
  videoEnhanceParameters: VideoEnhanceParametersValue
  contentReferences: ContentReferenceRecord[]
  referencedNodes: Record<string, PromptContextReferencedNode>
  generationStatus: ContentGenerationStatus | null
  generationKind: ContentGenerationKind | null
  generationErrorMessage: string | null
  nodeName?: string
  isImageCropMode: boolean
  isImageRepaintMode: boolean
  isImageEraseMode: boolean
  isImageOutpaintMode: boolean
  isVideoTrimMode: boolean
  isImageCropProcessing: boolean
  isVideoTrimProcessing: boolean
  videoTrimError: string | null
  onAddReference: () => void
  onRemoveReference: (reference: ContentReferenceRecord) => void
  onStartImageCrop: () => void
  onStartImageRepaint: () => void
  onStartImageErase: () => void
  onStartImageOutpaint: () => void
  onStartImageCutout: () => void
  onStartVideoTrim: () => void
  onStartVideoEnhance: () => void
  onCaptureVideoFrame: (params: {
    mode: VideoFrameCaptureMode
    timeSeconds: number
  }) => Promise<void> | void
  onCancelImageCrop: () => void
  onCancelImageRepaint: () => void
  onCancelImageErase: () => void
  onCancelImageOutpaint: () => void
  onCancelVideoTrim: () => void
  onConfirmImageCrop: (file: File) => Promise<void>
  onConfirmVideoTrim: (range: VideoTrimRange) => Promise<void>
  onConfirmVideoEnhance: () => Promise<void>
  onCreateImagePerspectiveVariant: (
    params: ImagePerspectiveGenerationRequest
  ) => Promise<void> | void
  onCreateImageRepaintVariant: (params: SubmitImageRepaintParams) => Promise<void> | void
  onCreateImageEraseVariant: (params: SubmitImageEraseParams) => Promise<void> | void
  onSubmitImageOutpaint: (params: SubmitImageOutpaintParams) => Promise<void> | void
  onRetryImageCutout: () => void
  onRetryImageOutpaint: () => void
  onRetryDerivedImageGeneration: () => void
  onRetryVideoFrameCapture: () => void
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
  onChangeVideoEnhanceParameters: (value: VideoEnhanceParametersValue) => void
}) {
  const params = useParams<{ workspaceId: string }>()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const uploadFileMutation = useUploadWorkspaceFile()
  const [error, setError] = useState<string | null>(null)
  const [isBroken, setIsBroken] = useState(false)
  const [isPerspectiveMenuOpen, setIsPerspectiveMenuOpen] = useState(false)
  const [isFrameCaptureMenuOpen, setIsFrameCaptureMenuOpen] = useState(false)
  const frameSelection = useVideoFrameSelectionStore((state) => state.selection)
  const beginFrameSelection = useVideoFrameSelectionStore((state) => state.beginSelection)
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const currentEditorBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const workflowBlocks = useWorkflowStore((state) => state.blocks)
  const [inferredAspectRatio, setInferredAspectRatio] = useState<Exclude<
    ImageAspectRatioValue,
    'auto'
  > | null>(null)

  const mediaPath = resolveUserFileUrl(file)
  const trimSourceFile = useMemo(
    () => (file ? toTrimRequestFile(file) : null),
    [file?.context, file?.id, file?.key, file?.name, file?.path, file?.size, file?.type, file?.url]
  )
  const isVideoEnhanceNode = variant === 'video' && generationKind === 'video_enhance'
  const isVideoEnhancePendingConfig =
    isVideoEnhanceNode && generationStatus === 'pending_config' && !file
  const isVideoEnhanceProcessing = isVideoEnhanceNode && generationStatus === 'pending' && !file
  const isVideoEnhanceError = isVideoEnhanceNode && generationStatus === 'error' && !file
  const videoEnhancePanelSourceFile = videoEnhanceSourceFile ?? trimSourceFile
  const videoEnhancePanelSourceUrl = videoEnhancePanelSourceFile?.url || mediaPath
  const canUpload = canEdit && !isPreview
  const accept = variant === 'image' ? 'image/*' : variant === 'video' ? 'video/*' : 'audio/*'
  const cardWidth =
    variant === 'image'
      ? IMAGE_CARD_WIDTH
      : variant === 'video'
        ? isVideoTrimMode
          ? 720
          : VIDEO_CARD_WIDTH
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
  const referenceContextText = useMemo(
    () =>
      buildContentReferencePromptContext({
        references: contentReferences,
        referencedNodes,
      }),
    [contentReferences, referencedNodes]
  )
  const resolvedImageModel = (aiModel || DEFAULT_IMAGE_AI_MODEL) as ImageGenerationModelId
  const showImageGenerationCompleteToast = useCallback(() => {
    toast.success('图片已生成')
  }, [])
  const showImageGenerationErrorToast = useCallback((message: string) => {
    toast.error(message)
  }, [])
  const showVideoGenerationCompleteToast = useCallback(() => {
    toast.success('视频已生成')
  }, [])
  const showVideoGenerationErrorToast = useCallback((message: string) => {
    toast.error(message)
  }, [])
  const showAudioGenerationCompleteToast = useCallback(() => {
    toast.success('音频已生成')
  }, [])
  const showAudioGenerationErrorToast = useCallback((message: string) => {
    toast.error(message)
  }, [])
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
    model: resolvedImageModel,
    availability: modelAvailability,
    aspectRatio: resolvedAspectRatio,
    referenceContext: structuredReferenceContext,
    onChangeFile,
    onGenerationComplete: showImageGenerationCompleteToast,
    onGenerationError: showImageGenerationErrorToast,
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
    referenceContextText,
    onChangeFile,
    onGenerationComplete: showVideoGenerationCompleteToast,
    onGenerationError: showVideoGenerationErrorToast,
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
    onGenerationComplete: showAudioGenerationCompleteToast,
    onGenerationError: showAudioGenerationErrorToast,
  })
  const currentImageModelDisabledReason = useMemo(
    () =>
      getModelDisabledReason({
        targetVariant: 'image',
        model: resolvedImageModel,
        references: contentReferences,
      }),
    [contentReferences, resolvedImageModel]
  )
  const imageModelOptionsWithDisabledReason = useMemo(
    () =>
      getCompatibleModelOptions({
        targetVariant: 'image',
        currentModel: resolvedImageModel,
        references: contentReferences,
        options: modelOptions,
      }),
    [contentReferences, modelOptions, resolvedImageModel]
  )
  const currentVideoModelFamilyDisabledReason = useMemo(
    () =>
      getVideoFamilyDisabledReason({
        family: videoModelFamily,
        references: contentReferences,
      }),
    [contentReferences, videoModelFamily]
  )
  const videoModelOptionsWithDisabledReason = useMemo(
    () =>
      getCompatibleVideoFamilyOptions({
        currentFamily: videoModelFamily,
        references: contentReferences,
        options: videoModelOptions,
      }),
    [contentReferences, videoModelFamily, videoModelOptions]
  )
  const currentAudioModelDisabledReason = useMemo(
    () =>
      getModelDisabledReason({
        targetVariant: 'audio',
        model: audioModel,
        references: contentReferences,
      }),
    [audioModel, contentReferences]
  )
  const audioModelOptionsWithDisabledReason = useMemo(
    () =>
      getCompatibleModelOptions({
        targetVariant: 'audio',
        currentModel: audioModel,
        references: contentReferences,
        options: audioModelOptions,
      }),
    [audioModel, audioModelOptions, contentReferences]
  )
  const handleSubmitImagePrompt = useCallback(() => {
    if (currentImageModelDisabledReason) return
    submitPrompt()
  }, [currentImageModelDisabledReason, submitPrompt])
  const handleSubmitVideoPrompt = useCallback(() => {
    if (currentVideoModelFamilyDisabledReason) return
    submitVideoPrompt()
  }, [currentVideoModelFamilyDisabledReason, submitVideoPrompt])
  const handleSubmitAudioPrompt = useCallback(() => {
    if (currentAudioModelDisabledReason) return
    submitAudioPrompt()
  }, [currentAudioModelDisabledReason, submitAudioPrompt])

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
          url: result.file.url,
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
  const isOrdinaryGenerationPending =
    variant === 'image' ? isGenerating : variant === 'video' ? isVideoGenerating : isAudioGenerating
  const ordinaryGenerationLabel =
    variant === 'image' ? '图片生成中...' : variant === 'video' ? '视频生成中...' : '音频生成中...'
  const isImageCutoutNode = variant === 'image' && generationKind === 'cutout'
  const isImageCutoutPending = isImageCutoutNode && generationStatus === 'pending' && !file
  const isImageCutoutError = isImageCutoutNode && generationStatus === 'error' && !file
  const isVideoFrameCaptureNode = variant === 'image' && generationKind === 'video_frame_capture'
  const isVideoFrameCapturePending =
    isVideoFrameCaptureNode && generationStatus === 'pending' && !file
  const isVideoFrameCaptureError = isVideoFrameCaptureNode && generationStatus === 'error' && !file
  const isImageOutpaintNode = variant === 'image' && generationKind === 'image_outpaint'
  const isImageOutpaintPending = isImageOutpaintNode && generationStatus === 'pending' && !file
  const isImageOutpaintError = isImageOutpaintNode && generationStatus === 'error' && !file
  const isImagePerspectiveNode = variant === 'image' && generationKind === 'image_perspective'
  const isImageRepaintNode = variant === 'image' && generationKind === 'image_repaint'
  const isImageEraseNode = variant === 'image' && generationKind === 'image_erase'
  const isDerivedImageGenerationNode =
    isImagePerspectiveNode || isImageRepaintNode || isImageEraseNode
  const isDerivedImageGenerationPending =
    isDerivedImageGenerationNode && generationStatus === 'pending' && !file
  const isDerivedImageGenerationError =
    isDerivedImageGenerationNode && generationStatus === 'error' && !file
  const derivedImageGenerationLabel = isImagePerspectiveNode
    ? '多角度生成中...'
    : isImageRepaintNode
      ? '重绘中...'
      : '擦除中...'
  const derivedImageGenerationFallbackError = isImagePerspectiveNode
    ? '多角度生成失败，请重试。'
    : isImageRepaintNode
      ? '重绘失败，请重试。'
      : '擦除失败，请重试。'
  const DerivedImageGenerationRetryIcon = isImagePerspectiveNode
    ? BoxIcon
    : isImageRepaintNode
      ? Brush
      : Eraser
  const isImageToolActive =
    isImageCropMode ||
    isImageRepaintMode ||
    isImageEraseMode ||
    isImageOutpaintMode ||
    isPerspectiveMenuOpen
  const hasLegacyToolbarDerivedReference =
    variant === 'image' &&
    contentReferences.length > 0 &&
    aiPrompt.trim().length === 0 &&
    (hasMedia ||
      contentReferences.some(
        (reference) =>
          reference.sourceVariant === 'video' && reference.role === 'video_frame_capture'
      ))
  const showUploadAction =
    selected &&
    canUpload &&
    ((variant !== 'image' && variant !== 'video') || !hasMedia) &&
    !isImageCutoutPending &&
    !isImageCutoutError &&
    !isVideoFrameCapturePending &&
    !isVideoFrameCaptureError &&
    !isImageOutpaintPending &&
    !isImageOutpaintError &&
    !isDerivedImageGenerationPending &&
    !isDerivedImageGenerationError &&
    !isVideoEnhanceNode
  const showImageCropAction =
    selected &&
    canUpload &&
    variant === 'image' &&
    hasMedia &&
    !isImageCropMode &&
    !isImageRepaintMode &&
    !isImageEraseMode &&
    !isImageOutpaintMode
  const showImageComposer =
    shouldShowImageComposer({
      variant,
      generationKind,
      isImageToolActive,
      hasLegacyToolbarDerivedReference,
    }) &&
    !isImageCutoutPending &&
    !isImageCutoutError &&
    !isVideoFrameCapturePending &&
    !isVideoFrameCaptureError &&
    !isImageOutpaintPending &&
    !isImageOutpaintError &&
    !isDerivedImageGenerationPending &&
    !isDerivedImageGenerationError
  const showImageToolbar =
    selected &&
    canUpload &&
    variant === 'image' &&
    hasMedia &&
    !isImageCropMode &&
    !isImageRepaintMode &&
    !isImageEraseMode &&
    !isImageOutpaintMode
  const showVideoToolbar =
    selected && canUpload && variant === 'video' && hasMedia && !isVideoTrimMode
  const isTrimDerivedVideo =
    variant === 'video' &&
    contentReferences.some(
      (reference) => reference.sourceVariant === 'video' && reference.role === 'text_context'
    )
  const showVideoComposer =
    variant === 'video' &&
    !isVideoTrimMode &&
    !isVideoEnhanceNode &&
    (!hasMedia || !isTrimDerivedVideo)
  const showVideoEnhancePanel = isVideoEnhanceNode && !hasMedia && !isPreview && !isEmbedded

  useEffect(() => {
    if (!showImageToolbar) {
      setIsPerspectiveMenuOpen(false)
    }
  }, [showImageToolbar])

  useEffect(() => {
    if (!showVideoToolbar) {
      setIsFrameCaptureMenuOpen(false)
    }
  }, [showVideoToolbar])

  const handleSelectVideoFrameCapture = useCallback(
    (mode: VideoFrameCaptureMode) => {
      setIsFrameCaptureMenuOpen(false)
      setError(null)
      const captureTime = resolveVideoFrameCaptureTime(videoRef.current, mode)
      if (!captureTime.ok) {
        setError(captureTime.error)
        return
      }

      void onCaptureVideoFrame({
        mode,
        timeSeconds: captureTime.timeSeconds,
      })
    },
    [onCaptureVideoFrame]
  )

  return (
    <div ref={rootRef} className='relative overflow-visible'>
      {showUploadAction && (
        <button
          type='button'
          aria-label={uploadActionLabel}
          title={uploadActionLabel}
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

      {showImageToolbar && (
        <div className='nodrag nopan -translate-x-1/2 absolute top-[-56px] left-1/2 z-40 inline-flex items-center gap-1.5'>
          {showImageCropAction && (
            <button
              type='button'
              aria-label='Crop image'
              title='Crop image'
              onPointerDown={(event) => {
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                setIsPerspectiveMenuOpen(false)
                onStartImageCrop()
              }}
              className='inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm hover-hover:bg-[var(--surface-3)]'
            >
              <CropIcon className='h-3.5 w-3.5' />
            </button>
          )}
          <button
            type='button'
            aria-label='多角度'
            title='多角度'
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              setIsPerspectiveMenuOpen((current) => !current)
            }}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm hover-hover:bg-[var(--surface-3)]',
              isPerspectiveMenuOpen && 'bg-[var(--surface-3)]'
            )}
          >
            <BoxIcon className='h-3.5 w-3.5' />
          </button>
          <button
            type='button'
            aria-label='重绘'
            title='重绘'
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              setIsPerspectiveMenuOpen(false)
              onStartImageRepaint()
            }}
            className='inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm hover-hover:bg-[var(--surface-3)]'
          >
            <Brush className='h-3.5 w-3.5' />
          </button>
          <button
            type='button'
            aria-label='擦除'
            title='擦除'
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              setIsPerspectiveMenuOpen(false)
              onStartImageErase()
            }}
            className='inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm hover-hover:bg-[var(--surface-3)]'
          >
            <Eraser className='h-3.5 w-3.5' />
          </button>
          <button
            type='button'
            aria-label='抠图'
            title='抠图'
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              setIsPerspectiveMenuOpen(false)
              onStartImageCutout()
            }}
            className='inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm hover-hover:bg-[var(--surface-3)]'
          >
            <Scissors className='h-3.5 w-3.5' />
          </button>
          <button
            type='button'
            aria-label='扩图'
            title='扩图'
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              setIsPerspectiveMenuOpen(false)
              onStartImageOutpaint()
            }}
            className='inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm hover-hover:bg-[var(--surface-3)]'
          >
            <Expand className='h-3.5 w-3.5' />
          </button>
          {file ? (
            <ImageToolbarActions
              file={file}
              imageSrc={mediaPath}
              nodeName={nodeName}
              isReplacing={uploadFileMutation.isPending}
              onReplace={() => {
                setIsPerspectiveMenuOpen(false)
                openFileDialog()
              }}
              onError={setError}
            />
          ) : null}
        </div>
      )}

      {showVideoToolbar && (
        <div className='nodrag nopan -translate-x-1/2 absolute top-[-38px] left-1/2 z-40 inline-flex items-center gap-1.5'>
          <button
            type='button'
            aria-label='剪辑视频'
            title='剪辑视频'
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              onStartVideoTrim()
            }}
            className='inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm hover-hover:bg-[var(--surface-3)]'
          >
            <Scissors className='h-3.5 w-3.5' />
          </button>
          <button
            type='button'
            aria-label='视频增强'
            title='视频增强'
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              onStartVideoEnhance()
            }}
            className='inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm hover-hover:bg-[var(--surface-3)]'
          >
            <Sparkles className='h-3.5 w-3.5' />
          </button>
          <div className='nodrag nopan relative'>
            <button
              type='button'
              aria-label='截帧'
              title='截帧'
              onPointerDown={(event) => {
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                setIsFrameCaptureMenuOpen((current) => !current)
              }}
              className={cn(
                'nodrag nopan inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm hover-hover:bg-[var(--surface-3)]',
                isFrameCaptureMenuOpen && 'bg-[var(--surface-3)]'
              )}
            >
              <Camera className='h-3.5 w-3.5' />
            </button>
            {isFrameCaptureMenuOpen ? (
              <VideoFrameCaptureMenu onSelect={handleSelectVideoFrameCapture} />
            ) : null}
          </div>
        </div>
      )}

      <div
        className={cn(
          'relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] transition-[width,min-height]',
          isVideoTrimMode && variant === 'video' && 'shadow-[0_0_0_1px_rgba(255,255,255,0.08)]'
        )}
        style={{ width: cardWidth, minHeight: cardHeight }}
      >
        <input
          ref={inputRef}
          type='file'
          accept={accept}
          className='hidden'
          onChange={handleFileChange}
        />

        {isOrdinaryGenerationPending ? (
          <ContentGenerationLoadingState
            label={ordinaryGenerationLabel}
            className={variant === 'audio' ? 'h-[132px] w-full' : 'h-[240px] w-full'}
          />
        ) : hasMedia ? (
          variant === 'image' ? (
            <div
              className={cn(
                'relative flex h-[240px] w-[320px] items-center justify-center bg-[var(--surface-1)] px-3 py-3',
                (isReferencedFirstFrame || isReferencedLastFrame) &&
                  'ring-2 ring-[#F4B740] ring-offset-0'
              )}
            >
              <img
                ref={imageRef}
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
            <div
              className={cn(
                'flex flex-col gap-3 bg-[var(--surface-1)] px-3 py-3',
                isVideoTrimMode ? 'w-[720px]' : 'w-[360px]'
              )}
            >
              {/* biome-ignore lint/a11y/useMediaCaption: uploaded local video cards do not have a caption track in this iteration. */}
              <video
                ref={videoRef}
                src={mediaPath}
                controls
                preload='metadata'
                className={cn(
                  'nopan aspect-video w-full rounded-xl bg-black object-contain',
                  isVideoTrimMode && 'nodrag rounded-[18px]'
                )}
                onPointerDown={(event) => {
                  if (isVideoTrimMode) event.stopPropagation()
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
        ) : isImageCutoutPending ? (
          <div className='nopan flex h-[240px] w-full flex-col items-center justify-center gap-3 bg-[var(--surface-1)] px-6 text-center text-[var(--text-secondary)]'>
            <Loader2 className='h-6 w-6 animate-spin text-[var(--brand-secondary)]' />
            <div className='font-medium text-sm'>抠图中...</div>
          </div>
        ) : isImageCutoutError ? (
          <div className='nopan flex h-[240px] w-full flex-col items-center justify-center gap-3 bg-[var(--surface-1)] px-6 text-center'>
            <div className='max-w-[240px] text-[var(--text-error)] text-xs'>
              {generationErrorMessage || '抠图失败，请重试。'}
            </div>
            <button
              type='button'
              aria-label='重试抠图'
              title='重试抠图'
              className='nodrag nopan inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[var(--text-primary)] text-xs shadow-sm hover-hover:bg-[var(--surface-3)]'
              onPointerDown={(event) => {
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                onRetryImageCutout()
              }}
            >
              <Scissors className='h-3.5 w-3.5' />
              <span>重试</span>
            </button>
          </div>
        ) : isVideoFrameCapturePending ? (
          <div className='nopan flex h-[240px] w-full flex-col items-center justify-center gap-3 bg-[var(--surface-1)] px-6 text-center text-[var(--text-secondary)]'>
            <Loader2 className='h-6 w-6 animate-spin text-[var(--brand-secondary)]' />
            <div className='font-medium text-sm'>截帧中...</div>
          </div>
        ) : isVideoFrameCaptureError ? (
          <div className='nopan flex h-[240px] w-full flex-col items-center justify-center gap-3 bg-[var(--surface-1)] px-6 text-center'>
            <div className='max-w-[240px] text-[var(--text-error)] text-xs'>
              {generationErrorMessage || '截帧失败，请重试。'}
            </div>
            <button
              type='button'
              aria-label='重试截帧'
              title='重试截帧'
              className='nodrag nopan inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[var(--text-primary)] text-xs shadow-sm hover-hover:bg-[var(--surface-3)]'
              onPointerDown={(event) => {
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                onRetryVideoFrameCapture()
              }}
            >
              <Camera className='h-3.5 w-3.5' />
              <span>重试</span>
            </button>
          </div>
        ) : isImageOutpaintPending ? (
          <div className='nopan flex h-[240px] w-full flex-col items-center justify-center gap-3 bg-[var(--surface-1)] px-6 text-center text-[var(--text-secondary)]'>
            <Loader2 className='h-6 w-6 animate-spin text-[var(--brand-secondary)]' />
            <div className='font-medium text-sm'>扩图中...</div>
          </div>
        ) : isImageOutpaintError ? (
          <div className='nopan flex h-[240px] w-full flex-col items-center justify-center gap-3 bg-[var(--surface-1)] px-6 text-center'>
            <div className='max-w-[240px] text-[var(--text-error)] text-xs'>
              {generationErrorMessage || '扩图失败，请重试。'}
            </div>
            <button
              type='button'
              aria-label='重试扩图'
              title='重试扩图'
              className='nodrag nopan inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[var(--text-primary)] text-xs shadow-sm hover-hover:bg-[var(--surface-3)]'
              onPointerDown={(event) => {
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                onRetryImageOutpaint()
              }}
            >
              <Expand className='h-3.5 w-3.5' />
              <span>重试</span>
            </button>
          </div>
        ) : isDerivedImageGenerationPending ? (
          <div className='nopan flex h-[240px] w-full flex-col items-center justify-center gap-3 bg-[var(--surface-1)] px-6 text-center text-[var(--text-secondary)]'>
            <Loader2 className='h-6 w-6 animate-spin text-[var(--brand-secondary)]' />
            <div className='font-medium text-sm'>{derivedImageGenerationLabel}</div>
          </div>
        ) : isDerivedImageGenerationError ? (
          <div className='nopan flex h-[240px] w-full flex-col items-center justify-center gap-3 bg-[var(--surface-1)] px-6 text-center'>
            <div className='max-w-[240px] text-[var(--text-error)] text-xs'>
              {generationErrorMessage || derivedImageGenerationFallbackError}
            </div>
            <button
              type='button'
              aria-label='重试图片生成'
              title='重试'
              className='nodrag nopan inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[var(--text-primary)] text-xs shadow-sm hover-hover:bg-[var(--surface-3)]'
              onPointerDown={(event) => {
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                onRetryDerivedImageGeneration()
              }}
            >
              <DerivedImageGenerationRetryIcon className='h-3.5 w-3.5' />
              <span>重试</span>
            </button>
          </div>
        ) : isVideoEnhancePendingConfig ? (
          <div className='nopan flex h-[240px] w-full items-center justify-center bg-[var(--surface-1)] px-6 text-center'>
            <div className='font-medium text-[#B8D7FF] text-sm'>配置参数生成高清视频</div>
          </div>
        ) : isVideoEnhanceProcessing ? (
          <div className='nopan flex h-[240px] w-full flex-col items-center justify-center gap-3 bg-[var(--surface-1)] px-6 text-center text-[var(--text-secondary)]'>
            <Loader2 className='h-6 w-6 animate-spin text-[var(--brand-secondary)]' />
            <div className='font-medium text-sm'>正在生成高清视频...</div>
          </div>
        ) : isVideoEnhanceError ? (
          <div className='nopan flex h-[240px] w-full items-center justify-center bg-[var(--surface-1)] px-6 text-center'>
            <div className='max-w-[260px] text-[var(--text-error)] text-xs'>
              {generationErrorMessage || '视频增强失败，请重试。'}
            </div>
          </div>
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

      {variant === 'image' && hasMedia && isImageCropMode ? (
        <ImageCropOverlay
          rootRef={rootRef}
          imageRef={imageRef}
          imageName={file?.name}
          imageType={file?.type}
          isProcessing={isImageCropProcessing}
          onCancel={onCancelImageCrop}
          onConfirm={onConfirmImageCrop}
        />
      ) : null}

      {variant === 'image' && hasMedia && isImageRepaintMode && file ? (
        <ImageRepaintOverlay
          workspaceId={params.workspaceId}
          rootRef={rootRef}
          imageRef={imageRef}
          sourceFile={file}
          isProcessingNode={false}
          onCancel={onCancelImageRepaint}
          onCreateVariant={onCreateImageRepaintVariant}
        />
      ) : null}

      {variant === 'image' && hasMedia && isImageEraseMode && file ? (
        <ImageEraseOverlay
          workspaceId={params.workspaceId}
          rootRef={rootRef}
          imageRef={imageRef}
          sourceFile={file}
          isProcessingNode={false}
          onCancel={onCancelImageErase}
          onCreateVariant={onCreateImageEraseVariant}
        />
      ) : null}

      {variant === 'image' && hasMedia && isImageOutpaintMode && file ? (
        <ImageOutpaintOverlay
          workspaceId={params.workspaceId}
          rootRef={rootRef}
          imageRef={imageRef}
          sourceFile={file}
          isProcessingNode={false}
          onCancel={onCancelImageOutpaint}
          onSubmitOutpaint={onSubmitImageOutpaint}
        />
      ) : null}

      {variant === 'image' && hasMedia && isPerspectiveMenuOpen && file ? (
        <ImagePerspectiveMenu
          workspaceId={params.workspaceId}
          sourceFile={file}
          availability={modelAvailability}
          onCreateVariant={onCreateImagePerspectiveVariant}
          onClose={() => setIsPerspectiveMenuOpen(false)}
        />
      ) : null}

      {variant === 'video' && hasMedia && isVideoTrimMode && file ? (
        <VideoTrimOverlay
          videoRef={videoRef}
          videoSrc={mediaPath}
          workspaceId={params.workspaceId}
          sourceFile={trimSourceFile}
          isProcessing={isVideoTrimProcessing}
          error={videoTrimError}
          onCancel={onCancelVideoTrim}
          onConfirm={onConfirmVideoTrim}
        />
      ) : null}

      {showImageComposer && !isPreview && !isEmbedded && (
        <MediaContentAiComposer
          canEdit={canEdit}
          selected={selected}
          prompt={aiPrompt}
          model={resolvedImageModel}
          aspectRatio={resolvedAspectRatio}
          isGenerating={isGenerating}
          error={generationError ?? currentImageModelDisabledReason}
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
          onSubmit={handleSubmitImagePrompt}
        />
      )}

      {showVideoEnhancePanel && (
        <VideoEnhancePanel
          workspaceId={params.workspaceId}
          sourceFile={videoEnhancePanelSourceFile}
          sourceVideoUrl={videoEnhancePanelSourceUrl}
          canEdit={canEdit}
          isProcessing={isVideoEnhanceProcessing}
          error={isVideoEnhanceError ? generationErrorMessage : null}
          parameters={videoEnhanceParameters}
          onChangeParameters={onChangeVideoEnhanceParameters}
          onSubmit={() => {
            void onConfirmVideoEnhance()
          }}
        />
      )}

      {showVideoComposer && !isPreview && !isEmbedded && (
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
          error={videoGenerationError ?? currentVideoModelFamilyDisabledReason}
          isSelectingFrame={frameSelection?.targetBlockId === blockId}
          selectedFrameSlot={frameSelection?.targetBlockId === blockId ? frameSelection.slot : null}
          header={
            <ReferenceComposerHeader
              canEdit={canEdit}
              references={contentReferences}
              referencedNodes={referencedNodes}
              onAddReference={onAddReference}
              onRemoveReference={onRemoveReference}
            />
          }
          modelOptions={videoModelOptionsWithDisabledReason}
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
          onSubmit={handleSubmitVideoPrompt}
        />
      )}

      {variant === 'audio' && !isPreview && !isEmbedded && (
        <AudioContentAiComposer
          canEdit={canEdit}
          selected={selected}
          prompt={audioPrompt}
          model={audioModel}
          parameters={audioParameters}
          isGenerating={isAudioGenerating}
          error={audioGenerationError ?? currentAudioModelDisabledReason}
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
          onSubmit={handleSubmitAudioPrompt}
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
  const params = useParams<{ workspaceId: string; workflowId: string }>()
  const router = useRouter()
  const reactFlowInstance = useReactFlow()
  const viewport = useViewport()
  const { fitViewToBounds } = useCanvasViewport(reactFlowInstance, {
    embedded: Boolean(data.isEmbedded),
  })
  const uploadWorkspaceFileMutation = useUploadWorkspaceFile()
  const createShowcaseItem = useCreateProductionShowcaseItem()
  const generatePresentation = useGenerateContentCanvasPresentation()
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
  const [videoEnhanceSourceFileValue] = useSubBlockValue<
    EnhanceWorkspaceVideoBody['sourceFile'] | null
  >(id, 'videoEnhanceSourceFile')
  const [videoEnhanceParametersValue, setVideoEnhanceParametersValue] =
    useSubBlockValue<VideoEnhanceParametersValue>(id, 'videoEnhanceParameters')
  const [videoFrameCaptureSourceFileValue] = useSubBlockValue<
    CaptureWorkspaceVideoFrameBody['sourceFile'] | null
  >(id, 'videoFrameCaptureSourceFile')
  const [videoFrameCaptureModeValue] = useSubBlockValue<VideoFrameCaptureMode | null>(
    id,
    'videoFrameCaptureMode'
  )
  const [videoFrameCaptureTimeSecondsValue] = useSubBlockValue<number | null>(
    id,
    'videoFrameCaptureTimeSeconds'
  )
  const [presentationPromptValue, setPresentationPromptValue] = useSubBlockValue<string>(
    id,
    'presentationPrompt'
  )
  const [presentationSlideCountModeValue, setPresentationSlideCountModeValue] =
    useSubBlockValue<string>(id, 'presentationSlideCountMode')
  const [presentationSlideCountValue, setPresentationSlideCountValue] = useSubBlockValue<number>(
    id,
    'presentationSlideCount'
  )
  const [presentationStatusValue, setPresentationStatusValue] = useSubBlockValue<string>(
    id,
    'presentationStatus'
  )
  const [presentationErrorValue, setPresentationErrorValue] = useSubBlockValue<string | null>(
    id,
    'presentationError'
  )
  const [presentationArtifactValue, setPresentationArtifactValue] =
    useSubBlockValue<PresentationArtifactValue | null>(id, 'presentationArtifact')
  const [fileValue, setFileValue] = useSubBlockValue<UploadedFileValue | null>(id, 'file')
  const [contentReferencesValue, setContentReferencesValue] = useSubBlockValue<
    ContentReferenceRecord[]
  >(id, 'contentReferences')
  const [generationStatusValue] = useSubBlockValue<string>(id, 'generationStatus')
  const [generationKindValue] = useSubBlockValue<string>(id, 'generationKind')
  const [generationErrorValue] = useSubBlockValue<string | null>(id, 'generationError')

  const userPermissions = useUserPermissionsContext()
  const canEditWorkflow = userPermissions.canEdit && !data.isWorkflowLocked
  const contentReferenceSelection = useContentReferenceSelectionStore((state) => state.selection)
  const beginContentReferenceSelection = useContentReferenceSelectionStore(
    (state) => state.beginSelection
  )
  const frameSelection = useVideoFrameSelectionStore((state) => state.selection)
  const workflowBlocks = useWorkflowStore((state) => state.blocks)
  const workflowEdges = useWorkflowStore((state) => state.edges)
  const workflowValues = useSubBlockStore(
    useCallback(
      (state) =>
        activeWorkflowId
          ? (state.workflowValues[activeWorkflowId] ?? EMPTY_SUBBLOCK_VALUES)
          : EMPTY_SUBBLOCK_VALUES,
      [activeWorkflowId]
    )
  )
  const {
    collaborativeBatchAddBlocks,
    collaborativeBatchRemoveEdges,
    collaborativeBatchAddEdges,
    collaborativeSetSubblockValue,
    collaborativeUpdateBlockName,
  } = useCollaborativeWorkflow()
  const blockStoredValues = (workflowBlocks[id]?.subBlocks as StoredValueRecord) ?? undefined
  const setPendingSelection = useWorkflowRegistry((state) => state.setPendingSelection)
  const [createMenuAnchor, setCreateMenuAnchor] = useState<'left' | 'right' | null>(null)
  const [isImageCropMode, setIsImageCropMode] = useState(false)
  const [isImageRepaintMode, setIsImageRepaintMode] = useState(false)
  const [isImageEraseMode, setIsImageEraseMode] = useState(false)
  const [isImageOutpaintMode, setIsImageOutpaintMode] = useState(false)
  const [isVideoTrimMode, setIsVideoTrimMode] = useState(false)
  const [isVideoTrimProcessing, setIsVideoTrimProcessing] = useState(false)
  const [videoTrimError, setVideoTrimError] = useState<string | null>(null)
  const [referenceDragState, setReferenceDragState] = useState<ContentReferenceDragState | null>(
    null
  )

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
  const resolvedVideoEnhanceSourceFile = extractStoredValue<
    EnhanceWorkspaceVideoBody['sourceFile'] | null
  >(
    data.isPreview
      ? sourceValues
      : ({ videoEnhanceSourceFile: videoEnhanceSourceFileValue } as StoredValueRecord),
    'videoEnhanceSourceFile',
    null
  )
  const resolvedVideoEnhanceParameters = normalizeVideoEnhanceParameters(
    extractStoredValue<unknown>(
      data.isPreview
        ? sourceValues
        : ({
            videoEnhanceParameters: videoEnhanceParametersValue,
          } as StoredValueRecord),
      'videoEnhanceParameters',
      DEFAULT_VIDEO_ENHANCE_PARAMETERS
    )
  )
  const resolvedVideoFrameCaptureSourceFile = extractStoredValue<
    CaptureWorkspaceVideoFrameBody['sourceFile'] | null
  >(
    data.isPreview
      ? sourceValues
      : ({ videoFrameCaptureSourceFile: videoFrameCaptureSourceFileValue } as StoredValueRecord),
    'videoFrameCaptureSourceFile',
    null
  )
  const resolvedVideoFrameCaptureMode = extractStoredValue<VideoFrameCaptureMode | null>(
    data.isPreview
      ? sourceValues
      : ({ videoFrameCaptureMode: videoFrameCaptureModeValue } as StoredValueRecord),
    'videoFrameCaptureMode',
    null
  )
  const resolvedVideoFrameCaptureTimeSeconds = extractStoredValue<number | null>(
    data.isPreview
      ? sourceValues
      : ({
          videoFrameCaptureTimeSeconds: videoFrameCaptureTimeSecondsValue,
        } as StoredValueRecord),
    'videoFrameCaptureTimeSeconds',
    null
  )
  const resolvedPresentationPrompt = extractStoredValue<string>(
    data.isPreview
      ? sourceValues
      : ({ presentationPrompt: presentationPromptValue } as StoredValueRecord),
    'presentationPrompt',
    ''
  )
  const resolvedPresentationSlideCountMode = normalizePresentationSlideCountMode(
    extractStoredValue<string>(
      data.isPreview
        ? sourceValues
        : ({ presentationSlideCountMode: presentationSlideCountModeValue } as StoredValueRecord),
      'presentationSlideCountMode',
      'auto'
    )
  )
  const resolvedPresentationSlideCount = coerceNumber(
    extractStoredValue<number | string>(
      data.isPreview
        ? sourceValues
        : ({ presentationSlideCount: presentationSlideCountValue } as StoredValueRecord),
      'presentationSlideCount',
      8
    ),
    8
  )
  const resolvedPresentationStatus = normalizePresentationGenerationStatus(
    extractStoredValue<string | null>(
      data.isPreview
        ? sourceValues
        : ({ presentationStatus: presentationStatusValue } as StoredValueRecord),
      'presentationStatus',
      'idle'
    )
  )
  const resolvedPresentationError = extractStoredValue<string | null>(
    data.isPreview
      ? sourceValues
      : ({ presentationError: presentationErrorValue } as StoredValueRecord),
    'presentationError',
    null
  )
  const resolvedPresentationArtifact = normalizePresentationArtifact(
    extractStoredValue<unknown>(
      data.isPreview
        ? sourceValues
        : ({ presentationArtifact: presentationArtifactValue } as StoredValueRecord),
      'presentationArtifact',
      null
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
  const resolvedGenerationStatus = extractStoredValue<string | null>(
    data.isPreview
      ? sourceValues
      : ({
          generationStatus:
            generationStatusValue ??
            extractStoredValue<string | null>(blockStoredValues, 'generationStatus', null),
        } as StoredValueRecord),
    'generationStatus',
    null
  )
  const resolvedGenerationKind = extractStoredValue<string | null>(
    data.isPreview
      ? sourceValues
      : ({
          generationKind:
            generationKindValue ??
            extractStoredValue<string | null>(blockStoredValues, 'generationKind', null),
        } as StoredValueRecord),
    'generationKind',
    null
  )
  const resolvedGenerationError = extractStoredValue<string | null>(
    data.isPreview
      ? sourceValues
      : ({
          generationError:
            generationErrorValue ??
            extractStoredValue<string | null>(blockStoredValues, 'generationError', null),
        } as StoredValueRecord),
    'generationError',
    null
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
  const effectiveDefaultImageModel = getEffectiveContentModelId({
    requestedModelId: DEFAULT_IMAGE_AI_MODEL,
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
          : resolvedVariant === 'presentation'
            ? 'codex-ppt-skill'
            : videoReferenceModelId
  const showcasePlainText = useMemo(
    () => (resolvedVariant === 'text' ? getPlainTextFromHtml(resolvedHtml) : ''),
    [resolvedHtml, resolvedVariant]
  )
  const showcasePrompt = useMemo(
    () =>
      getShowcasePromptForVariant({
        variant: resolvedVariant,
        aiPrompt: resolvedAiPrompt,
        audioPrompt: resolvedAudioPrompt,
        videoPrompt: resolvedVideoPrompt,
        presentationPrompt: resolvedPresentationPrompt,
      }),
    [
      resolvedAiPrompt,
      resolvedAudioPrompt,
      resolvedPresentationPrompt,
      resolvedVariant,
      resolvedVideoPrompt,
    ]
  )
  const resolvedPresentationFile = resolvedPresentationArtifact?.pptxFile ?? resolvedFile
  const showcaseAttachments = useMemo(
    () =>
      resolvedVariant === 'text'
        ? []
        : getShowcaseAttachmentsFromFile(
            resolveUserFileUrl(
              resolvedVariant === 'presentation' ? resolvedPresentationFile : resolvedFile
            )
              ? resolvedVariant === 'presentation'
                ? resolvedPresentationFile
                : resolvedFile
              : null
          ),
    [resolvedFile, resolvedPresentationFile, resolvedVariant]
  )
  const canSubmitToShowcase =
    selected &&
    canEditWorkflow &&
    !data.isPreview &&
    !data.isEmbedded &&
    (resolvedVariant === 'text' ? showcasePlainText.length > 0 : showcaseAttachments.length > 0)

  const generatePresentationFromNode = async () => {
    const sourceWorkflowId = activeWorkflowId || params.workflowId
    const prompt = resolvedPresentationPrompt.trim()
    if (!params.workspaceId || !sourceWorkflowId) {
      toast({ message: '缺少项目或画布上下文，无法生成 PPT。', duration: 2600 })
      return
    }
    if (!prompt && resolvedContentReferences.length === 0) {
      toast({ message: '请填写 PPT 提示词，或先引用一个内容节点。', duration: 2400 })
      return
    }

    setPresentationStatusValue('pending')
    setPresentationSlideCountModeValue(resolvedPresentationSlideCountMode)
    setPresentationErrorValue(null)
    setPresentationArtifactValue(null)
    setFileValue(null)

    try {
      const result = await generatePresentation.mutateAsync({
        workspaceId: params.workspaceId,
        workflowId: sourceWorkflowId,
        nodeId: id,
        prompt,
        slideCountMode: resolvedPresentationSlideCountMode,
        ...(resolvedPresentationSlideCountMode === 'manual'
          ? { slideCount: resolvedPresentationSlideCount }
          : {}),
      })
      setPresentationStatusValue(result.presentationStatus)
      setPresentationErrorValue(null)
      setPresentationArtifactValue(result.presentationArtifact)
      setFileValue(result.file)
      if (
        resolvedPresentationSlideCountMode === 'manual' &&
        result.presentationArtifact.manifest.slideCount
      ) {
        setPresentationSlideCountValue(result.presentationArtifact.manifest.slideCount)
      }
      toast({ message: 'PPT 已生成并回写到当前节点。', duration: 2400 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PPT 生成失败'
      setPresentationStatusValue('error')
      setPresentationErrorValue(message)
      toast({ message, duration: 3200 })
    }
  }

  const createMenuItems = useMemo(
    () =>
      CONTENT_NODE_MENU_ITEMS.filter((item) =>
        getContentReferenceCreateTargetVariants(resolvedVariant).includes(item.variant)
      ),
    [resolvedVariant]
  )

  const submitToShowcase = async () => {
    const sourceWorkflowId = activeWorkflowId || params.workflowId
    if (!params.workspaceId || !sourceWorkflowId) {
      toast({ message: '缺少项目或画布上下文，无法提交成果。', duration: 2600 })
      return
    }

    const content =
      resolvedVariant === 'text' ? showcasePlainText.trim() : showcasePrompt.trim() || null
    if (!content && showcaseAttachments.length === 0) {
      toast({ message: '当前节点没有可提交的文字或文件。', duration: 2400 })
      return
    }

    const title =
      resolvedVariant === 'text'
        ? getShowcaseTitleFromText(showcasePlainText)
        : getShowcaseTitleFromFile(resolvedFile, showcasePrompt)

    try {
      const result = await createShowcaseItem.mutateAsync({
        workspaceId: params.workspaceId,
        title,
        description: null,
        category: getShowcaseCategory(resolvedVariant),
        content: content ? truncateShowcaseText(content, 10000) : null,
        sourceWorkflowId,
        sourceNodeId: id,
        sourceNodeVariant: getShowcaseSourceNodeVariant(resolvedVariant),
        attachments: showcaseAttachments,
      })
      toast({ message: '已提交到成果中心，正在打开编辑界面。', duration: 2200 })
      router.push(
        `/workspace/${params.workspaceId}/showcase?tab=results&itemId=${result.item.id}&edit=1`
      )
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : '提交成果失败',
        duration: 2800,
      })
    }
  }

  const createReferencedContentNode = useCallback(
    (targetVariant: ContentVariant, anchor: 'left' | 'right') => {
      if (!canEditWorkflow || data.isPreview || data.isEmbedded) return

      const preset = getContentNodePreset(targetVariant)
      if (!preset?.available || !preset.blockType || !preset.contentVariant) return

      const blockConfig = getBlockConfigFromCatalog(preset.blockType)
      if (!blockConfig) return

      const targetModel = getDefaultReferenceModelForVariant(targetVariant)
      const referenceRole = getContentReferenceRoleForTarget({
        targetVariant,
        targetModel,
        sourceVariant: resolvedVariant,
      })
      if (!referenceRole) return

      const sourceBlock = workflowBlocks[id]
      const sourcePosition = sourceBlock?.position ?? { x: 0, y: 0 }
      const sourceWidth = getContentCardWidth(resolvedVariant)
      const targetWidth = getContentCardWidth(targetVariant)
      const targetPosition = {
        x:
          anchor === 'right'
            ? sourcePosition.x + sourceWidth + CONTENT_REFERENCE_CREATE_GAP
            : sourcePosition.x - targetWidth - CONTENT_REFERENCE_CREATE_GAP,
        y: sourcePosition.y,
      }

      const targetBlockId = generateId()
      const targetName = getUniqueBlockName(preset.label, workflowBlocks)
      const parentId = sourceBlock?.data?.parentId
      const block = prepareBlockState({
        id: targetBlockId,
        type: preset.blockType,
        name: targetName,
        position: targetPosition,
        data: {
          contentVariant: preset.contentVariant,
          ...(parentId ? { parentId, extent: 'parent' } : {}),
        },
        parentId,
        extent: parentId ? 'parent' : undefined,
        blockConfig,
      })

      const reference: ContentReferenceRecord = {
        sourceBlockId: id,
        sourceVariant: resolvedVariant,
        role: referenceRole,
      }
      const subBlockValues: Record<string, Record<string, unknown>> = {
        [targetBlockId]: {
          ...(preset.presetSubBlockValues ?? {}),
          contentVariant: targetVariant,
          contentReferences: [reference],
        },
      }

      if (targetVariant === 'video') {
        subBlockValues[targetBlockId].videoModelFamily =
          getVideoModelFamilyForInitialReference(resolvedVariant)
      }

      if (
        targetVariant === 'video' &&
        resolvedVariant === 'image' &&
        referenceRole === 'video_first_frame' &&
        resolvedFile?.key
      ) {
        subBlockValues[targetBlockId].videoMedia = [
          {
            type: 'first_frame',
            file: resolvedFile,
          },
        ]
      }

      const isVideoFrameReference =
        referenceRole === 'video_first_frame' || referenceRole === 'video_last_frame'
      const edgeSourceId = isVideoFrameReference ? id : targetBlockId
      const edgeTargetId = isVideoFrameReference ? targetBlockId : id
      const edgeSourcePosition = edgeSourceId === id ? sourcePosition : targetPosition
      const edgeTargetPosition = edgeTargetId === id ? sourcePosition : targetPosition
      const targetAnchor = getContentReferenceAnchorForTarget({
        sourceX: edgeSourcePosition.x,
        targetX: edgeTargetPosition.x,
      })
      const ordinaryHandles = getOrdinaryContentReferenceHandles()

      const edge = createContentReferenceEdge({
        id: generateId(),
        source: edgeSourceId,
        target: edgeTargetId,
        sourceHandle: isVideoFrameReference
          ? getContentReferenceSourceHandleId(
              edgeTargetPosition.x >= edgeSourcePosition.x ? 'right' : 'left'
            )
          : ordinaryHandles.sourceHandle,
        targetHandle: isVideoFrameReference
          ? getContentReferenceTargetHandleId(targetAnchor)
          : ordinaryHandles.targetHandle,
        autoLinkType: isVideoFrameReference ? referenceRole : undefined,
      })

      setPendingSelection([targetBlockId])
      collaborativeBatchAddBlocks([block], [edge], {}, {}, subBlockValues)
      usePanelEditorStore.getState().setCurrentBlockId(targetBlockId)
      setCreateMenuAnchor(null)
    },
    [
      canEditWorkflow,
      collaborativeBatchAddBlocks,
      data.isEmbedded,
      data.isPreview,
      id,
      resolvedFile,
      resolvedVariant,
      setPendingSelection,
      workflowBlocks,
    ]
  )

  const startImageCropMode = useCallback(() => {
    if (
      !canEditWorkflow ||
      data.isPreview ||
      data.isEmbedded ||
      resolvedVariant !== 'image' ||
      !resolvedFile
    ) {
      return
    }

    setIsImageCropMode(true)
    setIsImageRepaintMode(false)
    setIsImageEraseMode(false)
    setIsImageOutpaintMode(false)
    requestAnimationFrame(() => {
      const node = reactFlowInstance.getNodes().find((candidate) => candidate.id === id)
      if (!node) return
      fitViewToBounds({
        nodes: [node],
        padding: 0.08,
        maxZoom: 2.4,
        duration: 300,
      })
    })
  }, [
    canEditWorkflow,
    data.isEmbedded,
    data.isPreview,
    fitViewToBounds,
    id,
    reactFlowInstance,
    resolvedFile,
    resolvedVariant,
  ])

  const cancelImageCropMode = useCallback(() => {
    setIsImageCropMode(false)
  }, [])

  const startImageRepaintMode = useCallback(() => {
    if (
      !canEditWorkflow ||
      data.isPreview ||
      data.isEmbedded ||
      resolvedVariant !== 'image' ||
      !resolvedFile
    ) {
      return
    }

    setIsImageCropMode(false)
    setIsImageOutpaintMode(false)
    setIsImageEraseMode(false)
    setIsImageRepaintMode(true)
    requestAnimationFrame(() => {
      const node = reactFlowInstance.getNodes().find((candidate) => candidate.id === id)
      if (!node) return
      fitViewToBounds({
        nodes: [node],
        padding: 0.03,
        maxZoom: 2.8,
        duration: 300,
      })
    })
  }, [
    canEditWorkflow,
    data.isEmbedded,
    data.isPreview,
    fitViewToBounds,
    id,
    reactFlowInstance,
    resolvedFile,
    resolvedVariant,
  ])

  const cancelImageRepaintMode = useCallback(() => {
    setIsImageRepaintMode(false)
  }, [])

  const startImageEraseMode = useCallback(() => {
    if (
      !canEditWorkflow ||
      data.isPreview ||
      data.isEmbedded ||
      resolvedVariant !== 'image' ||
      !resolvedFile
    ) {
      return
    }

    setIsImageCropMode(false)
    setIsImageRepaintMode(false)
    setIsImageOutpaintMode(false)
    setIsImageEraseMode(true)
    requestAnimationFrame(() => {
      const node = reactFlowInstance.getNodes().find((candidate) => candidate.id === id)
      if (!node) return
      fitViewToBounds({
        nodes: [node],
        padding: 0.03,
        maxZoom: 2.8,
        duration: 300,
      })
    })
  }, [
    canEditWorkflow,
    data.isEmbedded,
    data.isPreview,
    fitViewToBounds,
    id,
    reactFlowInstance,
    resolvedFile,
    resolvedVariant,
  ])

  const cancelImageEraseMode = useCallback(() => {
    setIsImageEraseMode(false)
  }, [])

  const startImageOutpaintMode = useCallback(() => {
    if (
      !canEditWorkflow ||
      data.isPreview ||
      data.isEmbedded ||
      resolvedVariant !== 'image' ||
      !resolvedFile
    ) {
      return
    }

    setIsImageCropMode(false)
    setIsImageRepaintMode(false)
    setIsImageEraseMode(false)
    setIsImageOutpaintMode(true)
    requestAnimationFrame(() => {
      const node = reactFlowInstance.getNodes().find((candidate) => candidate.id === id)
      if (!node) return
      fitViewToBounds({
        nodes: [node],
        padding: 0.16,
        maxZoom: 2,
        duration: 300,
      })
    })
  }, [
    canEditWorkflow,
    data.isEmbedded,
    data.isPreview,
    fitViewToBounds,
    id,
    reactFlowInstance,
    resolvedFile,
    resolvedVariant,
  ])

  const cancelImageOutpaintMode = useCallback(() => {
    setIsImageOutpaintMode(false)
  }, [])

  const startVideoTrimMode = useCallback(() => {
    if (
      !canEditWorkflow ||
      data.isPreview ||
      data.isEmbedded ||
      resolvedVariant !== 'video' ||
      !resolvedFile
    ) {
      return
    }

    setIsImageCropMode(false)
    setIsImageRepaintMode(false)
    setIsImageEraseMode(false)
    setIsImageOutpaintMode(false)
    setVideoTrimError(null)
    setIsVideoTrimMode(true)
    requestAnimationFrame(() => {
      const node = reactFlowInstance.getNodes().find((candidate) => candidate.id === id)
      if (!node) return
      fitViewToBounds({
        nodes: [node],
        padding: 0.04,
        maxZoom: 1.2,
        duration: 300,
      })
    })
  }, [
    canEditWorkflow,
    data.isEmbedded,
    data.isPreview,
    fitViewToBounds,
    id,
    reactFlowInstance,
    resolvedFile,
    resolvedVariant,
  ])

  const cancelVideoTrimMode = useCallback(() => {
    if (isVideoTrimProcessing) return
    setVideoTrimError(null)
    setIsVideoTrimMode(false)
  }, [isVideoTrimProcessing])

  const createVideoEnhanceNode = useCallback(() => {
    if (
      !canEditWorkflow ||
      data.isPreview ||
      data.isEmbedded ||
      resolvedVariant !== 'video' ||
      !resolvedFile
    ) {
      return
    }

    const sourceFile = toEnhanceRequestFile(resolvedFile)
    if (!sourceFile) {
      return
    }

    const sourceBlock = workflowBlocks[id]
    if (!sourceBlock) {
      return
    }

    const blockConfig = getBlockConfigFromCatalog('content')
    if (!blockConfig) {
      return
    }

    const targetBlockId = generateId()
    const parentId = sourceBlock.data?.parentId
    const sourcePosition = sourceBlock.position ?? { x: 0, y: 0 }
    const targetPosition = {
      x: sourcePosition.x + VIDEO_CARD_WIDTH + CONTENT_REFERENCE_CREATE_GAP,
      y: sourcePosition.y,
    }
    const newBlock = prepareBlockState({
      id: targetBlockId,
      type: 'content',
      name: getUniqueBlockName('视频增强', workflowBlocks),
      position: targetPosition,
      data: {
        contentVariant: 'video',
        ...(parentId ? { parentId, extent: 'parent' } : {}),
      },
      parentId,
      extent: parentId ? 'parent' : undefined,
      blockConfig,
    })
    const reference: ContentReferenceRecord = {
      sourceBlockId: id,
      sourceVariant: 'video',
      role: 'text_context',
    }
    const edge = createContentReferenceEdge({
      id: generateId(),
      source: targetBlockId,
      target: id,
      ...getOrdinaryContentReferenceHandles(),
    })
    const subBlockValues: Record<string, Record<string, unknown>> = {
      [targetBlockId]: {
        contentVariant: 'video',
        videoPrompt: '',
        videoModel: DEFAULT_VIDEO_MODEL,
        videoModelFamily: effectiveVideoModelFamily,
        videoFrameAspectRatioPreset: resolvedVideoFrameAspectRatioPreset,
        videoParameters: resolvedVideoParameters,
        videoMedia: [],
        file: null,
        contentReferences: [reference],
        generationKind: 'video_enhance',
        generationStatus: 'pending_config',
        generationError: null,
        videoEnhanceSourceFile: sourceFile,
        videoEnhanceParameters: DEFAULT_VIDEO_ENHANCE_PARAMETERS,
      },
    }

    setIsImageCropMode(false)
    setIsImageRepaintMode(false)
    setIsImageEraseMode(false)
    setIsImageOutpaintMode(false)
    setIsVideoTrimMode(false)
    setVideoTrimError(null)
    setPendingSelection([targetBlockId])
    collaborativeBatchAddBlocks([newBlock], [edge], {}, {}, subBlockValues)
    usePanelEditorStore.getState().setCurrentBlockId(targetBlockId)
  }, [
    canEditWorkflow,
    collaborativeBatchAddBlocks,
    data.isEmbedded,
    data.isPreview,
    effectiveVideoModelFamily,
    id,
    resolvedFile,
    resolvedVariant,
    resolvedVideoFrameAspectRatioPreset,
    resolvedVideoParameters,
    setPendingSelection,
    workflowBlocks,
  ])

  const markImageCutoutPending = useCallback(
    (targetBlockId: string) => {
      collaborativeSetSubblockValue(targetBlockId, 'generationKind', 'cutout')
      collaborativeSetSubblockValue(targetBlockId, 'generationStatus', 'pending')
      collaborativeSetSubblockValue(targetBlockId, 'generationError', null)
    },
    [collaborativeSetSubblockValue]
  )

  const completeImageCutout = useCallback(
    (targetBlockId: string, file: UploadedFileValue) => {
      collaborativeSetSubblockValue(targetBlockId, 'file', file)
      collaborativeSetSubblockValue(targetBlockId, 'generationKind', 'cutout')
      collaborativeSetSubblockValue(targetBlockId, 'generationStatus', 'complete')
      collaborativeSetSubblockValue(targetBlockId, 'generationError', null)
    },
    [collaborativeSetSubblockValue]
  )

  const failImageCutout = useCallback(
    (targetBlockId: string, message: string) => {
      collaborativeSetSubblockValue(targetBlockId, 'generationKind', 'cutout')
      collaborativeSetSubblockValue(targetBlockId, 'generationStatus', 'error')
      collaborativeSetSubblockValue(targetBlockId, 'generationError', message)
    },
    [collaborativeSetSubblockValue]
  )

  const startImageCutoutRequest = useImageCutoutSession({
    workspaceId: params.workspaceId,
    onPending: markImageCutoutPending,
    onComplete: completeImageCutout,
    onError: failImageCutout,
  })

  const startImageCutoutMode = useCallback(() => {
    if (
      !canEditWorkflow ||
      data.isPreview ||
      data.isEmbedded ||
      resolvedVariant !== 'image' ||
      !resolvedFile
    ) {
      return
    }

    const sourceBlock = workflowBlocks[id]
    if (!sourceBlock) {
      return
    }

    const blockConfig = getBlockConfigFromCatalog('content')
    if (!blockConfig) {
      return
    }

    const targetBlockId = generateId()
    const parentId = sourceBlock.data?.parentId
    const sourcePosition = sourceBlock.position ?? { x: 0, y: 0 }
    const targetPosition = {
      x: sourcePosition.x + IMAGE_CARD_WIDTH + CONTENT_REFERENCE_CREATE_GAP,
      y: sourcePosition.y,
    }
    const referenceRole =
      getDefaultReferenceRole({
        targetVariant: 'image',
        model: DEFAULT_IMAGE_CUTOUT_MODEL,
        sourceVariant: 'image',
      }) ?? ('image_reference' satisfies ContentReferenceRole)
    const newBlock = prepareBlockState({
      id: targetBlockId,
      type: 'content',
      name: getUniqueBlockName('Image', workflowBlocks),
      position: targetPosition,
      data: {
        contentVariant: 'image',
        ...(parentId ? { parentId, extent: 'parent' } : {}),
      },
      parentId,
      extent: parentId ? 'parent' : undefined,
      blockConfig,
    })
    const reference: ContentReferenceRecord = {
      sourceBlockId: id,
      sourceVariant: 'image',
      role: referenceRole,
    }
    const edge = createContentReferenceEdge({
      id: generateId(),
      source: targetBlockId,
      target: id,
      ...getOrdinaryContentReferenceHandles(),
    })
    const subBlockValues: Record<string, Record<string, unknown>> = {
      [targetBlockId]: {
        contentVariant: 'image',
        aiPrompt: '',
        aiModel: DEFAULT_IMAGE_CUTOUT_MODEL,
        aiAspectRatio: 'auto',
        file: null,
        contentReferences: [reference],
        generationStatus: 'pending',
        generationKind: 'cutout',
        generationError: null,
      },
    }

    setIsImageCropMode(false)
    setIsImageRepaintMode(false)
    setIsImageEraseMode(false)
    setIsImageOutpaintMode(false)
    setPendingSelection([targetBlockId])
    const added = collaborativeBatchAddBlocks([newBlock], [edge], {}, {}, subBlockValues)
    usePanelEditorStore.getState().setCurrentBlockId(targetBlockId)
    if (added) {
      void startImageCutoutRequest({
        targetBlockId,
        sourceFile: resolvedFile,
      })
    }
  }, [
    canEditWorkflow,
    collaborativeBatchAddBlocks,
    data.isEmbedded,
    data.isPreview,
    id,
    resolvedFile,
    resolvedVariant,
    setPendingSelection,
    startImageCutoutRequest,
    workflowBlocks,
  ])

  const confirmImageCrop = useCallback(
    async (croppedFile: File) => {
      if (!canEditWorkflow || data.isPreview || data.isEmbedded) {
        throw new Error('Cropping is not available for this workflow.')
      }
      if (!params.workspaceId) {
        throw new Error('Missing workspace context for upload.')
      }

      const sourceBlock = workflowBlocks[id]
      if (!sourceBlock) {
        throw new Error('Source image node no longer exists.')
      }

      const blockConfig = getBlockConfigFromCatalog('content')
      if (!blockConfig) {
        throw new Error('Unable to create an image content node.')
      }

      const uploadResult = await uploadWorkspaceFileMutation.mutateAsync({
        workspaceId: params.workspaceId,
        file: croppedFile,
        skipToast: true,
      })

      const targetBlockId = generateId()
      const parentId = sourceBlock.data?.parentId
      const sourcePosition = sourceBlock.position ?? { x: 0, y: 0 }
      const targetPosition = {
        x: sourcePosition.x + IMAGE_CARD_WIDTH + CONTENT_REFERENCE_CREATE_GAP,
        y: sourcePosition.y,
      }
      const referenceRole =
        getDefaultReferenceRole({
          targetVariant: 'image',
          model: effectiveImageModel,
          sourceVariant: 'image',
        }) ?? ('image_reference' satisfies ContentReferenceRole)
      const uploadedFile: UploadedFileValue = {
        id: uploadResult.file.id,
        name: uploadResult.file.name,
        url: uploadResult.file.url,
        path: uploadResult.file.url,
        key: uploadResult.file.key,
        size: uploadResult.file.size,
        type: uploadResult.file.type,
        context: uploadResult.file.context,
      }
      const newBlock = prepareBlockState({
        id: targetBlockId,
        type: 'content',
        name: getUniqueBlockName('Image', workflowBlocks),
        position: targetPosition,
        data: {
          contentVariant: 'image',
          ...(parentId ? { parentId, extent: 'parent' } : {}),
        },
        parentId,
        extent: parentId ? 'parent' : undefined,
        blockConfig,
      })
      const reference: ContentReferenceRecord = {
        sourceBlockId: id,
        sourceVariant: 'image',
        role: referenceRole,
      }
      const edge = createContentReferenceEdge({
        id: generateId(),
        source: targetBlockId,
        target: id,
        ...getOrdinaryContentReferenceHandles(),
      })
      const subBlockValues: Record<string, Record<string, unknown>> = {
        [targetBlockId]: {
          contentVariant: 'image',
          aiPrompt: '',
          aiModel: effectiveImageModel || resolvedAiModel || DEFAULT_IMAGE_AI_MODEL,
          aiAspectRatio: 'auto',
          file: uploadedFile,
          contentReferences: [reference],
          generationKind: 'image_crop',
        },
      }

      setPendingSelection([targetBlockId])
      collaborativeBatchAddBlocks([newBlock], [edge], {}, {}, subBlockValues)
      usePanelEditorStore.getState().setCurrentBlockId(targetBlockId)
      setIsImageCropMode(false)
    },
    [
      canEditWorkflow,
      collaborativeBatchAddBlocks,
      data.isEmbedded,
      data.isPreview,
      effectiveImageModel,
      id,
      params.workspaceId,
      resolvedAiModel,
      setPendingSelection,
      uploadWorkspaceFileMutation,
      workflowBlocks,
    ]
  )

  const confirmVideoTrim = useCallback(
    async ({ startSeconds, endSeconds }: VideoTrimRange) => {
      if (!canEditWorkflow || data.isPreview || data.isEmbedded) {
        throw new Error('Video trimming is not available for this workflow.')
      }
      if (!params.workspaceId) {
        throw new Error('Missing workspace context for video trimming.')
      }
      if (resolvedVariant !== 'video' || !resolvedFile) {
        throw new Error('Source video node no longer has a video file.')
      }

      const sourceFile = toTrimRequestFile(resolvedFile)
      if (!sourceFile) {
        throw new Error('Source video file is missing a storage key.')
      }

      const sourceBlock = workflowBlocks[id]
      if (!sourceBlock) {
        throw new Error('Source video node no longer exists.')
      }

      const blockConfig = getBlockConfigFromCatalog('content')
      if (!blockConfig) {
        throw new Error('Unable to create a video content node.')
      }

      setIsVideoTrimProcessing(true)
      setVideoTrimError(null)

      try {
        const trimResult = await requestJson(trimWorkspaceVideoContract, {
          body: {
            workspaceId: params.workspaceId,
            sourceFile,
            startSeconds,
            endSeconds,
          },
        })

        const targetBlockId = generateId()
        const parentId = sourceBlock.data?.parentId
        const sourcePosition = sourceBlock.position ?? { x: 0, y: 0 }
        const targetPosition = {
          x: sourcePosition.x + VIDEO_CARD_WIDTH + CONTENT_REFERENCE_CREATE_GAP,
          y: sourcePosition.y,
        }
        const uploadedFile: UploadedFileValue = {
          id: trimResult.file.id,
          name: trimResult.file.name,
          url: trimResult.file.url,
          path: trimResult.file.url,
          key: trimResult.file.key,
          size: trimResult.file.size,
          type: trimResult.file.type,
          context: trimResult.file.context,
        }
        const newBlock = prepareBlockState({
          id: targetBlockId,
          type: 'content',
          name: getUniqueBlockName('Video', workflowBlocks),
          position: targetPosition,
          data: {
            contentVariant: 'video',
            ...(parentId ? { parentId, extent: 'parent' } : {}),
          },
          parentId,
          extent: parentId ? 'parent' : undefined,
          blockConfig,
        })
        const reference: ContentReferenceRecord = {
          sourceBlockId: id,
          sourceVariant: 'video',
          role: 'text_context',
        }
        const edge = createContentReferenceEdge({
          id: generateId(),
          source: targetBlockId,
          target: id,
          ...getOrdinaryContentReferenceHandles(),
        })
        const subBlockValues: Record<string, Record<string, unknown>> = {
          [targetBlockId]: {
            contentVariant: 'video',
            videoPrompt: '',
            videoModel: DEFAULT_VIDEO_MODEL,
            videoModelFamily: effectiveVideoModelFamily,
            videoFrameAspectRatioPreset: resolvedVideoFrameAspectRatioPreset,
            videoParameters: resolvedVideoParameters,
            videoMedia: [],
            file: uploadedFile,
            contentReferences: [reference],
          },
        }

        setPendingSelection([targetBlockId])
        collaborativeBatchAddBlocks([newBlock], [edge], {}, {}, subBlockValues)
        usePanelEditorStore.getState().setCurrentBlockId(targetBlockId)
        setIsVideoTrimMode(false)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Video trim failed.'
        setVideoTrimError(message)
      } finally {
        setIsVideoTrimProcessing(false)
      }
    },
    [
      canEditWorkflow,
      collaborativeBatchAddBlocks,
      data.isEmbedded,
      data.isPreview,
      effectiveVideoModelFamily,
      id,
      params.workspaceId,
      resolvedFile,
      resolvedVariant,
      resolvedVideoFrameAspectRatioPreset,
      resolvedVideoParameters,
      setPendingSelection,
      workflowBlocks,
    ]
  )

  const confirmVideoEnhance = useCallback(async () => {
    if (!canEditWorkflow || data.isPreview || data.isEmbedded) {
      throw new Error('Video enhancement is not available for this workflow.')
    }
    if (!params.workspaceId) {
      throw new Error('Missing workspace context for video enhancement.')
    }
    if (resolvedVariant !== 'video') {
      throw new Error('Video enhancement is only available for video nodes.')
    }
    if (!resolvedVideoEnhanceSourceFile?.key) {
      collaborativeSetSubblockValue(id, 'generationKind', 'video_enhance')
      collaborativeSetSubblockValue(id, 'generationStatus', 'error')
      collaborativeSetSubblockValue(id, 'generationError', 'Source video file is missing.')
      return
    }

    collaborativeSetSubblockValue(id, 'generationKind', 'video_enhance')
    collaborativeSetSubblockValue(id, 'generationStatus', 'pending')
    collaborativeSetSubblockValue(id, 'generationError', null)
    collaborativeSetSubblockValue(id, 'videoEnhanceParameters', resolvedVideoEnhanceParameters)

    try {
      const enhanceResult = await requestJson(enhanceWorkspaceVideoContract, {
        body: {
          workspaceId: params.workspaceId,
          sourceFile: resolvedVideoEnhanceSourceFile,
          resolution: resolvedVideoEnhanceParameters.resolution,
          frameRate: resolvedVideoEnhanceParameters.frameRate,
          slowMotion: resolvedVideoEnhanceParameters.slowMotion,
        },
      })
      const uploadedFile: UploadedFileValue = {
        id: enhanceResult.file.id,
        name: enhanceResult.file.name,
        url: enhanceResult.file.url,
        path: enhanceResult.file.url,
        key: enhanceResult.file.key,
        size: enhanceResult.file.size,
        type: enhanceResult.file.type,
        context: enhanceResult.file.context,
      }

      collaborativeSetSubblockValue(id, 'file', uploadedFile)
      collaborativeSetSubblockValue(id, 'generationKind', 'video_enhance')
      collaborativeSetSubblockValue(id, 'generationStatus', 'complete')
      collaborativeSetSubblockValue(id, 'generationError', null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Video enhancement failed.'
      collaborativeSetSubblockValue(id, 'generationKind', 'video_enhance')
      collaborativeSetSubblockValue(id, 'generationStatus', 'error')
      collaborativeSetSubblockValue(id, 'generationError', message)
    }
  }, [
    canEditWorkflow,
    collaborativeSetSubblockValue,
    data.isEmbedded,
    data.isPreview,
    id,
    params.workspaceId,
    resolvedVariant,
    resolvedVideoEnhanceParameters,
    resolvedVideoEnhanceSourceFile,
  ])

  const markVideoFrameCapturePending = useCallback(
    (targetBlockId: string) => {
      collaborativeSetSubblockValue(targetBlockId, 'generationKind', 'video_frame_capture')
      collaborativeSetSubblockValue(targetBlockId, 'generationStatus', 'pending')
      collaborativeSetSubblockValue(targetBlockId, 'generationError', null)
      collaborativeSetSubblockValue(targetBlockId, 'file', null)
    },
    [collaborativeSetSubblockValue]
  )

  const completeVideoFrameCapture = useCallback(
    (targetBlockId: string, file: UploadedFileValue) => {
      collaborativeSetSubblockValue(targetBlockId, 'file', file)
      collaborativeSetSubblockValue(targetBlockId, 'generationKind', 'video_frame_capture')
      collaborativeSetSubblockValue(targetBlockId, 'generationStatus', 'complete')
      collaborativeSetSubblockValue(targetBlockId, 'generationError', null)
    },
    [collaborativeSetSubblockValue]
  )

  const failVideoFrameCapture = useCallback(
    (targetBlockId: string, message: string) => {
      collaborativeSetSubblockValue(targetBlockId, 'generationKind', 'video_frame_capture')
      collaborativeSetSubblockValue(targetBlockId, 'generationStatus', 'error')
      collaborativeSetSubblockValue(targetBlockId, 'generationError', message)
      collaborativeSetSubblockValue(targetBlockId, 'file', null)
    },
    [collaborativeSetSubblockValue]
  )

  const startVideoFrameCaptureRequest = useCallback(
    async (request: {
      targetBlockId: string
      sourceFile: CaptureWorkspaceVideoFrameBody['sourceFile']
      mode: VideoFrameCaptureMode
      timeSeconds: number
    }) => {
      markVideoFrameCapturePending(request.targetBlockId)

      try {
        const captureResult = await requestJson(captureWorkspaceVideoFrameContract, {
          body: {
            workspaceId: params.workspaceId,
            sourceFile: request.sourceFile,
            timeSeconds: request.timeSeconds,
            mode: request.mode,
          },
        })
        const uploadedFile: UploadedFileValue = {
          id: captureResult.file.id,
          name: captureResult.file.name,
          url: captureResult.file.url,
          path: captureResult.file.url,
          key: captureResult.file.key,
          size: captureResult.file.size,
          type: captureResult.file.type,
          context: captureResult.file.context,
        }

        completeVideoFrameCapture(request.targetBlockId, uploadedFile)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Video frame capture failed.'
        failVideoFrameCapture(request.targetBlockId, message)
      }
    },
    [
      completeVideoFrameCapture,
      failVideoFrameCapture,
      markVideoFrameCapturePending,
      params.workspaceId,
    ]
  )

  const createVideoFrameCaptureNode = useCallback(
    ({ mode, timeSeconds }: { mode: VideoFrameCaptureMode; timeSeconds: number }) => {
      if (
        !canEditWorkflow ||
        data.isPreview ||
        data.isEmbedded ||
        resolvedVariant !== 'video' ||
        !resolvedFile
      ) {
        return
      }
      if (!params.workspaceId) {
        return
      }

      const sourceFile = toFrameCaptureRequestFile(resolvedFile)
      if (!sourceFile) {
        return
      }

      const sourceBlock = workflowBlocks[id]
      if (!sourceBlock) {
        return
      }

      const blockConfig = getBlockConfigFromCatalog('content')
      if (!blockConfig) {
        return
      }

      const targetBlockId = generateId()
      const parentId = sourceBlock.data?.parentId
      const sourcePosition = sourceBlock.position ?? { x: 0, y: 0 }
      const targetPosition = {
        x: sourcePosition.x + VIDEO_CARD_WIDTH + CONTENT_REFERENCE_CREATE_GAP,
        y: sourcePosition.y,
      }
      const sourceAnchor = targetPosition.x >= sourcePosition.x ? 'right' : 'left'
      const targetAnchor = targetPosition.x >= sourcePosition.x ? 'left' : 'right'
      const newBlock = prepareBlockState({
        id: targetBlockId,
        type: 'content',
        name: getUniqueBlockName('Image', workflowBlocks),
        position: targetPosition,
        data: {
          contentVariant: 'image',
          ...(parentId ? { parentId, extent: 'parent' } : {}),
        },
        parentId,
        extent: parentId ? 'parent' : undefined,
        blockConfig,
      })
      const reference: ContentReferenceRecord = {
        sourceBlockId: id,
        sourceVariant: 'video',
        role: 'video_frame_capture',
      }
      const edge = createContentReferenceEdge({
        id: generateId(),
        source: id,
        target: targetBlockId,
        sourceHandle: getContentReferenceSourceHandleId(sourceAnchor),
        targetHandle: getContentReferenceTargetHandleId(targetAnchor),
      })
      const subBlockValues: Record<string, Record<string, unknown>> = {
        [targetBlockId]: {
          contentVariant: 'image',
          aiPrompt: '',
          aiModel: effectiveDefaultImageModel,
          aiAspectRatio: 'auto',
          file: null,
          contentReferences: [reference],
          generationKind: 'video_frame_capture',
          generationStatus: 'pending',
          generationError: null,
          videoFrameCaptureSourceFile: sourceFile,
          videoFrameCaptureMode: mode,
          videoFrameCaptureTimeSeconds: timeSeconds,
        },
      }

      setIsImageCropMode(false)
      setIsImageRepaintMode(false)
      setIsImageEraseMode(false)
      setIsImageOutpaintMode(false)
      setIsVideoTrimMode(false)
      setVideoTrimError(null)
      setPendingSelection([targetBlockId])
      const added = collaborativeBatchAddBlocks([newBlock], [edge], {}, {}, subBlockValues)
      usePanelEditorStore.getState().setCurrentBlockId(targetBlockId)
      if (added) {
        void startVideoFrameCaptureRequest({
          targetBlockId,
          sourceFile,
          mode,
          timeSeconds,
        })
      }
    },
    [
      canEditWorkflow,
      collaborativeBatchAddBlocks,
      data.isEmbedded,
      data.isPreview,
      effectiveDefaultImageModel,
      id,
      params.workspaceId,
      resolvedFile,
      resolvedVariant,
      setPendingSelection,
      startVideoFrameCaptureRequest,
      workflowBlocks,
    ]
  )

  const completeImageOutpaint = useCallback(
    (targetBlockId: string, file: UploadedFileValue) => {
      collaborativeSetSubblockValue(targetBlockId, 'file', file)
      collaborativeSetSubblockValue(targetBlockId, 'generationKind', 'image_outpaint')
      collaborativeSetSubblockValue(targetBlockId, 'generationStatus', 'complete')
      collaborativeSetSubblockValue(targetBlockId, 'generationError', null)
    },
    [collaborativeSetSubblockValue]
  )

  const failImageOutpaint = useCallback(
    (targetBlockId: string, message: string) => {
      collaborativeSetSubblockValue(targetBlockId, 'generationKind', 'image_outpaint')
      collaborativeSetSubblockValue(targetBlockId, 'generationStatus', 'error')
      collaborativeSetSubblockValue(targetBlockId, 'generationError', message)
      collaborativeSetSubblockValue(targetBlockId, 'file', null)
    },
    [collaborativeSetSubblockValue]
  )

  const startImageOutpaintRequest = useCallback(
    (
      request: SubmitImageOutpaintParams & { targetBlockId: string; sourceFile: UploadedFileValue }
    ) => {
      void runImageOutpaintRequest({
        ...request,
        workspaceId: params.workspaceId,
        onComplete: completeImageOutpaint,
        onError: failImageOutpaint,
      })
    },
    [completeImageOutpaint, failImageOutpaint, params.workspaceId]
  )

  const completeDerivedImageGeneration = useCallback(
    (
      targetBlockId: string,
      file: UploadedFileValue,
      generationKind: DerivedImageGenerationKind
    ) => {
      collaborativeSetSubblockValue(targetBlockId, 'file', file)
      collaborativeSetSubblockValue(targetBlockId, 'generationKind', generationKind)
      collaborativeSetSubblockValue(targetBlockId, 'generationStatus', 'complete')
      collaborativeSetSubblockValue(targetBlockId, 'generationError', null)
    },
    [collaborativeSetSubblockValue]
  )

  const failDerivedImageGeneration = useCallback(
    (targetBlockId: string, message: string, generationKind: DerivedImageGenerationKind) => {
      collaborativeSetSubblockValue(targetBlockId, 'generationKind', generationKind)
      collaborativeSetSubblockValue(targetBlockId, 'generationStatus', 'error')
      collaborativeSetSubblockValue(targetBlockId, 'generationError', message)
      collaborativeSetSubblockValue(targetBlockId, 'file', null)
    },
    [collaborativeSetSubblockValue]
  )

  const markDerivedImageGenerationPending = useCallback(
    (targetBlockId: string, generationKind: DerivedImageGenerationKind) => {
      collaborativeSetSubblockValue(targetBlockId, 'generationKind', generationKind)
      collaborativeSetSubblockValue(targetBlockId, 'generationStatus', 'pending')
      collaborativeSetSubblockValue(targetBlockId, 'generationError', null)
      collaborativeSetSubblockValue(targetBlockId, 'file', null)
    },
    [collaborativeSetSubblockValue]
  )

  const startImagePerspectiveRequest = useCallback(
    (request: {
      targetBlockId: string
      sourceFile: UploadedFileValue
      metadata: ImagePerspectiveGenerationRequest
    }) => {
      void runImagePerspectiveRequest({
        workspaceId: params.workspaceId,
        sourceFile: request.sourceFile,
        targetBlockId: request.targetBlockId,
        request: request.metadata,
        onComplete: (targetBlockId, file) =>
          completeDerivedImageGeneration(targetBlockId, file, 'image_perspective'),
        onError: (targetBlockId, message) =>
          failDerivedImageGeneration(targetBlockId, message, 'image_perspective'),
      })
    },
    [completeDerivedImageGeneration, failDerivedImageGeneration, params.workspaceId]
  )

  const startImageRepaintRequest = useCallback(
    (request: {
      targetBlockId: string
      sourceFile: UploadedFileValue
      metadata: ImageRepaintGenerationRequest
    }) => {
      void runImageRepaintRequest({
        workspaceId: params.workspaceId,
        sourceFile: request.sourceFile,
        targetBlockId: request.targetBlockId,
        request: request.metadata,
        onComplete: (targetBlockId, file) =>
          completeDerivedImageGeneration(targetBlockId, file, 'image_repaint'),
        onError: (targetBlockId, message) =>
          failDerivedImageGeneration(targetBlockId, message, 'image_repaint'),
      })
    },
    [completeDerivedImageGeneration, failDerivedImageGeneration, params.workspaceId]
  )

  const startImageEraseRequest = useCallback(
    (request: {
      targetBlockId: string
      sourceFile: UploadedFileValue
      metadata: ImageEraseGenerationRequest
    }) => {
      void runImageEraseRequest({
        workspaceId: params.workspaceId,
        sourceFile: request.sourceFile,
        targetBlockId: request.targetBlockId,
        request: request.metadata,
        onComplete: (targetBlockId, file) =>
          completeDerivedImageGeneration(targetBlockId, file, 'image_erase'),
        onError: (targetBlockId, message) =>
          failDerivedImageGeneration(targetBlockId, message, 'image_erase'),
      })
    },
    [completeDerivedImageGeneration, failDerivedImageGeneration, params.workspaceId]
  )

  const createDerivedImagePendingNode = useCallback(
    ({
      model,
      buildSubBlockValues,
      unavailableMessage,
    }: {
      model: ImageGenerationModelId
      buildSubBlockValues: (reference: ContentReferenceRecord) => Record<string, unknown>
      unavailableMessage: string
    }) => {
      if (!canEditWorkflow || data.isPreview || data.isEmbedded) {
        throw new Error(unavailableMessage)
      }
      if (resolvedVariant !== 'image' || !resolvedFile) {
        throw new Error('Derived image generation requires a source image.')
      }

      const sourceBlock = workflowBlocks[id]
      if (!sourceBlock) {
        throw new Error('Source image node no longer exists.')
      }

      const blockConfig = getBlockConfigFromCatalog('content')
      if (!blockConfig) {
        throw new Error('Unable to create an image content node.')
      }

      const targetBlockId = generateId()
      const parentId = sourceBlock.data?.parentId
      const sourcePosition = sourceBlock.position ?? { x: 0, y: 0 }
      const targetPosition = {
        x: sourcePosition.x + IMAGE_CARD_WIDTH + CONTENT_REFERENCE_CREATE_GAP,
        y: sourcePosition.y,
      }
      const referenceRole =
        getDefaultReferenceRole({
          targetVariant: 'image',
          model,
          sourceVariant: 'image',
        }) ?? ('image_reference' satisfies ContentReferenceRole)
      const newBlock = prepareBlockState({
        id: targetBlockId,
        type: 'content',
        name: getUniqueBlockName('Image', workflowBlocks),
        position: targetPosition,
        data: {
          contentVariant: 'image',
          ...(parentId ? { parentId, extent: 'parent' } : {}),
        },
        parentId,
        extent: parentId ? 'parent' : undefined,
        blockConfig,
      })
      const reference: ContentReferenceRecord = {
        sourceBlockId: id,
        sourceVariant: 'image',
        role: referenceRole,
      }
      const edge = createImageOutpaintReferenceEdge({
        edgeId: generateId(),
        resultBlockId: targetBlockId,
        sourceBlockId: id,
        resultPosition: targetPosition,
        sourcePosition,
      })
      const subBlockValues: Record<string, Record<string, unknown>> = {
        [targetBlockId]: buildSubBlockValues(reference),
      }

      setPendingSelection([targetBlockId])
      const added = collaborativeBatchAddBlocks([newBlock], [edge], {}, {}, subBlockValues)
      usePanelEditorStore.getState().setCurrentBlockId(targetBlockId)
      return {
        added,
        sourceFile: resolvedFile,
        targetBlockId,
      }
    },
    [
      canEditWorkflow,
      collaborativeBatchAddBlocks,
      data.isEmbedded,
      data.isPreview,
      id,
      resolvedFile,
      resolvedVariant,
      setPendingSelection,
      workflowBlocks,
    ]
  )

  const createImagePerspectiveVariantNode = useCallback(
    async (request: ImagePerspectiveGenerationRequest) => {
      const result = createDerivedImagePendingNode({
        model: request.model,
        unavailableMessage: 'Multi-angle image creation is not available for this workflow.',
        buildSubBlockValues: (reference) =>
          buildImagePerspectivePendingSubBlockValues({ reference, request }),
      })
      if (result.added) {
        startImagePerspectiveRequest({
          targetBlockId: result.targetBlockId,
          sourceFile: result.sourceFile,
          metadata: request,
        })
      }
    },
    [createDerivedImagePendingNode, startImagePerspectiveRequest]
  )

  const createImageRepaintVariantNode = useCallback(
    async ({ prompt, resolution, mask, referenceImages }: SubmitImageRepaintParams) => {
      const request: ImageRepaintGenerationRequest = {
        prompt,
        resolution,
        maskImage: createMaskImageFile('repaint-mask.png', mask),
        referenceImages,
      }
      const result = createDerivedImagePendingNode({
        model: DEFAULT_IMAGE_REPAINT_MODEL,
        unavailableMessage: 'Image repaint is not available for this workflow.',
        buildSubBlockValues: (reference) =>
          buildImageRepaintPendingSubBlockValues({ reference, request }),
      })
      setIsImageRepaintMode(false)
      if (result.added) {
        startImageRepaintRequest({
          targetBlockId: result.targetBlockId,
          sourceFile: result.sourceFile,
          metadata: request,
        })
      }
    },
    [createDerivedImagePendingNode, startImageRepaintRequest]
  )

  const createImageEraseVariantNode = useCallback(
    async ({ mask, resolution }: SubmitImageEraseParams) => {
      const request: ImageEraseGenerationRequest = {
        resolution,
        maskImage: createMaskImageFile('erase-mask.png', mask),
      }
      const result = createDerivedImagePendingNode({
        model: DEFAULT_IMAGE_REPAINT_MODEL,
        unavailableMessage: 'Image erase is not available for this workflow.',
        buildSubBlockValues: (reference) =>
          buildImageErasePendingSubBlockValues({ reference, request }),
      })
      setIsImageEraseMode(false)
      if (result.added) {
        startImageEraseRequest({
          targetBlockId: result.targetBlockId,
          sourceFile: result.sourceFile,
          metadata: request,
        })
      }
    },
    [createDerivedImagePendingNode, startImageEraseRequest]
  )

  const createImageOutpaintVariantNode = useCallback(
    (outpaintRequest: SubmitImageOutpaintParams) => {
      if (!canEditWorkflow || data.isPreview || data.isEmbedded) {
        throw new Error('Image outpaint is not available for this workflow.')
      }
      if (resolvedVariant !== 'image' || !resolvedFile) {
        throw new Error('Image outpaint requires a source image.')
      }

      const sourceBlock = workflowBlocks[id]
      if (!sourceBlock) {
        throw new Error('Source image node no longer exists.')
      }

      const blockConfig = getBlockConfigFromCatalog('content')
      if (!blockConfig) {
        throw new Error('Unable to create an image content node.')
      }

      const targetBlockId = generateId()
      const parentId = sourceBlock.data?.parentId
      const sourcePosition = sourceBlock.position ?? { x: 0, y: 0 }
      const targetPosition = {
        x: sourcePosition.x + IMAGE_CARD_WIDTH + CONTENT_REFERENCE_CREATE_GAP,
        y: sourcePosition.y,
      }
      const referenceRole =
        getDefaultReferenceRole({
          targetVariant: 'image',
          model: DEFAULT_IMAGE_REPAINT_MODEL,
          sourceVariant: 'image',
        }) ?? ('image_reference' satisfies ContentReferenceRole)
      const newBlock = prepareBlockState({
        id: targetBlockId,
        type: 'content',
        name: getUniqueBlockName('Image', workflowBlocks),
        position: targetPosition,
        data: {
          contentVariant: 'image',
          ...(parentId ? { parentId, extent: 'parent' } : {}),
        },
        parentId,
        extent: parentId ? 'parent' : undefined,
        blockConfig,
      })
      const reference: ContentReferenceRecord = {
        sourceBlockId: id,
        sourceVariant: 'image',
        role: referenceRole,
      }
      const edge = createImageOutpaintReferenceEdge({
        edgeId: generateId(),
        resultBlockId: targetBlockId,
        sourceBlockId: id,
        resultPosition: targetPosition,
        sourcePosition,
      })
      const subBlockValues: Record<string, Record<string, unknown>> = {
        [targetBlockId]: buildImageOutpaintPendingSubBlockValues({
          aiAspectRatio: mapOutpaintAspectRatioToImageAspectRatio(
            outpaintRequest.targetAspectRatio
          ),
          reference,
          request: outpaintRequest,
        }),
      }

      setPendingSelection([targetBlockId])
      const added = collaborativeBatchAddBlocks([newBlock], [edge], {}, {}, subBlockValues)
      usePanelEditorStore.getState().setCurrentBlockId(targetBlockId)
      setIsImageOutpaintMode(false)
      if (added) {
        startImageOutpaintRequest({
          ...outpaintRequest,
          targetBlockId,
          sourceFile: resolvedFile,
        })
      }
    },
    [
      canEditWorkflow,
      collaborativeBatchAddBlocks,
      data.isEmbedded,
      data.isPreview,
      id,
      resolvedFile,
      resolvedVariant,
      setPendingSelection,
      startImageOutpaintRequest,
      workflowBlocks,
    ]
  )

  useEffect(() => {
    if (
      isImageCropMode &&
      (!selected ||
        data.isPreview ||
        data.isEmbedded ||
        resolvedVariant !== 'image' ||
        !resolvedFile)
    ) {
      setIsImageCropMode(false)
    }
  }, [data.isEmbedded, data.isPreview, isImageCropMode, resolvedFile, resolvedVariant, selected])

  useEffect(() => {
    if (
      isImageRepaintMode &&
      (!selected ||
        data.isPreview ||
        data.isEmbedded ||
        resolvedVariant !== 'image' ||
        !resolvedFile)
    ) {
      setIsImageRepaintMode(false)
    }
  }, [data.isEmbedded, data.isPreview, isImageRepaintMode, resolvedFile, resolvedVariant, selected])

  useEffect(() => {
    if (
      isImageEraseMode &&
      (!selected ||
        data.isPreview ||
        data.isEmbedded ||
        resolvedVariant !== 'image' ||
        !resolvedFile)
    ) {
      setIsImageEraseMode(false)
    }
  }, [data.isEmbedded, data.isPreview, isImageEraseMode, resolvedFile, resolvedVariant, selected])

  useEffect(() => {
    if (
      isImageOutpaintMode &&
      (!selected ||
        data.isPreview ||
        data.isEmbedded ||
        resolvedVariant !== 'image' ||
        !resolvedFile)
    ) {
      setIsImageOutpaintMode(false)
    }
  }, [
    data.isEmbedded,
    data.isPreview,
    isImageOutpaintMode,
    resolvedFile,
    resolvedVariant,
    selected,
  ])

  useEffect(() => {
    if (
      isVideoTrimMode &&
      (!selected ||
        data.isPreview ||
        data.isEmbedded ||
        resolvedVariant !== 'video' ||
        !resolvedFile)
    ) {
      setIsVideoTrimMode(false)
      setVideoTrimError(null)
    }
  }, [data.isEmbedded, data.isPreview, isVideoTrimMode, resolvedFile, resolvedVariant, selected])

  const resolveBlockSourceValues = useCallback(
    (blockId: string): StoredValueRecord => {
      const liveValues = workflowValues[blockId]
      const block = workflowBlocks[blockId]
      const liveNode = reactFlowInstance.getNode(blockId)
      return mergeStoredValueRecords(
        (block?.subBlocks as StoredValueRecord) ?? undefined,
        getNodeSubBlockValues(liveNode?.data),
        liveValues as StoredValueRecord
      )
    },
    [reactFlowInstance, workflowBlocks, workflowValues]
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
  const resolveBlockReferenceModel = useCallback(
    (blockId: string, blockVariant: ContentVariant): string => {
      const source = resolveBlockSourceValues(blockId)

      if (blockVariant === 'image') {
        return extractStoredValue<string>(source, 'aiModel', DEFAULT_IMAGE_AI_MODEL)
      }

      if (blockVariant === 'audio') {
        return extractStoredValue<string>(source, 'audioModel', DEFAULT_AUDIO_MODEL)
      }

      if (blockVariant === 'video') {
        const family = normalizeVideoModelFamily(
          extractStoredValue<unknown>(source, 'videoModelFamily', DEFAULT_VIDEO_MODEL_FAMILY),
          extractStoredValue<unknown>(source, 'videoModel', DEFAULT_VIDEO_MODEL)
        )
        return family === 'wan2.7' ? 'wan2.7-i2v' : 'wan2.6-i2v-flash'
      }

      if (blockVariant === 'presentation') {
        return 'codex-ppt-skill'
      }

      return extractStoredValue<string>(source, 'aiModel', DEFAULT_TEXT_AI_MODEL)
    },
    [resolveBlockSourceValues]
  )
  const getCurrentContentReferencesForBlock = useCallback(
    (blockId: string): ContentReferenceRecord[] =>
      normalizeContentReferences(
        extractStoredValue<unknown>(resolveBlockSourceValues(blockId), 'contentReferences', [])
      ),
    [resolveBlockSourceValues]
  )
  const retryImageCutout = useCallback(() => {
    if (
      !canEditWorkflow ||
      data.isPreview ||
      data.isEmbedded ||
      resolvedVariant !== 'image' ||
      resolvedGenerationKind !== 'cutout'
    ) {
      return
    }

    const sourceReference = resolvedContentReferences.find(
      (reference) => reference.sourceVariant === 'image'
    )
    if (!sourceReference) {
      failImageCutout(id, '缺少源图片引用，无法重试抠图。')
      return
    }

    const sourceFile = extractStoredValue<UploadedFileValue | null>(
      resolveBlockSourceValues(sourceReference.sourceBlockId),
      'file',
      null
    )
    if (!sourceFile?.key) {
      failImageCutout(id, '源图片缺少文件信息。')
      return
    }

    void startImageCutoutRequest({
      targetBlockId: id,
      sourceFile,
    })
  }, [
    canEditWorkflow,
    data.isEmbedded,
    data.isPreview,
    failImageCutout,
    id,
    resolvedContentReferences,
    resolvedGenerationKind,
    resolvedVariant,
    resolveBlockSourceValues,
    startImageCutoutRequest,
  ])

  const retryImageOutpaint = useCallback(() => {
    if (
      !canEditWorkflow ||
      data.isPreview ||
      data.isEmbedded ||
      resolvedVariant !== 'image' ||
      resolvedGenerationKind !== 'image_outpaint'
    ) {
      return
    }

    const sourceReference = resolvedContentReferences.find(
      (reference) => reference.sourceVariant === 'image'
    )
    if (!sourceReference) {
      failImageOutpaint(id, '缺少源图片引用，无法重试扩图。')
      return
    }

    const sourceFile = extractStoredValue<UploadedFileValue | null>(
      resolveBlockSourceValues(sourceReference.sourceBlockId),
      'file',
      null
    )
    if (!sourceFile?.key) {
      failImageOutpaint(id, '源图片缺少文件信息。')
      return
    }

    const request = getImageOutpaintRequestMetadata(
      extractStoredValue<unknown>(resolveBlockSourceValues(id), 'imageOutpaintRequest', null)
    )
    if (!request) {
      failImageOutpaint(id, '缺少扩图参数，无法重试。')
      return
    }

    collaborativeSetSubblockValue(id, 'generationKind', 'image_outpaint')
    collaborativeSetSubblockValue(id, 'generationStatus', 'pending')
    collaborativeSetSubblockValue(id, 'generationError', null)
    collaborativeSetSubblockValue(id, 'file', null)
    startImageOutpaintRequest({
      ...request,
      targetBlockId: id,
      sourceFile,
    })
  }, [
    canEditWorkflow,
    collaborativeSetSubblockValue,
    data.isEmbedded,
    data.isPreview,
    failImageOutpaint,
    id,
    resolvedContentReferences,
    resolvedGenerationKind,
    resolvedVariant,
    resolveBlockSourceValues,
    startImageOutpaintRequest,
  ])

  const retryDerivedImageGeneration = useCallback(() => {
    if (
      !canEditWorkflow ||
      data.isPreview ||
      data.isEmbedded ||
      resolvedVariant !== 'image' ||
      (resolvedGenerationKind !== 'image_perspective' &&
        resolvedGenerationKind !== 'image_repaint' &&
        resolvedGenerationKind !== 'image_erase')
    ) {
      return
    }

    const sourceReference = resolvedContentReferences.find(
      (reference) => reference.sourceVariant === 'image'
    )
    if (!sourceReference) {
      failDerivedImageGeneration(id, '缺少源图片引用，无法重试。', resolvedGenerationKind)
      return
    }

    const sourceFile = extractStoredValue<UploadedFileValue | null>(
      resolveBlockSourceValues(sourceReference.sourceBlockId),
      'file',
      null
    )
    if (!sourceFile?.key) {
      failDerivedImageGeneration(id, '源图片缺少文件信息。', resolvedGenerationKind)
      return
    }

    const currentValues = resolveBlockSourceValues(id)
    if (resolvedGenerationKind === 'image_perspective') {
      const request = getImagePerspectiveRequestMetadata(
        extractStoredValue<unknown>(currentValues, 'imagePerspectiveRequest', null)
      )
      if (!request) {
        failDerivedImageGeneration(id, '缺少多角度生成参数，无法重试。', resolvedGenerationKind)
        return
      }
      markDerivedImageGenerationPending(id, resolvedGenerationKind)
      startImagePerspectiveRequest({ targetBlockId: id, sourceFile, metadata: request })
      return
    }

    if (resolvedGenerationKind === 'image_repaint') {
      const request = getImageRepaintRequestMetadata(
        extractStoredValue<unknown>(currentValues, 'imageRepaintRequest', null)
      )
      if (!request) {
        failDerivedImageGeneration(id, '缺少重绘参数，无法重试。', resolvedGenerationKind)
        return
      }
      markDerivedImageGenerationPending(id, resolvedGenerationKind)
      startImageRepaintRequest({ targetBlockId: id, sourceFile, metadata: request })
      return
    }

    const request = getImageEraseRequestMetadata(
      extractStoredValue<unknown>(currentValues, 'imageEraseRequest', null)
    )
    if (!request) {
      failDerivedImageGeneration(id, '缺少擦除参数，无法重试。', resolvedGenerationKind)
      return
    }
    markDerivedImageGenerationPending(id, resolvedGenerationKind)
    startImageEraseRequest({ targetBlockId: id, sourceFile, metadata: request })
  }, [
    canEditWorkflow,
    data.isEmbedded,
    data.isPreview,
    failDerivedImageGeneration,
    id,
    markDerivedImageGenerationPending,
    resolvedContentReferences,
    resolvedGenerationKind,
    resolvedVariant,
    resolveBlockSourceValues,
    startImageEraseRequest,
    startImagePerspectiveRequest,
    startImageRepaintRequest,
  ])

  const retryVideoFrameCapture = useCallback(() => {
    if (
      !canEditWorkflow ||
      data.isPreview ||
      data.isEmbedded ||
      resolvedVariant !== 'image' ||
      resolvedGenerationKind !== 'video_frame_capture'
    ) {
      return
    }

    if (!resolvedVideoFrameCaptureSourceFile?.key) {
      failVideoFrameCapture(id, '源视频缺少文件信息。')
      return
    }

    if (
      resolvedVideoFrameCaptureMode !== 'current' &&
      resolvedVideoFrameCaptureMode !== 'first' &&
      resolvedVideoFrameCaptureMode !== 'last'
    ) {
      failVideoFrameCapture(id, '缺少截帧模式，无法重试。')
      return
    }

    const timeSeconds =
      typeof resolvedVideoFrameCaptureTimeSeconds === 'number'
        ? resolvedVideoFrameCaptureTimeSeconds
        : Number(resolvedVideoFrameCaptureTimeSeconds)
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
      failVideoFrameCapture(id, '缺少截帧时间，无法重试。')
      return
    }

    void startVideoFrameCaptureRequest({
      targetBlockId: id,
      sourceFile: resolvedVideoFrameCaptureSourceFile,
      mode: resolvedVideoFrameCaptureMode,
      timeSeconds,
    })
  }, [
    canEditWorkflow,
    data.isEmbedded,
    data.isPreview,
    failVideoFrameCapture,
    id,
    resolvedGenerationKind,
    resolvedVariant,
    resolvedVideoFrameCaptureMode,
    resolvedVideoFrameCaptureSourceFile,
    resolvedVideoFrameCaptureTimeSeconds,
    startVideoFrameCaptureRequest,
  ])
  const getContentNodeIdAtPoint = useCallback(
    (clientX: number, clientY: number): string | null => {
      const elements = document.elementsFromPoint(clientX, clientY)
      for (const element of elements) {
        const nodeElement = element.closest('.react-flow__node[data-id]') as HTMLElement | null
        const nodeId = nodeElement?.getAttribute('data-id')
        if (!nodeId || nodeId === id) continue
        if (workflowBlocks[nodeId]?.type === 'content') return nodeId
      }

      const nodeElements = Array.from(
        document.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')
      )
      const matchingNodes = nodeElements
        .map((nodeElement) => {
          const nodeId = nodeElement.getAttribute('data-id')
          if (!nodeId || nodeId === id || workflowBlocks[nodeId]?.type !== 'content') return null

          const rect = nodeElement.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) return null
          const containsPoint =
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom
          if (!containsPoint) return null

          const zIndex = Number.parseInt(window.getComputedStyle(nodeElement).zIndex || '0', 10)
          return {
            nodeId,
            area: rect.width * rect.height,
            zIndex: Number.isFinite(zIndex) ? zIndex : 0,
          }
        })
        .filter((candidate): candidate is { nodeId: string; area: number; zIndex: number } =>
          Boolean(candidate)
        )
        .sort((left, right) => right.zIndex - left.zIndex || left.area - right.area)

      if (matchingNodes[0]) return matchingNodes[0].nodeId

      return null
    },
    [id, workflowBlocks]
  )
  const canCreateExistingContentReference = useCallback(
    (targetBlockId: string): boolean => {
      const targetBlockVariant = resolveBlockVariant(targetBlockId)
      if (!targetBlockVariant) return false

      const normalReference = getNextContentReferencesForSource({
        targetVariant: resolvedVariant,
        targetModel: selectionModel,
        targetReferences: getCurrentContentReferencesForBlock(id),
        sourceBlockId: targetBlockId,
        sourceVariant: targetBlockVariant,
      })
      if (normalReference.referenceRole && !normalReference.disabledReason) return true

      const targetModel = resolveBlockReferenceModel(targetBlockId, targetBlockVariant)
      const videoFrameReference = getNextContentReferencesForSource({
        targetVariant: targetBlockVariant,
        targetModel,
        targetReferences: getCurrentContentReferencesForBlock(targetBlockId),
        sourceBlockId: id,
        sourceVariant: resolvedVariant,
      })
      const isVideoFrameReference =
        videoFrameReference.referenceRole === 'video_first_frame' ||
        videoFrameReference.referenceRole === 'video_last_frame'

      return Boolean(
        isVideoFrameReference &&
          videoFrameReference.referenceRole &&
          !videoFrameReference.disabledReason
      )
    },
    [
      getCurrentContentReferencesForBlock,
      id,
      resolvedVariant,
      resolveBlockReferenceModel,
      resolveBlockVariant,
      selectionModel,
    ]
  )
  const createExistingContentReference = useCallback(
    (targetBlockId: string, sourceAnchor: 'left' | 'right'): boolean => {
      const targetBlockVariant = resolveBlockVariant(targetBlockId)
      if (!targetBlockVariant) return false

      const normalReference = getNextContentReferencesForSource({
        targetVariant: resolvedVariant,
        targetModel: selectionModel,
        targetReferences: getCurrentContentReferencesForBlock(id),
        sourceBlockId: targetBlockId,
        sourceVariant: targetBlockVariant,
      })

      let consumerBlockId = id
      let referenceRole = normalReference.referenceRole
      let nextReferences = normalReference.nextReferences
      let disabledReason = normalReference.disabledReason
      let isVideoFrameReference = false

      if (!referenceRole || disabledReason) {
        const targetModel = resolveBlockReferenceModel(targetBlockId, targetBlockVariant)
        const videoFrameReference = getNextContentReferencesForSource({
          targetVariant: targetBlockVariant,
          targetModel,
          targetReferences: getCurrentContentReferencesForBlock(targetBlockId),
          sourceBlockId: id,
          sourceVariant: resolvedVariant,
        })
        const isVideoFrameRole =
          videoFrameReference.referenceRole === 'video_first_frame' ||
          videoFrameReference.referenceRole === 'video_last_frame'

        if (isVideoFrameRole) {
          consumerBlockId = targetBlockId
          referenceRole = videoFrameReference.referenceRole
          nextReferences = videoFrameReference.nextReferences
          disabledReason = videoFrameReference.disabledReason
          isVideoFrameReference = true
        }
      }

      if (!referenceRole || disabledReason) return false

      const edgeSourceId = id
      const edgeTargetId = targetBlockId
      const edgeSourcePosition = workflowBlocks[edgeSourceId]?.position ?? { x: 0, y: 0 }
      const edgeTargetPosition = workflowBlocks[edgeTargetId]?.position ?? { x: 0, y: 0 }
      const derivedTargetAnchor = getContentReferenceAnchorForTarget({
        sourceX: edgeSourcePosition.x,
        targetX: edgeTargetPosition.x,
      })

      collaborativeSetSubblockValue(consumerBlockId, 'contentReferences', nextReferences)
      const autoLinkType =
        referenceRole === 'video_first_frame' || referenceRole === 'video_last_frame'
          ? referenceRole
          : undefined

      if (autoLinkType) {
        const previousAutoEdgeIds = workflowEdges
          .filter(
            (edge) =>
              isContentReferenceEdge(edge) &&
              getContentReferenceAutoLinkType(edge) === autoLinkType &&
              edge.target === consumerBlockId
          )
          .map((edge) => edge.id)
        if (previousAutoEdgeIds.length > 0) {
          collaborativeBatchRemoveEdges(previousAutoEdgeIds, { skipUndoRedo: true })
        }

        if (resolvedVariant === 'image' && resolvedFile?.key) {
          const mediaType = autoLinkType === 'video_first_frame' ? 'first_frame' : 'last_frame'
          const currentVideoMedia = normalizeVideoMedia(
            extractStoredValue<unknown>(resolveBlockSourceValues(consumerBlockId), 'videoMedia', [])
          )
          const nextVideoMedia = upsertVideoMediaFile(currentVideoMedia, mediaType, resolvedFile)
          collaborativeSetSubblockValue(consumerBlockId, 'videoMedia', nextVideoMedia)
        }
      }

      const ordinaryHandles = getOrdinaryContentReferenceHandles()
      const edge = createContentReferenceEdge({
        id: generateId(),
        source: edgeSourceId,
        target: edgeTargetId,
        sourceHandle: isVideoFrameReference
          ? getContentReferenceSourceHandleId(sourceAnchor)
          : ordinaryHandles.sourceHandle,
        targetHandle: isVideoFrameReference
          ? getContentReferenceTargetHandleId(derivedTargetAnchor)
          : ordinaryHandles.targetHandle,
        autoLinkType,
      })

      const alreadyLinked =
        !isVideoFrameReference &&
        workflowEdges.some(
          (candidate) =>
            isContentReferenceEdge(candidate) &&
            !getContentReferenceAutoLinkType(candidate) &&
            candidate.source === edgeSourceId &&
            candidate.target === edgeTargetId
        )

      if (!alreadyLinked) {
        collaborativeBatchAddEdges([edge])
      }

      return true
    },
    [
      collaborativeBatchAddEdges,
      collaborativeBatchRemoveEdges,
      collaborativeSetSubblockValue,
      getCurrentContentReferencesForBlock,
      id,
      resolvedFile,
      resolvedVariant,
      resolveBlockReferenceModel,
      resolveBlockSourceValues,
      resolveBlockVariant,
      selectionModel,
      workflowBlocks,
      workflowEdges,
    ]
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
            ? getPlainTextFromHtml(
                extractStoredValue<string>(source, 'contentHtml', DEFAULT_TEXT_HTML)
              )
            : null,
        file:
          variant === 'text'
            ? null
            : (() => {
                const file =
                  variant === 'presentation'
                    ? (normalizePresentationArtifact(
                        extractStoredValue<unknown>(source, 'presentationArtifact', null)
                      )?.pptxFile ??
                      extractStoredValue<UploadedFileValue | null>(source, 'file', null))
                    : extractStoredValue<UploadedFileValue | null>(source, 'file', null)
                return normalizeReferencedNodeFile(file, block.name || reference.sourceBlockId)
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
  const startExistingReferenceSelection = useCallback(
    (anchor: 'left' | 'right' = 'left') => {
      if (!canEditWorkflow || data.isPreview || data.isEmbedded) return

      beginContentReferenceSelection({
        sourceBlockId: id,
        sourceVariant: resolvedVariant,
        sourceModel: selectionModel,
        allowedSourceVariants: getAllowedReferenceSourceVariants(resolvedVariant, selectionModel),
        sourceAnchor: anchor,
        mode: 'content_reference',
      })
    },
    [
      beginContentReferenceSelection,
      canEditWorkflow,
      data.isEmbedded,
      data.isPreview,
      id,
      resolvedVariant,
      selectionModel,
    ]
  )
  const startCreateMenuPointerSession = useCallback(
    (event: ReactPointerEvent<HTMLElement>, anchor: 'left' | 'right') => {
      if (!canEditWorkflow || data.isPreview || data.isEmbedded) return

      event.preventDefault()
      event.stopPropagation()

      const buttonRect = event.currentTarget.getBoundingClientRect()
      const start = {
        x: buttonRect.left + buttonRect.width / 2,
        y: buttonRect.top + buttonRect.height / 2,
      }
      const pointerStart = { x: event.clientX, y: event.clientY }
      let isDragging = false
      let latestTargetBlockId: string | null = null
      let latestCanConnect = false

      const updateDragState = (clientX: number, clientY: number) => {
        const targetBlockId = getContentNodeIdAtPoint(clientX, clientY)
        const canConnect = targetBlockId ? canCreateExistingContentReference(targetBlockId) : false
        latestTargetBlockId = targetBlockId
        latestCanConnect = canConnect
        setReferenceDragState({
          anchor,
          start,
          current: { x: clientX, y: clientY },
          isDragging,
          targetBlockId,
          canConnect,
        })
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - pointerStart.x
        const deltaY = moveEvent.clientY - pointerStart.y
        if (!isDragging && Math.hypot(deltaX, deltaY) < CONTENT_REFERENCE_DRAG_THRESHOLD) {
          return
        }

        if (!isDragging) {
          isDragging = true
          setCreateMenuAnchor(null)
        }

        updateDragState(moveEvent.clientX, moveEvent.clientY)
      }

      const handlePointerUp = (upEvent: PointerEvent) => {
        window.removeEventListener('pointermove', handlePointerMove, true)
        window.removeEventListener('pointerup', handlePointerUp, true)
        window.removeEventListener('pointercancel', handlePointerCancel, true)

        if (isDragging) {
          updateDragState(upEvent.clientX, upEvent.clientY)
          if (latestTargetBlockId && latestCanConnect) {
            createExistingContentReference(latestTargetBlockId, anchor)
          }
          setReferenceDragState(null)
          return
        }

        setReferenceDragState(null)
        setCreateMenuAnchor((current) => (current === anchor ? null : anchor))
      }

      const handlePointerCancel = () => {
        window.removeEventListener('pointermove', handlePointerMove, true)
        window.removeEventListener('pointerup', handlePointerUp, true)
        window.removeEventListener('pointercancel', handlePointerCancel, true)
        setReferenceDragState(null)
      }

      window.addEventListener('pointermove', handlePointerMove, true)
      window.addEventListener('pointerup', handlePointerUp, true)
      window.addEventListener('pointercancel', handlePointerCancel, true)
    },
    [
      canCreateExistingContentReference,
      canEditWorkflow,
      createExistingContentReference,
      data.isEmbedded,
      data.isPreview,
      getContentNodeIdAtPoint,
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
            : resolvedVariant === 'presentation'
              ? { width: PRESENTATION_CARD_WIDTH, height: PRESENTATION_CARD_HEIGHT }
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
      resolvedPresentationPrompt,
      resolvedPresentationSlideCount,
      resolvedPresentationStatus,
      resolvedPresentationArtifact,
      getVideoMediaFileForType(resolvedVideoMedia, 'first_frame')?.path,
      getVideoMediaFileForType(resolvedVideoMedia, 'last_frame')?.path,
      resolvedFile?.path,
      isImageRepaintMode,
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

      const isSourceToTargetRole =
        reference.role === 'video_first_frame' ||
        reference.role === 'video_last_frame' ||
        reference.role === 'video_frame_capture'
      const sourceBlockId = isSourceToTargetRole ? reference.sourceBlockId : id
      const targetBlockId = isSourceToTargetRole ? id : reference.sourceBlockId
      const sourceX = workflowBlocks[sourceBlockId]?.position.x ?? 0
      const targetX = workflowBlocks[targetBlockId]?.position.x ?? 0
      const ordinaryHandles = getOrdinaryContentReferenceHandles()

      return [
        {
          id: `${sourceBlockId}:${targetBlockId}:${reference.role}`,
          source: sourceBlockId,
          target: targetBlockId,
          sourceHandle: isSourceToTargetRole
            ? getContentReferenceSourceHandleId(targetX >= sourceX ? 'right' : 'left')
            : ordinaryHandles.sourceHandle,
          targetHandle: isSourceToTargetRole
            ? getContentReferenceTargetHandleId(targetX >= sourceX ? 'left' : 'right')
            : ordinaryHandles.targetHandle,
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
        (['left', 'right'] as const).map((anchor) => (
          <Handle
            key={`target-${anchor}`}
            id={getContentReferenceTargetHandleId(anchor)}
            type='target'
            position={anchor === 'left' ? Position.Left : Position.Right}
            isConnectable={canEditWorkflow}
            className={HIDDEN_CONTENT_HANDLE_CLASSNAME}
          />
        ))}

      {showContentReferenceHandles && (
        <>
          {(['left', 'right'] as const).map((anchor) => (
            <Fragment key={anchor}>
              <Handle
                id={getContentReferenceSourceHandleId(anchor)}
                type='source'
                position={anchor === 'left' ? Position.Left : Position.Right}
                isConnectable={false}
                className={HIDDEN_CONTENT_HANDLE_CLASSNAME}
              />
              <button
                type='button'
                aria-label={
                  anchor === 'left'
                    ? 'Add or link content from left'
                    : 'Add or link content from right'
                }
                onPointerDown={(event) => startCreateMenuPointerSession(event, anchor)}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                className={cn(
                  'nodrag nopan -translate-y-1/2 absolute top-1/2 z-50 flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] shadow-sm transition-all hover-hover:bg-[var(--surface-3)]',
                  anchor === 'left' ? 'left-[-18px]' : 'right-[-18px]',
                  selected || isContentReferenceSource
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100',
                  isContentReferenceSource &&
                    'border-[var(--brand-secondary)] text-[var(--brand-secondary)]'
                )}
              >
                <Plus className='h-3.5 w-3.5' />
              </button>
            </Fragment>
          ))}

          {createMenuAnchor && createMenuItems.length > 0 ? (
            <div
              className={cn(
                'nodrag nopan -translate-y-1/2 absolute top-1/2 z-[70] min-w-[150px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-1 shadow-xl',
                createMenuAnchor === 'left' ? 'right-[calc(100%+28px)]' : 'left-[calc(100%+28px)]'
              )}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              {createMenuItems.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.variant}
                    type='button'
                    className='flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[var(--text-primary)] text-xs transition-colors hover-hover:bg-[var(--surface-3)]'
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      createReferencedContentNode(item.variant, createMenuAnchor)
                    }}
                  >
                    <Icon className='h-3.5 w-3.5 text-[var(--text-secondary)]' />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          ) : null}

          {referenceDragState?.isDragging ? (
            <div className='pointer-events-none fixed inset-0 z-[1200]'>
              <svg className='h-full w-full'>
                <line
                  x1={referenceDragState.start.x}
                  y1={referenceDragState.start.y}
                  x2={referenceDragState.current.x}
                  y2={referenceDragState.current.y}
                  stroke={
                    referenceDragState.targetBlockId
                      ? referenceDragState.canConnect
                        ? 'var(--brand-secondary)'
                        : 'var(--text-error)'
                      : 'var(--text-tertiary)'
                  }
                  strokeWidth='2'
                  strokeDasharray='6 6'
                  strokeLinecap='round'
                />
              </svg>
            </div>
          ) : null}
        </>
      )}

      <div
        ref={cardRef}
        role='button'
        tabIndex={0}
        className={cn(
          'relative z-[20] cursor-grab select-none overflow-visible transition-opacity content-drag-handle [&:active]:cursor-grabbing',
          (isReferenceSelectionDisabled || isFrameSelectionDisabled) && 'opacity-45'
        )}
        onClick={() => {
          if (frameSelection) return
          handleClick()
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) {
            return
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (frameSelection) return
            handleClick()
          }
        }}
      >
        <ContentNodeTitleBar
          blockId={id}
          name={data.name}
          variant={resolvedVariant}
          canEdit={canEditWorkflow && !data.isPreview && !data.isEmbedded}
          zoom={viewport.zoom}
          onRename={(nextName) => collaborativeUpdateBlockName(id, nextName).success}
        />

        {canSubmitToShowcase && (
          <button
            type='button'
            aria-label='提交成果'
            title='提交成果'
            disabled={createShowcaseItem.isPending}
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void submitToShowcase()
            }}
            className={cn(
              'nodrag nopan absolute top-2 right-2 z-[70] inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)]/95 px-3 text-[var(--text-primary)] text-xs shadow-sm backdrop-blur transition-colors hover-hover:bg-[var(--surface-3)]',
              createShowcaseItem.isPending && 'cursor-not-allowed opacity-70'
            )}
          >
            {createShowcaseItem.isPending ? (
              <Loader2 className='h-3.5 w-3.5 animate-spin' />
            ) : (
              <UploadCloud className='h-3.5 w-3.5' />
            )}
            <span>提交成果</span>
          </button>
        )}

        {!data.isPreview &&
          !data.isEmbedded &&
          !(resolvedVariant === 'image' && resolvedFile) &&
          !(resolvedVariant === 'video' && resolvedFile) &&
          !(resolvedVariant === 'presentation' && resolvedPresentationFile) && (
            <div className='nodrag nopan'>
              <ActionBar blockId={id} blockType='content' disabled={!canEditWorkflow} />
            </div>
          )}

        {resolvedVariant === 'presentation' ? (
          <PresentationContentCard
            canEdit={canEditWorkflow}
            isPreview={Boolean(data.isPreview)}
            isEmbedded={Boolean(data.isEmbedded)}
            selected={selected}
            prompt={resolvedPresentationPrompt}
            slideCountMode={resolvedPresentationSlideCountMode}
            slideCount={resolvedPresentationSlideCount}
            status={resolvedPresentationStatus}
            errorMessage={resolvedPresentationError}
            artifact={resolvedPresentationArtifact}
            fallbackFile={resolvedFile}
            contentReferences={resolvedContentReferences}
            referencedNodes={referencedNodes}
            isGeneratePending={generatePresentation.isPending}
            onAddReference={() => startExistingReferenceSelection()}
            onRemoveReference={removeReferenceAndEdges}
            onChangePrompt={(value) => {
              if (!data.isPreview) setPresentationPromptValue(value)
            }}
            onChangeSlideCountMode={(value) => {
              if (!data.isPreview) setPresentationSlideCountModeValue(value)
            }}
            onChangeSlideCount={(value) => {
              if (!data.isPreview && Number.isFinite(value)) {
                setPresentationSlideCountValue(Math.max(1, Math.min(30, Math.round(value))))
              }
            }}
            onGenerate={() => {
              void generatePresentationFromNode()
            }}
          />
        ) : resolvedVariant === 'image' ||
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
            videoEnhanceSourceFile={resolvedVideoEnhanceSourceFile}
            videoEnhanceParameters={resolvedVideoEnhanceParameters}
            contentReferences={resolvedContentReferences}
            referencedNodes={referencedNodes}
            generationStatus={
              normalizeImageGenerationStatus(resolvedGenerationStatus) ??
              normalizeVideoEnhanceGenerationStatus(resolvedGenerationStatus)
            }
            generationKind={
              normalizeImageGenerationKind(resolvedGenerationKind) ??
              normalizeVideoEnhanceGenerationKind(resolvedGenerationKind)
            }
            generationErrorMessage={resolvedGenerationError}
            nodeName={data.name}
            isImageCropMode={isImageCropMode}
            isImageRepaintMode={isImageRepaintMode}
            isImageEraseMode={isImageEraseMode}
            isImageOutpaintMode={isImageOutpaintMode}
            isVideoTrimMode={isVideoTrimMode}
            isImageCropProcessing={uploadWorkspaceFileMutation.isPending}
            isVideoTrimProcessing={isVideoTrimProcessing}
            videoTrimError={videoTrimError}
            onAddReference={() => startExistingReferenceSelection()}
            onRemoveReference={removeReferenceAndEdges}
            onStartImageCrop={startImageCropMode}
            onStartImageRepaint={startImageRepaintMode}
            onStartImageErase={startImageEraseMode}
            onStartImageOutpaint={startImageOutpaintMode}
            onStartImageCutout={startImageCutoutMode}
            onStartVideoTrim={startVideoTrimMode}
            onStartVideoEnhance={createVideoEnhanceNode}
            onCaptureVideoFrame={createVideoFrameCaptureNode}
            onCancelImageCrop={cancelImageCropMode}
            onCancelImageRepaint={cancelImageRepaintMode}
            onCancelImageErase={cancelImageEraseMode}
            onCancelImageOutpaint={cancelImageOutpaintMode}
            onCancelVideoTrim={cancelVideoTrimMode}
            onConfirmImageCrop={confirmImageCrop}
            onConfirmVideoTrim={confirmVideoTrim}
            onConfirmVideoEnhance={confirmVideoEnhance}
            onCreateImagePerspectiveVariant={createImagePerspectiveVariantNode}
            onCreateImageRepaintVariant={createImageRepaintVariantNode}
            onCreateImageEraseVariant={createImageEraseVariantNode}
            onSubmitImageOutpaint={createImageOutpaintVariantNode}
            onRetryImageCutout={retryImageCutout}
            onRetryImageOutpaint={retryImageOutpaint}
            onRetryDerivedImageGeneration={retryDerivedImageGeneration}
            onRetryVideoFrameCapture={retryVideoFrameCapture}
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
            onChangeVideoEnhanceParameters={(value) => {
              if (!data.isPreview) setVideoEnhanceParametersValue(value)
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
            onAddReference={() => startExistingReferenceSelection()}
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
