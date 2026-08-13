import { describe, expect, it } from 'vitest'
import { normalizeInternalFileUrl, resolveUserFileUrl } from '@/lib/core/utils/user-file'

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

  it('keeps authenticated internal files on the current browser origin', () => {
    expect(
      resolveUserFileUrl({
        url: 'http://8.133.178.111:3000/api/files/serve/workspace%2Fws-1%2Fimage.png?context=workspace',
      })
    ).toBe('/api/files/serve/workspace%2Fws-1%2Fimage.png?context=workspace')
  })
})

describe('normalizeInternalFileUrl', () => {
  it('preserves external image URLs', () => {
    expect(normalizeInternalFileUrl('https://cdn.example.com/image.png')).toBe(
      'https://cdn.example.com/image.png'
    )
  })

  it('does not mistake an external query value for an internal file URL', () => {
    expect(
      normalizeInternalFileUrl(
        'https://cdn.example.com/image.png?redirect=/api/files/serve/workspace/image.png'
      )
    ).toBe('https://cdn.example.com/image.png?redirect=/api/files/serve/workspace/image.png')
  })

  it('normalizes an absolute internal file URL without changing its encoded key', () => {
    expect(
      normalizeInternalFileUrl(
        'https://old.example.com/api/files/serve/workspace%2Fws-1%2Fimage.png?context=workspace'
      )
    ).toBe('/api/files/serve/workspace%2Fws-1%2Fimage.png?context=workspace')
  })
})
