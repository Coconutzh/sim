import { memo, useCallback, useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  ArrowUpDown,
  Circle,
  CircleOff,
  CopyPlus,
  Lock,
  LogOut,
  Unlock,
} from 'lucide-react'
import { useParams } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import {
  Button,
  Copy,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  PlayOutline,
  Tooltip,
  Trash2,
  toast,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { isPureCanvasBlockType } from '@/lib/workflows/blocks/pure-canvas-blocks'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-context'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { validateTriggerPaste } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import { useCopySelection, useMyWorkgroups } from '@/hooks/queries/collaboration'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useExecutionStore, useIsCurrentWorkflowExecuting } from '@/stores/execution'
import { useNotificationStore } from '@/stores/notifications'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const DEFAULT_DUPLICATE_OFFSET = { x: 50, y: 50 }

const ACTION_BUTTON_STYLES = [
  'h-[23px] w-[23px] rounded-lg p-0',
  'border border-[var(--border)] bg-[var(--surface-5)]',
  'text-[var(--text-secondary)]',
  'hover-hover:border-transparent hover-hover:bg-[var(--brand-secondary)] hover-hover:!text-[var(--text-inverse)]',
  'dark:border-transparent dark:bg-[var(--surface-7)] dark:hover-hover:bg-[var(--brand-secondary)]',
].join(' ')

const ICON_SIZE = 'h-[11px] w-[11px]'

/**
 * Props for the ActionBar component
 */
interface ActionBarProps {
  /** Unique identifier for the block */
  blockId: string
  /** Type of the block */
  blockType: string
  /** Whether the action bar is disabled */
  disabled?: boolean
}

/**
 * ActionBar component displays action buttons for workflow blocks
 * Provides controls for enabling/disabling, duplicating, removing, and toggling block handles
 *
 * @component
 */
export const ActionBar = memo(
  function ActionBar({ blockId, blockType, disabled = false }: ActionBarProps) {
    const {
      collaborativeBatchAddBlocks,
      collaborativeBatchRemoveBlocks,
      collaborativeBatchToggleBlockEnabled,
      collaborativeBatchToggleBlockHandles,
      collaborativeBatchToggleLocked,
    } = useCollaborativeWorkflow()
    const setPendingSelection = useWorkflowRegistry((state) => state.setPendingSelection)
    const { handleRunFromBlock } = useWorkflowExecution()

    const addNotification = useNotificationStore((s) => s.addNotification)

    const handleDuplicateBlock = useCallback(() => {
      const { copyBlocks, preparePasteData, activeWorkflowId } = useWorkflowRegistry.getState()
      const existingBlocks = useWorkflowStore.getState().blocks
      copyBlocks([blockId])

      const pasteData = preparePasteData(DEFAULT_DUPLICATE_OFFSET)
      if (!pasteData) return

      const blocks = Object.values(pasteData.blocks)
      const validation = validateTriggerPaste(blocks, existingBlocks, 'duplicate')
      if (!validation.isValid) {
        addNotification({
          level: 'error',
          message: validation.message!,
          workflowId: activeWorkflowId || undefined,
        })
        return
      }

      setPendingSelection(blocks.map((b) => b.id))
      collaborativeBatchAddBlocks(
        blocks,
        pasteData.edges,
        pasteData.loops,
        pasteData.parallels,
        pasteData.subBlockValues
      )
    }, [blockId, addNotification, collaborativeBatchAddBlocks, setPendingSelection])

    const {
      isEnabled,
      horizontalHandles,
      parentId,
      parentType,
      isLocked,
      isParentLocked,
      isParentDisabled,
    } = useWorkflowStore(
      useShallow(
        useCallback(
          (state) => {
            const block = state.blocks[blockId]
            const parentId = block?.data?.parentId
            const parentBlock = parentId ? state.blocks[parentId] : undefined
            return {
              isEnabled: block?.enabled ?? true,
              horizontalHandles: block?.horizontalHandles ?? false,
              parentId,
              parentType: parentBlock?.type,
              isLocked: block?.locked ?? false,
              isParentLocked: parentBlock?.locked ?? false,
              isParentDisabled: parentBlock ? !parentBlock.enabled : false,
            }
          },
          [blockId]
        )
      )
    )

    const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
    const params = useParams<{ workspaceId: string }>()
    const { data: workspaces = [] } = useWorkspacesQuery(true)
    const { data: workgroupsData } = useMyWorkgroups(true)
    const [isTransferOpen, setIsTransferOpen] = useState(false)
    const [targetWorkspaceId, setTargetWorkspaceId] = useState<string | null>(null)
    const copySelection = useCopySelection()
    const isPersonalCanvas =
      workspaces.find((workspace) => workspace.id === params.workspaceId)?.canvasScope ===
      'personal'
    const teamCanvases = useMemo(
      () =>
        (workgroupsData?.workgroups ?? []).map((workgroup) => ({
          workspaceId: workgroup.teamWorkspaceId,
          label: `${workgroup.organization.name} / ${workgroup.discipline.name} / ${workgroup.name}`,
        })),
      [workgroupsData?.workgroups]
    )
    const selectedTeamCanvas = teamCanvases.find(
      (teamCanvas) => teamCanvas.workspaceId === targetWorkspaceId
    )
    const { data: targetWorkflows = [], isLoading: isLoadingTargetWorkflows } = useWorkflows(
      targetWorkspaceId ?? undefined,
      { enabled: Boolean(targetWorkspaceId) }
    )
    const isExecuting = useIsCurrentWorkflowExecuting()
    const getLastExecutionSnapshot = useExecutionStore((s) => s.getLastExecutionSnapshot)
    const userPermissions = useUserPermissionsContext()
    const edges = useWorkflowStore((state) => state.edges)

    const isStartBlock = isInputDefinitionTrigger(blockType)
    const isResponseBlock = blockType === 'response'
    const isPureCanvasBlock = isPureCanvasBlockType(blockType)
    const isSubflowBlock = blockType === 'loop' || blockType === 'parallel'
    const isInsideSubflow = parentId && (parentType === 'loop' || parentType === 'parallel')

    const snapshot = activeWorkflowId ? getLastExecutionSnapshot(activeWorkflowId) : null
    const incomingEdges = edges.filter((edge) => edge.target === blockId)
    const isTriggerBlock = incomingEdges.length === 0

    // Check if each source block is either executed OR is a trigger block (triggers don't need prior execution)
    const isSourceSatisfied = (sourceId: string) => {
      if (snapshot?.executedBlocks.includes(sourceId)) return true
      // Check if source is a trigger (has no incoming edges itself)
      const sourceIncomingEdges = edges.filter((edge) => edge.target === sourceId)
      return sourceIncomingEdges.length === 0
    }

    // Non-trigger blocks need a snapshot to exist (so upstream outputs are available)
    const dependenciesSatisfied =
      isTriggerBlock || (snapshot && incomingEdges.every((edge) => isSourceSatisfied(edge.source)))
    const canRunFromBlock =
      dependenciesSatisfied && !isPureCanvasBlock && !isInsideSubflow && !isExecuting

    const handleRunFromBlockClick = useCallback(() => {
      if (!activeWorkflowId || !canRunFromBlock) return
      handleRunFromBlock(blockId, activeWorkflowId)
    }, [blockId, activeWorkflowId, canRunFromBlock, handleRunFromBlock])

    const handleCopyToTeamCanvas = useCallback(async () => {
      if (!activeWorkflowId || !targetWorkspaceId) return
      const targetWorkflow = targetWorkflows.find(
        (workflow) => workflow.workspaceId === targetWorkspaceId && workflow.track !== 'published'
      )
      if (!targetWorkflow) {
        toast.error('目标团队画布没有可用工作流')
        return
      }
      try {
        await copySelection.mutateAsync({
          workflowId: activeWorkflowId,
          body: {
            source: { type: 'personal', workflowId: activeWorkflowId },
            target: {
              type: 'team',
              workspaceId: targetWorkspaceId,
              workflowId: targetWorkflow.id,
            },
            selection: { blockIds: [blockId], edgeIds: [] },
            placement: { offsetX: 80, offsetY: 80 },
          },
        })
        setIsTransferOpen(false)
        setTargetWorkspaceId(null)
        toast.success(`已复制到 ${selectedTeamCanvas?.label ?? '团队画布'}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '复制到团队画布失败')
      }
    }, [
      activeWorkflowId,
      blockId,
      copySelection,
      selectedTeamCanvas?.label,
      targetWorkspaceId,
      targetWorkflows,
    ])

    /**
     * Get appropriate tooltip message based on disabled state
     *
     * @param defaultMessage - The default message to show when not disabled
     * @returns The tooltip message
     */
    const getTooltipMessage = (defaultMessage: string) => {
      if (disabled) {
        return userPermissions.isOfflineMode ? 'Connection lost - please refresh' : 'Read-only mode'
      }
      return defaultMessage
    }

    return (
      <div
        className={cn(
          '-top-[46px] pointer-events-auto absolute right-0',
          'flex flex-row items-center',
          'opacity-0 transition-opacity duration-200 group-hover:opacity-100',
          'gap-[5px] rounded-[10px] p-[5px]',
          'border border-[var(--border)] bg-[var(--surface-2)]',
          'dark:border-transparent dark:bg-[var(--surface-4)]'
        )}
      >
        {isPersonalCanvas && blockType === 'content' && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={(event) => {
                  event.stopPropagation()
                  setIsTransferOpen(true)
                }}
                className={ACTION_BUTTON_STYLES}
                disabled={disabled || teamCanvases.length === 0}
              >
                <CopyPlus className={ICON_SIZE} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {teamCanvases.length === 0 ? '没有可写入的团队画布' : '复制到团队画布'}
            </Tooltip.Content>
          </Tooltip.Root>
        )}

        {!isPureCanvasBlock && !isInsideSubflow && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span className='inline-flex'>
                <Button
                  variant='ghost'
                  onClick={(e) => {
                    e.stopPropagation()
                    if (canRunFromBlock && !disabled) {
                      handleRunFromBlockClick()
                    }
                  }}
                  className={ACTION_BUTTON_STYLES}
                  disabled={disabled || !canRunFromBlock}
                >
                  <PlayOutline className={ICON_SIZE} />
                </Button>
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {(() => {
                if (disabled) return getTooltipMessage('Run from block')
                if (isExecuting) return 'Running...'
                if (!dependenciesSatisfied) return 'Run previous blocks first'
                return 'Run from block'
              })()}
            </Tooltip.Content>
          </Tooltip.Root>
        )}

        {!isPureCanvasBlock && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={(e) => {
                  e.stopPropagation()
                  // Can't enable if parent is disabled (must enable parent first)
                  const cantEnable = !isEnabled && isParentDisabled
                  if (!disabled && !isLocked && !isParentLocked && !cantEnable) {
                    collaborativeBatchToggleBlockEnabled([blockId])
                  }
                }}
                className={ACTION_BUTTON_STYLES}
                disabled={
                  disabled || isLocked || isParentLocked || (!isEnabled && isParentDisabled)
                }
              >
                {isEnabled ? <Circle className={ICON_SIZE} /> : <CircleOff className={ICON_SIZE} />}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {isLocked || isParentLocked
                ? 'Block is locked'
                : !isEnabled && isParentDisabled
                  ? 'Parent container is disabled'
                  : getTooltipMessage(isEnabled ? 'Disable Block' : 'Enable Block')}
            </Tooltip.Content>
          </Tooltip.Root>
        )}

        {userPermissions.canAdmin && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={(e) => {
                  e.stopPropagation()
                  // Can't unlock a block if its parent container is locked
                  if (!disabled && !(isLocked && isParentLocked)) {
                    collaborativeBatchToggleLocked([blockId])
                  }
                }}
                className={ACTION_BUTTON_STYLES}
                disabled={disabled || (isLocked && isParentLocked)}
              >
                {isLocked ? <Unlock className={ICON_SIZE} /> : <Lock className={ICON_SIZE} />}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {isLocked && isParentLocked
                ? 'Parent container is locked'
                : isLocked
                  ? 'Unlock Block'
                  : 'Lock Block'}
            </Tooltip.Content>
          </Tooltip.Root>
        )}

        {!isStartBlock && !isResponseBlock && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={(e) => {
                  e.stopPropagation()
                  if (!disabled && !isLocked && !isParentLocked) {
                    handleDuplicateBlock()
                  }
                }}
                className={ACTION_BUTTON_STYLES}
                disabled={disabled || isLocked || isParentLocked}
              >
                <Copy className={ICON_SIZE} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {isLocked || isParentLocked
                ? 'Block is locked'
                : getTooltipMessage('Duplicate Block')}
            </Tooltip.Content>
          </Tooltip.Root>
        )}

        {!isPureCanvasBlock && !isSubflowBlock && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={(e) => {
                  e.stopPropagation()
                  if (!disabled && !isLocked && !isParentLocked) {
                    collaborativeBatchToggleBlockHandles([blockId])
                  }
                }}
                className={ACTION_BUTTON_STYLES}
                disabled={disabled || isLocked || isParentLocked}
              >
                {horizontalHandles ? (
                  <ArrowLeftRight className={ICON_SIZE} />
                ) : (
                  <ArrowUpDown className={ICON_SIZE} />
                )}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {isLocked || isParentLocked
                ? 'Block is locked'
                : getTooltipMessage(horizontalHandles ? 'Vertical Ports' : 'Horizontal Ports')}
            </Tooltip.Content>
          </Tooltip.Root>
        )}

        {!isStartBlock && parentId && (parentType === 'loop' || parentType === 'parallel') && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={(e) => {
                  e.stopPropagation()
                  if (!disabled && userPermissions.canEdit && !isLocked && !isParentLocked) {
                    window.dispatchEvent(
                      new CustomEvent('remove-from-subflow', { detail: { blockIds: [blockId] } })
                    )
                  }
                }}
                className={ACTION_BUTTON_STYLES}
                disabled={disabled || !userPermissions.canEdit || isLocked || isParentLocked}
              >
                <LogOut className={ICON_SIZE} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {isLocked || isParentLocked
                ? 'Block is locked'
                : getTooltipMessage('Remove from Subflow')}
            </Tooltip.Content>
          </Tooltip.Root>
        )}

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              onClick={(e) => {
                e.stopPropagation()
                if (!disabled && !isLocked && !isParentLocked) {
                  collaborativeBatchRemoveBlocks([blockId])
                }
              }}
              className={ACTION_BUTTON_STYLES}
              disabled={disabled || isLocked || isParentLocked}
            >
              <Trash2 className={ICON_SIZE} />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>
            {isLocked || isParentLocked ? 'Block is locked' : getTooltipMessage('Delete Block')}
          </Tooltip.Content>
        </Tooltip.Root>
        <Modal open={isTransferOpen} onOpenChange={setIsTransferOpen}>
          <ModalContent size='md'>
            <ModalHeader>复制到团队画布</ModalHeader>
            <ModalBody>
              <div className='space-y-2'>
                <p className='text-[12px] text-[var(--text-secondary)]'>
                  将当前节点及其已生成内容复制为团队画布中的独立副本。
                </p>
                {teamCanvases.map((teamCanvas) => (
                  <Button
                    key={teamCanvas.workspaceId}
                    type='button'
                    variant='ghost'
                    className={cn(
                      'h-auto w-full justify-start rounded-md border px-3 py-3 text-left text-[12px]',
                      teamCanvas.workspaceId === targetWorkspaceId
                        ? 'border-[var(--brand-secondary)] bg-[var(--surface-active)]'
                        : 'border-[var(--border)]'
                    )}
                    onClick={() => setTargetWorkspaceId(teamCanvas.workspaceId)}
                  >
                    <CopyPlus className='mr-2 h-4 w-4 shrink-0 text-[var(--badge-success-text)]' />
                    <span className='min-w-0 truncate'>{teamCanvas.label}</span>
                  </Button>
                ))}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button type='button' variant='default' onClick={() => setIsTransferOpen(false)}>
                取消
              </Button>
              <Button
                type='button'
                disabled={
                  !targetWorkspaceId ||
                  isLoadingTargetWorkflows ||
                  targetWorkflows.length === 0 ||
                  copySelection.isPending
                }
                onClick={() => void handleCopyToTeamCanvas()}
              >
                {copySelection.isPending ? '正在复制…' : '复制节点'}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
    )
  },
  /**
   * Custom comparison function for memo optimization
   * Only re-renders if props actually changed
   *
   * @param prevProps - Previous component props
   * @param nextProps - Next component props
   * @returns True if props are equal (should not re-render), false otherwise
   */
  (prevProps, nextProps) => {
    return (
      prevProps.blockId === nextProps.blockId &&
      prevProps.blockType === nextProps.blockType &&
      prevProps.disabled === nextProps.disabled
    )
  }
)
