'use client'

import type { ReactNode, SyntheticEvent } from 'react'
import { useState } from 'react'
import { Check, Music4, Settings2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'
import {
  AUDIO_MODE_OPTIONS,
  AUDIO_VOICE_MODE_OPTIONS,
  buildAudioGenerationSummary,
  type AudioGenerationModelId,
  type AudioGenerationParametersValue,
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
  modelOptions: ReadonlyArray<{
    id: AudioGenerationModelId
    label: string
    description: string
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
          ? 'bg-[#515157] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
          : 'text-[#8D939F] hover-hover:bg-white/5',
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
      <div className='flex items-center gap-1 text-[#9EA4B1] text-xs'>
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={cn(
          'grid rounded-[18px] bg-[#2F3136] p-1',
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
      <span className='text-[#9EA4B1] text-xs'>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onPointerDown={stopEvent}
        onClick={stopEvent}
        disabled={disabled}
        placeholder={placeholder}
        className='rounded-[14px] border border-white/8 bg-[#2F3136] px-3 py-2 text-sm text-[#F5F7FA] outline-none placeholder:text-[#7B8190] disabled:cursor-not-allowed disabled:opacity-60'
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
      afterFooter={
        settingsOpen ? (
          <div className='border-white/5 border-t bg-[#1B1D21] px-4 py-4'>
            <div className='flex flex-col gap-4'>
              <div className='flex items-center justify-between gap-3'>
                <div>
                  <div className='font-medium text-[#F5F7FA] text-sm'>Suno 参数</div>
                  <div className='mt-1 text-[#8D939F] text-[11px]'>
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
                  className='rounded-full border border-white/10 px-2 py-1 text-[11px] text-[#B9C0CC]'
                >
                  收起
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
                label='演唱'
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
                    label='排除项（Exclude）'
                    value={parameters.negativeTags}
                    placeholder='例如：metal, scream, low quality'
                    disabled={!canEdit || isGenerating}
                    onChange={(value) => onChangeParameters({ ...parameters, negativeTags: value })}
                  />
                  <PanelInput
                    label='人声性别'
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
            <label className='flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[#E3E7EF] text-xs'>
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
                  <option key={option.id} value={option.id}>
                    {option.label}
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
                'flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs transition-colors',
                !canEdit || isGenerating
                  ? 'cursor-not-allowed text-[#7B8190]'
                  : 'text-[#F5F7FA] hover-hover:bg-white/10'
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
