'use client'

import type { ReactNode, SyntheticEvent } from 'react'
import { useState } from 'react'
import { Check, Music4, Settings2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'
import {
  AUDIO_MODE_OPTIONS,
  AUDIO_VOICE_MODE_OPTIONS,
  type AudioGenerationModelId,
  type AudioGenerationParametersValue,
  buildAudioGenerationSummary,
} from '@/lib/generated-media/audio/audio-generation-utils'
import {
  ComposerSendButton,
  ContentAiComposerShell,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-ai-composer-shell'

interface AudioContentAiComposerProps {
  canEdit: boolean
  selected: boolean
  prompt: string
  model: AudioGenerationModelId
  parameters: AudioGenerationParametersValue
  isGenerating: boolean
  error: string | null
  header?: ReactNode
  modelOptions: ReadonlyArray<{
    id: AudioGenerationModelId
    label: string
    description: string
    disabledReason?: string | null
  }>
  onChangePrompt: (value: string) => void
  onChangeModel: (value: AudioGenerationModelId) => void
  onChangeParameters: (value: AudioGenerationParametersValue) => void
  onSubmit: () => void
}

function stopEvent(event: SyntheticEvent<HTMLElement>) {
  event.stopPropagation()
}

function SegmentButton({
  active,
  disabled,
  label,
  onClick,
  icon,
}: {
  active: boolean
  disabled: boolean
  label: string
  onClick: () => void
  icon?: ReactNode
}) {
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      className={cn(
        'flex min-w-0 items-center justify-center gap-1 rounded-[14px] px-3 py-2 text-xs transition-colors',
        active
          ? 'bg-[var(--surface-5)] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
          : 'text-[var(--text-muted)] hover-hover:bg-[var(--surface-3)]',
        disabled && 'cursor-not-allowed opacity-60'
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function SegmentedControl({
  label,
  options,
  value,
  disabled,
  icon,
  onChange,
}: {
  label: string
  options: ReadonlyArray<{ id: string; label: string }>
  value: string
  disabled: boolean
  icon?: ReactNode
  onChange: (value: string) => void
}) {
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center gap-1 text-[var(--text-secondary)] text-xs'>
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={cn(
          'grid rounded-[18px] bg-[var(--surface-1)] p-1',
          options.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
        )}
      >
        {options.map((option) => (
          <SegmentButton
            key={option.id}
            active={value === option.id}
            disabled={disabled}
            label={option.label}
            onClick={() => onChange(option.id)}
          />
        ))}
      </div>
    </div>
  )
}

function PanelInput({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className='flex flex-col gap-2'>
      <span className='text-[var(--text-secondary)] text-xs'>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onPointerDown={stopEvent}
        onClick={stopEvent}
        disabled={disabled}
        placeholder={placeholder}
        className='rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[var(--text-primary)] text-sm outline-none placeholder:text-[var(--text-subtle)] disabled:cursor-not-allowed disabled:opacity-60'
      />
    </label>
  )
}

export function AudioContentAiComposer({
  canEdit,
  selected,
  prompt,
  model,
  parameters,
  isGenerating,
  error,
  header,
  modelOptions,
  onChangePrompt,
  onChangeModel,
  onChangeParameters,
  onSubmit,
}: AudioContentAiComposerProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  const summary = buildAudioGenerationSummary({
    customMode: parameters.customMode,
    instrumental: parameters.instrumental,
    hasPrompt: prompt.trim().length > 0,
    hasStyle: parameters.style.trim().length > 0,
  })

  return (
    <ContentAiComposerShell
      canEdit={canEdit}
      selected={selected}
      prompt={prompt}
      placeholder={
        parameters.customMode
          ? '输入歌词，让 Suno 生成一段歌曲音频...'
          : '输入歌曲描述，让 Suno 生成一段歌曲音频...'
      }
      isGenerating={isGenerating}
      loadingLabel='AI 正在生成音频...'
      error={error}
      header={header}
      afterFooter={
        settingsOpen ? (
          <div className='border-[var(--border)] border-t bg-[var(--surface-1)] px-4 py-4'>
            <div className='flex flex-col gap-4'>
              <div className='flex items-center justify-between gap-3'>
                <div>
                  <div className='font-medium text-[var(--text-primary)] text-sm'>Suno 参数</div>
                  <div className='mt-1 text-[11px] text-[var(--text-muted)]'>
                    {parameters.customMode
                      ? '当前主输入框会作为歌词提交。'
                      : '当前主输入框会作为歌曲描述提交。'}
                  </div>
                </div>
                <button
                  type='button'
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setSettingsOpen(false)
                  }}
                  className='rounded-full border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover-hover:bg-[var(--surface-3)]'
                >
                  关闭
                </button>
              </div>

              <SegmentedControl
                label='模式'
                disabled={!canEdit || isGenerating}
                value={parameters.customMode ? 'custom' : 'simple'}
                icon={<Sparkles className='h-3.5 w-3.5' />}
                onChange={(value) =>
                  onChangeParameters({
                    ...parameters,
                    customMode: value === 'custom',
                  })
                }
                options={AUDIO_MODE_OPTIONS}
              />

              <SegmentedControl
                label='器乐'
                disabled={!canEdit || isGenerating}
                value={parameters.instrumental ? 'instrumental' : 'vocal'}
                icon={<Music4 className='h-3.5 w-3.5' />}
                onChange={(value) =>
                  onChangeParameters({
                    ...parameters,
                    instrumental: value === 'instrumental',
                  })
                }
                options={AUDIO_VOICE_MODE_OPTIONS}
              />

              {parameters.customMode ? (
                <div className='grid gap-3'>
                  <PanelInput
                    label='风格（Style）'
                    value={parameters.style}
                    placeholder='例如：Dreamy indie pop, lush synths, warm chorus'
                    disabled={!canEdit || isGenerating}
                    onChange={(value) => onChangeParameters({ ...parameters, style: value })}
                  />
                  <PanelInput
                    label='标题（Title）'
                    value={parameters.title}
                    placeholder='输入歌曲标题'
                    disabled={!canEdit || isGenerating}
                    onChange={(value) => onChangeParameters({ ...parameters, title: value })}
                  />
                  <PanelInput
                    label='排除标签（Exclude）'
                    value={parameters.negativeTags}
                    placeholder='例如：metal, scream, low quality'
                    disabled={!canEdit || isGenerating}
                    onChange={(value) => onChangeParameters({ ...parameters, negativeTags: value })}
                  />
                  <PanelInput
                    label='演唱性别'
                    value={parameters.vocalGender}
                    placeholder='例如：female / male'
                    disabled={!canEdit || isGenerating}
                    onChange={(value) => onChangeParameters({ ...parameters, vocalGender: value })}
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null
      }
      onChangePrompt={onChangePrompt}
      onSubmit={onSubmit}
      footer={
        <div className='flex items-center justify-between gap-3'>
          <div className='flex min-w-0 items-center gap-2'>
            <label className='flex min-w-0 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-[var(--text-secondary)] text-xs'>
              <Sparkles className='h-3.5 w-3.5 shrink-0 text-[#F4B740]' />
              <select
                value={model}
                onChange={(event) => onChangeModel(event.target.value as AudioGenerationModelId)}
                onPointerDown={stopEvent}
                onClick={stopEvent}
                onFocus={stopEvent}
                disabled={!canEdit || isGenerating}
                className='max-w-[140px] truncate bg-transparent outline-none'
              >
                {modelOptions.map((option) => (
                  <option
                    key={option.id}
                    value={option.id}
                    disabled={Boolean(option.disabledReason)}
                  >
                    {option.label}
                    {option.disabledReason ? ' (Unavailable)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <button
              type='button'
              disabled={!canEdit || isGenerating}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setSettingsOpen((current) => !current)
              }}
              className={cn(
                'flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-xs transition-colors',
                !canEdit || isGenerating
                  ? 'cursor-not-allowed text-[var(--text-muted)]'
                  : 'text-[var(--text-secondary)] hover-hover:bg-[var(--surface-3)] hover-hover:text-[var(--text-primary)]'
              )}
            >
              <Settings2 className='h-3.5 w-3.5 text-[#8DD8FF]' />
              <span>{summary}</span>
              {settingsOpen ? <Check className='h-3.5 w-3.5 text-[#F4B740]' /> : null}
            </button>
          </div>

          <ComposerSendButton
            canEdit={canEdit}
            isGenerating={isGenerating}
            onSubmit={onSubmit}
            ariaLabel='Generate audio with AI'
          />
        </div>
      }
    />
  )
}
