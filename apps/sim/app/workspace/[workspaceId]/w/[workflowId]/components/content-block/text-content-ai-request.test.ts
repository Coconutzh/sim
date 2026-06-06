import { describe, expect, it, vi } from 'vitest'
import {
  buildTextContentAiUserMessage,
  hydrateReferenceImagesForTextAi,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/text-content-ai-request'

describe('text-content-ai-request', () => {
  it('builds multimodal user message parts while preserving plain text content', () => {
    const message = buildTextContentAiUserMessage({
      prompt: '润色这段文案',
      referenceContextText: '参考画布上下文：夜景、霓虹、潮湿街道',
      referenceImages: [
        {
          mimeType: 'image/png',
          data: 'ZmFrZS1iYXNlNjQ=',
        },
      ],
    })

    expect(message.content).toBe('润色这段文案\n\n参考画布上下文：夜景、霓虹、潮湿街道')
    expect(message.parts).toEqual([
      { type: 'text', text: '润色这段文案\n\n参考画布上下文：夜景、霓虹、潮湿街道' },
      {
        type: 'image',
        mimeType: 'image/png',
        data: 'ZmFrZS1iYXNlNjQ=',
      },
    ])
  })

  it('hydrates referenced image urls into base64 payloads for Gemini text requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'image/png' }),
    })

    const images = await hydrateReferenceImagesForTextAi(
      [
        {
          url: 'https://example.com/reference.png',
          type: 'image/png',
          name: 'reference.png',
        },
      ],
      fetchMock
    )

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/reference.png', { credentials: 'include' })
    expect(images).toEqual([
      {
        mimeType: 'image/png',
        data: 'AQIDBA==',
      },
    ])
  })
})
