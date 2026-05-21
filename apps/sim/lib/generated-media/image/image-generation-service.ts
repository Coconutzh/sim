import type {
  ImageAspectRatioValue,
  ImageGenerationModelId,
} from '@/lib/generated-media/image/image-generation-utils'
import { generateImageWithProvider } from '@/lib/generated-media/image/providers'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { UserFile } from '@/executor/types'

interface GenerateWorkspaceImageFromPromptInput {
  workspaceId: string
  userId: string
  model: ImageGenerationModelId
  prompt: string
  aspectRatio: ImageAspectRatioValue
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

export async function generateWorkspaceImageFromPrompt({
  workspaceId,
  userId,
  model,
  prompt,
  aspectRatio,
}: GenerateWorkspaceImageFromPromptInput): Promise<GenerateWorkspaceImageFromPromptResult> {
  const generatedImage = await generateImageWithProvider({
    model,
    prompt,
    aspectRatio,
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
