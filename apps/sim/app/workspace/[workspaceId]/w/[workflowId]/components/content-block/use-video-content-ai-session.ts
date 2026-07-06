'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import type { ContentCanvasModelAvailabilitySnapshot } from '@/lib/api/contracts/content-canvas'
import { generateWorkspaceVideoContract } from '@/lib/api/contracts/media-videos'
import {
  getVideoDurationOptions,
  getVideoFrameAspectRatioOptions,
  getVideoGenerationModelFamilyOptions,
  getVideoResolutionOptions,
  resolveVideoGenerationModelId,
  type VideoFrameAspectRatioPreset,
  type VideoModelFamily,
  type VideoResolution,
} from '@/lib/generated-media/video/video-generation-utils'

interface UploadedFileValue {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
}

interface UseVideoContentAiSessionOptions {
  blockId: string
  workspaceId?: string
  prompt: string
  modelFamily: VideoModelFamily
  availability?: ContentCanvasModelAvailabilitySnapshot | null
  aspectRatioPreset: VideoFrameAspectRatioPreset
  resolution: VideoResolution
  durationSeconds: number
  firstFrameFile: UploadedFileValue | null
  lastFrameFile: UploadedFileValue | null
  referenceContextText?: string
  onChangeFile: (value: UploadedFileValue | null) => void
  onGenerationComplete?: () => void
  onGenerationError?: (message: string) => void
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return '视频生成失败，请稍后重试。'
}

function toRequestFile(file: UploadedFileValue | null, fallbackName: string) {
  if (!file?.path || !file?.key) return null

  return {
    id: file.id ?? '',
    name: file.name ?? fallbackName,
    url: file.path,
    key: file.key,
    size: file.size ?? 0,
    type: file.type ?? 'image/png',
    context: file.context,
  }
}

export function useVideoContentAiSession({
  blockId,
  workspaceId,
  prompt,
  modelFamily,
  availability,
  aspectRatioPreset,
  resolution,
  durationSeconds,
  firstFrameFile,
  lastFrameFile,
  referenceContextText,
  onChangeFile,
  onGenerationComplete,
  onGenerationError,
}: UseVideoContentAiSessionOptions) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSequenceRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  const modelOptions = useMemo(
    () => getVideoGenerationModelFamilyOptions(availability?.video.enabledModelIds),
    [availability?.video.enabledModelIds]
  )
  const aspectRatioOptions = useMemo(() => getVideoFrameAspectRatioOptions(), [])
  const resolutionOptions = useMemo(() => getVideoResolutionOptions(), [])
  const durationOptions = useMemo(() => getVideoDurationOptions(), [])

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
    setError(null)
  }, [
    aspectRatioPreset,
    durationSeconds,
    firstFrameFile?.key,
    firstFrameFile?.path,
    lastFrameFile?.key,
    lastFrameFile?.path,
    modelFamily,
    prompt,
    referenceContextText,
    resolution,
  ])

  const submitPrompt = useCallback(async () => {
    const trimmedPrompt = prompt.trim()
    const trimmedReferenceContext = referenceContextText?.trim()
    const nextPrompt = [trimmedPrompt, trimmedReferenceContext].filter(Boolean).join('\n\n')
    if (!nextPrompt) {
      setError('请输入提示词。')
      return
    }
    if (!workspaceId) {
      setError('缺少工作区上下文。')
      return
    }

    const firstFrame = toRequestFile(firstFrameFile, 'first-frame.png')
    const lastFrame = toRequestFile(lastFrameFile, 'last-frame.png')
    const resolvedModel = resolveVideoGenerationModelId({
      modelFamily,
      hasFirstFrame: Boolean(firstFrame),
    })

    if (resolvedModel === 'wan2.7-i2v' && !firstFrame) {
      setError('Wan 2.7 首尾帧模式需要先选择首帧。')
      return
    }

    if (resolvedModel === 'wan2.7-i2v' && !lastFrame) {
      setError('Wan 2.7 首尾帧模式需要先选择尾帧。')
      return
    }

    const media =
      resolvedModel === 'wan2.7-i2v'
        ? [
            { type: 'first_frame' as const, file: firstFrame! },
            { type: 'last_frame' as const, file: lastFrame! },
          ]
        : resolvedModel === 'wan2.6-i2v-flash'
          ? [{ type: 'first_frame' as const, file: firstFrame! }]
          : []

    const requestId = requestSequenceRef.current + 1
    requestSequenceRef.current = requestId
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsGenerating(true)
    setError(null)

    try {
      const response = await requestJson(generateWorkspaceVideoContract, {
        body: {
          workspaceId,
          model: resolvedModel,
          prompt: nextPrompt,
          media,
          parameters: {
            aspectRatioPreset,
            resolution,
            duration: durationSeconds,
            promptExtend: true,
            watermark: false,
          },
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
        context: response.file.context,
      })
      onGenerationComplete?.()
    } catch (caughtError) {
      if (controller.signal.aborted) return
      if (requestSequenceRef.current !== requestId) return
      const message = getErrorMessage(caughtError)
      setError(message)
      onGenerationError?.(message)
    } finally {
      if (requestSequenceRef.current === requestId) {
        setIsGenerating(false)
      }
    }
  }, [
    aspectRatioPreset,
    durationSeconds,
    firstFrameFile,
    lastFrameFile,
    modelFamily,
    onChangeFile,
    onGenerationComplete,
    onGenerationError,
    prompt,
    referenceContextText,
    resolution,
    workspaceId,
  ])

  return {
    modelOptions,
    aspectRatioOptions,
    resolutionOptions,
    durationOptions,
    isGenerating,
    error,
    submitPrompt,
  }
}
