'use client'

import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/core/utils/cn'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { getBlockConfigFromCatalog, resolveCatalogBlockType } from '@/blocks/catalog'
import type { SubBlockConfig } from '@/blocks/types'
import { usePanelEditorStore } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

const EDITABLE_TYPES = new Set([
  'short-input',
  'long-input',
  'code',
  'number-input',
  'dropdown',
  'combobox',
])

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

interface LiteFieldProps {
  blockId: string
  subBlock: SubBlockConfig
  value: unknown
  onChange: (subBlockId: string, value: string) => void
}

function LiteField({ blockId, subBlock, value, onChange }: LiteFieldProps) {
  const stringValue = stringifyValue(value)
  const editable = EDITABLE_TYPES.has(subBlock.type)
  const commonClassName =
    'w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-2 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-placeholder)] focus:border-[var(--brand-primary)]'

  return (
    <div className='space-y-1.5' data-lite-editor-field={subBlock.id}>
      <div className='flex items-center justify-between gap-2'>
        <label
          htmlFor={`${blockId}-${subBlock.id}`}
          className='font-medium text-[12px] text-[var(--text-secondary)]'
        >
          {subBlock.title || subBlock.id}
        </label>
        <span className='text-[10px] text-[var(--text-tertiary)]'>{subBlock.type}</span>
      </div>
      {editable ? (
        subBlock.type === 'long-input' || subBlock.type === 'code' ? (
          <textarea
            id={`${blockId}-${subBlock.id}`}
            className={cn(commonClassName, 'min-h-[74px] resize-y')}
            value={stringValue}
            placeholder={subBlock.placeholder}
            onChange={(event) => onChange(subBlock.id, event.target.value)}
          />
        ) : (
          <input
            id={`${blockId}-${subBlock.id}`}
            className={commonClassName}
            value={stringValue}
            placeholder={subBlock.placeholder}
            onChange={(event) => onChange(subBlock.id, event.target.value)}
          />
        )
      ) : (
        <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-2 text-[12px] text-[var(--text-tertiary)]'>
          {stringValue || 'Not configured'}
        </div>
      )}
    </div>
  )
}

/**
 * Lightweight low-memory editor that avoids selector, permission, and MCP hydration queries.
 */
export function EditorLite() {
  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const currentWorkflow = useCurrentWorkflow()
  const setValue = useSubBlockStore((state) => state.setValue)
  const blockValues = useSubBlockStore(
    useShallow((state) => {
      if (!activeWorkflowId || !currentBlockId) return {}
      return state.workflowValues[activeWorkflowId]?.[currentBlockId] ?? {}
    })
  )

  const currentBlock = currentBlockId ? currentWorkflow.getBlockById(currentBlockId) : null
  const blockType = currentBlock ? resolveCatalogBlockType(currentBlock.type) : null
  const blockConfig = blockType ? getBlockConfigFromCatalog(blockType) : null
  const subBlocks = useMemo(
    () =>
      (blockConfig?.subBlocks ?? []).filter(
        (subBlock) => subBlock.mode !== 'advanced' && subBlock.mode !== 'trigger'
      ),
    [blockConfig?.subBlocks]
  )

  const handleChange = useCallback(
    (subBlockId: string, value: string) => {
      if (!currentBlockId) return
      setValue(currentBlockId, subBlockId, value)
    },
    [currentBlockId, setValue]
  )

  if (!currentBlockId || !currentBlock || !blockConfig) {
    return (
      <div className='flex h-full items-center justify-center px-4 text-center text-[12px] text-[var(--text-tertiary)]'>
        Select a block to edit its MVP fields.
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col overflow-hidden' data-tab-content='editor-lite'>
      <div className='border-[var(--border)] border-b px-3 pb-3'>
        <div className='font-semibold text-[13px] text-[var(--text-primary)]'>
          {currentBlock.name || blockConfig.name}
        </div>
        <div className='pt-1 text-[11px] text-[var(--text-tertiary)]'>{blockConfig.name}</div>
      </div>
      <div className='flex-1 space-y-3 overflow-y-auto px-3 py-3'>
        {subBlocks.length > 0 ? (
          subBlocks.map((subBlock) => (
            <LiteField
              key={subBlock.id}
              blockId={currentBlockId}
              subBlock={subBlock}
              value={blockValues[subBlock.id]}
              onChange={handleChange}
            />
          ))
        ) : (
          <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-3 text-[12px] text-[var(--text-tertiary)]'>
            This MVP block has no editable lite fields.
          </div>
        )}
      </div>
    </div>
  )
}
