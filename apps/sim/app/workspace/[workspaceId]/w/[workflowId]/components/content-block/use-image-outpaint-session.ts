'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type ImageGenerationResolution,
  type ImageOutpaintAspectRatio,
  outpaintWorkspaceImageContract,
} from '@/lib/api/contracts/media-images'
import { resolveUserFileUrl } from '@/lib/core/utils/user-file'
import { resolveStorageKeyFromFileInput } from '@/lib/uploads/utils/file-utils'

interface UploadedFileValue {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
}

interface OutpaintPlacement {
  x: number
  y: number
  width: number
  height: number
  canvasWidth: number
  canvasHeight: number
}

interface SubmitOutpaintParams {
  placement: OutpaintPlacement
  resolution: ImageGenerationResolution
  targetAspectRatio: ImageOutpaintAspectRatio
  customAspectRatio?: {
    width: number
    height: number
  }
  prompt?: string
}

interface UseImageOutpaintSessionParams {
  workspaceId?: string
  sourceFile: UploadedFileValue
  onCreateVariant: (
    file: UploadedFileValue,
    targetAspectRatio: ImageOutpaintAspectRatio
  ) => Promise<void> | void
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '扩图失败，请稍后重试。'
}

export function normalizeImageOutpaintFile(file: UploadedFileValue) {
  const url = resolveUserFileUrl(file)
  const key =
    resolveStorageKeyFromFileInput({
      key: file.key,
      path: file.path,
      url,
    }) ?? ''
  const name = file.name?.trim() || key || 'image.png'

  return {
    id: file.id ?? '',
    name,
    url,
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

export function useImageOutpaintSession({
  workspaceId,
  sourceFile,
  onCreateVariant,
}: UseImageOutpaintSessionParams) {
  const abortControllerRef = useRef<AbortController | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const normalizedSourceFile = normalizeImageOutpaintFile(sourceFile)
  const disabledReason = !workspaceId
    ? '缺少工作区上下文。'
    : !normalizedSourceFile.key
      ? '源图片缺少文件信息。'
      : null

  const abort = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }, [])

  useEffect(() => abort, [abort])

  const submit = useCallback(
    async ({
      placement,
      resolution,
      targetAspectRatio,
      customAspectRatio,
      prompt,
    }: SubmitOutpaintParams) => {
      if (disabledReason || !workspaceId) {
        setError(disabledReason ?? '无法提交扩图。')
        return
      }

      abort()
      const abortController = new AbortController()
      abortControllerRef.current = abortController
      setIsSubmitting(true)
      setError(null)

      try {
        const response = await requestJson(outpaintWorkspaceImageContract, {
          body: {
            workspaceId,
            sourceImage: normalizedSourceFile,
            resolution,
            targetAspectRatio,
            customAspectRatio,
            placement,
            prompt: prompt?.trim() ?? '',
          },
          signal: abortController.signal,
        })

        await onCreateVariant(mapGeneratedFile(response.file), targetAspectRatio)
      } catch (caughtError) {
        if (abortController.signal.aborted) return
        setError(getErrorMessage(caughtError))
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null
        }
        setIsSubmitting(false)
      }
    },
    [abort, disabledReason, normalizedSourceFile, onCreateVariant, workspaceId]
  )

  return {
    abort,
    disabledReason,
    error,
    isSubmitting,
    setError,
    submit,
  }
}
