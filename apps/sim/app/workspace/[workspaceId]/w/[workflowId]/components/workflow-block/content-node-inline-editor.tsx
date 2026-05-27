'use client'

import type { ChangeEvent } from 'react'
import { lazy, Suspense, useCallback, useMemo } from 'react'
import { Button, Textarea } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { getContentNodePresetForBlockType } from '@/lib/product/content-node-presets'
import { LongInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/long-input/long-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { usePanelEditorStore } from '@/stores/panel'

const FileUpload = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/file-upload/file-upload'
  ).then((module) => ({ default: module.FileUpload }))
)

const TableSelector = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/table-selector/table-selector'
  ).then((module) => ({ default: module.TableSelector }))
)

const Dropdown = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/dropdown/dropdown'
  ).then((module) => ({ default: module.Dropdown }))
)

interface ContentNodeInlineEditorProps {
  blockId: string
  blockType: string
  subBlocks: SubBlockConfig[]
  disabled: boolean
  isPreview?: boolean
  previewSubBlockValues?: Record<string, { value: unknown }>
}

interface AgentMessage {
  role: string
  content: string
}

function getSubBlockConfig(subBlocks: SubBlockConfig[], id: string): SubBlockConfig | undefined {
  return subBlocks.find((subBlock) => subBlock.id === id)
}

function getPreviewValue(
  previewSubBlockValues: Record<string, { value: unknown }> | undefined,
  subBlockId: string
): unknown {
  return previewSubBlockValues?.[subBlockId]?.value
}

function getDropdownPreviewValue(value: unknown): string | string[] | null {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value
  }

  return null
}

function getPrimaryAgentContent(messages: AgentMessage[] | null | undefined): string {
  if (!messages || messages.length === 0) {
    return ''
  }

  const preferredMessage =
    messages.find((message) => message.role === 'user' && message.content.trim().length > 0) ??
    messages.find((message) => message.content.trim().length > 0) ??
    messages[0]

  return preferredMessage?.content ?? ''
}

function updatePrimaryAgentContent(
  existingMessages: AgentMessage[] | null | undefined,
  nextContent: string
): AgentMessage[] {
  const messages = existingMessages ? [...existingMessages] : []
  const targetIndex = messages.findIndex((message) => message.role === 'user')

  if (targetIndex >= 0) {
    messages[targetIndex] = {
      ...messages[targetIndex],
      content: nextContent,
    }
    return messages
  }

  if (messages.length > 0) {
    messages[0] = {
      ...messages[0],
      content: nextContent,
    }
    return messages
  }

  return [{ role: 'user', content: nextContent }]
}

function InlineAgentTextEditor({
  blockId,
  disabled,
  isPreview = false,
  previewValue,
}: {
  blockId: string
  disabled: boolean
  isPreview?: boolean
  previewValue?: unknown
}) {
  const [messages, setMessages] = useSubBlockValue<AgentMessage[]>(blockId, 'messages')
  const value = isPreview
    ? getPrimaryAgentContent(Array.isArray(previewValue) ? (previewValue as AgentMessage[]) : [])
    : getPrimaryAgentContent(messages)

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setMessages(updatePrimaryAgentContent(messages, event.target.value))
    },
    [messages, setMessages]
  )

  return (
    <div className='flex flex-col gap-1.5'>
      <div className='font-medium text-[var(--text-tertiary)] text-xs uppercase tracking-[0.08em]'>
        Text
      </div>
      <Textarea
        value={value}
        onChange={handleChange}
        disabled={disabled || isPreview}
        placeholder='Write directly in the node...'
        className='min-h-[92px] resize-none border-[var(--border-1)] bg-[var(--surface-1)] text-sm'
      />
    </div>
  )
}

/**
 * Lightweight inline editor for TapNow-style content nodes.
 * Reuses existing sub-block inputs so values still flow through the normal workflow stores.
 */
