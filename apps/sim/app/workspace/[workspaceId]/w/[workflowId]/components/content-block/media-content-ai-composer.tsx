'use client'

import type { ReactNode } from 'react'
import { ImageIcon, Sparkles } from 'lucide-react'
import type {
  ImageAspectRatioValue,
  ImageGenerationModelId,
} from '@/lib/generated-media/image/image-generation-utils'
import {
  ComposerSendButton,
  ContentAiComposerShell,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-ai-composer-shell'

interface MediaContentAiComposerProps {
  canEdit: boolean
  selected: boolean
  prompt: string
  model: ImageGenerationModelId
  aspectRatio: ImageAspectRatioValue
  isGenerating: boolean
  error: string | null
  header?: ReactNode
  modelOptions: ReadonlyArray<{
    id: ImageGenerationModelId
    label: string
    description: string
    disabledReason?: string | null
  }>
  aspectRatioOptions: ReadonlyArray<{
    id: ImageAspectRatioValue
    label: string
  }>
  onChangePrompt: (value: string) => void
  onChangeModel: (value: ImageGenerationModelId) => void
  onChangeAspectRatio: (value: ImageAspectRatioValue) => void
  onSubmit: () => void
}

export function MediaContentAiComposer({
  canEdit,
  selected,
  prompt,
  model,
  aspectRatio,
  isGenerating,
  error,
  header,
  modelOptions,
  aspectRatioOptions,
  onChangePrompt,
  onChangeModel,
  onChangeAspectRatio,
  onSubmit,
}: MediaContentAiComposerProps) {
  return (
    <ContentAiComposerShell
      canEdit={canEdit}
      selected={selected}
      prompt={prompt}
      placeholder='输入提示词，让 AI 直接为这个图片卡片生成一张新图...'
      isGenerating={isGenerating}
      loadingLabel='AI 正在生成图片...'
      error={error}
      header={header}
      onChangePrompt={onChangePrompt}
      onSubmit={onSubmit}
      footer={
        <div className='flex items-center justify-between gap-3'>
          <div className='flex min-w-0 items-center gap-2'>
            <label className='flex min-w-0 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-[var(--text-secondary)] text-xs'>
              <Sparkles className='h-3.5 w-3.5 shrink-0 text-[#F4B740]' />
              <select
                value={model}
                onChange={(event) => onChangeModel(event.target.value as ImageGenerationModelId)}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                disabled={!canEdit || isGenerating}
                className='max-w-[220px] truncate bg-transparent outline-none'
                onFocus={(event) => event.stopPropagation()}
              >
                {modelOptions.map((option) => (
                  <option
                    key={option.id}
                    value={option.id}
                    disabled={Boolean(option.disabledReason)}
                  >
                    {option.label} - {option.description}
                    {option.disabledReason ? ' (Unavailable)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className='flex min-w-0 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-[var(--text-secondary)] text-xs'>
              <ImageIcon className='h-3.5 w-3.5 shrink-0 text-[#8DD8FF]' />
              <select
                value={aspectRatio}
                onChange={(event) =>
                  onChangeAspectRatio(event.target.value as ImageAspectRatioValue)
                }
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                disabled={!canEdit || isGenerating}
                className='max-w-[120px] truncate bg-transparent outline-none'
                onFocus={(event) => event.stopPropagation()}
              >
                {aspectRatioOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ComposerSendButton
            canEdit={canEdit}
            isGenerating={isGenerating}
            onSubmit={onSubmit}
            ariaLabel='Generate image with AI'
          />
        </div>
      }
    />
  )
}
