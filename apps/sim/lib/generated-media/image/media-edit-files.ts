import { createLogger } from '@sim/logger'
import type { UserFileLike } from '@/lib/core/utils/user-file'
import {
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  getWorkspaceFileByKey,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { resolveStorageKeyFromFileInput } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('MediaEditFiles')

type MediaEditFileInput = UserFileLike & {
  path?: string
}

function toCanonicalUserFile(fileRecord: WorkspaceFileRecord, base64: string): UserFileLike {
  return {
    id: fileRecord.id,
    name: fileRecord.name,
    url: fileRecord.url ?? fileRecord.path,
    key: fileRecord.key,
    size: fileRecord.size,
    type: fileRecord.type,
    context: 'workspace',
    base64,
  }
}

async function loadCanonicalWorkspaceFile(fileRecord: WorkspaceFileRecord): Promise<UserFileLike> {
  const buffer = await fetchWorkspaceFileBuffer(fileRecord)
  return toCanonicalUserFile(fileRecord, buffer.toString('base64'))
}

/**
 * Resolves an editable media file using the displayed storage identity before legacy id fallback.
 */
export async function resolveMediaEditWorkspaceFile({
  workspaceId,
  file,
}: {
  workspaceId: string
  file: MediaEditFileInput
}): Promise<UserFileLike | null> {
  const displayKey = resolveStorageKeyFromFileInput({
    key: file.key,
    path: file.path,
    url: file.url,
  })
  const trimmedId = file.id?.trim() ?? ''

  if (displayKey) {
    const fileByKey = await getWorkspaceFileByKey(workspaceId, displayKey)
    if (fileByKey) {
      if (trimmedId) {
        const fileById = await getWorkspaceFile(workspaceId, trimmedId)
        if (fileById && fileById.id !== fileByKey.id) {
          logger.warn('Media edit file id does not match displayed storage key; using key record', {
            workspaceId,
            fileId: trimmedId,
            fileIdKey: fileById.key,
            displayedKey: displayKey,
            displayedFileId: fileByKey.id,
          })
        }
      }

      return loadCanonicalWorkspaceFile(fileByKey)
    }
  }

  if (!trimmedId) {
    return null
  }

  const fileById = await getWorkspaceFile(workspaceId, trimmedId)
  return fileById ? loadCanonicalWorkspaceFile(fileById) : null
}
