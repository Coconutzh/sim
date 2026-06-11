'use client'

import { useCallback, useEffect, useRef } from 'react'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { cutoutWorkspaceImageContract } from '@/lib/api/contracts/media-images'
import { resolveUserFileUrl } from '@/lib/core/utils/user-file'

interface UploadedFileValue {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
}

interface StartImageCutoutParams {
  targetBlockId: string
  sourceFile: UploadedFileValue
}

interface UseImageCutoutSessionParams {
  workspaceId?: string
  onPending: (targetBlockId: string) => void
  onComplete: (targetBlockId: string, file: UploadedFileValue) => void
  onError: (targetBlockId: string, message: string) => void
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '抠图失败，请稍后重试。'
}

function normalizeFile(file: UploadedFileValue) {
  const key = file.key?.trim() ?? ''
  const name = file.name?.trim() || key || 'image.png'

  return {
    id: file.id ?? '',
    name,
    url: resolveUserFileUrl(file),
    key,
    size: file.size ?? 0,
    type: file.type ?? 'image/png',
    context: file.context,
  }
}

function mapGeneratedFile(file: {
  id: string
  name: string
  url: string
  key: string
  size: number
  type: string
  context?: string
}): UploadedFileValue {
  return {
    id: file.id,
    name: file.name,
    path: file.url,
    key: file.key,
    size: file.size,
    type: file.type,
    context: file.context,
  }
}

export function useImageCutoutSession({
  workspaceId,
  onPending,
  onComplete,
  onError,
}: UseImageCutoutSessionParams) {
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())

  useEffect(() => {
    return () => {
      for (const abortController of abortControllersRef.current.values()) {
        abortController.abort()
      }
      abortControllersRef.current.clear()
    }
  }, [])

  return useCallback(
    async ({ targetBlockId, sourceFile }: StartImageCutoutParams) => {
      const previousController = abortControllersRef.current.get(targetBlockId)
      previousController?.abort()

      onPending(targetBlockId)

      if (!workspaceId) {
        onError(targetBlockId, '缺少工作区上下文。')
        return
      }

      const normalizedSourceFile = normalizeFile(sourceFile)
      if (!normalizedSourceFile.key) {
        onError(targetBlockId, '源图片缺少文件信息。')
        return
      }

      const abortController = new AbortController()
      abortControllersRef.current.set(targetBlockId, abortController)

      try {
        const response = await requestJson(cutoutWorkspaceImageContract, {
          body: {
            workspaceId,
            sourceImage: normalizedSourceFile,
          },
          signal: abortController.signal,
        })

        onComplete(targetBlockId, mapGeneratedFile(response.file))
      } catch (caughtError) {
        if (!abortController.signal.aborted) {
          onError(targetBlockId, getErrorMessage(caughtError))
        }
      } finally {
        if (abortControllersRef.current.get(targetBlockId) === abortController) {
          abortControllersRef.current.delete(targetBlockId)
        }
      }
    },
    [onComplete, onError, onPending, workspaceId]
  )
}
