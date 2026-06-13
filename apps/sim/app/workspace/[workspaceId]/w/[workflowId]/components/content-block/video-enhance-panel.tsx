'use client'

import type { PointerEvent as ReactPointerEvent, SyntheticEvent } from 'react'
import { ArrowUp, ChevronDown, Loader2, Video } from 'lucide-react'
import type { GenerateWorkspaceVideoThumbnailsBody } from '@/lib/api/contracts/media-videos'
import { cn } from '@/lib/core/utils/cn'
import { useVideoEnhanceSession } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-video-enhance-session'
import {
  VIDEO_ENHANCE_FRAME_RATE_OPTIONS,
  VIDEO_ENHANCE_RESOLUTION_OPTIONS,
  VIDEO_ENHANCE_SLOW_MOTION_OPTIONS,
  type VideoEnhanceFrameRate,
  type VideoEnhanceParametersValue,
  type VideoEnhanceResolution,
  type VideoEnhanceSlowMotion,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/video-enhance-utils'

interface VideoEnhancePanelProps {
  workspaceId: string
  sourceFile: GenerateWorkspaceVideoThumbnailsBody['sourceFile'] | null
  sourceVideoUrl: string
  canEdit: boolean
  isProcessing: boolean
  error: string | null
  parameters: VideoEnhanceParametersValue
  onChangeParameters: (value: VideoEnhanceParametersValue) => void
  onSubmit: () => void
}

function stopEvent(event: SyntheticEvent<HTMLElement> | ReactPointerEvent<HTMLElement>) {
  event.stopPropagation()
}

function SelectField<TValue extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: TValue
  options: ReadonlyArray<{ id: TValue; label: string }>
  disabled: boolean
  onChange: (value: TValue) => void
}) {
  return (
    <label className='grid grid-cols-[140px_minmax(0,1fr)] items-center gap-4'>
      <span className='font-semibold text-[15px] text-white leading-tight'>{label}</span>
      <span className='nodrag nopan relative block'>
        <select
          value={value}
          disabled={disabled}
          onPointerDown={stopEvent}
          onClick={stopEvent}
          onChange={(event) => onChange(event.target.value as TValue)}
          className='nodrag nopan h-10 w-full appearance-none rounded-[18px] border border-white/55 bg-[#26272B] px-4 pr-10 font-semibold text-sm text-white outline-none transition-colors hover-hover:border-white/75 disabled:cursor-not-allowed disabled:opacity-60'
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className='-translate-y-1/2 pointer-events-none absolute top-1/2 right-3 h-4 w-4 text-white/85' />
      </span>
    </label>
  )
}

export function VideoEnhancePanel({
  workspaceId,
  sourceFile,
  sourceVideoUrl,
  canEdit,
  isProcessing,
  error,
  parameters,
  onChangeParameters,
  onSubmit,
}: VideoEnhancePanelProps) {
  const { coverUrl, coverError } = useVideoEnhanceSession({
    workspaceId,
    sourceFile,
    sourceVideoUrl,
  })
  const disabled = !canEdit || isProcessing

  return (
    <div
      className='nodrag nopan mt-3 w-[448px] max-w-[calc(100vw-48px)] rounded-[16px] bg-[#292A2F] px-4 py-4 shadow-[0_18px_44px_rgba(0,0,0,0.28)]'
      onPointerDown={stopEvent}
      onClick={stopEvent}
    >
      <div className='mb-6 flex items-center gap-2'>
        <h3 className='font-semibold text-lg text-white leading-none'>视频增强</h3>
        <span className='rounded-full bg-[#4B5161] px-3 py-1 font-medium text-[#C6CCD8] text-sm leading-none'>
          5-10 min
        </span>
      </div>

      <div className='flex flex-col gap-6'>
        <SelectField<VideoEnhanceResolution>
          label='视频高清分辨率'
          value={parameters.resolution}
          options={VIDEO_ENHANCE_RESOLUTION_OPTIONS}
          disabled={disabled}
          onChange={(resolution) => onChangeParameters({ ...parameters, resolution })}
        />
        <SelectField<VideoEnhanceFrameRate>
          label='视频帧数（可选）'
          value={parameters.frameRate}
          options={VIDEO_ENHANCE_FRAME_RATE_OPTIONS}
          disabled={disabled}
          onChange={(frameRate) => onChangeParameters({ ...parameters, frameRate })}
        />
        <SelectField<VideoEnhanceSlowMotion>
          label='视频放慢倍率（可选）'
          value={parameters.slowMotion}
          options={VIDEO_ENHANCE_SLOW_MOTION_OPTIONS}
          disabled={disabled}
          onChange={(slowMotion) => onChangeParameters({ ...parameters, slowMotion })}
        />
      </div>

      {error ? <div className='mt-4 text-[#FF8E8E] text-xs'>{error}</div> : null}

      <div className='mt-6 flex items-end justify-between gap-3'>
        <button
          type='button'
          aria-label='源视频封面'
          title='源视频封面'
          disabled={true}
          className='nodrag nopan flex h-9 w-9 items-center justify-center overflow-hidden rounded-[10px] bg-black/35 text-white/70'
          onPointerDown={stopEvent}
          onClick={stopEvent}
        >
          {coverUrl ? (
            <img src={coverUrl} alt='' aria-hidden='true' className='h-full w-full object-cover' />
          ) : coverError ? (
            <Video className='h-4 w-4' />
          ) : (
            <Loader2 className='h-4 w-4 animate-spin' />
          )}
        </button>

        <button
          type='button'
          aria-label='确认视频增强'
          title='确认视频增强'
          disabled={disabled}
          className={cn(
            'nodrag nopan flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-sm transition-colors hover-hover:bg-[#F2F3F5]',
            disabled && 'cursor-not-allowed opacity-60'
          )}
          onPointerDown={stopEvent}
          onClick={(event) => {
            event.stopPropagation()
            onSubmit()
          }}
        >
          {isProcessing ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <ArrowUp className='h-5 w-5' />
          )}
        </button>
      </div>
    </div>
  )
}
