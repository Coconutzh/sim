import { getContentCanvasModelOptions } from '@/lib/content-canvas/model-catalog'
import type { UserFileLike } from '@/lib/core/utils/user-file'

export const DEFAULT_AUDIO_MODEL = 'suno-v5-beta' as const

export const AUDIO_MODE_OPTIONS = [
  { id: 'simple', label: '简单' },
  { id: 'custom', label: '自定义' },
] as const

export const AUDIO_VOICE_MODE_OPTIONS = [
  { id: 'vocal', label: '人声' },
  { id: 'instrumental', label: '器乐' },
] as const

export type AudioGenerationModelId = 'suno-v5-beta' | 'suno-v4.5-beta' | 'suno-v4-beta'

export interface AudioGenerationParametersValue {
  customMode: boolean
  instrumental: boolean
  style: string
  title: string
  negativeTags: string
  vocalGender: string
}

export type AudioGenerationTaskResultFile = UserFileLike

export const DEFAULT_AUDIO_PARAMETERS: AudioGenerationParametersValue = {
  customMode: false,
  instrumental: false,
  style: '',
  title: '',
  negativeTags: '',
  vocalGender: '',
}

export function getAudioGenerationModelOptions(
  enabledModelIds?: readonly string[]
): ReadonlyArray<{
  id: AudioGenerationModelId
  label: string
  description: string
}> {
  const options = getContentCanvasModelOptions('audio') as Array<{
    id: AudioGenerationModelId
    label: string
    description: string
  }>
  if (!enabledModelIds) return options

  const enabledSet = new Set(enabledModelIds)
  return options.filter((option) => enabledSet.has(option.id))
}

export function isAudioGenerationModel(value: unknown): value is AudioGenerationModelId {
  return getAudioGenerationModelOptions().some((option) => option.id === value)
}

export function buildAudioGenerationSummary({
  customMode,
  instrumental,
  hasPrompt,
  hasStyle,
}: {
  customMode: boolean
  instrumental: boolean
  hasPrompt: boolean
  hasStyle: boolean
}) {
  const modeLabel = customMode ? '自定义' : '简单'
  const voiceLabel = instrumental ? '器乐' : '人声'
  const contentLabel = customMode
    ? hasStyle
      ? '歌词+风格'
      : hasPrompt
        ? '歌词'
        : '待填写'
    : hasPrompt
      ? '描述'
      : '待填写'

  return `${modeLabel} · ${voiceLabel} · ${contentLabel}`
}
