import { NoteIcon } from '@/components/icons'
import {
  DEFAULT_AUDIO_MODEL,
  DEFAULT_AUDIO_PARAMETERS,
} from '@/lib/generated-media/audio/audio-generation-utils'
import {
  DEFAULT_VIDEO_FRAME_ASPECT_RATIO_PRESET,
  DEFAULT_VIDEO_MODEL_FAMILY,
} from '@/lib/generated-media/video/video-generation-utils'
import type { BlockConfig } from '@/blocks/types'

const CONTENT_AUDIO_PARAMETERS_DEFAULT: Record<string, unknown> = { ...DEFAULT_AUDIO_PARAMETERS }

export const ContentBlock: BlockConfig = {
  type: 'content',
  name: 'Content',
  description: 'Add pure canvas content such as text notes and uploaded media.',
  longDescription:
    'Content blocks are TapNow-style canvas cards for text and media. They do not participate in workflow execution or block connections.',
  category: 'blocks',
  bgColor: '#F4B740',
  icon: NoteIcon,
  hideFromToolbar: true,
  subBlocks: [
    {
      id: 'contentVariant',
      title: 'Variant',
      type: 'short-input',
      defaultValue: 'text',
    },
    {
      id: 'contentHtml',
      title: 'Content',
      type: 'long-input',
      defaultValue: '<p></p>',
    },
    {
      id: 'blockStyle',
      title: 'Format',
      type: 'dropdown',
      defaultValue: 'paragraph',
      options: [
        { id: 'h1', label: 'H1' },
        { id: 'h2', label: 'H2' },
        { id: 'h3', label: 'H3' },
        { id: 'paragraph', label: 'Body' },
      ],
    },
    {
      id: 'backgroundColor',
      title: 'Background',
      type: 'short-input',
      defaultValue: '#FFF8C5',
    },
    {
      id: 'fontSize',
      title: 'Font Size',
      type: 'short-input',
      defaultValue: 16,
    },
    {
      id: 'width',
      title: 'Width',
      type: 'short-input',
      defaultValue: 320,
    },
    {
      id: 'height',
      title: 'Height',
      type: 'short-input',
      defaultValue: 160,
    },
    {
      id: 'aiPrompt',
      title: 'AI Prompt',
      type: 'long-input',
      defaultValue: '',
    },
    {
      id: 'aiModel',
      title: 'AI Model',
      type: 'short-input',
      defaultValue: 'gemini-3.1-flash-lite-preview',
    },
    {
      id: 'aiAspectRatio',
      title: 'AI Aspect Ratio',
      type: 'short-input',
      defaultValue: 'auto',
    },
    {
      id: 'contentReferences',
      title: 'Content References',
      type: 'short-input',
      defaultValue: [],
      hidden: true,
      paramVisibility: 'hidden',
    },
    {
      id: 'file',
      title: 'Media',
      type: 'file-upload',
      acceptedTypes: 'image/*,video/*,audio/*',
      multiple: false,
    },
    {
      id: 'audioPrompt',
      title: 'Audio Prompt',
      type: 'long-input',
      defaultValue: '',
      hidden: true,
      paramVisibility: 'hidden',
    },
    {
      id: 'audioModel',
      title: 'Audio Model',
      type: 'short-input',
      defaultValue: DEFAULT_AUDIO_MODEL,
      hidden: true,
      paramVisibility: 'hidden',
    },
    {
      id: 'audioParameters',
      title: 'Audio Parameters',
      type: 'short-input',
      defaultValue: CONTENT_AUDIO_PARAMETERS_DEFAULT,
      hidden: true,
      paramVisibility: 'hidden',
    },
    {
      id: 'videoPrompt',
      title: 'Video Prompt',
      type: 'long-input',
      defaultValue: '',
      hidden: true,
      paramVisibility: 'hidden',
    },
    {
      id: 'videoModelFamily',
      title: 'Video Model Family',
      type: 'short-input',
      defaultValue: DEFAULT_VIDEO_MODEL_FAMILY,
      hidden: true,
      paramVisibility: 'hidden',
    },
    {
      id: 'videoMedia',
      title: 'Video Media',
      type: 'short-input',
      defaultValue: [],
      hidden: true,
      paramVisibility: 'hidden',
    },
    {
      id: 'videoParameters',
      title: 'Video Parameters',
      type: 'short-input',
      defaultValue: {
        resolution: '720P',
        duration: 5,
      },
      hidden: true,
      paramVisibility: 'hidden',
    },
    {
      id: 'videoFrameAspectRatioPreset',
      title: 'Video Aspect Ratio',
      type: 'short-input',
      defaultValue: DEFAULT_VIDEO_FRAME_ASPECT_RATIO_PRESET,
      hidden: true,
      paramVisibility: 'hidden',
    },
  ],
  tools: { access: [] },
  inputs: {},
  outputs: {},
}
