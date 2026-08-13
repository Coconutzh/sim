import { generateId } from '@sim/utils/id'
import { getMediaCreditQuote } from '@/lib/credits/media-pricing'
import { releaseCredits, reserveCredits, settleCredits } from '@/lib/credits/wallet'
import type {
  AudioGenerationModelId,
  AudioGenerationParametersValue,
} from '@/lib/generated-media/audio/audio-generation-utils'
import { generateAudioWithProvider } from '@/lib/generated-media/audio/providers'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { UserFile } from '@/executor/types'

interface GenerateWorkspaceAudioFromPromptInput {
  workspaceId: string
  userId: string
  model: AudioGenerationModelId
  prompt: string
  parameters: AudioGenerationParametersValue
  referenceContext?: {
    text: string[]
  }
  abortSignal?: AbortSignal
}

interface GenerateWorkspaceAudioFromPromptResult {
  file: UserFile
  metadata: {
    provider: string
    providerModel: string
    taskId: string
  }
}

function getGeneratedAudioFileName(mimeType: string) {
  if (mimeType.includes('wav')) return 'generated-audio.wav'
  if (mimeType.includes('ogg')) return 'generated-audio.ogg'
  if (mimeType.includes('flac')) return 'generated-audio.flac'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'generated-audio.m4a'
  return 'generated-audio.mp3'
}

export async function generateWorkspaceAudioFromPrompt({
  workspaceId,
  userId,
  model,
  prompt,
  parameters,
  referenceContext,
  abortSignal,
}: GenerateWorkspaceAudioFromPromptInput): Promise<GenerateWorkspaceAudioFromPromptResult> {
  const operationId = generateId()
  const credits = getMediaCreditQuote({ capability: 'audio', modelId: model })
  await reserveCredits({
    userId,
    operationId,
    credits,
    capability: 'audio',
    modelId: model,
    workspaceId,
  })
  try {
    const generatedAudio = await generateAudioWithProvider({
      model,
      prompt,
      parameters,
      referenceContext,
      abortSignal,
    })

    const file = await uploadWorkspaceFile(
      workspaceId,
      userId,
      generatedAudio.buffer,
      getGeneratedAudioFileName(generatedAudio.mimeType),
      generatedAudio.mimeType
    )

    await settleCredits({ userId, operationId, capability: 'audio', modelId: model, workspaceId })

    return {
      file,
      metadata: {
        provider: generatedAudio.provider,
        providerModel: generatedAudio.providerModel,
        taskId: generatedAudio.taskId,
      },
    }
  } catch (error) {
    await releaseCredits({
      userId,
      operationId,
      capability: 'audio',
      modelId: model,
      workspaceId,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    })
    throw error
  }
}
