import { NoteIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

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
      id: 'file',
      title: 'Media',
      type: 'file-upload',
      acceptedTypes: 'image/*,video/*,audio/*',
      multiple: false,
    },
  ],
  tools: { access: [] },
  inputs: {},
  outputs: {},
}
