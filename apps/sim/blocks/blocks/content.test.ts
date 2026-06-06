import { describe, expect, it } from 'vitest'
import { ContentBlock } from '@/blocks/blocks/content'

describe('ContentBlock', () => {
  it('registers persisted AI subblocks for text content nodes', () => {
    const aiPromptSubBlock = ContentBlock.subBlocks.find((subBlock) => subBlock.id === 'aiPrompt')
    const aiModelSubBlock = ContentBlock.subBlocks.find((subBlock) => subBlock.id === 'aiModel')
    const aiAspectRatioSubBlock = ContentBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'aiAspectRatio'
    )
    const contentReferencesSubBlock = ContentBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'contentReferences'
    )

    expect(aiPromptSubBlock).toMatchObject({
      id: 'aiPrompt',
      type: 'long-input',
      defaultValue: '',
    })
    expect(aiModelSubBlock).toMatchObject({
      id: 'aiModel',
      type: 'short-input',
      defaultValue: 'gemini-3.1-flash-lite-preview',
    })
    expect(aiAspectRatioSubBlock).toMatchObject({
      id: 'aiAspectRatio',
      type: 'short-input',
      defaultValue: 'auto',
    })
    expect(contentReferencesSubBlock).toMatchObject({
      id: 'contentReferences',
      type: 'short-input',
      hidden: true,
      paramVisibility: 'hidden',
      defaultValue: [],
    })
  })
})
