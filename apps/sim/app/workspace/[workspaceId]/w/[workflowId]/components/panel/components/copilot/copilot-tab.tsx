'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { History, Plus, Trash } from 'lucide-react'
import { usePostHog } from 'posthog-js/react'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverSection,
  PopoverTrigger,
} from '@/components/emcn'
import { requestJson } from '@/lib/api/client/request'
import {
  createWorkflowCopilotChatContract,
  deleteCopilotChatContract,
} from '@/lib/api/contracts/copilot'
import { getWorkflowNormalizedStateContract } from '@/lib/api/contracts/workflows'
import { useSession } from '@/lib/auth/auth-client'
import { getCopilotSkillActionCards } from '@/lib/copilot/skill-action-registry'
import { captureEvent } from '@/lib/posthog/client'
import { getContentNodePreset } from '@/lib/product/content-node-presets'
import { ConversationListItem } from '@/app/workspace/[workspaceId]/components'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components/mothership-chat/mothership-chat'
import type { SkillActionCard } from '@/app/workspace/[workspaceId]/home/components/user-input'
import { getWorkflowCopilotUseChatOptions, useChat } from '@/app/workspace/[workspaceId]/home/hooks'
import type {
  CanvasSelectionCard,
  ChatSendOptions,
  FileAttachmentForApi,
} from '@/app/workspace/[workspaceId]/home/types'
import { useCopilotAgentProfile } from '@/hooks/queries/collaboration'
import { useCopilotChatSelection } from '@/hooks/queries/copilot-chat-selection'
import {
  type CopilotChatListItem,
  copilotChatsKeys,
  useCopilotChats,
} from '@/hooks/queries/copilot-chats'
import { useCopilotSkillCards } from '@/hooks/queries/copilot-skill-cards'
import { useContentCanvasSelectionStore } from '@/stores/copilot/content-canvas-selection/store'
import type { ChatContext } from '@/stores/panel'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { captureBaselineSnapshot } from '@/stores/workflow-diff/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { EMPTY_SUBBLOCK_VALUES, useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('PanelCopilotTab')
const EMPTY_COPILOT_CHATS: readonly CopilotChatListItem[] = []
const EMPTY_SELECTION_IDS: string[] = []
const LOCAL_CANVAS_MUTATION_TOOLS = new Set(['canvas.apply_patch', 'canvas.generate_node_output'])

function getStoredValue<T>(
  source: Record<string, unknown> | undefined,
  key: string,
  fallback: T
): T {
  const rawValue = source?.[key]
  if (rawValue && typeof rawValue === 'object' && 'value' in rawValue) {
    return ((rawValue as { value?: T }).value ?? fallback) as T
  }
  return (rawValue ?? fallback) as T
}

