'use client'

import type { ReactNode, SyntheticEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Check, Clock3, ImageIcon, Settings2, Sparkles, Volume2, X } from 'lucide-react'
import { toast } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { resolveUserFileUrl } from '@/lib/core/utils/user-file'
import {
  buildVideoGenerationSummary,
  type VideoFrameAspectRatioPreset,
  type VideoModelFamily,
  type VideoResolution,
} from '@/lib/generated-media/video/video-generation-utils'
import {
  ComposerSendButton,
  ContentAiComposerShell,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-ai-composer-shell'

interface UploadedFileValue {
  name?: string
  path?: string
  url?: string
  key?: string
  size?: number
  type?: string
}

interface VideoContentAiComposerProps {
  canEdit: boolean
  selected: boolean
  header?: ReactNode
  prompt: string
  modelFamily: VideoModelFamily
  aspectRatioPreset: VideoFrameAspectRatioPreset
  resolution: VideoResolution
  durationSeconds: number
  firstFrameFile: UploadedFileValue | null
  lastFrameFile: UploadedFileValue | null
  isGenerating: boolean
  error: string | null
  isSelectingFrame: boolean
  selectedFrameSlot: 'first' | 'last' | null
  modelOptions: ReadonlyArray<{
    id: VideoModelFamily
    label: string
    description: string
    disabledReason?: string | null
  }>
  aspectRatioOptions: ReadonlyArray<{
    id: VideoFrameAspectRatioPreset
    label: string
  }>
  resolutionOptions: ReadonlyArray<{
    id: VideoResolution
    label: string
  }>
  durationOptions: ReadonlyArray<{
    id: number
    label: string
  }>
  onChangePrompt: (value: string) => void
  onChangeModelFamily: (value: VideoModelFamily) => void
  onChangeAspectRatioPreset: (value: VideoFrameAspectRatioPreset) => void
  onChangeResolution: (value: VideoResolution) => void
  onChangeDurationSeconds: (value: number) => void
  onSelectFrame: (slot: 'first' | 'last') => void
  onClearFrame: (slot: 'first' | 'last') => void
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
  icon?: React.ReactNode
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

function FrameSlotChip({
  label,
  file,
  active,
  disabled,
  onSelect,
  onClear,
}: {
  label: string
  file: UploadedFileValue | null
  active: boolean
  disabled: boolean
  onSelect: () => void
  onClear: () => void
}) {
  const previewPath = resolveUserFileUrl(file)

  return (
    <button
      type='button'
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onSelect()
      }}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      className={cn(
        'relative flex min-w-[88px] items-center gap-2 rounded-[14px] border px-2.5 py-2 text-left transition-colors',
        active
          ? 'border-[#F4B740] bg-[#2A2417]'
          : 'border-[var(--border)] bg-[var(--surface-1)] hover-hover:bg-[var(--surface-3)]',
        disabled && 'cursor-not-allowed opacity-60'
      )}
    >
      {previewPath ? (
        <div className='h-9 w-9 overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)]'>
          <img src={previewPath} alt={file?.name || label} className='h-full w-full object-cover' />
        </div>
      ) : (
        <div className='flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border)] border-dashed bg-[var(--surface-2)] text-[11px] text-[var(--text-primary)]'>
          +
        </div>
      )}

      <div className='min-w-0'>
        <div className='text-[11px] text-[var(--text-muted)]'>{label}</div>
        <div className='max-w-[88px] truncate text-[12px] text-[var(--text-primary)]'>
          {file?.name || '从画布选择'}
        </div>
      </div>

      {previewPath ? (
        <span
          role='button'
          tabIndex={-1}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onClear()
          }}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          className='absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--surface-5)] text-[var(--text-primary)]'
        >
          <X className='h-3 w-3' />
        </span>
      ) : null}
    </button>
  )
}

