'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  eraseWorkspaceImageContract,
  type ImageGenerationResolution,
} from '@/lib/api/contracts/media-images'
import { resolveUserFileUrl } from '@/lib/core/utils/user-file'
import type { ExportedMaskImage } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-mask-editor-overlay'

interface UploadedFileValue {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
}

interface SubmitEraseParams {
  mask: ExportedMaskImage
  resolution: ImageGenerationResolution
}

interface UseImageEraseSessionParams {
  workspaceId?: string
  sourceFile: UploadedFileValue
  onCreateVariant: (file: UploadedFileValue) => Promise<void> | void
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'Erase failed. Please try again.'
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

export function useImageEraseSession({
  workspaceId,
  sourceFile,
  onCreateVariant,
}: UseImageEraseSessionParams) {
  const abortControllerRef = useRef<AbortController | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const normalizedSourceFile = useMemo(() => normalizeFile(sourceFile), [sourceFile])
  const disabledReason = !workspaceId
    ? 'Missing workspace context.'
    : !normalizedSourceFile.key
      ? 'Source image is missing file information.'
      : null

  const abort = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }, [])

  useEffect(() => abort, [abort])

  const submit = useCallback(
    async ({ mask, resolution }: SubmitEraseParams) => {
      if (disabledReason || !workspaceId) {
        setError(disabledReason ?? 'Unable to submit erase.')
        return
      }

      abort()
      const abortController = new AbortController()
      abortControllerRef.current = abortController
      setIsSubmitting(true)
      setError(null)

      try {
        const response = await requestJson(eraseWorkspaceImageContract, {
          body: {
            workspaceId,
            sourceImage: normalizedSourceFile,
            maskImage: {
              id: '',
              name: 'erase-mask.png',
              url: '',
              key: 'erase-mask.png',
              size: mask.size,
              type: 'image/png',
              base64: mask.base64,
            },
            resolution,
          },
          signal: abortController.signal,
        })

        await onCreateVariant(mapGeneratedFile(response.file))
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
