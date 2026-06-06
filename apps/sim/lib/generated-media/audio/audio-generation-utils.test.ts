import { describe, expect, it } from 'vitest'
import {
  buildAudioGenerationSummary,
  DEFAULT_AUDIO_MODEL,
  getAudioGenerationModelOptions,
} from '@/lib/generated-media/audio/audio-generation-utils'

describe('audio-generation-utils', () => {
  it('defaults to Suno v5', () => {
    expect(DEFAULT_AUDIO_MODEL).toBe('suno-v5-beta')
  })

  it('returns the expected public model options', () => {
    expect(getAudioGenerationModelOptions().map((option) => option.label)).toEqual([
      'Suno v5',
      'Suno v4.5',
      'Suno v4',
    ])
  })

  it('summarizes simple vocal generation settings', () => {
    expect(
      buildAudioGenerationSummary({
        customMode: false,
        instrumental: false,
        hasPrompt: true,
        hasStyle: false,
      })
    ).toBe('简单 · 人声 · 描述')
  })

  it('summarizes custom instrumental generation settings', () => {
    expect(
      buildAudioGenerationSummary({
        customMode: true,
        instrumental: true,
        hasPrompt: true,
        hasStyle: true,
      })
    ).toBe('自定义 · 器乐 · 歌词+风格')
  })
})
