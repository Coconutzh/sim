import type { ComponentType } from 'react'
import { PenTool } from 'lucide-react'
import { AgentIcon, DocumentIcon, ImageIcon, TableIcon, VideoIcon } from '@/components/icons'

/**
 * TapNow-style content node identifiers used by product-facing creation flows.
 */
export type ContentNodePresetId = 'text' | 'image' | 'video' | 'document' | 'table' | 'image_editor'

/**
 * Product-layer preset that maps a user-facing content node to an existing Sim block.
 */
export interface ContentNodePreset {
  id: ContentNodePresetId
  label: string
  description: string
  blockType: string | null
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
    description: 'Write and refine text content with an agent-backed node.',
    blockType: 'agent',
    icon: AgentIcon,
    available: true,
    inlineSubBlockIds: ['messages'],
    advancedPanelLabel: 'Agent settings',
  },
  {
    id: 'image',
    label: 'Image',
    description: 'Generate still images from prompts.',
    blockType: 'image_generator',
    icon: ImageIcon,
    available: true,
    inlineSubBlockIds: ['prompt'],
    advancedPanelLabel: 'Image settings',
  },
  {
    id: 'video',
    label: 'Video',
    description: 'Generate videos from prompts and optional reference media.',
    blockType: 'video_generator',
    icon: VideoIcon,
    available: true,
    inlineSubBlockIds: ['prompt', 'visualReference'],
    advancedPanelLabel: 'Video settings',
  },
  {
    id: 'document',
    label: 'Document',
    description: 'Upload and parse documents directly from the canvas.',
    blockType: 'file',
    icon: DocumentIcon,
    available: true,
    inlineSubBlockIds: ['file'],
    presetSubBlockValues: {
      inputMethod: 'upload',
    },
    advancedPanelLabel: 'Document settings',
  },
  {
    id: 'table',
    label: 'Table',
    description: 'Work with structured table data from a lightweight node.',
    blockType: 'table',
    icon: TableIcon,
    available: true,
    inlineSubBlockIds: ['tableSelector', 'operation'],
    advancedPanelLabel: 'Table settings',
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
  return CONTENT_NODE_PRESETS.find((preset) => preset.blockType === blockType)
}
