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

import { generateWorkspaceImageFromPrompt } from '@/lib/generated-media/image/image-generation-service'

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
})
