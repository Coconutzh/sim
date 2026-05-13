'use client'

import type { RefObject } from 'react'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'
import {
  getAddableContentNodePresets,
  type ContentNodePresetId,
} from '@/lib/product/content-node-presets'

/**
 * Props for CanvasMenu component
 */
export interface CanvasMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  onUndo: () => void
  onRedo: () => void
  onPaste: () => void
  onAddContentNode: (presetId: ContentNodePresetId) => void
  onAutoLayout: () => void
  onFitToView: () => void
  onOpenLogs: () => void
  onOpenSearchReplace: () => void
  onToggleVariables: () => void
  onToggleChat: () => void
  onToggleWorkflowLock?: () => void
  isVariablesOpen?: boolean
  isChatOpen?: boolean
  hasClipboard?: boolean
  disableEdit?: boolean
  canAdmin?: boolean
  canUndo?: boolean
  canRedo?: boolean
  isInvitationsDisabled?: boolean
  /** Whether the workflow has locked blocks (disables auto-layout) */
  hasLockedBlocks?: boolean
  /** Whether all blocks in the workflow are locked */
  allBlocksLocked?: boolean
  /** Whether the workflow has any blocks */
  hasBlocks?: boolean
}

/**
 * Context menu for workflow canvas.
 * Displays canvas-level actions when right-clicking empty space.
 */
export function CanvasMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onUndo,
  onRedo,
  onPaste,
  onAddContentNode,
  onAutoLayout,
  onFitToView,
  onOpenLogs,
  onOpenSearchReplace,
  onToggleVariables,
  onToggleChat,
  onToggleWorkflowLock,
  isVariablesOpen = false,
  isChatOpen = false,
  hasClipboard = false,
  disableEdit = false,
  canAdmin = false,
  canUndo = false,
  canRedo = false,
  hasLockedBlocks = false,
  allBlocksLocked = false,
  hasBlocks = false,
}: CanvasMenuProps) {
  const contentNodePresets = getAddableContentNodePresets()

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      variant='secondary'
      size='sm'
      colorScheme='inverted'
    >
      <PopoverAnchor
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: '1px',
          height: '1px',
        }}
      />
      <PopoverContent ref={menuRef} align='start' side='bottom' sideOffset={4}>
        <PopoverItem
          className='group'
          disabled={disableEdit || !canUndo}
          onClick={() => {
            onUndo()
            onClose()
          }}
        >
          <span>Undo</span>
        </PopoverItem>
        <PopoverItem
          className='group'
          disabled={disableEdit || !canRedo}
          onClick={() => {
            onRedo()
            onClose()
          }}
        >
          <span>Redo</span>
        </PopoverItem>
        <PopoverItem
          className='group'
          disabled={disableEdit || !hasClipboard}
          onClick={() => {
            onPaste()
            onClose()
          }}
        >
          <span>Paste</span>
        </PopoverItem>

        <PopoverDivider />
        {contentNodePresets.map((preset) => (
          <PopoverItem
            key={preset.id}
            className='group'
            disabled={disableEdit}
            onClick={() => {
              onAddContentNode(preset.id)
              onClose()
            }}
          >
            <span>{`New ${preset.label}`}</span>
          </PopoverItem>
        ))}

        <PopoverDivider />
        <PopoverItem
          className='group'
          disabled={disableEdit || hasLockedBlocks}
          onClick={() => {
            onAutoLayout()
            onClose()
          }}
          title={hasLockedBlocks ? 'Unlock blocks to use auto-layout' : undefined}
        >
          <span>Auto-layout</span>
        </PopoverItem>
        {canAdmin && onToggleWorkflowLock && (
          <PopoverItem
            disabled={!hasBlocks}
            onClick={() => {
              onToggleWorkflowLock()
              onClose()
            }}
          >
            <span>{allBlocksLocked ? 'Unlock workflow' : 'Lock workflow'}</span>
          </PopoverItem>
        )}
        <PopoverItem
          onClick={() => {
            onFitToView()
            onClose()
          }}
        >
          Fit to View
        </PopoverItem>

        <PopoverDivider />
        <PopoverItem
          className='group'
          onClick={() => {
            onOpenSearchReplace()
            onClose()
          }}
        >
          <span>Search and replace</span>
        </PopoverItem>
        <PopoverItem
          className='group'
          onClick={() => {
            onOpenLogs()
            onClose()
          }}
        >
          <span>Open Logs</span>
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            onToggleVariables()
            onClose()
          }}
        >
          {isVariablesOpen ? 'Close Variables' : 'Open Variables'}
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            onToggleChat()
            onClose()
          }}
        >
          {isChatOpen ? 'Close Chat' : 'Open Chat'}
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
}
