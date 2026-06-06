import type { ComponentType } from 'react'
import { PenTool } from 'lucide-react'
import { AgentIcon, DocumentIcon, ImageIcon, TableIcon, VideoIcon } from '@/components/icons'
import { AudioIcon } from '@/components/icons/document-icons'

const DEFAULT_TEXT_AI_MODEL = 'gemini-3.1-flash-lite-preview'
const DEFAULT_IMAGE_AI_MODEL = 'jimeng-4.5'

/**
 * TapNow-style content node identifiers used by product-facing creation flows.
 */
export type ContentNodePresetId =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'table'
  | 'image_editor'

export type ContentNodeVariant = 'text' | 'image' | 'video' | 'audio'

/**
 * Product-layer preset that maps a user-facing content node to a pure canvas content block.
 */
export interface ContentNodePreset {
  id: ContentNodePresetId
  label: string
  description: string
  blockType: string | null
  contentVariant?: ContentNodeVariant
  icon: ComponentType<{ className?: string }>
  available: boolean
  inlineSubBlockIds: string[]
  presetSubBlockValues?: Record<string, unknown>
  advancedPanelLabel: string
}

const CONTENT_NODE_PRESETS: readonly ContentNodePreset[] = [
  {
    id: 'text',
    label: 'Text',
    description: 'Add a resizable text card directly onto the canvas.',
    blockType: 'content',
    contentVariant: 'text',
    icon: AgentIcon,
    available: true,
    inlineSubBlockIds: [],
    presetSubBlockValues: {
      contentVariant: 'text',
      contentHtml: '<p></p>',
      blockStyle: 'paragraph',
      backgroundColor: '#FFF8C5',
      fontSize: 16,
      width: 320,
      height: 160,
      aiPrompt: '',
      aiModel: DEFAULT_TEXT_AI_MODEL,
      contentReferences: [],
    },
    advancedPanelLabel: 'Text settings',
  },
  {
    id: 'image',
    label: 'Image',
    description: 'Upload and display a single image in a fixed card.',
    blockType: 'content',
    contentVariant: 'image',
    icon: ImageIcon,
    available: true,
    inlineSubBlockIds: [],
    presetSubBlockValues: {
      contentVariant: 'image',
      aiPrompt: '',
      aiModel: DEFAULT_IMAGE_AI_MODEL,
      aiAspectRatio: 'auto',
      file: null,
      contentReferences: [],
    },
    advancedPanelLabel: 'Image settings',
  },
  {
    id: 'video',
    label: 'Video',
    description: 'Upload and play a single video in a canvas card.',
    blockType: 'content',
    contentVariant: 'video',
    icon: VideoIcon,
    available: true,
    inlineSubBlockIds: [],
    presetSubBlockValues: {
      contentVariant: 'video',
      file: null,
      contentReferences: [],
    },
    advancedPanelLabel: 'Video settings',
  },
  {
    id: 'audio',
    label: 'Audio',
    description: 'Upload and play a single audio file in a canvas card.',
    blockType: 'content',
    contentVariant: 'audio',
    icon: AudioIcon,
    available: true,
    inlineSubBlockIds: [],
    presetSubBlockValues: {
      contentVariant: 'audio',
      file: null,
      contentReferences: [],
    },
    advancedPanelLabel: 'Audio settings',
  },
  {
    id: 'document',
    label: 'Document',
    description: 'Reserved for a future canvas document card.',
    blockType: null,
    icon: DocumentIcon,
    available: false,
    inlineSubBlockIds: [],
    advancedPanelLabel: 'Document card settings',
  },
  {
    id: 'table',
    label: 'Table',
    description: 'Reserved for a future canvas table card.',
    blockType: null,
    icon: TableIcon,
    available: false,
    inlineSubBlockIds: [],
    advancedPanelLabel: 'Table card settings',
  },
  {
    id: 'image_editor',
    label: 'Image Editor',
    description: 'Reserved for a future first-class image editing node.',
    blockType: null,
    icon: PenTool,
    available: false,
    inlineSubBlockIds: [],
    advancedPanelLabel: 'Image editor settings',
  },
] as const

/**
 * Returns all content node presets, including unavailable placeholders.
 */
export function getContentNodePresets(): readonly ContentNodePreset[] {
  return CONTENT_NODE_PRESETS
}

/**
 * Returns the addable content node presets for current product surfaces.
 */
export function getAddableContentNodePresets(): readonly ContentNodePreset[] {
  return CONTENT_NODE_PRESETS.filter((preset) => preset.available && preset.blockType)
}

/**
 * Looks up a content node preset by its product-facing identifier.
 */
export function getContentNodePreset(id: ContentNodePresetId): ContentNodePreset | undefined {
  return CONTENT_NODE_PRESETS.find((preset) => preset.id === id)
}

/**
 * Looks up the content node preset that owns a given underlying block type.
 */
export function getContentNodePresetForBlockType(blockType: string): ContentNodePreset | undefined {
  const legacyPresetMap: Record<string, ContentNodePresetId> = {
    agent: 'text',
    image_generator: 'image',
    video_generator: 'video',
    file: 'document',
    table: 'table',
  }

  const presetId = legacyPresetMap[blockType]
  return presetId ? getContentNodePreset(presetId) : undefined
}
