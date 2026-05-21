import { describe, expect, it } from 'vitest'
import {
  getAddableContentNodePresets,
  getContentNodePreset,
} from '@/lib/product/content-node-presets'

describe('content-node-presets', () => {
  it('creates text, image, video, and audio content nodes from addable presets', () => {
    const presetIds = getAddableContentNodePresets().map((preset) => preset.id)

    expect(presetIds).toEqual(['text', 'image', 'video', 'audio'])
  })

  it('maps the text preset to a pure canvas content block', () => {
    const preset = getContentNodePreset('text')

    expect(preset).toBeDefined()
    expect(preset?.blockType).toBe('content')
    expect(preset?.contentVariant).toBe('text')
    expect(preset?.presetSubBlockValues).toMatchObject({
      contentVariant: 'text',
      contentHtml: '<p></p>',
      blockStyle: 'paragraph',
      backgroundColor: '#FFF8C5',
      fontSize: 16,
      width: 320,
      height: 160,
      aiPrompt: '',
      aiModel: 'gemini-3.1-flash-lite-preview',
    })
  })

  it('maps the image preset to a pure canvas content block', () => {
    const preset = getContentNodePreset('image')

    expect(preset).toBeDefined()
    expect(preset?.blockType).toBe('content')
    expect(preset?.contentVariant).toBe('image')
    expect(preset?.presetSubBlockValues).toMatchObject({
      contentVariant: 'image',
      aiPrompt: '',
      aiModel: 'jimeng-4.5',
      aiAspectRatio: 'auto',
      file: null,
    })
  })

  it('maps the video preset to a pure canvas content block', () => {
    const preset = getContentNodePreset('video')

    expect(preset).toBeDefined()
    expect(preset?.blockType).toBe('content')
    expect(preset?.contentVariant).toBe('video')
    expect(preset?.presetSubBlockValues).toMatchObject({
      contentVariant: 'video',
      file: null,
    })
  })

  it('maps the audio preset to a pure canvas content block', () => {
    const preset = getContentNodePreset('audio')

    expect(preset).toBeDefined()
    expect(preset?.blockType).toBe('content')
    expect(preset?.contentVariant).toBe('audio')
    expect(preset?.presetSubBlockValues).toMatchObject({
      contentVariant: 'audio',
      file: null,
    })
  })
})
