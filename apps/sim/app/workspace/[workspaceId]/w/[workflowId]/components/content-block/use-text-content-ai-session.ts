'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { executeProviderContract } from '@/lib/api/contracts/providers'
import {
  applyGeneratedTextToContentHtml,
  buildTextNodeAiSystemPrompt,
  DEFAULT_TEXT_AI_MODEL,
  getTextAiModelOptions,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/text-content-ai-utils'
import { getProviderFromModel } from '@/providers/models'

interface UseTextContentAiSessionOptions {
  blockId: string
  workspaceId?: string
  html: string
  prompt: string
  model: string
  onChangeHtml: (value: string) => void
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return 'AI 生成失败，请稍后重试。'
}

export function useTextContentAiSession({
  blockId,
  workspaceId,
  html,
  prompt,
  model,
  onChangeHtml,
}: UseTextContentAiSessionOptions) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingGeneratedText, setPendingGeneratedText] = useState<string | null>(null)
  const [pendingActionChoice, setPendingActionChoice] = useState(false)
  const requestSequenceRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  const modelOptions = useMemo(() => getTextAiModelOptions(), [])

  useEffect(() => {
    setError(null)
    setPendingGeneratedText(null)
    setPendingActionChoice(false)
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
  }, [model, prompt])

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

    const resolvedModel = model || DEFAULT_TEXT_AI_MODEL
    const requestId = requestSequenceRef.current + 1
    requestSequenceRef.current = requestId
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsGenerating(true)
    setError(null)
    setPendingGeneratedText(null)
    setPendingActionChoice(false)

    try {
      const response = await requestJson(executeProviderContract, {
        body: {
          workspaceId,
          provider: getProviderFromModel(resolvedModel),
          model: resolvedModel,
          systemPrompt: buildTextNodeAiSystemPrompt(),
          messages: [{ role: 'user', content: nextPrompt }],
        },
        signal: controller.signal,
      })
      if (requestSequenceRef.current !== requestId) return

      const content = response.content?.trim()
      if (!content) {
        setError('AI 没有返回可写入的内容。')
        return
      }

      setPendingGeneratedText(content)
      setPendingActionChoice(true)
    } catch (caughtError) {
      if (controller.signal.aborted) return
      if (requestSequenceRef.current !== requestId) return
      setError(getErrorMessage(caughtError))
    } finally {
      if (requestSequenceRef.current === requestId) {
        setIsGenerating(false)
      }
    }
  }, [model, prompt, workspaceId])

  const applyPendingGeneratedText = useCallback(
    (mode: 'replace' | 'append') => {
      if (!pendingGeneratedText) return
      onChangeHtml(
        applyGeneratedTextToContentHtml({
          currentHtml: html,
          generatedText: pendingGeneratedText,
          mode,
        })
      )
      setPendingGeneratedText(null)
      setPendingActionChoice(false)
      setError(null)
    },
    [html, onChangeHtml, pendingGeneratedText]
  )

  return {
    modelOptions,
    isGenerating,
    error,
    pendingGeneratedText,
    pendingActionChoice,
    submitPrompt,
    applyPendingGeneratedText,
  }
}
