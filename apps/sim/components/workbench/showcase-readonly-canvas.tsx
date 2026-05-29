'use client'

import { useMemo } from 'react'
import {
  createReadOnlyShowcaseCanvasModel,
  SHOWCASE_READ_ONLY_CANVAS_MODE,
} from '@/lib/collaboration/showcase-snapshot'
import { cn } from '@/lib/core/utils/cn'
import { PreviewWorkflow } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/preview-workflow'

interface ShowcaseReadOnlyCanvasProps {
  snapshotState: unknown
  title: string
  description?: string | null
  versionLabel: string
  className?: string
}

export function ShowcaseReadOnlyCanvas({
  snapshotState,
  title,
  description,
  versionLabel,
  className,
}: ShowcaseReadOnlyCanvasProps) {
  const canvasModel = useMemo(
    () => createReadOnlyShowcaseCanvasModel(snapshotState),
    [snapshotState]
  )

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[2rem] border border-[#e2d8c7] bg-[#fbf8f2] shadow-sm',
        className
      )}
    >
      <div className='flex flex-col gap-4 border-[#e2d8c7] border-b bg-white p-5 md:flex-row md:items-start md:justify-between'>
        <div>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='rounded-full bg-[#efe3d0] px-3 py-1 font-semibold text-[#9b5b2e] text-xs'>
              {versionLabel}
            </span>
            <span
              className='rounded-full bg-[#e7f0e1] px-3 py-1 font-semibold text-[#496b36] text-xs'
              title={SHOWCASE_READ_ONLY_CANVAS_MODE.reason}
            >
              Read-only snapshot
            </span>
          </div>
          <h2 className='mt-3 font-semibold text-2xl'>{title}</h2>
          {description ? <p className='mt-2 text-[#6f6256] text-sm'>{description}</p> : null}
        </div>
        <div className='grid min-w-[220px] grid-cols-2 gap-3'>
          <CanvasMetric label='Nodes' value={String(canvasModel.blockCount)} />
          <CanvasMetric label='Edges' value={String(canvasModel.edgeCount)} />
        </div>
      </div>

      <div className='p-5'>
        <div className='mb-4 rounded-2xl border border-[#e7d7c1] bg-[#fffaf2] px-4 py-3 text-[#6f6256] text-sm'>
          Showcase canvas renders the published snapshot only. You can pan and zoom, but it will not
          save changes, send realtime operations, or join the team editing presence.
        </div>

        {canvasModel.workflowState ? (
          <div className='h-[560px] overflow-hidden rounded-2xl border border-[#dfd2bd] bg-white'>
            <PreviewWorkflow
              className='showcase-readonly-canvas'
              cursorStyle='grab'
              fitPadding={0.2}
              height='560px'
              isPannable
              lightweight
              workflowState={canvasModel.workflowState}
            />
          </div>
        ) : (
          <div className='rounded-2xl border border-[#cdbfaa] border-dashed bg-white p-8'>
            <p className='font-semibold text-[#9b5b2e] text-sm'>Snapshot is not renderable</p>
            <p className='mt-3 text-[#6f6256]'>
              This published version does not match the current canvas rendering contract. The raw
              read-only data is shown for diagnosis.
            </p>
            <pre className='mt-6 max-h-[320px] overflow-auto rounded-xl bg-[#271f18] p-4 text-[#f7f4ed] text-xs'>
              {JSON.stringify(snapshotState, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

function CanvasMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-xl bg-[#f7f4ed] p-4'>
      <div className='text-[#6f6256] text-xs'>{label}</div>
      <div className='mt-1 font-semibold text-xl'>{value}</div>
    </div>
  )
}
