import type { UserFile } from '@/executor/types'
import type { UserFileLike } from '@/lib/core/utils/user-file'
import { generateVideoWithProvider } from '@/lib/generated-media/video/providers'
import type {
  VideoFrameAspectRatioPreset,
  VideoGenerationModelId,
  VideoMediaType,
  VideoResolution,
} from '@/lib/generated-media/video/video-generation-utils'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

interface GenerateWorkspaceVideoFromPromptInput {
  workspaceId: string
  userId: string
  model: VideoGenerationModelId
  prompt: string
  media: Array<{
    type: VideoMediaType
    file: UserFileLike
  }>
  parameters: {
    aspectRatioPreset: VideoFrameAspectRatioPreset
    resolution: VideoResolution
    duration: number
    promptExtend: boolean
    watermark: boolean
  }
}

interface GenerateWorkspaceVideoFromPromptResult {
  file: UserFile
  metadata: {
    provider: string
    providerModel: string
    taskId: string
    revisedPrompt?: string
  }
}

function getGeneratedVideoFileName(mimeType: string) {
  if (mimeType.includes('webm')) return 'generated-video.webm'
  if (mimeType.includes('quicktime')) return 'generated-video.mov'
  return 'generated-video.mp4'
}

export async function generateWorkspaceVideoFromPrompt({
  workspaceId,
  userId,
  model,
  prompt,
  media,
  parameters,
}: GenerateWorkspaceVideoFromPromptInput): Promise<GenerateWorkspaceVideoFromPromptResult> {
  const generatedVideo = await generateVideoWithProvider({
    model,
    prompt,
    media,
    parameters,
  })

  const file = await uploadWorkspaceFile(
    workspaceId,
    userId,
    generatedVideo.buffer,
    getGeneratedVideoFileName(generatedVideo.mimeType),
    generatedVideo.mimeType
  )

  return {
    file,
    metadata: {
      provider: generatedVideo.provider,
      providerModel: generatedVideo.providerModel,
      taskId: generatedVideo.taskId,
      revisedPrompt: generatedVideo.revisedPrompt,
    },
  }
}