function stripHtmlPreview(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface CopilotTabProps {
  workspaceId: string
  activeWorkflowId: string | null
  isActive: boolean
  pendingMessage: string | null
  onPendingMessageConsumed: () => void
}

export function CopilotTab({
  workspaceId,
  activeWorkflowId,
  isActive,
  pendingMessage,
  onPendingMessageConsumed,
}: CopilotTabProps) {
  const posthog = usePostHog()
  const posthogRef = useRef(posthog)
  const { data: session } = useSession()
  const { data: agentProfile } = useCopilotAgentProfile(workspaceId)
  const { data: managedSkillCardsData } = useCopilotSkillCards(workspaceId)
  const queryClient = useQueryClient()
  const { chatId: copilotChatId, setChatId: setCopilotChatId } = useCopilotChatSelection(
    activeWorkflowId ?? undefined
  )
  const { data: copilotChatList = EMPTY_COPILOT_CHATS } = useCopilotChats(
    activeWorkflowId ?? undefined
  )
  const [isCopilotHistoryOpen, setIsCopilotHistoryOpen] = useState(false)
  const blocks = useWorkflowStore((state) => state.blocks)
  const selectedCanvasNodeIds = useContentCanvasSelectionStore(
    useCallback(
      (state) =>
        activeWorkflowId
          ? (state.selectionByWorkflow[activeWorkflowId] ?? EMPTY_SELECTION_IDS)
          : EMPTY_SELECTION_IDS,
      [activeWorkflowId]
    )
  )
  const workflowSubBlockValues = useSubBlockStore(
    useCallback(
      (state) =>
        activeWorkflowId
          ? (state.workflowValues[activeWorkflowId] ?? EMPTY_SUBBLOCK_VALUES)
          : EMPTY_SUBBLOCK_VALUES,
      [activeWorkflowId]
    )
  )

  const autoSelectionCards = useMemo<CanvasSelectionCard[]>(() => {
    if (!isActive || !activeWorkflowId || selectedCanvasNodeIds.length === 0) {
      return []
    }

    return selectedCanvasNodeIds.flatMap((blockId) => {
      const block = blocks[blockId]
      if (!block || block.type !== 'content') {
        return []
      }

      const storedValues = workflowSubBlockValues[blockId] as Record<string, unknown> | undefined
      const sourceValues = storedValues ?? (block.subBlocks as Record<string, unknown> | undefined)
      const variant = getStoredValue<string>(sourceValues, 'contentVariant', 'text')
      if (variant !== 'text' && variant !== 'image' && variant !== 'video' && variant !== 'audio') {
        return []
      }

      const file = getStoredValue<Record<string, unknown> | null>(sourceValues, 'file', null)
      return [
        {
          blockId,
          title: block.name || getContentNodePreset(variant)?.label || 'Content',
          variant,
          previewText:
            variant === 'text'
              ? stripHtmlPreview(getStoredValue<string>(sourceValues, 'contentHtml', '')).slice(
                  0,
                  80
                )
              : undefined,
          mediaPath:
            typeof file?.path === 'string'
              ? file.path
              : typeof file?.url === 'string'
                ? file.url
                : undefined,
          mediaName: typeof file?.name === 'string' ? file.name : undefined,
        },
      ]
    })
  }, [activeWorkflowId, blocks, isActive, selectedCanvasNodeIds, workflowSubBlockValues])

  const skillActionCards = useMemo<SkillActionCard[]>(
    () =>
      getCopilotSkillActionCards(
        agentProfile?.agent.code,
        agentProfile?.skills,
        managedSkillCardsData?.cards
      ),
    [agentProfile?.agent.code, agentProfile?.skills, managedSkillCardsData?.cards]
  )

  const handleSkillActionSelect = useCallback((action: SkillActionCard) => {
    if (action.actionKind === 'create_task') {
      window.dispatchEvent(
        new CustomEvent('production-task:create', {
          detail: { draft: action.taskDraft, prompt: action.prompt },
        })
      )
      return true
    }
    if (action.actionKind === 'submit_task') {
      window.dispatchEvent(
        new CustomEvent('production-task:submit-selected-node', {
          detail: { prompt: action.prompt },
        })
      )
      return true
    }
    return false
  }, [])

  const copilotChatTitle = useMemo(
    () =>
      copilotChatId ? (copilotChatList.find((c) => c.id === copilotChatId)?.title ?? null) : null,
    [copilotChatId, copilotChatList]
  )

  const loadCopilotChats = useCallback(() => {
    if (!activeWorkflowId) return
    queryClient.invalidateQueries({ queryKey: copilotChatsKeys.list(activeWorkflowId) })
  }, [activeWorkflowId, queryClient])

  const autoSelectAttemptedForRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!activeWorkflowId) return

    if (copilotChatId && !copilotChatList.find((c) => c.id === copilotChatId)) {
      setCopilotChatId(undefined)
      return
    }

    if (copilotChatId) return
    if (autoSelectAttemptedForRef.current.has(activeWorkflowId)) return
    if (copilotChatList.length === 0) return
    autoSelectAttemptedForRef.current.add(activeWorkflowId)
    setCopilotChatId(copilotChatList[0].id)
  }, [copilotChatList, copilotChatId, activeWorkflowId, setCopilotChatId])

  useEffect(() => {
    posthogRef.current = posthog
  }, [posthog])

  const handleCopilotSelectChat = useCallback(
    (chat: { id: string; title: string | null }) => {
      setCopilotChatId(chat.id)
      setIsCopilotHistoryOpen(false)
    },
    [setCopilotChatId]
  )

  const handleCopilotDeleteChat = useCallback(
    (chatId: string) => {
      requestJson(deleteCopilotChatContract, { body: { chatId } })
        .then(() => {
          if (copilotChatId === chatId) {
            setCopilotChatId(undefined)
          }
          loadCopilotChats()
        })
        .catch((err) => {
          logger.error('Failed to delete copilot chat', { error: toError(err).message, chatId })
        })
    },
    [copilotChatId, loadCopilotChats, setCopilotChatId]
  )

  const refreshWorkflowAfterLocalCanvasMutation = useCallback(
    (workflowId: string, source: string, toolName?: string) => {
      useWorkflowRegistry
        .getState()
        .refreshWorkflowState(workflowId, { reason: source })
        .catch((err) => {
          logger.error('Failed to refresh workflow after local canvas mutation', {
            error: toError(err).message,
            source,
            ...(toolName ? { toolName } : {}),
            workflowId,
          })
        })
    },
    []
  )

  const handleCopilotToolResult = useCallback(
    (toolName: string, success: boolean, _output: unknown) => {
      if (toolName !== 'edit_workflow' && !LOCAL_CANVAS_MUTATION_TOOLS.has(toolName)) return
      if (!success) return
      const workflowId = activeWorkflowId || useWorkflowRegistry.getState().activeWorkflowId
      if (!workflowId) return

      if (LOCAL_CANVAS_MUTATION_TOOLS.has(toolName)) {
        refreshWorkflowAfterLocalCanvasMutation(workflowId, 'tool-result', toolName)
        return
      }

      const baselineWorkflow = captureBaselineSnapshot(workflowId)

      requestJson(getWorkflowNormalizedStateContract, { params: { id: workflowId } })
        .then((freshState) => {
          const diffStore = useWorkflowDiffStore.getState()
          return diffStore.setProposedChanges(freshState as WorkflowState, undefined, {
            baselineWorkflow,
            skipPersist: true,
          })
        })
        .catch((err) => {
          logger.error('Failed to fetch/apply edit_workflow state', {
            error: toError(err).message,
            workflowId,
          })
        })
    },
    [activeWorkflowId, refreshWorkflowAfterLocalCanvasMutation]
  )

  const handleCopilotStreamEnd = useCallback(
    (_chatId: string) => {
      const workflowId = activeWorkflowId || useWorkflowRegistry.getState().activeWorkflowId
      if (!workflowId) return
      refreshWorkflowAfterLocalCanvasMutation(workflowId, 'stream-end')
    },
    [activeWorkflowId, refreshWorkflowAfterLocalCanvasMutation]
  )

  const {
    messages: copilotMessages,
    isSending: copilotIsSending,
    isReconnecting: copilotIsReconnecting,
    sendMessage: copilotSendMessage,
    stopGeneration: copilotStopGeneration,
    resolvedChatId: copilotResolvedChatId,
    messageQueue: copilotMessageQueue,
    removeFromQueue: copilotRemoveFromQueue,
    sendNow: copilotSendNow,
    editQueuedMessage: copilotEditQueuedMessage,
    getCurrentRequestId: getCopilotCurrentRequestId,
  } = useChat(
    workspaceId,
    copilotChatId,
    getWorkflowCopilotUseChatOptions({
      workflowId: activeWorkflowId || undefined,
      fixedSendOptions: { workflowCopilotMode: 'hermes_agent_v1' },
      onTitleUpdate: loadCopilotChats,
      onToolResult: handleCopilotToolResult,
      onStreamEnd: handleCopilotStreamEnd,
      onRequestStarted: ({ requestId, userMessageId }) => {
        captureEvent(posthogRef.current, 'task_request_started', {
          workspace_id: workspaceId,
          view: 'copilot',
          request_id: requestId,
          user_message_id: userMessageId,
        })
      },
    })
  )

  const handleCopilotNewChat = useCallback(() => {
    if (!activeWorkflowId || !workspaceId) return
    requestJson(createWorkflowCopilotChatContract, {
      body: { workspaceId, workflowId: activeWorkflowId },
    })
      .then((data) => {
        queryClient.setQueryData<CopilotChatListItem[]>(
          copilotChatsKeys.list(activeWorkflowId),
          (prev) => [
            {
              id: data.id,
              title: null,
              workflowId: activeWorkflowId,
              updatedAt: new Date().toISOString(),
              activeStreamId: null,
            },
            ...(prev ?? []),
          ]
        )
        setCopilotChatId(data.id)
        loadCopilotChats()
      })
      .catch((err) => {
        logger.error('Failed to create copilot chat', { error: toError(err).message })
      })
  }, [activeWorkflowId, workspaceId, loadCopilotChats, setCopilotChatId, queryClient])

  const prevResolvedRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (
      copilotResolvedChatId &&
      copilotResolvedChatId !== prevResolvedRef.current &&
      !copilotChatId
    ) {
      prevResolvedRef.current = copilotResolvedChatId
      setCopilotChatId(copilotResolvedChatId)
      loadCopilotChats()
    } else {
      prevResolvedRef.current = copilotResolvedChatId
    }
  }, [copilotResolvedChatId, copilotChatId, loadCopilotChats, setCopilotChatId])

  const wasCopilotSendingRef = useRef(false)
  useEffect(() => {
    if (wasCopilotSendingRef.current && !copilotIsSending) {
      loadCopilotChats()
    }
    wasCopilotSendingRef.current = copilotIsSending
  }, [copilotIsSending, loadCopilotChats])

  const handleCopilotStopGeneration = useCallback(() => {
    captureEvent(posthogRef.current, 'task_generation_aborted', {
      workspace_id: workspaceId,
      view: 'copilot',
      request_id: getCopilotCurrentRequestId(),
    })
    copilotStopGeneration()
  }, [copilotStopGeneration, getCopilotCurrentRequestId, workspaceId])

  const handleCopilotSubmit = useCallback(
    (
      text: string,
      fileAttachments?: FileAttachmentForApi[],
      contexts?: ChatContext[],
      options?: ChatSendOptions
    ) => {
      const trimmed = text.trim()
      if (!trimmed && !(fileAttachments && fileAttachments.length > 0)) return
      copilotSendMessage(
        trimmed || 'Analyze the attached file(s).',
        fileAttachments,
        contexts,
        options
      )
    },
    [copilotSendMessage]
  )

  useEffect(() => {
    if (!pendingMessage) return
    copilotSendMessage(pendingMessage)
    onPendingMessageConsumed()
  }, [copilotSendMessage, onPendingMessageConsumed, pendingMessage])

  useEffect(() => {
    if (!isActive) return
    const id = window.setTimeout(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        "[data-tab-content='copilot'] textarea"
      )
      textarea?.focus()
    }, 0)
    return () => window.clearTimeout(id)
  }, [isActive])

  return (
    <>
      <div className='mx-[-1px] flex flex-shrink-0 items-center justify-between gap-2 border border-[var(--border)] bg-[var(--surface-4)] px-3 py-1.5'>
        <h2 className='min-w-0 flex-1 truncate font-medium text-[14px] text-[var(--text-primary)]'>
          {copilotChatTitle || 'New Chat'}
        </h2>
        <div className='flex items-center gap-2'>
          <Button variant='ghost' className='p-0' onClick={handleCopilotNewChat}>
            <Plus className='h-[14px] w-[14px]' />
          </Button>
          <Popover
            open={isCopilotHistoryOpen}
            onOpenChange={(open) => {
              setIsCopilotHistoryOpen(open)
              if (open) loadCopilotChats()
            }}
          >
            <PopoverTrigger asChild>
              <Button variant='ghost' className='p-0'>
                <History className='h-[14px] w-[14px]' />
              </Button>
            </PopoverTrigger>
            <PopoverContent align='end' side='bottom' sideOffset={8} maxHeight={280}>
              {copilotChatList.length === 0 ? (
                <div className='px-1.5 py-4 text-center text-[12px] text-muted-foreground'>
                  No chats yet
                </div>
              ) : (
                <PopoverScrollArea>
                  <PopoverSection className='pt-0'>Recent</PopoverSection>
                  <div className='flex flex-col gap-0.5'>
                    {copilotChatList.map((chat) => (
                      <div key={chat.id} className='group'>
                        <PopoverItem
                          active={copilotChatId === chat.id}
                          onClick={() => handleCopilotSelectChat(chat)}
                        >
                          <ConversationListItem
                            title={chat.title || 'New Chat'}
                            isActive={Boolean(chat.activeStreamId)}
                            titleClassName='text-[13px]'
                            actions={
                              <div
                                className={`flex flex-shrink-0 items-center gap-1 ${copilotChatId !== chat.id ? 'opacity-0 transition-opacity group-hover:opacity-100' : ''}`}
                              >
                                <Button
                                  variant='ghost'
                                  className='h-[16px] w-[16px] p-0'
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleCopilotDeleteChat(chat.id)
                                  }}
                                  aria-label='Delete chat'
                                >
                                  <Trash className='h-[10px] w-[10px]' />
                                </Button>
                              </div>
                            }
                          />
                        </PopoverItem>
                      </div>
                    ))}
                  </div>
                </PopoverScrollArea>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <MothershipChat
        className='min-h-0 flex-1'
        messages={copilotMessages}
        isSending={copilotIsSending}
        isReconnecting={copilotIsReconnecting}
        onSubmit={handleCopilotSubmit}
        onStopGeneration={handleCopilotStopGeneration}
        messageQueue={copilotMessageQueue}
        onRemoveQueuedMessage={copilotRemoveFromQueue}
        onSendQueuedMessage={copilotSendNow}
        onEditQueuedMessage={copilotEditQueuedMessage}
        userId={session?.user?.id}
        chatId={copilotResolvedChatId}
        layout='copilot-view'
        fixedSendOptions={{ workflowCopilotMode: 'hermes_agent_v1' }}
        enableContentCanvasAgent
        autoSelectionCards={autoSelectionCards}
        skillActionCards={skillActionCards}
        onSkillActionSelect={handleSkillActionSelect}
      />
    </>
  )
}
