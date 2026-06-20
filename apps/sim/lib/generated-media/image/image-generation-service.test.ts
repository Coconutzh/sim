/**
 * @vitest-environment node
 */

import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFetchWorkspaceFileBuffer,
  mockGenerateImageWithProvider,
  mockGetWorkspaceFile,
  mockGetWorkspaceFileByKey,
  mockUploadWorkspaceFile,
} = vi.hoisted(() => ({
  mockFetchWorkspaceFileBuffer: vi.fn(),
  mockGenerateImageWithProvider: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockGetWorkspaceFileByKey: vi.fn(),
  mockUploadWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/generated-media/image/providers', () => ({
  generateImageWithProvider: (...args: unknown[]) => mockGenerateImageWithProvider(...args),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: (...args: unknown[]) => mockFetchWorkspaceFileBuffer(...args),
  getWorkspaceFile: (...args: unknown[]) => mockGetWorkspaceFile(...args),
  getWorkspaceFileByKey: (...args: unknown[]) => mockGetWorkspaceFileByKey(...args),
  uploadWorkspaceFile: (...args: unknown[]) => mockUploadWorkspaceFile(...args),
}))

import {
  cutoutWorkspaceImage,
  eraseWorkspaceImage,
  generateWorkspaceImageFromPrompt,
  outpaintWorkspaceImage,
  repaintWorkspaceImage,
  resolveOutpaintAspectRatio,
} from '@/lib/generated-media/image/image-generation-service'

async function createSolidPng({
  width,
  height,
  color,
}: {
  width: number
  height: number
  color: { r: number; g: number; b: number }
}): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .png()
    .toBuffer()
}

