import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleOff,
  CopyPlus,
  FolderKanban,
  Lock,
  LogOut,
  Unlock,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import {
  Button,
  Copy,
  Input,
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
import { useAsyncJob } from '@/hooks/queries/async-jobs'
import { useMyWorkgroups, useQueueCopySelection } from '@/hooks/queries/collaboration'
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
    const router = useRouter()
    const { data: workspaces = [] } = useWorkspacesQuery(true)
    const { data: workgroupsData } = useMyWorkgroups(true)
    const [isTransferOpen, setIsTransferOpen] = useState(false)
    const [targetWorkspaceId, setTargetWorkspaceId] = useState<string | null>(null)
    const [searchTerm, setSearchTerm] = useState('')
    const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([])
    const [completedTarget, setCompletedTarget] = useState<{
      workspaceId: string
      workflowId: string
      label: string
    } | null>(null)
    const [queuedTarget, setQueuedTarget] = useState<{
      workspaceId: string
      workflowId: string
      label: string
    } | null>(null)
    const queueCopySelection = useQueueCopySelection()
    const [copyTaskId, setCopyTaskId] = useState<string | null>(null)
    const copyTask = useAsyncJob(copyTaskId ?? undefined)
    const isPersonalCanvas =
      workspaces.find((workspace) => workspace.id === params.workspaceId)?.canvasScope ===
      'personal'
    const teamCanvases = useMemo(
      () =>
        (workgroupsData?.workgroups ?? []).map((workgroup) => ({
          projectId: workgroup.organizationId,
          projectName: workgroup.organization.name,
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
    const visibleTeamCanvases = teamCanvases.filter((teamCanvas) =>
      `${teamCanvas.projectName} ${teamCanvas.label}`
        .toLocaleLowerCase()
        .includes(searchTerm.trim().toLocaleLowerCase())
    )
    const teamCanvasGroups = useMemo(() => {
      const groups = new Map<string, { id: string; name: string; canvases: typeof teamCanvases }>()
      for (const teamCanvas of visibleTeamCanvases) {
        const group = groups.get(teamCanvas.projectId) ?? {
          id: teamCanvas.projectId,
          name: teamCanvas.projectName,
          canvases: [],
        }
        group.canvases.push(teamCanvas)
        groups.set(teamCanvas.projectId, group)
      }
      return [...groups.values()].sort((left, right) =>
        left.name.localeCompare(right.name, 'zh-CN')
      )
    }, [teamCanvases, visibleTeamCanvases])
    const isExecuting = useIsCurrentWorkflowExecuting()
    const getLastExecutionSnapshot = useExecutionStore((s) => s.getLastExecutionSnapshot)
    const userPermissions = useUserPermissionsContext()
    const edges = useWorkflowStore((state) => state.edges)

    useEffect(() => {
      if (copyTask.data?.status !== 'completed' || !queuedTarget || completedTarget) return
      setCompletedTarget(queuedTarget)
      toast.success(`已复制到 ${queuedTarget.label}`)
    }, [completedTarget, copyTask.data?.status, queuedTarget])

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
        const result = await queueCopySelection.mutateAsync({
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
        setQueuedTarget({
          workspaceId: targetWorkspaceId,
          workflowId: targetWorkflow.id,
          label: selectedTeamCanvas?.label ?? '团队画布',
        })
        setCopyTaskId(result.taskId)
        toast.success('复制任务已进入队列')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '复制到团队画布失败')
      }
    }, [activeWorkflowId, blockId, queueCopySelection, targetWorkspaceId, targetWorkflows])

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
        <Modal
          open={isTransferOpen}
          onOpenChange={(open) => {
            setIsTransferOpen(open)
            if (!open) {
              setSearchTerm('')
              setTargetWorkspaceId(null)
              setCompletedTarget(null)
              setCopyTaskId(null)
              setQueuedTarget(null)
            }
          }}
        >
          <ModalContent size='md'>
            <ModalHeader>{completedTarget ? '已复制到团队画布' : '复制到团队画布'}</ModalHeader>
            <ModalBody>
              {completedTarget ? (
                <p className='text-[12px] text-[var(--text-secondary)]'>
                  节点及其已生成内容已复制到「{completedTarget.label}」。
                </p>
              ) : copyTaskId ? (
                <div className='space-y-3'>
                  <p className='text-[12px] text-[var(--text-secondary)]'>
                    {copyTask.data?.status === 'pending'
                      ? '复制任务正在排队，文件会在后台安全传输。'
                      : copyTask.data?.status === 'processing'
                        ? '正在复制节点内容和文件，请勿关闭此画布。'
                        : copyTask.data?.status === 'failed'
                          ? `复制失败：${copyTask.data.error ?? '请重试'}`
                          : '正在获取复制任务进度…'}
                  </p>
                  <div className='h-2 overflow-hidden rounded-full bg-[var(--surface-4)]'>
                    <div
                      className={cn(
                        'h-full rounded-full bg-[var(--brand-secondary)] transition-all',
                        copyTask.data?.status === 'pending'
                          ? 'w-1/4'
                          : copyTask.data?.status === 'processing'
                            ? 'w-2/3'
                            : copyTask.data?.status === 'failed'
                              ? 'w-full bg-[var(--badge-error-text)]'
                              : 'w-1/6'
                      )}
                    />
                  </div>
                  <p className='text-[11px] text-[var(--text-tertiary)]'>
                    {copyTask.data?.status === 'pending'
                      ? '阶段进度：排队中 · 25%'
                      : copyTask.data?.status === 'processing'
                        ? '阶段进度：复制中 · 66%'
                        : copyTask.data?.status === 'failed'
                          ? '失败 · 可重新发起'
                          : '正在连接任务服务'}
                  </p>
                </div>
              ) : (
                <div className='space-y-3'>
                  <p className='text-[12px] text-[var(--text-secondary)]'>
                    将当前节点及其已生成内容复制为团队画布中的独立副本。
                  </p>
                  <Input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder='搜索项目或团队画布'
                    aria-label='搜索团队画布'
                  />
                  <div className='max-h-[320px] space-y-2 overflow-y-auto pr-1'>
                    {teamCanvasGroups.map((group) => {
                      const isExpanded =
                        searchTerm.trim().length > 0 || expandedProjectIds.includes(group.id)
                      return (
                        <div key={group.id} className='rounded-md border border-[var(--border)]'>
                          <Button
                            type='button'
                            variant='ghost'
                            className='h-auto w-full justify-start px-3 py-2 text-left text-[12px]'
                            onClick={() =>
                              setExpandedProjectIds((current) =>
                                current.includes(group.id)
                                  ? current.filter((id) => id !== group.id)
                                  : [...current, group.id]
                              )
                            }
                          >
                            {isExpanded ? (
                              <ChevronDown className='mr-2 h-4 w-4 shrink-0' />
                            ) : (
                              <ChevronRight className='mr-2 h-4 w-4 shrink-0' />
                            )}
                            <FolderKanban className='mr-2 h-4 w-4 shrink-0 text-[var(--brand-secondary)]' />
                            <span className='min-w-0 flex-1 truncate'>{group.name}</span>
                            <span className='ml-2 text-[11px] text-[var(--text-tertiary)]'>
                              {group.canvases.length}
                            </span>
                          </Button>
                          {isExpanded && (
                            <div className='space-y-1 border-[var(--border)] border-t p-2'>
                              {group.canvases.map((teamCanvas) => (
                                <Button
                                  key={teamCanvas.workspaceId}
                                  type='button'
                                  variant='ghost'
                                  className={cn(
                                    'h-auto w-full justify-start rounded-md border px-3 py-2 text-left text-[12px]',
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
                          )}
                        </div>
                      )
                    })}
                    {teamCanvasGroups.length === 0 && (
                      <p className='px-1 py-4 text-center text-[12px] text-[var(--text-tertiary)]'>
                        未找到可复制到的团队画布。
                      </p>
                    )}
                  </div>
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              {completedTarget ? (
                <>
                  <Button type='button' variant='default' onClick={() => setIsTransferOpen(false)}>
                    关闭
                  </Button>
                  <Button
                    type='button'
                    onClick={() =>
                      router.push(
                        `/workspace/${completedTarget.workspaceId}/w/${completedTarget.workflowId}`
                      )
                    }
                  >
                    打开目标画布
                  </Button>
                </>
              ) : copyTaskId ? (
                <>
                  <Button type='button' variant='default' onClick={() => setIsTransferOpen(false)}>
                    关闭
                  </Button>
                  {copyTask.data?.status === 'failed' && (
                    <Button
                      type='button'
                      disabled={queueCopySelection.isPending}
                      onClick={() => {
                        setCopyTaskId(null)
                        void handleCopyToTeamCanvas()
                      }}
                    >
                      {queueCopySelection.isPending ? '正在重新发起…' : '重新复制'}
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Button type='button' variant='default' onClick={() => setIsTransferOpen(false)}>
                    取消
                  </Button>
                  <Button
                    type='button'
                    disabled={
                      !targetWorkspaceId ||
                      isLoadingTargetWorkflows ||
                      targetWorkflows.length === 0 ||
                      queueCopySelection.isPending
                    }
                    onClick={() => void handleCopyToTeamCanvas()}
                  >
                    {queueCopySelection.isPending ? '正在创建任务…' : '复制节点'}
                  </Button>
                </>
              )}
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
