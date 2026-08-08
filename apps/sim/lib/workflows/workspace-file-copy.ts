import {
  fetchWorkspaceFileBuffer,
  getWorkspaceFileByKey,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { UserFile } from '@/executor/types'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isWorkspaceFileReference(value: JsonRecord): boolean {
  const key = value.key
  if (typeof key !== 'string' || !key) return false
  return value.context === 'workspace' || key.startsWith('workspace/')
}

function toCopiedFileValue(source: JsonRecord, file: UserFile): JsonRecord {
  return {
    ...source,
    ...file,
    path: file.url,
    url: file.url,
  }
}

/** Copies workspace-scoped file references embedded in a persisted workflow value. */
export async function copyWorkspaceFileReferences<T>(params: {
  sourceWorkspaceId: string
  targetWorkspaceId: string
  targetUserId: string
  value: T
}): Promise<T> {
  const copiedFiles = new Map<string, UserFile>()

  async function copy(value: unknown): Promise<unknown> {
    if (Array.isArray(value)) return Promise.all(value.map(copy))
    if (!isRecord(value)) return value

    if (isWorkspaceFileReference(value)) {
      const key = value.key as string
      let copiedFile = copiedFiles.get(key)
      if (!copiedFile) {
        const sourceFile = await getWorkspaceFileByKey(params.sourceWorkspaceId, key)
        if (!sourceFile) throw new Error(`Source workspace file is unavailable: ${key}`)
        const content = await fetchWorkspaceFileBuffer(sourceFile)
        copiedFile = await uploadWorkspaceFile(
          params.targetWorkspaceId,
          params.targetUserId,
          content,
          sourceFile.name,
          sourceFile.type
        )
        copiedFiles.set(key, copiedFile)
      }
      return toCopiedFileValue(value, copiedFile)
    }

    const copiedEntries = await Promise.all(
      Object.entries(value).map(
        async ([key, nestedValue]) => [key, await copy(nestedValue)] as const
      )
    )
    return Object.fromEntries(copiedEntries)
  }

  return (await copy(params.value)) as T
}
