import { describe, expect, it } from 'vitest'
import { resolveUserFileUrl } from '@/lib/core/utils/user-file'

describe('resolveUserFileUrl', () => {
  it('prefers an explicit url when present', () => {
    expect(
      resolveUserFileUrl({
        url: ' https://example.com/image.png ',
        path: '/api/files/fallback.png',
      })
    ).toBe('https://example.com/image.png')
  })

  it('falls back to path when url is missing', () => {
    expect(
      resolveUserFileUrl({
        path: ' /api/files/image.png ',
      })
    ).toBe('/api/files/image.png')
  })

  it('falls back to a workspace serve URL when only key is present', () => {
    expect(
      resolveUserFileUrl({
        key: 'workspace/ws-1/generated image.png',
      })
    ).toBe('/api/files/serve/workspace%2Fws-1%2Fgenerated%20image.png?context=workspace')
  })

  it('returns an empty string when neither url nor path is usable', () => {
    expect(resolveUserFileUrl(null)).toBe('')
    expect(resolveUserFileUrl({})).toBe('')
  })
})
