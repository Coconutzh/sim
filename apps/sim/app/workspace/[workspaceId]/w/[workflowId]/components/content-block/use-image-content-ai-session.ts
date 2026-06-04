'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { generateWorkspaceImageContract } from '@/lib/api/contracts/media-images'
import {
  getImageAspectRatioOptions,
  getImageGenerationModelOptions,
  type ImageAspectRatioValue,
  type ImageGenerationModelId,
} from '@/lib/generated-media/image/image-generation-utils'

interface UploadedFileValue {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
}

interface UseImageContentAiSessionOptions {
  blockId: string
  workspaceId?: string
  prompt: string
  model: ImageGenerationModelId
  aspectRatio: ImageAspectRatioValue
  referenceContext?: {
    text: string[]
    images: Array<{
      id?: string
      name: string
      url?: string
      key: string
      size: number
      type?: string
      context?: string
      base64?: string
    }>
  }
  onChangeFile: (value: UploadedFileValue | null) => void
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return '图片生成失败，请稍后重试。'
}

export function useImageContentAiSession({
  blockId,
  workspaceId,
  prompt,
  model,
  aspectRatio,
  referenceContext,
  onChangeFile,
}: UseImageContentAiSessionOptions) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSequenceRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  const modelOptions = useMemo(() => getImageGenerationModelOptions(), [])
  const aspectRatioOptions = useMemo(() => getImageAspectRatioOptions(), [])

  useEffect(() => {
    setError(null)
    setIsGenerating(false)
    requestSequenceRef.current = 0
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }, [blockId])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (error) {
      setError(null)
    }
  }, [aspectRatio, error, model, prompt])

  const submitPrompt = useCallback(async () => {
    const nextPrompt = prompt.trim()
    if (!nextPrompt) {
      setError('请输入提示词。')
      return
    }
    if (!workspaceId) {
      setError('缺少工作区上下文。')
      return
    }

    const requestId = requestSequenceRef.current + 1
    requestSequenceRef.current = requestId
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsGenerating(true)
    setError(null)

    try {
      const response = await requestJson(generateWorkspaceImageContract, {
        body: {
          workspaceId,
          model,
          prompt: nextPrompt,
          aspectRatio,
          referenceContext,
        },
        signal: controller.signal,
      })

      if (requestSequenceRef.current !== requestId) return

      onChangeFile({
        id: response.file.id,
        name: response.file.name,
        path: response.file.url,
        key: response.file.key,
        size: response.file.size,
        type: response.file.type,
      })
    } catch (caughtError) {
      if (controller.signal.aborted) return
      if (requestSequenceRef.current !== requestId) return
      setError(getErrorMessage(caughtError))
    } finally {
      if (requestSequenceRef.current === requestId) {
        setIsGenerating(false)
      }
    }
  }, [aspectRatio, model, onChangeFile, prompt, referenceContext, workspaceId])

  return {
    modelOptions,
    aspectRatioOptions,
    isGenerating,
    error,
    submitPrompt,
  }
}