function LockedToggle({
  label,
  enabled,
  description,
}: {
  label: string
  enabled: boolean
  description: string
}) {
  return (
    <div className='flex items-center justify-between rounded-[18px] bg-[var(--surface-1)] px-3 py-2.5'>
      <div>
        <div className='flex items-center gap-1 text-[var(--text-primary)] text-xs'>
          <Volume2 className='h-3.5 w-3.5 text-[var(--text-secondary)]' />
          <span>{label}</span>
        </div>
        <div className='mt-1 text-[11px] text-[var(--text-muted)]'>{description}</div>
      </div>
      <div className='rounded-full bg-[var(--surface-2)] p-1'>
        <div
          className={cn(
            'flex min-w-[72px] items-center justify-center rounded-full px-3 py-1.5 text-xs',
            enabled
              ? 'bg-[var(--surface-5)] text-[var(--text-primary)]'
              : 'text-[var(--text-muted)]'
          )}
        >
          {enabled ? '开启' : '关闭'}
        </div>
      </div>
    </div>
  )
}

export function VideoContentAiComposer({
  canEdit,
  selected,
  header,
  prompt,
  modelFamily,
  aspectRatioPreset,
  resolution,
  durationSeconds,
  firstFrameFile,
  lastFrameFile,
  isGenerating,
  error,
  isSelectingFrame,
  selectedFrameSlot,
  modelOptions,
  aspectRatioOptions,
  resolutionOptions,
  durationOptions,
  onChangePrompt,
  onChangeModelFamily,
  onChangeAspectRatioPreset,
  onChangeResolution,
  onChangeDurationSeconds,
  onSelectFrame,
  onClearFrame,
  onSubmit,
}: VideoContentAiComposerProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    if (isSelectingFrame) {
      setSettingsOpen(true)
    }
  }, [isSelectingFrame])

  const isWan26 = modelFamily === 'wan2.6'
  const hasFirstFrame = Boolean(firstFrameFile?.path)
  const summary = buildVideoGenerationSummary({
    modelFamily,
    aspectRatioPreset,
    resolution,
    durationSeconds,
    hasFirstFrame,
  })

  const frameSlots = useMemo(
    () =>
      isWan26
        ? [{ slot: 'first' as const, label: '首帧', file: firstFrameFile }]
        : [
            { slot: 'first' as const, label: '首帧', file: firstFrameFile },
            { slot: 'last' as const, label: '尾帧', file: lastFrameFile },
          ],
    [firstFrameFile, isWan26, lastFrameFile]
  )

  const handleSelectFrame = (slot: 'first' | 'last') => {
    const slotLabel = slot === 'first' ? '首帧' : '尾帧'
    setSettingsOpen(true)
    toast({
      message: `请从画布选择一张图片作为${slotLabel}，按 Esc 取消`,
      duration: 3200,
    })
    onSelectFrame(slot)
  }

  const compactDurationOptions = durationOptions.map((option) => ({
    id: String(option.id),
    label: option.label,
  }))

  return (
    <ContentAiComposerShell
      canEdit={canEdit}
      selected={selected}
      prompt={prompt}
      placeholder='输入提示词，让 AI 为这个视频节点生成一段视频...'
      isGenerating={isGenerating}
      loadingLabel='AI 正在生成视频...'
      error={error}
      widthClassName='w-[520px]'
      header={
        <div className='flex flex-col gap-3'>
          {header}
          <div className='flex items-start justify-between gap-3'>
            <div className='flex flex-wrap items-center gap-2'>
              {frameSlots.map((frameSlot) => (
                <FrameSlotChip
                  key={frameSlot.slot}
                  label={frameSlot.label}
                  file={frameSlot.file}
                  active={selectedFrameSlot === frameSlot.slot}
                  disabled={!canEdit || isGenerating}
                  onSelect={() => handleSelectFrame(frameSlot.slot)}
                  onClear={() => onClearFrame(frameSlot.slot)}
                />
              ))}
            </div>

            {isSelectingFrame ? (
              <div className='rounded-full border border-[#5F4720] bg-[#2D2418] px-2.5 py-1 text-[#F4C86A] text-[11px]'>
                {selectedFrameSlot === 'last' ? '选择尾帧中' : '选择首帧中'}
              </div>
            ) : null}
          </div>
        </div>
      }
      afterFooter={
        settingsOpen ? (
          <div className='border-[var(--border)] border-t bg-[var(--surface-1)] px-4 py-4'>
            <div className='flex flex-col gap-4'>
              <div className='flex items-center justify-between gap-3'>
                <div>
                  <div className='font-medium text-[var(--text-primary)] text-sm'>
                    {isWan26 ? 'Wan 2.6 参数' : 'Wan 2.7 参数'}
                  </div>
                  <div className='mt-1 text-[11px] text-[var(--text-muted)]'>
                    {isWan26
                      ? hasFirstFrame
                        ? '当前将使用首帧参考模式。'
                        : '当前将使用纯文本模式。'
                      : '当前仅支持首尾帧生成模式。'}
                  </div>
                </div>

                <button
                  type='button'
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (!isSelectingFrame) setSettingsOpen(false)
                  }}
                  disabled={isSelectingFrame}
                  className={cn(
                    'rounded-full border border-[var(--border)] px-2 py-1 text-[11px] transition-colors',
                    isSelectingFrame
                      ? 'cursor-not-allowed text-[var(--text-muted)]'
                      : 'text-[var(--text-secondary)] hover-hover:bg-[var(--surface-3)]'
                  )}
                >
                  收起
                </button>
              </div>

              <div className='flex flex-col gap-4'>
                <SegmentedControl
                  label='生成方式'
                  disabled={true}
                  value={isWan26 ? (hasFirstFrame ? 'i2v' : 't2v') : 'first_last'}
                  onChange={() => {}}
                  options={
                    isWan26
                      ? [
                          {
                            id: hasFirstFrame ? 'i2v' : 't2v',
                            label: hasFirstFrame ? '首帧参考' : '纯文本',
                          },
                          { id: 'auto', label: '自动' },
                          { id: 'locked', label: '已锁定' },
                        ]
                      : [
                          { id: 'first_last', label: '首尾帧' },
                          { id: 'locked-1', label: '已锁定' },
                          { id: 'locked-2', label: '已锁定' },
                        ]
                  }
                />

                <SegmentedControl
                  label='比例'
                  icon={<ImageIcon className='h-3.5 w-3.5' />}
                  options={aspectRatioOptions}
                  value={aspectRatioPreset}
                  disabled={!canEdit || isGenerating}
                  onChange={(value) =>
                    onChangeAspectRatioPreset(value as VideoFrameAspectRatioPreset)
                  }
                />

                <SegmentedControl
                  label='清晰度'
                  options={resolutionOptions}
                  value={resolution}
                  disabled={!canEdit || isGenerating}
                  onChange={(value) => onChangeResolution(value as VideoResolution)}
                />

                <div className='flex flex-col gap-2'>
                  <div className='flex items-center gap-1 text-[var(--text-secondary)] text-xs'>
                    <Clock3 className='h-3.5 w-3.5' />
                    <span>生成时长</span>
                  </div>
                  <label className='rounded-[18px] bg-[var(--surface-1)] px-3 py-2'>
                    <select
                      value={durationSeconds}
                      onChange={(event) => onChangeDurationSeconds(Number(event.target.value))}
                      onPointerDown={stopEvent}
                      onClick={stopEvent}
                      disabled={!canEdit || isGenerating}
                      className='w-full bg-transparent text-[var(--text-primary)] text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60'
                    >
                      {compactDurationOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <LockedToggle
                  label='生成音频'
                  enabled={isWan26}
                  description={
                    isWan26 ? 'Wan 2.6 当前默认生成音频。' : 'Wan 2.7 首尾帧模式暂不支持音频。'
                  }
                />

                {isSelectingFrame ? (
                  <div className='rounded-[16px] border border-[#5F4720] bg-[#2D2418] px-3 py-2 text-[#F4C86A] text-[11px]'>
                    {selectedFrameSlot === 'last'
                      ? '请从画布选择一张图片作为尾帧，按 Esc 取消。'
                      : '请从画布选择一张图片作为首帧，按 Esc 取消。'}
                  </div>
                ) : null}
              </div>
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
                value={modelFamily}
                onChange={(event) => onChangeModelFamily(event.target.value as VideoModelFamily)}
                onPointerDown={stopEvent}
                onClick={stopEvent}
                onFocus={stopEvent}
                disabled={!canEdit || isGenerating}
                className='max-w-[120px] truncate bg-transparent outline-none'
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
            ariaLabel='Generate video with AI'
          />
        </div>
      }
    />
  )
}
