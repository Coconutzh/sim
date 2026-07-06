'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import type { ContentCanvasModelAvailabilitySnapshot } from '@/lib/api/contracts/content-canvas'
import { generateWorkspaceAudioContract } from '@/lib/api/contracts/media-audios'
import type {
  AudioGenerationModelId,
  AudioGenerationParametersValue,
} from '@/lib/generated-media/audio/audio-generation-utils'
import { getAudioGenerationModelOptions } from '@/lib/generated-media/audio/audio-generation-utils'

interface UploadedFileValue {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
}

interface UseAudioContentAiSessionOptions {
  blockId: string
  workspaceId?: string
  prompt: string
  model: AudioGenerationModelId
  availability?: ContentCanvasModelAvailabilitySnapshot | null
  parameters: AudioGenerationParametersValue
  referenceContext?: {
    text: string[]
  }
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
  return '音频生成失败，请稍后重试。'
}

export function useAudioContentAiSession({
  blockId,
  workspaceId,
  prompt,
  model,
  availability,
  parameters,
  referenceContext,
  onChangeFile,
  onGenerationComplete,
  onGenerationError,
}: UseAudioContentAiSessionOptions) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSequenceRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  const modelOptions = useMemo(
    () => getAudioGenerationModelOptions(availability?.audio.enabledModelIds),
    [availability?.audio.enabledModelIds]
  )

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
  }, [
    error,
    model,
    parameters.customMode,
    parameters.instrumental,
    parameters.style,
    parameters.title,
    parameters.negativeTags,
    parameters.vocalGender,
    prompt,
  ])

  const submitPrompt = useCallback(async () => {
    const nextPrompt = prompt.trim()
    if (!nextPrompt) {
      setError(parameters.customMode ? '请输入歌词。' : '请输入歌曲描述。')
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
      const response = await requestJson(generateWorkspaceAudioContract, {
        body: {
          workspaceId,
          model,
          prompt: nextPrompt,
          parameters,
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
    model,
    onChangeFile,
    onGenerationComplete,
    onGenerationError,
    parameters,
    prompt,
    referenceContext,
    workspaceId,
  ])

  return {
    modelOptions,
    isGenerating,
    error,
    submitPrompt,
  }
}
