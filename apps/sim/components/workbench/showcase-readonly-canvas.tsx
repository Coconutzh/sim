'use client'

import { useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import {
  createReadOnlyShowcaseCanvasModel,
  SHOWCASE_READ_ONLY_CANVAS_MODE,
} from '@/lib/collaboration/showcase-snapshot'
import { cn } from '@/lib/core/utils/cn'
import { PreviewWorkflow } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/preview-workflow'
import type { BlockState } from '@/stores/workflows/workflow/types'

interface ShowcaseReadOnlyCanvasProps {
  snapshotState: unknown
  title: string
  description?: string | null
  versionLabel: string
  className?: string
  canvasHeightClassName?: string
}

interface BlockDetailModalProps {
  open: boolean
  block: BlockState | null
  onOpenChange: (open: boolean) => void
}

function stringifyDetailValue(value: unknown): string {
  if (value === undefined) return '-'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function getSubBlockDisplayValue(value: unknown): unknown {
  if (isRecord(value) && 'value' in value) return value.value
  return value
}

function getSubBlockType(value: unknown): string | null {
  if (!isRecord(value)) return null
  return typeof value.type === 'string' ? value.type : null
}

function CanvasMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4'>
      <div className='text-[var(--text-secondary)] text-xs'>{label}</div>
      <div className='mt-1 font-semibold text-[var(--text-primary)] text-xl'>{value}</div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-start justify-between gap-4 border-[var(--border-muted)] border-b py-2 last:border-b-0'>
      <span className='text-[var(--text-secondary)] text-xs'>{label}</span>
      <span className='max-w-[360px] break-words text-right text-[var(--text-primary)] text-xs'>
        {value}
      </span>
    </div>
  )
}

function DetailJsonBlock({ value }: { value: unknown }) {
  return (
    <pre className='max-h-[220px] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border-muted)] bg-[var(--surface-3)] p-3 text-[var(--text-secondary)] text-xs'>
      {stringifyDetailValue(value)}
    </pre>
  )
}