export function ContentNodeInlineEditor({
  blockId,
  blockType,
  subBlocks,
  disabled,
  isPreview = false,
  previewSubBlockValues,
}: ContentNodeInlineEditorProps) {
  const preset = getContentNodePresetForBlockType(blockType)
  const [videoProvider] = useSubBlockValue<string>(blockId, 'provider')

  const promptConfig = useMemo(() => getSubBlockConfig(subBlocks, 'prompt'), [subBlocks])
  const fileConfig = useMemo(() => getSubBlockConfig(subBlocks, 'file'), [subBlocks])
  const tableConfig = useMemo(() => getSubBlockConfig(subBlocks, 'tableSelector'), [subBlocks])
  const operationConfig = useMemo(() => getSubBlockConfig(subBlocks, 'operation'), [subBlocks])
  const visualReferenceConfig = useMemo(
    () => getSubBlockConfig(subBlocks, 'visualReference'),
    [subBlocks]
  )

  const promptPreviewValue =
    promptConfig && previewSubBlockValues
      ? getPreviewValue(previewSubBlockValues, promptConfig.id)
      : null
  const filePreviewValue =
    fileConfig && previewSubBlockValues
      ? getPreviewValue(previewSubBlockValues, fileConfig.id)
      : null
  const tablePreviewValue =
    tableConfig && previewSubBlockValues
      ? getPreviewValue(previewSubBlockValues, tableConfig.id)
      : null
  const operationPreviewValue =
    operationConfig && previewSubBlockValues
      ? getPreviewValue(previewSubBlockValues, operationConfig.id)
      : null
  const visualReferencePreviewValue =
    visualReferenceConfig && previewSubBlockValues
      ? getPreviewValue(previewSubBlockValues, visualReferenceConfig.id)
      : null

  if (!preset) {
    return null
  }

  const openAdvancedSettings = () => {
    usePanelEditorStore.getState().setCurrentBlockId(blockId)
  }

  return (
    <div
      className='rounded-lg border border-[var(--border-1)] bg-[var(--surface-3)] p-2'
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {preset.id === 'text' && (
        <InlineAgentTextEditor
          blockId={blockId}
          disabled={disabled}
          isPreview={isPreview}
          previewValue={getPreviewValue(previewSubBlockValues, 'messages')}
        />
      )}

      {preset.id === 'image' && promptConfig && (
        <LongInput
          blockId={blockId}
          subBlockId={promptConfig.id}
          config={promptConfig}
          placeholder={promptConfig.placeholder}
          rows={3}
          isPreview={isPreview}
          previewValue={typeof promptPreviewValue === 'string' ? promptPreviewValue : null}
          disabled={disabled}
          hideInternalWand={true}
        />
      )}

      {preset.id === 'video' && promptConfig && (
        <div className='flex flex-col gap-2'>
          <LongInput
            blockId={blockId}
            subBlockId={promptConfig.id}
            config={promptConfig}
            placeholder={promptConfig.placeholder}
            rows={3}
            isPreview={isPreview}
            previewValue={typeof promptPreviewValue === 'string' ? promptPreviewValue : null}
            disabled={disabled}
            hideInternalWand={true}
          />
          {visualReferenceConfig && (isPreview || videoProvider === 'runway') && (
            <div className='rounded-md border border-[var(--border-1)] border-dashed p-2'>
              <div className='mb-2 font-medium text-[var(--text-tertiary)] text-xs uppercase tracking-[0.08em]'>
                Reference Image
              </div>
              <Suspense fallback={<div className='h-9' />}>
                <FileUpload
                  blockId={blockId}
                  subBlockId={visualReferenceConfig.id}
                  acceptedTypes={visualReferenceConfig.acceptedTypes || '*'}
                  multiple={visualReferenceConfig.multiple === true}
                  maxSize={visualReferenceConfig.maxSize}
                  isPreview={isPreview}
                  previewValue={visualReferencePreviewValue}
                  disabled={disabled}
                />
              </Suspense>
            </div>
          )}
        </div>
      )}

      {preset.id === 'document' && fileConfig && (
        <div className='flex flex-col gap-1.5'>
          <div className='font-medium text-[var(--text-tertiary)] text-xs uppercase tracking-[0.08em]'>
            Upload
          </div>
          <Suspense fallback={<div className='h-9' />}>
            <FileUpload
              blockId={blockId}
              subBlockId={fileConfig.id}
              acceptedTypes={fileConfig.acceptedTypes || '*'}
              multiple={fileConfig.multiple === true}
              maxSize={fileConfig.maxSize}
              isPreview={isPreview}
              previewValue={filePreviewValue}
              disabled={disabled}
            />
          </Suspense>
        </div>
      )}

      {preset.id === 'table' && tableConfig && operationConfig && (
        <div className='grid grid-cols-1 gap-2'>
          <div className='flex flex-col gap-1.5'>
            <div className='font-medium text-[var(--text-tertiary)] text-xs uppercase tracking-[0.08em]'>
              Table
            </div>
            <Suspense fallback={<div className='h-8' />}>
              <TableSelector
                blockId={blockId}
                subBlock={tableConfig}
                disabled={disabled}
                isPreview={isPreview}
                previewValue={typeof tablePreviewValue === 'string' ? tablePreviewValue : null}
              />
            </Suspense>
          </div>
          <div className='flex flex-col gap-1.5'>
            <div className='font-medium text-[var(--text-tertiary)] text-xs uppercase tracking-[0.08em]'>
              Action
            </div>
            <div className={cn('rounded-md border border-[var(--border-1)] bg-[var(--surface-1)]')}>
              <Suspense fallback={<div className='h-8' />}>
                <Dropdown
                  blockId={blockId}
                  subBlockId={operationConfig.id}
                  options={operationConfig.options as { label: string; id: string }[]}
                  defaultValue={
                    typeof operationConfig.value === 'function'
                      ? operationConfig.value({})
                      : operationConfig.value
                  }
                  placeholder={operationConfig.placeholder}
                  isPreview={isPreview}
                  previewValue={getDropdownPreviewValue(operationPreviewValue)}
                  disabled={disabled}
                  multiSelect={operationConfig.multiSelect}
                  fetchOptions={operationConfig.fetchOptions}
                  fetchOptionById={operationConfig.fetchOptionById}
                  dependsOn={operationConfig.dependsOn}
                  searchable={operationConfig.searchable}
                />
              </Suspense>
            </div>
          </div>
        </div>
      )}

      <div className='mt-2 flex justify-end border-[var(--border-1)] border-t pt-2'>
        <Button
          variant='ghost'
          className='h-7 px-2 text-[11px] text-[var(--text-tertiary)] hover-hover:text-[var(--text-primary)]'
          onClick={openAdvancedSettings}
        >
          {preset.advancedPanelLabel}
        </Button>
      </div>
    </div>
  )
}
