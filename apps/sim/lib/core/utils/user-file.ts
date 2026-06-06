import type { UserFile } from '@/executor/types'

export type UserFileLike = Pick<UserFile, 'id' | 'name' | 'url' | 'key'> &
  Partial<Pick<UserFile, 'size' | 'type' | 'context' | 'base64'>>

/**
 * Fields exposed for UserFile objects in UI (tag dropdown) and logs.
 * Internal fields like 'key' and 'context' are not exposed.
 */
export const USER_FILE_DISPLAY_FIELDS = ['id', 'name', 'url', 'size', 'type', 'base64'] as const

export type UserFileDisplayField = (typeof USER_FILE_DISPLAY_FIELDS)[number]

/**
 * Checks if a value matches the minimal UserFile shape.
 */
export function isUserFile(value: unknown): value is UserFileLike {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.key === 'string' &&
    typeof candidate.url === 'string' &&
    typeof candidate.name === 'string'
  )
}

/**
 * Checks if a value matches the full UserFile metadata shape.
 */
export function isUserFileWithMetadata(value: unknown): value is UserFile {
  if (!isUserFile(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return typeof candidate.size === 'number' && typeof candidate.type === 'string'
}

/**
 * Filters a UserFile object to only include display fields.
 * Used for both UI display and log sanitization.
 */
export function filterUserFileForDisplay(data: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {}
  for (const field of USER_FILE_DISPLAY_FIELDS) {
    if (field in data) {
      filtered[field] = data[field]
    }
  }
  return filtered
}

/**
 * Resolves the best available display URL for a file-like object.
 * Prefers `url` and falls back to legacy `path`.
 */
export function resolveUserFileUrl(fileInput: unknown): string {
  if (!fileInput || typeof fileInput !== 'object') {
    return ''
  }

  const record = fileInput as Record<string, unknown>
  if (typeof record.url === 'string' && record.url.trim()) {
    return record.url.trim()
  }
  if (typeof record.path === 'string' && record.path.trim()) {
    return record.path.trim()
  }
  return ''
}

/**
 * Extracts base64 content from either a raw base64 string or a UserFile object.
 * Useful for tools that accept file input in either format.
 * @returns The base64 string, or undefined if not found
 */
export function extractBase64FromFileInput(
  input: string | UserFileLike | null | undefined
): string | undefined {
  if (typeof input === 'string') {
    return input
  }
  if (input?.base64) {
    return input.base64
  }
  return undefined
}
