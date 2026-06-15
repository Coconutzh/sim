'use client'

import type { ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import {
  ComposerActionChip,
  ComposerSendButton,
  ContentAiComposerShell,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-ai-composer-shell'
import type { TextAiModelOption } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/text-content-ai-utils'

interface ContentNodeAiComposerProps {
  canEdit: boolean
  selected: boolean
  prompt: string
  model: string
  modelOptions: ReadonlyArray<TextAiModelOption & { disabledReason?: string | null }>
  isGenerating: boolean
  error: string | null
  hasPendingResult: boolean
  header?: ReactNode
  onChangePrompt: (value: string) => void
  onChangeModel: (value: string) => void
  onSubmit: () => void
  onReplace: () => void
  onAppend: () => void
}

export function ContentNodeAiComposer({
  canEdit,
  selected,
  prompt,
  model,
  modelOptions,
  isGenerating,
  error,
  hasPendingResult,
  header,
  onChangePrompt,
  onChangeModel,
  onSubmit,
  onReplace,
  onAppend,
}: ContentNodeAiComposerProps) {
  return (
    <ContentAiComposerShell
      canEdit={canEdit}
      selected={selected}
      prompt={prompt}
      placeholder='输入提示词，让 AI 直接帮你写进这个文本卡片...'
      isGenerating={isGenerating}
      loadingLabel='AI 正在生成内容...'
      error={error}
      header={header}
      onChangePrompt={onChangePrompt}
      onSubmit={onSubmit}
      footer={
        <div className='flex items-center justify-between gap-3'>
          <label className='flex min-w-0 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-[var(--text-secondary)] text-xs'>
            <Sparkles className='h-3.5 w-3.5 shrink-0 text-[#F4B740]' />
            <select
              value={model}
              onChange={(event) => onChangeModel(event.target.value)}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              disabled={!canEdit || isGenerating}
              className='max-w-[220px] truncate bg-transparent outline-none'
              onFocus={(event) => event.stopPropagation()}
            >
              {modelOptions.map((option) => (
                <option key={option.id} value={option.id} disabled={Boolean(option.disabledReason)}>
                  {option.label} - {option.description}
                  {option.disabledReason ? ' (Unavailable)' : ''}
                </option>
              ))}
            </select>
          </label>

          <ComposerSendButton
            canEdit={canEdit}
            isGenerating={isGenerating}
            onSubmit={onSubmit}
            ariaLabel='Generate text with AI'
          />
        </div>
      }
      afterFooter={
        hasPendingResult ? (
          <div className='flex items-center justify-between gap-3 border-[var(--border)] border-t bg-[var(--surface-1)] px-4 py-3'>
            <div className='text-[var(--text-secondary)] text-xs'>AI 内容已生成，选择写回方式</div>
            <div className='flex items-center gap-2'>
              <ComposerActionChip onClick={onReplace}>替换</ComposerActionChip>
              <ComposerActionChip onClick={onAppend}>追加</ComposerActionChip>
            </div>
          </div>
        ) : null
      }
    />
  )
}
