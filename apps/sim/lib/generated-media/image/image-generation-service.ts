import type { UserFileLike } from '@/lib/core/utils/user-file'
import type {
  ImageAspectRatioValue,
  ImageGenerationModelId,
} from '@/lib/generated-media/image/image-generation-utils'
import { generateImageWithProvider } from '@/lib/generated-media/image/providers'
import {
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { UserFile } from '@/executor/types'

interface GenerateWorkspaceImageFromPromptInput {
  workspaceId: string
  userId: string
  model: ImageGenerationModelId
  prompt: string
  aspectRatio: ImageAspectRatioValue
  referenceContext?: {
    text: string[]
    images: UserFileLike[]
  }
  abortSignal?: AbortSignal
}

interface GenerateWorkspaceImageFromPromptResult {
  file: UserFile
  metadata: {
    provider: string
    providerModel: string
    revisedPrompt?: string
  }
}

function getGeneratedFileName(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'generated-image.jpg'
  if (mimeType.includes('webp')) return 'generated-image.webp'
  return 'generated-image.png'
}

async function hydrateImageReferenceContext(
  workspaceId: string,
  referenceContext: GenerateWorkspaceImageFromPromptInput['referenceContext']
): Promise<GenerateWorkspaceImageFromPromptInput['referenceContext']> {
  if (!referenceContext?.images?.length) {
    return referenceContext
  }

  const hydratedImages = await Promise.all(
    referenceContext.images.map(async (image) => {
      const normalizedImage = {
        id: image.id ?? '',
        name: image.name ?? image.key,
        url: image.url ?? '',
        key: image.key,
        size: image.size ?? 0,
        type: image.type,
        context: image.context,
        base64: image.base64,
      }

      if (image.base64 || !image.id) {
        return normalizedImage
      }

      try {
        const fileRecord = await getWorkspaceFile(workspaceId, image.id)
        if (!fileRecord) {
          return normalizedImage
        }
        const buffer = await fetchWorkspaceFileBuffer(fileRecord)
        return {
          ...normalizedImage,
          name: image.name || fileRecord.name,
          url: image.url || fileRecord.url || '',
          key: image.key || fileRecord.key,
          size: image.size ?? fileRecord.size,
          type: image.type || fileRecord.type,
          base64: buffer.toString('base64'),
        } satisfies UserFileLike
      } catch {
        return normalizedImage
      }
    })
  )

  return {
    ...referenceContext,
    images: hydratedImages,
  }
}

export async function generateWorkspaceImageFromPrompt({
  workspaceId,
  userId,
  model,
  prompt,
  aspectRatio,
  referenceContext,
  abortSignal,
}: GenerateWorkspaceImageFromPromptInput): Promise<GenerateWorkspaceImageFromPromptResult> {
  const hydratedReferenceContext = await hydrateImageReferenceContext(workspaceId, referenceContext)

  const generatedImage = await generateImageWithProvider({
    model,
    prompt,
    aspectRatio,
    referenceContext: hydratedReferenceContext,
    abortSignal,
  })

  const file = await uploadWorkspaceFile(
    workspaceId,
    userId,
    generatedImage.buffer,
    getGeneratedFileName(generatedImage.mimeType),
    generatedImage.mimeType
  )

  return {
    file,
    metadata: {
      provider: generatedImage.provider,
      providerModel: generatedImage.providerModel,
      revisedPrompt: generatedImage.revisedPrompt,
    },
  }
}
