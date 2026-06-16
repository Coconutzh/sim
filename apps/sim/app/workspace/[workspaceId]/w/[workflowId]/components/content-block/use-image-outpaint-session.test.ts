/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  buildImageOutpaintPendingSubBlockValues,
  normalizeImageOutpaintFile,
  runImageOutpaintRequest,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-image-outpaint-session'

describe('normalizeImageOutpaintFile', () => {
  it('derives a storage key from an internal path when file.key is missing', () => {
    expect(
      normalizeImageOutpaintFile({
        id: 'file-1',
        name: 'source.png',
        path: '/api/files/serve/workspace%2Fws-1%2Fsource.png?context=workspace',
        size: 100,
        type: 'image/png',
      })
    ).toMatchObject({
      id: 'file-1',
      name: 'source.png',
      url: '/api/files/serve/workspace%2Fws-1%2Fsource.png?context=workspace',
      key: 'workspace/ws-1/source.png',
    })
  })
})

describe('runImageOutpaintRequest', () => {
  const request = {
    workspaceId: 'ws-1',
    sourceFile: {
      id: 'file-1',
      name: 'source.png',
      key: 'workspace/ws-1/source.png',
      path: '/api/files/serve/workspace/ws-1/source.png?context=workspace',
      size: 100,
      type: 'image/png',
    },
    targetBlockId: 'result-1',
    placement: {
      x: 0,
      y: 20,
      width: 100,
      height: 100,
      canvasWidth: 160,
      canvasHeight: 160,
    },
    resolution: '2K' as const,
    targetAspectRatio: '1:1' as const,
  }

  it('completes the target result node without passing an abort signal', async () => {
    const requestOutpaint = vi.fn().mockResolvedValue({
      file: {
        id: 'generated-1',
        name: 'generated.png',
        url: '/api/files/serve/workspace/ws-1/generated.png?context=workspace',
        key: 'workspace/ws-1/generated.png',
        size: 200,
        type: 'image/png',
        context: 'workspace',
      },
    })
    const onComplete = vi.fn()
    const onError = vi.fn()

    await runImageOutpaintRequest({
      ...request,
      requestOutpaint,
      onComplete,
      onError,
    })

    expect(requestOutpaint).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      sourceImage: expect.objectContaining({
        id: 'file-1',
        key: 'workspace/ws-1/source.png',
      }),
      resolution: '2K',
      targetAspectRatio: '1:1',
      customAspectRatio: undefined,
      placement: request.placement,
      prompt: '',
    })
    expect(requestOutpaint.mock.calls[0]?.[0]).not.toHaveProperty('signal')
    expect(onComplete).toHaveBeenCalledWith('result-1', {
      id: 'generated-1',
      name: 'generated.png',
      path: '/api/files/serve/workspace/ws-1/generated.png?context=workspace',
      key: 'workspace/ws-1/generated.png',
      size: 200,
      type: 'image/png',
      context: 'workspace',
    })
    expect(onError).not.toHaveBeenCalled()
  })

  it('writes failures to the target result node callback', async () => {
    const requestOutpaint = vi.fn().mockRejectedValue(new Error('provider failed'))
    const onComplete = vi.fn()
    const onError = vi.fn()

    await runImageOutpaintRequest({
      ...request,
      requestOutpaint,
      onComplete,
      onError,
    })

    expect(onComplete).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('result-1', 'provider failed')
  })
})

describe('buildImageOutpaintPendingSubBlockValues', () => {
  it('creates the pending result node values with source content references', () => {
    const reference = {
      sourceBlockId: 'source-node',
      sourceVariant: 'image' as const,
      role: 'image_reference',
    }

    expect(
      buildImageOutpaintPendingSubBlockValues({
        aiAspectRatio: '16:9',
        reference,
      })
    ).toEqual({
      contentVariant: 'image',
      aiPrompt: '',
      aiModel: 'gemini-3-pro-image',
      aiAspectRatio: '16:9',
      file: null,
      contentReferences: [reference],
      generationKind: 'image_outpaint',
      generationStatus: 'pending',
      generationError: null,
    })
  })
})
