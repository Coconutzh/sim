/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateImageWithProvider, mockUploadWorkspaceFile } = vi.hoisted(() => ({
  mockGenerateImageWithProvider: vi.fn(),
  mockUploadWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/generated-media/image/providers', () => ({
  generateImageWithProvider: (...args: unknown[]) => mockGenerateImageWithProvider(...args),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
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
    })

    expect(mockGenerateImageWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'jimeng-4.5',
        prompt: 'A bright cover image',
        aspectRatio: '16:9',
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
})
