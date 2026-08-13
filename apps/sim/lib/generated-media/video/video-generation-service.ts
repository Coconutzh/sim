import { generateId } from '@sim/utils/id'
import type { UserFileLike } from '@/lib/core/utils/user-file'
import { getMediaCreditQuote } from '@/lib/credits/media-pricing'
import { releaseCredits, reserveCredits, settleCredits } from '@/lib/credits/wallet'
import { resolveMediaEditWorkspaceFile } from '@/lib/generated-media/image/media-edit-files'
import { generateVideoWithProvider } from '@/lib/generated-media/video/providers'
import type {
  VideoFrameAspectRatioPreset,
  VideoGenerationModelId,
  VideoMediaType,
  VideoResolution,
} from '@/lib/generated-media/video/video-generation-utils'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { isInternalFileUrl } from '@/lib/uploads/utils/file-utils'
import type { UserFile } from '@/executor/types'

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
  abortSignal?: AbortSignal
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

async function hydrateInternalVideoMedia(
  workspaceId: string,
  media: GenerateWorkspaceVideoFromPromptInput['media']
): Promise<GenerateWorkspaceVideoFromPromptInput['media']> {
  return Promise.all(
    media.map(async (item) => {
      const fileUrl = item.file.url?.trim() || item.file.path?.trim() || ''
      if (item.file.base64 || !isInternalFileUrl(fileUrl)) return item

      const resolvedFile = await resolveMediaEditWorkspaceFile({
        workspaceId,
        file: item.file,
      })
      if (!resolvedFile?.base64) {
        throw new Error(`${item.type} image was not found in this workspace.`)
      }

      return {
        ...item,
        file: {
          ...item.file,
          ...resolvedFile,
          base64: resolvedFile.base64,
        },
      }
    })
  )
}

export async function generateWorkspaceVideoFromPrompt({
  workspaceId,
  userId,
  model,
  prompt,
  media,
  parameters,
  abortSignal,
}: GenerateWorkspaceVideoFromPromptInput): Promise<GenerateWorkspaceVideoFromPromptResult> {
  const hydratedMedia = await hydrateInternalVideoMedia(workspaceId, media)
  const operationId = generateId()
  const credits = getMediaCreditQuote({
    capability: 'video',
    modelId: model,
    durationSeconds: parameters.duration,
    resolution: parameters.resolution,
  })
  await reserveCredits({
    userId,
    operationId,
    credits,
    capability: 'video',
    modelId: model,
    workspaceId,
    metadata: { duration: parameters.duration, resolution: parameters.resolution },
  })
  try {
    const generatedVideo = await generateVideoWithProvider({
      model,
      prompt,
      media: hydratedMedia,
      parameters,
      abortSignal,
    })

    const file = await uploadWorkspaceFile(
      workspaceId,
      userId,
      generatedVideo.buffer,
      getGeneratedVideoFileName(generatedVideo.mimeType),
      generatedVideo.mimeType
    )

    await settleCredits({ userId, operationId, capability: 'video', modelId: model, workspaceId })

    return {
      file,
      metadata: {
        provider: generatedVideo.provider,
        providerModel: generatedVideo.providerModel,
        taskId: generatedVideo.taskId,
        revisedPrompt: generatedVideo.revisedPrompt,
      },
    }
  } catch (error) {
    await releaseCredits({
      userId,
      operationId,
      capability: 'video',
      modelId: model,
      workspaceId,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    })
    throw error
  }
}
