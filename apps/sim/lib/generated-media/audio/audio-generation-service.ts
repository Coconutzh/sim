import type { UserFile } from '@/executor/types'
import { generateAudioWithProvider } from '@/lib/generated-media/audio/providers'
import type {
  AudioGenerationModelId,
  AudioGenerationParametersValue,
} from '@/lib/generated-media/audio/audio-generation-utils'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

interface GenerateWorkspaceAudioFromPromptInput {
  workspaceId: string
  userId: string
  model: AudioGenerationModelId
  prompt: string
  parameters: AudioGenerationParametersValue
  referenceContext?: {
    text: string[]
  }
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
}: GenerateWorkspaceAudioFromPromptInput): Promise<GenerateWorkspaceAudioFromPromptResult> {
  const generatedAudio = await generateAudioWithProvider({
    model,
    prompt,
    parameters,
    referenceContext,
  })

  const file = await uploadWorkspaceFile(
    workspaceId,
    userId,
    generatedAudio.buffer,
    getGeneratedAudioFileName(generatedAudio.mimeType),
    generatedAudio.mimeType
  )

  return {
    file,
    metadata: {
      provider: generatedAudio.provider,
      providerModel: generatedAudio.providerModel,
      taskId: generatedAudio.taskId,
    },
  }
}
