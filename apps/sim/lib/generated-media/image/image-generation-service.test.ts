/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFetchWorkspaceFileBuffer,
  mockGenerateImageWithProvider,
  mockGetWorkspaceFile,
  mockUploadWorkspaceFile,
} = vi.hoisted(() => ({
  mockFetchWorkspaceFileBuffer: vi.fn(),
  mockGenerateImageWithProvider: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockUploadWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/generated-media/image/providers', () => ({
  generateImageWithProvider: (...args: unknown[]) => mockGenerateImageWithProvider(...args),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: (...args: unknown[]) => mockFetchWorkspaceFileBuffer(...args),
  getWorkspaceFile: (...args: unknown[]) => mockGetWorkspaceFile(...args),
  uploadWorkspaceFile: (...args: unknown[]) => mockUploadWorkspaceFile(...args),
}))

import {
  generateWorkspaceImageFromPrompt,
  outpaintWorkspaceImage,
  repaintWorkspaceImage,
} from '@/lib/generated-media/image/image-generation-service'

describe('generateWorkspaceImageFromPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates a single image, saves it as a workspace file, and returns the file result', async () => {
    mockGenerateImageWithProvider.mockResolvedValue({
      buffer: Buffer.from('image-binary'),
      mimeType: 'image/png',
      provider: 'ark',
      providerModel: 'doubao-seedream-4-5-251128',
      revisedPrompt: 'A bright cover image',
    })
    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'wf_123',
      name: 'generated-image.png',
      size: 12,
      type: 'image/png',
      key: 'workspace/ws-1/generated-image.png',
      url: '/api/files/serve/workspace/ws-1/generated-image.png?context=workspace',
      context: 'workspace',
    })

    const result = await generateWorkspaceImageFromPrompt({
      workspaceId: 'ws-1',
      userId: 'user-1',
      model: 'jimeng-4.5',
      prompt: 'A bright cover image',
      aspectRatio: '16:9',
      referenceContext: {
        text: ['Use the referenced copy as the headline direction.'],
        images: [],
      },
    })

    expect(mockGenerateImageWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'jimeng-4.5',
        prompt: 'A bright cover image',
        aspectRatio: '16:9',
        referenceContext: {
          text: ['Use the referenced copy as the headline direction.'],
          images: [],
        },
      })
    )
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'ws-1',
      'user-1',
      expect.any(Buffer),
      'generated-image.png',
      'image/png'
    )
    expect(result.file).toMatchObject({
      id: 'wf_123',
      name: 'generated-image.png',
      type: 'image/png',
      key: 'workspace/ws-1/generated-image.png',
    })
  })

  it('hydrates referenced workspace images into base64 before calling the provider', async () => {
    mockGetWorkspaceFile.mockResolvedValue({
      id: 'image-1',
      name: 'board.png',
      key: 'workspace/board.png',
      url: 'https://example.com/board.png',
      size: 99,
      type: 'image/png',
      context: 'workspace',
    })
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('png-binary'))
    mockGenerateImageWithProvider.mockResolvedValue({
      buffer: Buffer.from('image-binary'),
      mimeType: 'image/png',
      provider: 'gemini',
      providerModel: 'gemini-3.1-flash-image-preview',
    })
    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'wf_456',
      name: 'generated-image.png',
      size: 12,
      type: 'image/png',
      key: 'workspace/ws-1/generated-image.png',
      url: '/api/files/serve/workspace/ws-1/generated-image.png?context=workspace',
      context: 'workspace',
    })

    await generateWorkspaceImageFromPrompt({
      workspaceId: 'ws-1',
      userId: 'user-1',
      model: 'gemini-3.1-flash-image-preview',
      prompt: 'Use this board as the visual reference.',
      aspectRatio: '1:1',
      referenceContext: {
        text: [],
        images: [
          {
            id: 'image-1',
            name: 'board.png',
            url: 'https://example.com/board.png',
            key: 'workspace/board.png',
            size: 99,
            type: 'image/png',
          },
        ],
      },
    })

    expect(mockGetWorkspaceFile).toHaveBeenCalledWith('ws-1', 'image-1')
    expect(mockFetchWorkspaceFileBuffer).toHaveBeenCalled()
    expect(mockGenerateImageWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceContext: {
          text: [],
          images: [
            expect.objectContaining({
              id: 'image-1',
              key: 'workspace/board.png',
              base64: Buffer.from('png-binary').toString('base64'),
            }),
          ],
        },
      })
    )
  })

  it('repaints with fixed Nano Banana Pro model, resolution, mask, and references', async () => {
    mockGetWorkspaceFile.mockImplementation(async (_workspaceId: string, fileId: string) => ({
      id: fileId,
      name: `${fileId}.png`,
      key: `workspace/${fileId}.png`,
      url: '',
      size: 99,
      type: 'image/png',
      context: 'workspace',
    }))
    mockFetchWorkspaceFileBuffer.mockImplementation(async (fileRecord: { id: string }) =>
      Buffer.from(`${fileRecord.id}-binary`)
    )
    mockGenerateImageWithProvider.mockResolvedValue({
      buffer: Buffer.from('repainted-image'),
      mimeType: 'image/png',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image',
    })
    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'wf_repaint',
      name: 'generated-image.png',
      size: 16,
      type: 'image/png',
      key: 'workspace/ws-1/repaint.png',
      url: '/api/files/serve/workspace/ws-1/repaint.png?context=workspace',
      context: 'workspace',
    })

    await repaintWorkspaceImage({
      workspaceId: 'ws-1',
      userId: 'user-1',
      prompt: 'replace the logo with a blue mark',
      resolution: '4K',
      sourceImage: {
        id: 'source-1',
        name: 'source.png',
        url: '',
        key: 'workspace/source.png',
        size: 100,
        type: 'image/png',
      },
      maskImage: {
        id: '',
        name: 'mask.png',
        url: '',
        key: 'mask.png',
        size: 50,
        type: 'image/png',
        base64: Buffer.from('mask-binary').toString('base64'),
      },
      referenceImages: [
        {
          id: 'ref-1',
          name: 'ref.png',
          url: '',
          key: 'workspace/ref.png',
          size: 80,
          type: 'image/png',
        },
      ],
    })

    expect(mockGenerateImageWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3-pro-image',
        aspectRatio: 'auto',
        resolution: '4K',
        prompt: expect.stringContaining('User request: replace the logo with a blue mark.'),
        referenceContext: {
          text: [],
          images: [
            expect.objectContaining({
              id: 'source-1',
              base64: Buffer.from('source-1-binary').toString('base64'),
            }),
            expect.objectContaining({
              key: 'mask.png',
              base64: Buffer.from('mask-binary').toString('base64'),
            }),
            expect.objectContaining({
              id: 'ref-1',
              base64: Buffer.from('ref-1-binary').toString('base64'),
            }),
          ],
        },
      })
    )
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'ws-1',
      'user-1',
      expect.any(Buffer),
      'generated-image.png',
      'image/png'
    )
  })

  it('outpaints with fixed Nano Banana Pro model, generated layout guides, and resolution', async () => {
    const sourcePngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
    mockGetWorkspaceFile.mockResolvedValue({
      id: 'source-1',
      name: 'source.png',
      key: 'workspace/source.png',
      url: '',
      size: 100,
      type: 'image/png',
      context: 'workspace',
    })
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from(sourcePngBase64, 'base64'))
    mockGenerateImageWithProvider.mockResolvedValue({
      buffer: Buffer.from('outpainted-image'),
      mimeType: 'image/png',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image',
    })
    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'wf_outpaint',
      name: 'generated-image.png',
      size: 16,
      type: 'image/png',
      key: 'workspace/ws-1/outpaint.png',
      url: '/api/files/serve/workspace/ws-1/outpaint.png?context=workspace',
      context: 'workspace',
    })

    const result = await outpaintWorkspaceImage({
      workspaceId: 'ws-1',
      userId: 'user-1',
      resolution: '2K',
      sourceImage: {
        id: 'source-1',
        name: 'source.png',
        url: '',
        key: 'workspace/source.png',
        size: 100,
        type: 'image/png',
      },
      targetAspectRatio: 'custom',
      customAspectRatio: { width: 2, height: 1 },
      placement: {
        x: 120,
        y: 80,
        width: 320,
        height: 180,
        canvasWidth: 640,
        canvasHeight: 360,
      },
      prompt: 'extend the city skyline',
    })

    expect(mockGenerateImageWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3-pro-image',
        aspectRatio: 'auto',
        resolution: '2K',
        prompt: expect.stringContaining('User request: extend the city skyline.'),
        referenceContext: {
          text: [],
          images: [
            expect.objectContaining({
              id: 'source-1',
              base64: sourcePngBase64,
            }),
            expect.objectContaining({
              name: 'outpaint-layout-guide.png',
              type: 'image/png',
              base64: expect.any(String),
            }),
            expect.objectContaining({
              name: 'outpaint-mask-guide.png',
              type: 'image/png',
              base64: expect.any(String),
            }),
          ],
        },
      })
    )
    expect(result.file).toMatchObject({
      id: 'wf_outpaint',
      name: 'generated-image.png',
      key: 'workspace/ws-1/outpaint.png',
    })
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'ws-1',
      'user-1',
      expect.any(Buffer),
      'generated-image.png',
      'image/png'
    )
  })
})