describe('resolveOutpaintAspectRatio', () => {
  it('returns fixed ratios unchanged', () => {
    expect(
      resolveOutpaintAspectRatio({
        targetAspectRatio: '21:9',
        placement: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          canvasWidth: 100,
          canvasHeight: 100,
        },
      })
    ).toBe('21:9')
  })

  it('maps custom ratios to the nearest supported provider ratio', () => {
    expect(
      resolveOutpaintAspectRatio({
        targetAspectRatio: 'custom',
        customAspectRatio: { width: 2, height: 1 },
        placement: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          canvasWidth: 100,
          canvasHeight: 100,
        },
      })
    ).toBe('16:9')
  })

  it('maps original to the final outpaint canvas ratio', () => {
    expect(
      resolveOutpaintAspectRatio({
        targetAspectRatio: 'original',
        placement: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          canvasWidth: 900,
          canvasHeight: 1600,
        },
      })
    ).toBe('9:16')
  })
})

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

  it('resolves multi-angle auto aspect ratio from the source image dimensions', async () => {
    const sourcePng = await createSolidPng({
      width: 1600,
      height: 900,
      color: { r: 255, g: 255, b: 255 },
    })
    mockGetWorkspaceFile.mockResolvedValue({
      id: 'source-1',
      name: 'source.png',
      key: 'workspace/source.png',
      url: '',
      size: sourcePng.byteLength,
      type: 'image/png',
      context: 'workspace',
    })
    mockFetchWorkspaceFileBuffer.mockResolvedValue(sourcePng)
    mockGenerateImageWithProvider.mockResolvedValue({
      buffer: Buffer.from('image-binary'),
      mimeType: 'image/png',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image-preview',
    })
    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'wf_perspective',
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
      model: 'gemini-3-pro-image-preview',
      prompt: 'Create a different camera angle.',
      aspectRatio: 'auto',
      referenceContext: {
        text: [],
        images: [
          {
            id: 'source-1',
            name: 'source.png',
            url: '',
            key: 'workspace/source.png',
            size: sourcePng.byteLength,
            type: 'image/png',
          },
        ],
      },
    })

    expect(mockGenerateImageWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3-pro-image-preview',
        aspectRatio: '16:9',
        logContext: expect.objectContaining({
          tool: 'image_perspective',
          sourceBytes: sourcePng.byteLength,
        }),
      })
    )
  })

  it('repaints with fixed Nano Banana Pro model, resolution, mask, and references', async () => {
    const sourcePng = await createSolidPng({
      width: 1600,
      height: 1200,
      color: { r: 255, g: 255, b: 255 },
    })
    const maskPng = await createSolidPng({
      width: 400,
      height: 300,
      color: { r: 255, g: 255, b: 255 },
    })
    mockGetWorkspaceFile.mockImplementation(async (_workspaceId: string, fileId: string) => ({
      id: fileId,
      name: `${fileId}.png`,
      key: `workspace/${fileId}.png`,
      url: '',
      size: fileId === 'source-1' ? sourcePng.byteLength : 80,
      type: 'image/png',
      context: 'workspace',
    }))
    mockFetchWorkspaceFileBuffer.mockImplementation(async (fileRecord: { id: string }) => {
      if (fileRecord.id === 'source-1') return sourcePng
      return Buffer.from(`${fileRecord.id}-binary`)
    })
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
        size: sourcePng.byteLength,
        type: 'image/png',
      },
      maskImage: {
        id: '',
        name: 'mask.png',
        url: '',
        key: 'mask.png',
        size: maskPng.byteLength,
        type: 'image/png',
        base64: maskPng.toString('base64'),
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
        aspectRatio: '4:3',
        resolution: '4K',
        prompt: expect.stringContaining('User request: replace the logo with a blue mark.'),
        logContext: {
          tool: 'image_repaint',
          sourceBytes: sourcePng.byteLength,
          maskBytes: expect.any(Number),
          referenceBytes: 80,
          sourceWidth: 1600,
          sourceHeight: 1200,
          maskWidth: 400,
          maskHeight: 300,
          normalizedMaskWidth: 1600,
          normalizedMaskHeight: 1200,
        },
        referenceContext: {
          text: [],
          images: [
            expect.objectContaining({
              id: 'source-1',
              base64: sourcePng.toString('base64'),
            }),
            expect.objectContaining({
              key: expect.stringMatching(/^repaint-mask-.+\.png$/),
              size: expect.any(Number),
              type: 'image/png',
              base64: expect.any(String),
            }),
            expect.objectContaining({
              id: 'ref-1',
              base64: Buffer.from('ref-1-binary').toString('base64'),
            }),
          ],
        },
      })
    )
    const providerInput = mockGenerateImageWithProvider.mock.calls[0]?.[0] as {
      referenceContext: { images: Array<{ base64?: string }> }
    }
    const normalizedMaskBase64 = providerInput.referenceContext.images[1]?.base64
    expect(normalizedMaskBase64).toEqual(expect.any(String))
    await expect(
      sharp(Buffer.from(normalizedMaskBase64 ?? '', 'base64')).metadata()
    ).resolves.toMatchObject({
      width: 1600,
      height: 1200,
    })
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'ws-1',
      'user-1',
      expect.any(Buffer),
      'generated-image.png',
      'image/png'
    )
  })

  it('erases with fixed Nano Banana Pro model, resolution, source image, and mask', async () => {
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
      buffer: Buffer.from('erased-image'),
      mimeType: 'image/png',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image',
    })
    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'wf_erase',
      name: 'generated-image.png',
      size: 16,
      type: 'image/png',
      key: 'workspace/ws-1/erase.png',
      url: '/api/files/serve/workspace/ws-1/erase.png?context=workspace',
      context: 'workspace',
    })

    const result = await eraseWorkspaceImage({
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
      maskImage: {
        id: '',
        name: 'mask.png',
        url: '',
        key: 'mask.png',
        size: 50,
        type: 'image/png',
        base64: Buffer.from('mask-binary').toString('base64'),
      },
    })

    expect(mockGenerateImageWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3-pro-image',
        aspectRatio: 'auto',
        resolution: '2K',
        prompt: expect.stringContaining('white/visible painted areas should be removed'),
        logContext: {
          tool: 'image_erase',
          sourceBytes: 100,
          maskBytes: 50,
          referenceBytes: undefined,
        },
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
          ],
        },
      })
    )
    expect(result).toMatchObject({
      file: {
        id: 'wf_erase',
      },
      metadata: {
        providerModel: 'gemini-3-pro-image',
      },
    })
  })

  it('cuts out with fixed Nano Banana Pro model and preserves a real transparent PNG', async () => {
    const sourcePng = await createSolidPng({
      width: 2,
      height: 2,
      color: { r: 255, g: 0, b: 0 },
    })
    const transparentPng = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg width="2" height="2" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="1" height="1" fill="red"/></svg>'
          ),
        },
      ])
      .png()
      .toBuffer()

    mockGetWorkspaceFileByKey.mockResolvedValueOnce({
      id: 'source-1',
      name: 'source.png',
      key: 'workspace/source.png',
      url: '',
      size: 100,
      type: 'image/png',
      context: 'workspace',
    })
    mockFetchWorkspaceFileBuffer.mockResolvedValue(sourcePng)
    mockGenerateImageWithProvider.mockResolvedValue({
      buffer: transparentPng,
      mimeType: 'image/png',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image',
    })
    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'wf_cutout',
      name: 'generated-cutout.png',
      size: transparentPng.byteLength,
      type: 'image/png',
      key: 'workspace/ws-1/generated-cutout.png',
      url: '/api/files/serve/workspace/ws-1/generated-cutout.png?context=workspace',
      context: 'workspace',
    })

    const result = await cutoutWorkspaceImage({
      workspaceId: 'ws-1',
      userId: 'user-1',
      sourceImage: {
        id: 'source-1',
        name: 'source.png',
        url: '',
        key: 'workspace/source.png',
        size: 100,
        type: 'image/png',
      },
    })

    expect(mockGenerateImageWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3-pro-image',
        aspectRatio: '1:1',
        resolution: '2K',
        prompt: expect.stringContaining('Cut out the main foreground subject'),
        referenceContext: {
          text: [],
          images: [
            expect.objectContaining({
              id: '',
              name: 'source.jpg',
              key: expect.stringMatching(/^cutout-source-.+\.jpg$/),
              type: 'image/jpeg',
              base64: expect.any(String),
            }),
          ],
        },
      })
    )
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'ws-1',
      'user-1',
      expect.any(Buffer),
      'generated-cutout.png',
      'image/png'
    )
    expect(result).toMatchObject({
      metadata: {
        providerModel: 'gemini-3-pro-image',
        hasAlpha: true,
        postProcessed: false,
      },
    })
  })

  it('resolves cutout source images by displayed key before legacy id fallback', async () => {
    const displayedSourcePng = await createSolidPng({
      width: 16,
      height: 9,
      color: { r: 255, g: 0, b: 0 },
    })
    const transparentPng = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer()

    mockGetWorkspaceFileByKey.mockResolvedValueOnce({
      id: 'displayed-source',
      name: 'displayed.png',
      key: 'workspace/displayed.png',
      url: '/api/files/serve/workspace/displayed.png?context=workspace',
      size: 100,
      type: 'image/png',
      context: 'workspace',
    })
    mockGetWorkspaceFile.mockResolvedValueOnce({
      id: 'legacy-source',
      name: 'legacy.png',
      key: 'workspace/legacy.png',
      url: '/api/files/serve/workspace/legacy.png?context=workspace',
      size: 100,
      type: 'image/png',
      context: 'workspace',
    })
    mockFetchWorkspaceFileBuffer.mockResolvedValue(displayedSourcePng)
    mockGenerateImageWithProvider.mockResolvedValue({
      buffer: transparentPng,
      mimeType: 'image/png',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image',
    })
    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'wf_cutout',
      name: 'generated-cutout.png',
      size: transparentPng.byteLength,
      type: 'image/png',
      key: 'workspace/ws-1/generated-cutout.png',
      url: '/api/files/serve/workspace/ws-1/generated-cutout.png?context=workspace',
      context: 'workspace',
    })

    await cutoutWorkspaceImage({
      workspaceId: 'ws-1',
      userId: 'user-1',
      sourceImage: {
        id: 'legacy-source',
        name: 'stale-display.png',
        url: '/api/files/serve/workspace/displayed.png?context=workspace',
        key: 'workspace/displayed.png',
        size: 100,
        type: 'image/png',
      },
    })

    expect(mockGetWorkspaceFileByKey).toHaveBeenCalledWith('ws-1', 'workspace/displayed.png')
    expect(mockFetchWorkspaceFileBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'displayed-source' })
    )
    expect(mockGenerateImageWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        aspectRatio: '16:9',
        referenceContext: {
          text: [],
          images: [
            expect.objectContaining({
              id: '',
              name: 'displayed.jpg',
              key: expect.stringMatching(/^cutout-source-.+\.jpg$/),
              type: 'image/jpeg',
              base64: expect.any(String),
            }),
          ],
        },
      })
    )
  })

  it('post-processes an opaque flat-background cutout into a transparent PNG', async () => {
    const opaqueWhiteBackgroundPng = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg width="8" height="8" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="4" height="4" fill="blue"/></svg>'
          ),
        },
      ])
      .png()
      .toBuffer()

    mockGetWorkspaceFile.mockResolvedValue({
      id: 'source-1',
      name: 'source.png',
      key: 'workspace/source.png',
      url: '',
      size: 100,
      type: 'image/png',
      context: 'workspace',
    })
    mockFetchWorkspaceFileBuffer.mockResolvedValue(
      await createSolidPng({
        width: 8,
        height: 8,
        color: { r: 255, g: 0, b: 0 },
      })
    )
    mockGenerateImageWithProvider.mockResolvedValue({
      buffer: opaqueWhiteBackgroundPng,
      mimeType: 'image/png',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image',
    })
    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'wf_cutout',
      name: 'generated-cutout.png',
      size: opaqueWhiteBackgroundPng.byteLength,
      type: 'image/png',
      key: 'workspace/ws-1/generated-cutout.png',
      url: '/api/files/serve/workspace/ws-1/generated-cutout.png?context=workspace',
      context: 'workspace',
    })

    const result = await cutoutWorkspaceImage({
      workspaceId: 'ws-1',
      userId: 'user-1',
      sourceImage: {
        id: 'source-1',
        name: 'source.png',
        url: '',
        key: 'workspace/source.png',
        size: 100,
        type: 'image/png',
      },
    })
    const uploadedBuffer = mockUploadWorkspaceFile.mock.calls[0]?.[2] as Buffer
    const uploadedStats = await sharp(uploadedBuffer).stats()

    expect(result.metadata).toMatchObject({
      hasAlpha: true,
      postProcessed: true,
    })
    expect(uploadedStats.channels[3]?.min).toBe(0)
  })

  it('rejects opaque cutout output when no real alpha mask can be derived', async () => {
    const solidOpaquePng = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 24, g: 80, b: 160 },
      },
    })
      .png()
      .toBuffer()

    mockGetWorkspaceFile.mockResolvedValue({
      id: 'source-1',
      name: 'source.png',
      key: 'workspace/source.png',
      url: '',
      size: 100,
      type: 'image/png',
      context: 'workspace',
    })
    mockFetchWorkspaceFileBuffer.mockResolvedValue(
      await createSolidPng({
        width: 4,
        height: 4,
        color: { r: 255, g: 0, b: 0 },
      })
    )
    mockGenerateImageWithProvider.mockResolvedValue({
      buffer: solidOpaquePng,
      mimeType: 'image/png',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image',
    })

    await expect(
      cutoutWorkspaceImage({
        workspaceId: 'ws-1',
        userId: 'user-1',
        sourceImage: {
          id: 'source-1',
          name: 'source.png',
          url: '',
          key: 'workspace/source.png',
          size: 100,
          type: 'image/png',
        },
      })
    ).rejects.toThrow('Unable to generate a real transparent PNG')
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('outpaints with fixed Nano Banana Pro model, generated layout guides, and resolution', async () => {
    const sourcePng = await createSolidPng({
      width: 2,
      height: 2,
      color: { r: 255, g: 0, b: 0 },
    })
    const sourcePngBase64 = sourcePng.toString('base64')
    const generatedPng = await createSolidPng({
      width: 32,
      height: 18,
      color: { r: 0, g: 0, b: 255 },
    })
    mockGetWorkspaceFile.mockResolvedValue({
      id: 'source-1',
      name: 'source.png',
      key: 'workspace/source.png',
      url: '',
      size: 100,
      type: 'image/png',
      context: 'workspace',
    })
    mockFetchWorkspaceFileBuffer.mockResolvedValue(sourcePng)
    mockGenerateImageWithProvider.mockResolvedValue({
      buffer: generatedPng,
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
        aspectRatio: '16:9',
        resolution: '2K',
        prompt: expect.stringContaining('left 18.75%, top 22.22%, width 50.00%, height 50.00%'),
        logContext: expect.objectContaining({
          tool: 'image_outpaint',
          sourceBytes: 100,
          maskBytes: expect.any(Number),
          referenceBytes: expect.any(Number),
        }),
        referenceContext: {
          text: [],
          images: [
            expect.objectContaining({
              id: 'source-1',
              base64: sourcePngBase64,
            }),
            expect.objectContaining({
              name: expect.stringMatching(/^outpaint-layout-guide-.+\.png$/),
              type: 'image/png',
              base64: expect.any(String),
            }),
            expect.objectContaining({
              name: expect.stringMatching(/^outpaint-mask-guide-.+\.png$/),
              type: 'image/png',
              base64: expect.any(String),
            }),
          ],
        },
      })
    )
    const providerRequest = mockGenerateImageWithProvider.mock.calls[0]?.[0] as { prompt: string }
    expect(providerRequest.prompt).toContain('User request: extend the city skyline.')
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

  it('uses unique guide image names across consecutive outpaint requests', async () => {
    const sourcePng = await createSolidPng({
      width: 2,
      height: 2,
      color: { r: 255, g: 0, b: 0 },
    })
    const sourcePngBase64 = sourcePng.toString('base64')
    const generatedPng = await createSolidPng({
      width: 32,
      height: 18,
      color: { r: 0, g: 0, b: 255 },
    })
    mockGetWorkspaceFileByKey.mockResolvedValue({
      id: 'source-1',
      name: 'source.png',
      key: 'workspace/source.png',
      url: '',
      size: 100,
      type: 'image/png',
      context: 'workspace',
    })
    mockFetchWorkspaceFileBuffer.mockResolvedValue(sourcePng)
    mockGenerateImageWithProvider.mockResolvedValue({
      buffer: generatedPng,
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
    const request = {
      workspaceId: 'ws-1',
      userId: 'user-1',
      resolution: '2K' as const,
      sourceImage: {
        id: 'source-1',
        name: 'source.png',
        url: '',
        key: 'workspace/source.png',
        size: 100,
        type: 'image/png',
      },
      targetAspectRatio: '16:9' as const,
      placement: {
        x: 120,
        y: 80,
        width: 320,
        height: 180,
        canvasWidth: 640,
        canvasHeight: 360,
      },
    }

    await outpaintWorkspaceImage(request)
    await outpaintWorkspaceImage(request)

    const firstImages = mockGenerateImageWithProvider.mock.calls[0]?.[0]?.referenceContext
      ?.images as Array<{ name: string }>
    const secondImages = mockGenerateImageWithProvider.mock.calls[1]?.[0]?.referenceContext
      ?.images as Array<{ name: string }>

    expect(firstImages[1].name).not.toBe(secondImages[1].name)
    expect(firstImages[2].name).not.toBe(secondImages[2].name)
  })
})
