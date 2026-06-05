import { isUserFile, type UserFileLike } from '@/lib/core/utils/user-file'

function isImageUserFile(file: UserFileLike): boolean {
  return typeof file.type === 'string' && file.type.toLowerCase().startsWith('image/')
}

function collectImageFilesFromValue(value: unknown, files: UserFileLike[]): void {
  if (!value) return

  if (Array.isArray(value)) {
    for (const item of value) {
      collectImageFilesFromValue(item, files)
    }
    return
  }

  if (isUserFile(value)) {
    if (isImageUserFile(value)) {
      files.push(value)
    }
    return
  }

  if (typeof value !== 'object') {
    return
  }

  const record = value as Record<string, unknown>
  if ('file' in record) {
    collectImageFilesFromValue(record.file, files)
  }
  if ('files' in record) {
    collectImageFilesFromValue(record.files, files)
  }
}

export function extractImageFilesFromValue(value: unknown): UserFileLike[] {
  const files: UserFileLike[] = []
  collectImageFilesFromValue(value, files)

  return files.filter(
    (file, index, items) =>
      items.findIndex((candidate) =>
        candidate.key
          ? candidate.key === file.key
          : candidate.id
            ? candidate.id === file.id
            : candidate.url === file.url
      ) === index
  )
}