function BlockDetailModal({ open, block, onOpenChange }: BlockDetailModalProps) {
  if (!block) return null

  const subBlockEntries = Object.entries(block.subBlocks ?? {})
  const outputEntries = Object.entries(block.outputs ?? {})

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='xl'>
        <ModalHeader>{block.name || block.id}</ModalHeader>
        <ModalBody className='flex flex-col gap-4 overflow-y-auto'>
          <div className='flex flex-wrap items-center gap-2'>
            <Badge variant='type' size='sm'>
              {block.type}
            </Badge>
            <Badge variant={block.enabled ? 'green' : 'gray-secondary'} size='sm' dot>
              {block.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
            {block.triggerMode ? (
              <Badge variant='blue' size='sm'>
                Trigger
              </Badge>
            ) : null}
            {block.locked ? (
              <Badge variant='amber' size='sm'>
                Locked
              </Badge>
            ) : null}
          </div>

          <div className='rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3'>
            <DetailRow label='Node ID' value={block.id} />
            <DetailRow label='Type' value={block.type} />
            <DetailRow label='Position' value={`x ${block.position.x}, y ${block.position.y}`} />
            <DetailRow label='Parent ID' value={block.data?.parentId ?? '-'} />
            <DetailRow label='Handles' value={block.horizontalHandles ? 'Horizontal' : 'Default'} />
            <DetailRow label='Advanced mode' value={block.advancedMode ? 'On' : 'Off'} />
          </div>

          <div className='grid gap-4 lg:grid-cols-2'>
            <section className='min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3'>
              <div className='mb-3 font-medium text-[var(--text-primary)] text-small'>
                Sub-blocks
              </div>
              {subBlockEntries.length > 0 ? (
                <div className='flex flex-col gap-3'>
                  {subBlockEntries.map(([key, value]) => (
                    <div key={key} className='min-w-0'>
                      <div className='mb-1 flex items-center justify-between gap-2'>
                        <span className='font-medium text-[var(--text-primary)] text-xs'>
                          {key}
                        </span>
                        {getSubBlockType(value) ? (
                          <Badge variant='gray-secondary' size='sm'>
                            {getSubBlockType(value)}
                          </Badge>
                        ) : null}
                      </div>
                      <DetailJsonBlock value={getSubBlockDisplayValue(value)} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className='rounded-lg border border-[var(--border-muted)] border-dashed p-4 text-[var(--text-secondary)] text-xs'>
                  No sub-block configuration is stored on this node.
                </div>
              )}
            </section>

            <section className='min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3'>
              <div className='mb-3 font-medium text-[var(--text-primary)] text-small'>Outputs</div>
              {outputEntries.length > 0 ? (
                <div className='flex flex-col gap-3'>
                  {outputEntries.map(([key, value]) => (
                    <div key={key} className='min-w-0'>
                      <div className='mb-1 font-medium text-[var(--text-primary)] text-xs'>
                        {key}
                      </div>
                      <DetailJsonBlock value={value} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className='rounded-lg border border-[var(--border-muted)] border-dashed p-4 text-[var(--text-secondary)] text-xs'>
                  No output schema is stored on this node.
                </div>
              )}
            </section>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export function ShowcaseReadOnlyCanvas({
  snapshotState,
  title,
  description,
  versionLabel,
  className,
  canvasHeightClassName,
}: ShowcaseReadOnlyCanvasProps) {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const canvasModel = useMemo(
    () => createReadOnlyShowcaseCanvasModel(snapshotState),
    [snapshotState]
  )
  const selectedBlock = useMemo(
    () =>
      selectedBlockId && canvasModel.workflowState
        ? (canvasModel.workflowState.blocks[selectedBlockId] ?? null)
        : null,
    [canvasModel.workflowState, selectedBlockId]
  )

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[2rem] border border-[var(--border)] bg-[var(--surface-1)] shadow-card',
        className
      )}
    >
      <div className='flex flex-col gap-4 border-[var(--border-muted)] border-b bg-[var(--bg)] p-5 md:flex-row md:items-start md:justify-between'>
        <div>
          <div className='flex flex-wrap items-center gap-2'>
            <Badge variant='gray-secondary' size='sm'>
              {versionLabel}
            </Badge>
            <Badge variant='green' size='sm' title={SHOWCASE_READ_ONLY_CANVAS_MODE.reason} dot>
              Read-only snapshot
            </Badge>
          </div>
          <h2 className='mt-3 font-semibold text-2xl text-[var(--text-primary)]'>{title}</h2>
          {description ? (
            <p className='mt-2 text-[var(--text-secondary)] text-sm'>{description}</p>
          ) : null}
        </div>
        <div className='grid min-w-[220px] grid-cols-2 gap-3'>
          <CanvasMetric label='Nodes' value={String(canvasModel.blockCount)} />
          <CanvasMetric label='Edges' value={String(canvasModel.edgeCount)} />
        </div>
      </div>

      <div className='p-5'>
        <div className='mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-[var(--text-secondary)] text-sm'>
          Showcase canvas renders the published snapshot only. You can pan, zoom, and click a node
          to inspect details, but this view will not save changes or join team editing presence.
        </div>

        {canvasModel.workflowState ? (
          <div
            className={cn(
              'h-[560px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg)]',
              canvasHeightClassName
            )}
          >
            <PreviewWorkflow
              className='showcase-readonly-canvas'
              cursorStyle='grab'
              fitPadding={0.2}
              height='100%'
              isPannable
              lightweight
              onNodeClick={(blockId) => setSelectedBlockId(blockId)}
              onPaneClick={() => setSelectedBlockId(null)}
              selectedBlockId={selectedBlockId}
              workflowState={canvasModel.workflowState}
            />
          </div>
        ) : (
          <div className='rounded-2xl border border-[var(--border)] border-dashed bg-[var(--surface-2)] p-8'>
            <p className='font-semibold text-[var(--text-primary)] text-sm'>
              Snapshot is not renderable
            </p>
            <p className='mt-3 text-[var(--text-secondary)]'>
              This published version does not match the current canvas rendering contract. The raw
              read-only data is shown for diagnosis.
            </p>
            <pre className='mt-6 max-h-[320px] overflow-auto rounded-xl bg-[var(--surface-3)] p-4 text-[var(--text-secondary)] text-xs'>
              {JSON.stringify(snapshotState, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <BlockDetailModal
        open={Boolean(selectedBlock)}
        block={selectedBlock}
        onOpenChange={(open) => {
          if (!open) setSelectedBlockId(null)
        }}
      />
    </div>
  )
}
