/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isAbortError, isInternalFileUrl, isNetworkError } from '@/lib/uploads/utils/file-utils'

describe('isInternalFileUrl', () => {
  it.each([
    '/api/files/serve/workspace%2Fws-1%2Fimage.png?context=workspace',
    'http://8.133.178.111:3000/api/files/serve/workspace%2Fws-1%2Fimage.png?context=workspace',
    'https://old.example.com/api/files/serve/workspace/image.png',
  ])('recognizes internal file paths across deployment origins: %s', (url) => {
    expect(isInternalFileUrl(url)).toBe(true)
  })

  it.each([
    'https://cdn.example.com/image.png',
    'https://cdn.example.com/image.png?redirect=/api/files/serve/workspace/image.png',
    'https://cdn.example.com/assets/api/files/serve/image.png',
    'not a url',
  ])('does not classify external or invalid values as internal files: %s', (url) => {
    expect(isInternalFileUrl(url)).toBe(false)
  })
})

describe('isAbortError', () => {
  it('returns true for AbortError-named errors', () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    expect(isAbortError(err)).toBe(true)
  })

  it('returns false for generic Errors', () => {
    expect(isAbortError(new Error('boom'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })
})

describe('isNetworkError', () => {
  it.each([
    'fetch failed',
    'Network request failed',
    'connection reset',
    'request timeout',
    'operation timed out',
    'ECONNRESET while reading body',
  ])('matches transient message %s', (msg) => {
    expect(isNetworkError(new Error(msg))).toBe(true)
  })

  it('does not match deterministic errors', () => {
    expect(isNetworkError(new Error('Forbidden'))).toBe(false)
    expect(isNetworkError(new Error('Validation failed: name is required'))).toBe(false)
    expect(isNetworkError('not an error')).toBe(false)
    expect(isNetworkError(null)).toBe(false)
  })
})
