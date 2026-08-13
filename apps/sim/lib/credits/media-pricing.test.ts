import { describe, expect, it } from 'vitest'
import { getMediaCreditQuote } from '@/lib/credits/media-pricing'

describe('getMediaCreditQuote', () => {
  it('prices configured image and audio models at fixed credits', () => {
    expect(getMediaCreditQuote({ capability: 'image', modelId: 'jimeng-4.5' })).toBe(20)
    expect(getMediaCreditQuote({ capability: 'audio', modelId: 'suno-v5-beta' })).toBe(50)
  })

  it('prices video by duration and applies the 1080P multiplier', () => {
    expect(getMediaCreditQuote({ capability: 'video', modelId: 'wan2.7-i2v', durationSeconds: 5, resolution: '720P' })).toBe(170)
    expect(getMediaCreditQuote({ capability: 'video', modelId: 'wan2.7-i2v', durationSeconds: 5, resolution: '1080P' })).toBe(255)
  })

  it('rejects enabled models without a platform price', () => {
    expect(() => getMediaCreditQuote({ capability: 'image', modelId: 'unknown' })).toThrow('No platform credit price configured')
  })
})
