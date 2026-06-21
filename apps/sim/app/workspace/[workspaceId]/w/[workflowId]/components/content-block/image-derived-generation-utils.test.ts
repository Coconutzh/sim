/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { ContentReferenceRecord } from '@/lib/workflows/content-references'
import {
  buildImageErasePendingSubBlockValues,
  buildImagePerspectivePendingSubBlockValues,
  buildImageRepaintPendingSubBlockValues,
  createMaskImageFile,
  getImageEraseRequestMetadata,
  getImagePerspectiveRequestMetadata,
  getImageRepaintRequestMetadata,
  type requestWorkspaceImageErase,
  type requestWorkspaceImagePerspective,
  type requestWorkspaceImageRepaint,
  runImageEraseRequest,
  runImagePerspectiveRequest,
  runImageRepaintRequest,
  type UploadedFileValue,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-derived-generation-utils'

const reference = {
  sourceBlockId: 'source-1',
  sourceVariant: 'image',
  role: 'image_reference',
} satisfies ContentReferenceRecord

const sourceFile = {
  id: 'file-source',
  name: 'source.png',
  path: '/api/files/serve/source.png',
  key: 'workspace/source.png',
  size: 100,
  type: 'image/png',
} satisfies UploadedFileValue

const generatedResponse = {
  success: true,
  file: {
    id: 'generated-1',
    name: 'generated.png',
    url: '/api/files/serve/generated.png',
    key: 'workspace/generated.png',
    size: 200,
    type: 'image/png',
  },
  metadata: {
    provider: 'test',
    providerModel: 'test-model',
  },
} as const

describe('image-derived-generation-utils', () => {
  it('builds pending multi-angle subBlock values with retry metadata', () => {
    const request = {
      model: 'gemini-3-pro-image-preview',
      prompt: 'rotate camera',
      values: {
        rotation: 12,
        tilt: -4,
        zoom: 9,
        wideAngle: true,
      },
    } as const

    const values = buildImagePerspectivePendingSubBlockValues({ reference, request })

    expect(values).toMatchObject({
      contentVariant: 'image',
      aiPrompt: 'rotate camera',
      aiModel: 'gemini-3-pro-image-preview',
      aiAspectRatio: 'auto',
      file: null,
      contentReferences: [reference],
      generationKind: 'image_perspective',
      generationStatus: 'pending',
      generationError: null,
      imagePerspectiveRequest: request,
    })
    expect(getImagePerspectiveRequestMetadata(values.imagePerspectiveRequest)).toEqual(request)
  })

  it('builds pending repaint and erase values with persisted masks', () => {
    const repaintMask = createMaskImageFile('repaint-mask.png', {
      base64: 'mask-base64',
      size: 24,
    })
    const repaintRequest = {
      prompt: 'make it red',
      resolution: '2K',
      maskImage: repaintMask,
      referenceImages: [
        {
          id: 'ref-1',
          name: 'ref.png',
          path: '/api/files/serve/ref.png',
          key: 'workspace/ref.png',
          size: 50,
          type: 'image/png',
        },
      ],
    } as const
    const eraseRequest = {
      resolution: '1K',
      maskImage: createMaskImageFile('erase-mask.png', { base64: 'erase-mask', size: 12 }),
    } as const

    const repaintValues = buildImageRepaintPendingSubBlockValues({
      reference,
      request: repaintRequest,
    })
    const eraseValues = buildImageErasePendingSubBlockValues({ reference, request: eraseRequest })

    expect(repaintValues).toMatchObject({
      file: null,
      contentReferences: [reference],
      generationKind: 'image_repaint',
      generationStatus: 'pending',
      generationError: null,
      imageRepaintRequest: repaintRequest,
    })
    expect(eraseValues).toMatchObject({
      file: null,
      contentReferences: [reference],
      generationKind: 'image_erase',
      generationStatus: 'pending',
      generationError: null,
      imageEraseRequest: eraseRequest,
    })
    expect(getImageRepaintRequestMetadata(repaintValues.imageRepaintRequest)).toEqual(
      repaintRequest
    )
    expect(getImageEraseRequestMetadata(eraseValues.imageEraseRequest)).toEqual(eraseRequest)
  })

  it('runs a multi-angle request from persisted metadata', async () => {
    const onComplete = vi.fn()
    const onError = vi.fn()
    const requestPerspective = vi.fn<typeof requestWorkspaceImagePerspective>(async () => ({
      ...generatedResponse,
      metadata: {
        provider: 'test',
        providerModel: 'gemini-3-pro-image-preview',
      },
    }))

    await runImagePerspectiveRequest({
      workspaceId: 'workspace-1',
      sourceFile,
      targetBlockId: 'target-1',
      request: {
        model: 'gemini-3-pro-image-preview',
        prompt: 'rotate camera',
        values: { rotation: 1, tilt: 2, zoom: 3, wideAngle: false },
      },
      requestPerspective,
      onComplete,
      onError,
    })

    expect(requestPerspective).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      model: 'gemini-3-pro-image-preview',
      prompt: 'rotate camera',
      aspectRatio: 'auto',
      referenceContext: {
        text: [],
        images: [expect.objectContaining({ key: 'workspace/source.png' })],
      },
    })
    expect(onComplete).toHaveBeenCalledWith(
      'target-1',
      expect.objectContaining({ key: 'workspace/generated.png' })
    )
    expect(onError).not.toHaveBeenCalled()
  })

  it('runs repaint and erase requests from persisted metadata', async () => {
    const repaintRequest = vi.fn<typeof requestWorkspaceImageRepaint>(async () => generatedResponse)
    const eraseRequest = vi.fn<typeof requestWorkspaceImageErase>(async () => generatedResponse)
    const repaintComplete = vi.fn()
    const eraseComplete = vi.fn()
    const onError = vi.fn()
    const repaintMask = createMaskImageFile('repaint-mask.png', {
      base64: 'repaint-mask',
      size: 10,
    })
    const eraseMask = createMaskImageFile('erase-mask.png', { base64: 'erase-mask', size: 11 })

    await runImageRepaintRequest({
      workspaceId: 'workspace-1',
      sourceFile,
      targetBlockId: 'repaint-target',
      request: {
        prompt: 'replace the window',
        resolution: '4K',
        maskImage: repaintMask,
        referenceImages: [],
      },
      requestRepaint: repaintRequest,
      onComplete: repaintComplete,
      onError,
    })
    await runImageEraseRequest({
      workspaceId: 'workspace-1',
      sourceFile,
      targetBlockId: 'erase-target',
      request: {
        resolution: '2K',
        maskImage: eraseMask,
      },
      requestErase: eraseRequest,
      onComplete: eraseComplete,
      onError,
    })

    expect(repaintRequest).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      prompt: 'replace the window',
      resolution: '4K',
      sourceImage: expect.objectContaining({ key: 'workspace/source.png' }),
      maskImage: expect.objectContaining({ base64: 'repaint-mask' }),
      referenceImages: [],
    })
    expect(eraseRequest).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      resolution: '2K',
      sourceImage: expect.objectContaining({ key: 'workspace/source.png' }),
      maskImage: expect.objectContaining({ base64: 'erase-mask' }),
    })
    expect(repaintComplete).toHaveBeenCalledWith(
      'repaint-target',
      expect.objectContaining({ key: 'workspace/generated.png' })
    )
    expect(eraseComplete).toHaveBeenCalledWith(
      'erase-target',
      expect.objectContaining({ key: 'workspace/generated.png' })
    )
    expect(onError).not.toHaveBeenCalled()
  })
})
