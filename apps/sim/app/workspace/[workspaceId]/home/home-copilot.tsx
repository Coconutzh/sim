'use client'

import type { ComponentType } from 'react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ArrowRight, Compass, PenLine, Users } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { Button } from '@/components/emcn'
import { PanelLeft } from '@/components/emcn/icons'
import { requestJson } from '@/lib/api/client/request'
import { createWorkflowContract } from '@/lib/api/contracts'
import { useSession } from '@/lib/auth/auth-client'
import {
  LandingPromptStorage,
  type LandingWorkflowSeed,
  LandingWorkflowSeedStorage,
} from '@/lib/core/utils/browser-storage'
import { captureEvent } from '@/lib/posthog/client'
import { TemplatePrompts } from '@/app/workspace/[workspaceId]/home/components/template-prompts'
import { UserInput } from '@/app/workspace/[workspaceId]/home/components/user-input'
import {
  getMothershipUseChatOptions,
  useChat,
  useMothershipResize,
} from '@/app/workspace/[workspaceId]/home/hooks'
import type {
  FileAttachmentForApi,
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import {
  useCreateTeamWorkspace,
  useMyWorkgroups,
  usePersonalWorkspace,
  useTeamWorkspace,
} from '@/hooks/queries/collaboration'
import { useChatHistory, useMarkTaskRead } from '@/hooks/queries/tasks'
import {
  useWorkspaceCanvasCreationCapabilities,
  useWorkspaceSettings,
} from '@/hooks/queries/workspace'
import type { ChatContext } from '@/stores/panel'

const logger = createLogger('Home')
const MothershipChat = lazy(() =>
  import('@/app/workspace/[workspaceId]/home/components/mothership-chat/mothership-chat').then(
    (module) => ({
      default: module.MothershipChat,
    })
  )
)
const MothershipView = lazy(() =>
  import('@/app/workspace/[workspaceId]/home/components/mothership-view/mothership-view').then(
    (module) => ({
      default: module.MothershipView,
    })
  )
)

interface HomeProps {
  chatId?: string
}

interface CanvasEntryCardProps {
  description: string
  disabled?: boolean
  eyebrow: string
  href: string
  icon: ComponentType<{ className?: string }>
  meta: string
  onClick?: () => void
  title: string
}

function CanvasEntryCard({
  description,
  disabled = false,
  eyebrow,
  href,
  icon: Icon,
  meta,
  onClick,
  title,
}: CanvasEntryCardProps) {
  const content = (
    <>
      <div className='flex items-start justify-between gap-4'>
        <div className='flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'>
          <Icon className='h-[16px] w-[16px] text-[var(--text-icon)]' />
        </div>
        <span className='rounded-[6px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
          {eyebrow}
        </span>
      </div>
      <div className='mt-5 flex min-h-[120px] flex-col'>
        <h2 className='font-medium text-[18px] text-[var(--text-primary)]'>{title}</h2>
        <p className='mt-2 text-[13px] text-[var(--text-muted)] leading-5'>{description}</p>
        <div className='mt-auto flex items-center justify-between gap-3 pt-5'>
          <span className='truncate text-[12px] text-[var(--text-tertiary)]'>{meta}</span>
          <ArrowRight className='h-[15px] w-[15px] flex-shrink-0 text-[var(--text-icon)]' />
        </div>
      </div>
    </>
  )

  if (disabled) {
    return (
      <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-4 opacity-60'>
        {content}
      </div>
    )
  }

  if (onClick) {
    return (
      <button
        type='button'
        onClick={onClick}
        className='group rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-4 text-left transition-colors hover-hover:bg-[var(--surface-hover)]'
      >
        {content}
      </button>
    )
  }

  return (
    <Link
      href={href}
      className='group rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-4 transition-colors hover-hover:bg-[var(--surface-hover)]'
    >
      {content}
    </Link>
  )
}

export function HomeCopilot({ chatId }: HomeProps = {}) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialResourceId = searchParams.get('resource')
  const { data: session } = useSession()
  const { data: workgroupsData } = useMyWorkgroups(Boolean(session?.user?.id))
  const workgroups = workgroupsData?.workgroups ?? []
  const { data: workspaceSettingsData } = useWorkspaceSettings(workspaceId)
  const { data: workspaceCanvasCreationCapabilities } = useWorkspaceCanvasCreationCapabilities(
    Boolean(session?.user?.id)
  )
  const currentWorkspaceWorkgroupId = workspaceSettingsData?.settings.workspace.workgroupId
  const activeWorkgroup =
    workgroups.find((workgroup) => workgroup.teamWorkspaceId === workspaceId) ??
    workgroups.find((workgroup) => workgroup.id === currentWorkspaceWorkgroupId) ??
    workgroups.find((workgroup) => workgroup.id === workgroupsData?.defaultWorkgroupId) ??
    workgroups[0]
  const activeWorkgroupId = activeWorkgroup?.id
  const { data: personalWorkspaceData } = usePersonalWorkspace(activeWorkgroupId)
  const { data: teamWorkspaceData } = useTeamWorkspace(activeWorkgroupId)
  const { mutateAsync: createTeamWorkspace, isPending: isCreatingTeamWorkspace } =
    useCreateTeamWorkspace()
  const personalWorkspaceId = personalWorkspaceData?.workspace.id ?? workspaceId
  const teamWorkspaceId = teamWorkspaceData?.workspace.id ?? activeWorkgroup?.teamWorkspaceId
  const isActiveWorkgroupAdmin = activeWorkgroup?.role === 'admin'
  const canInitializeActiveTeamCanvas =
    isActiveWorkgroupAdmin && workspaceCanvasCreationCapabilities?.canCreateTeamCanvas === true
  const posthog = usePostHog()
  const posthogRef = useRef(posthog)
  posthogRef.current = posthog
  const [initialPrompt, setInitialPrompt] = useState('')
  const hasCheckedLandingStorageRef = useRef(false)
  const initialViewInputRef = useRef<HTMLDivElement>(null)
  const templateRef = useRef<HTMLDivElement>(null)
  const [isInputEntering, setIsInputEntering] = useState(false)

  const createWorkflowFromLandingSeed = useCallback(
    async (seed: LandingWorkflowSeed) => {
      try {
        const { persistImportedWorkflow } = await import('@/lib/workflows/operations/import-export')
        const result = await persistImportedWorkflow({
          content: seed.workflowJson,
          filename: `${seed.workflowName}.json`,
          workspaceId,
          nameOverride: seed.workflowName,
          descriptionOverride: seed.workflowDescription || 'Imported from landing template',
          colorOverride: seed.color,
          createWorkflow: async ({ name, description, color, workspaceId }) => {
            return requestJson(createWorkflowContract, {
              body: {
                name,
                description,
                color,
                workspaceId,
                deduplicate: true,
              },
            })
          },
        })

        if (result?.workflowId) {
          window.location.href = `/workspace/${workspaceId}/w/${result.workflowId}`
          return
        }

        logger.warn('Landing workflow seed did not produce a workflow', {
          templateId: seed.templateId,
        })
      } catch (error) {
        logger.error('Error creating workflow from landing workflow seed:', error)
      }
    },
    [workspaceId]
  )

  useEffect(() => {
    if (hasCheckedLandingStorageRef.current) return
    hasCheckedLandingStorageRef.current = true

    const workflowSeed = LandingWorkflowSeedStorage.consume()
    if (workflowSeed) {
      logger.info('Retrieved landing page workflow seed, creating workflow in workspace')
      void createWorkflowFromLandingSeed(workflowSeed)
      return
    }

    const prompt = LandingPromptStorage.consume()
    if (prompt) {
      logger.info('Retrieved landing page prompt, populating home input')
      setInitialPrompt(prompt)
    }
  }, [createWorkflowFromLandingSeed])

  const wasSendingRef = useRef(false)

  const { isPending: isChatHistoryPending } = useChatHistory(chatId)
  const { mutate: markRead } = useMarkTaskRead(workspaceId)

  const { mothershipRef, handleResizePointerDown, clearWidth } = useMothershipResize()

  const [isResourceCollapsed, setIsResourceCollapsed] = useState(true)
  const [skipResourceTransition, setSkipResourceTransition] = useState(false)
  const isResourceCollapsedRef = useRef(isResourceCollapsed)
  isResourceCollapsedRef.current = isResourceCollapsed

  const collapseResource = useCallback(() => {
    clearWidth()
    setIsResourceCollapsed(true)
  }, [clearWidth])

  function handleResourceEvent() {
    if (isResourceCollapsedRef.current) {
      setIsResourceCollapsed(false)
    }
  }

  const {
    messages,
    isSending,
    isReconnecting,
    sendMessage,
    stopGeneration,
    resolvedChatId,
    resources,
    activeResourceId,
    setActiveResourceId,
    addResource,
    removeResource,
    reorderResources,
    messageQueue,
    removeFromQueue,
    sendNow,
    editQueuedMessage,
    previewSession,
    genericResourceData,
    getCurrentRequestId,
  } = useChat(
    workspaceId,
    chatId,
    getMothershipUseChatOptions({
      onResourceEvent: handleResourceEvent,
      initialActiveResourceId: initialResourceId,
      onRequestStarted: ({ requestId, userMessageId }) => {
        captureEvent(posthogRef.current, 'task_request_started', {
          workspace_id: workspaceId,
          view: 'mothership',
          request_id: requestId,
          user_message_id: userMessageId,
        })
      },
    })
  )

  useEffect(() => {
    const url = new URL(window.location.href)
    if (activeResourceId) {
      url.searchParams.set('resource', activeResourceId)
    } else {
      url.searchParams.delete('resource')
    }
    url.hash = ''
    window.history.replaceState(null, '', url.toString())
  }, [activeResourceId])

  useEffect(() => {
    wasSendingRef.current = false
    if (resolvedChatId) {
      markRead(resolvedChatId)
    } else {
      clearWidth()
      setIsResourceCollapsed(true)
    }
  }, [resolvedChatId, markRead, clearWidth])

  useEffect(() => {
    if (wasSendingRef.current && !isSending && resolvedChatId) {
      markRead(resolvedChatId)
    }
    wasSendingRef.current = isSending
  }, [isSending, resolvedChatId, markRead])

  useEffect(() => {
    if (!(resources.length > 0 && isResourceCollapsedRef.current)) return
    setIsResourceCollapsed(false)
    setSkipResourceTransition(true)
    const id = requestAnimationFrame(() => setSkipResourceTransition(false))
    return () => cancelAnimationFrame(id)
  }, [resources])

  useEffect(() => {
    if (resources.length === 0 && !isResourceCollapsedRef.current) {
      collapseResource()
    }
  }, [resources, collapseResource])

  function handleStopGeneration() {
    captureEvent(posthogRef.current, 'task_generation_aborted', {
      workspace_id: workspaceId,
      view: 'mothership',
      request_id: getCurrentRequestId(),
    })
    void stopGeneration().catch(() => {})
  }

  function handleSubmit(
    text: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[]
  ) {
    const trimmed = text.trim()
    if (!trimmed && !(fileAttachments && fileAttachments.length > 0)) return

    captureEvent(posthogRef.current, 'task_message_sent', {
      workspace_id: workspaceId,
      has_attachments: !!(fileAttachments && fileAttachments.length > 0),
      has_contexts: !!(contexts && contexts.length > 0),
      is_new_task: !chatId,
    })

    if (initialViewInputRef.current) {
      setIsInputEntering(true)
    }

    sendMessage(trimmed || 'Analyze the attached file(s).', fileAttachments, contexts)
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const message = (e as CustomEvent<{ message: string }>).detail?.message
      if (message) sendMessage(message)
    }
    window.addEventListener('mothership-send-message', handler)
    return () => window.removeEventListener('mothership-send-message', handler)
  }, [sendMessage])

  function resolveResourceFromContext(
    context: ChatContext
  ): { type: MothershipResourceType; id: string } | null {
    switch (context.kind) {
      case 'workflow':
      case 'current_workflow':
        return context.workflowId ? { type: 'workflow', id: context.workflowId } : null
      case 'knowledge':
        return context.knowledgeId ? { type: 'knowledgebase', id: context.knowledgeId } : null
      case 'table':
        return context.tableId ? { type: 'table', id: context.tableId } : null
      case 'file':
        return context.fileId ? { type: 'file', id: context.fileId } : null
      default:
        return null
    }
  }

  function handleContextAdd(context: ChatContext) {
    const resolved = resolveResourceFromContext(context)
    if (resolved) {
      addResource({ ...resolved, title: context.label })
      handleResourceEvent()
    }
  }

  function handleInitialContextRemove(context: ChatContext) {
    const resolved = resolveResourceFromContext(context)
    if (!resolved) return
    removeResource(resolved.type, resolved.id)
  }

  function handleWorkspaceResourceSelect(resource: MothershipResource) {
    const wasAdded = addResource(resource)
    if (!wasAdded) {
      setActiveResourceId(resource.id)
    }
    handleResourceEvent()
  }

  const handleInitializeTeamCanvas = useCallback(async () => {
    if (!activeWorkgroupId || !canInitializeActiveTeamCanvas || isCreatingTeamWorkspace) return
    const result = await createTeamWorkspace({ workgroupId: activeWorkgroupId })
    router.push(
      result.defaultWorkflowId
        ? `/workspace/${result.workspace.id}/w/${result.defaultWorkflowId}`
        : `/workspace/${result.workspace.id}/home`
    )
  }, [
    activeWorkgroupId,
    canInitializeActiveTeamCanvas,
    createTeamWorkspace,
    isCreatingTeamWorkspace,
    router,
  ])

  const hasMessages = messages.length > 0
  const showChatSkeleton = Boolean(chatId) && !hasMessages && isChatHistoryPending
  const draftScopeKey = `${workspaceId}:${chatId ?? 'new'}`

  if (!hasMessages && !showChatSkeleton) {
    return (
      <div className='h-full overflow-y-auto bg-[var(--bg)] [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex min-h-full w-full max-w-[72rem] flex-col px-4 pt-10 pb-8 sm:px-6 lg:px-10'>
          <div className='mb-5 flex flex-col gap-2'>
            <span className='text-[12px] text-[var(--text-muted)]'>
              {activeWorkgroup
                ? `${activeWorkgroup.discipline.name} / ${activeWorkgroup.name}`
                : 'Canvas context'}
            </span>
            <h1
              data-tour='home-greeting'
              className='max-w-[42rem] text-balance font-[430] font-season text-[32px] text-[var(--text-primary)] tracking-[-0.02em]'
            >
              Choose a canvas
              {session?.user?.name ? `, ${session.user.name.split(' ')[0]}` : ''}
            </h1>
            <p className='max-w-[46rem] text-[14px] text-[var(--text-muted)] leading-6'>
              Start from a private draft, jump into the team canvas, or review read-only showcase
              work without leaving the original Sim canvas shell.
            </p>
          </div>
          <div className='grid gap-3 md:grid-cols-3'>
            <CanvasEntryCard
              description='Private space for ideas, tests, and nodes that are not ready for the team.'
              eyebrow='Private'
              href={`/workspace/${personalWorkspaceId}/home`}
              icon={PenLine}
              meta='Only you can edit'
              title='Personal draft canvas'
            />
            <CanvasEntryCard
              description='Shared work area for your active workgroup. Team members collaborate here.'
              disabled={!teamWorkspaceId && !canInitializeActiveTeamCanvas}
              eyebrow='Team'
              href={teamWorkspaceId ? `/workspace/${teamWorkspaceId}/home` : '#'}
              icon={Users}
              meta={
                teamWorkspaceId
                  ? activeWorkgroup?.name || 'Team canvas'
                  : canInitializeActiveTeamCanvas
                    ? 'Admin can initialize'
                    : 'Waiting for team admin'
              }
              onClick={
                !teamWorkspaceId && canInitializeActiveTeamCanvas
                  ? handleInitializeTeamCanvas
                  : undefined
              }
              title={teamWorkspaceId ? 'Team canvas' : 'Initialize team canvas'}
            />
            <CanvasEntryCard
              description='Read-only published versions shared with your team or organization.'
              disabled={!activeWorkgroupId}
              eyebrow='Read-only'
              href={`/workspace/${teamWorkspaceId ?? workspaceId}/showcase`}
              icon={Compass}
              meta='Published work'
              title='Showcase canvas'
            />
          </div>
          <div className='mt-10 flex flex-col items-center'>
            <h2 className='mb-4 text-[13px] text-[var(--text-muted)]'>Or ask Copilot to help</h2>
            <div ref={initialViewInputRef} className='w-full' data-tour='home-chat-input'>
              <UserInput
                defaultValue={initialPrompt}
                draftScopeKey={draftScopeKey}
                onSubmit={handleSubmit}
                isSending={isSending}
                onStopGeneration={handleStopGeneration}
                userId={session?.user?.id}
                onContextAdd={handleContextAdd}
                onContextRemove={handleInitialContextRemove}
              />
            </div>
          </div>
        </div>
        <div
          ref={templateRef}
          data-tour='home-templates'
          className='mx-auto w-full max-w-[68rem] px-4 pb-8 sm:px-6 lg:px-10'
        >
          <TemplatePrompts onSelect={handleSubmit} />
        </div>
      </div>
    )
  }

  return (
    <div className='relative flex h-full bg-[var(--bg)]'>
      <div className='flex h-full min-w-[320px] flex-1 flex-col'>
        <Suspense fallback={null}>
          <MothershipChat
            messages={messages}
            isSending={isSending}
            isReconnecting={isReconnecting}
            isLoading={showChatSkeleton}
            onSubmit={handleSubmit}
            onStopGeneration={handleStopGeneration}
            messageQueue={messageQueue}
            onRemoveQueuedMessage={removeFromQueue}
            onSendQueuedMessage={sendNow}
            onEditQueuedMessage={editQueuedMessage}
            userId={session?.user?.id}
            chatId={resolvedChatId}
            onContextAdd={handleContextAdd}
            onWorkspaceResourceSelect={handleWorkspaceResourceSelect}
            draftScopeKey={draftScopeKey}
            animateInput={isInputEntering}
            onInputAnimationEnd={isInputEntering ? () => setIsInputEntering(false) : undefined}
            initialScrollBlocked={resources.length > 0 && isResourceCollapsed}
          />
        </Suspense>
      </div>

      {!isResourceCollapsed && (
        <div className='relative z-20 w-0 flex-none'>
          <div
            className='absolute inset-y-0 left-[-4px] w-[8px] cursor-ew-resize'
            role='separator'
            aria-orientation='vertical'
            aria-label='Resize resource panel'
            onPointerDown={handleResizePointerDown}
          />
        </div>
      )}

      <Suspense fallback={null}>
        <MothershipView
          ref={mothershipRef}
          workspaceId={workspaceId}
          chatId={resolvedChatId}
          resources={resources}
          activeResourceId={activeResourceId}
          onSelectResource={setActiveResourceId}
          onAddResource={addResource}
          onRemoveResource={removeResource}
          onReorderResources={reorderResources}
          onCollapse={collapseResource}
          isCollapsed={isResourceCollapsed}
          previewSession={previewSession}
          genericResourceData={genericResourceData ?? undefined}
          className={skipResourceTransition ? '!transition-none' : undefined}
        />
      </Suspense>

      {isResourceCollapsed && (
        <div className='absolute top-[8.5px] right-[16px]'>
          <Button
            variant='ghost'
            size={null}
            type='button'
            onClick={() => setIsResourceCollapsed(false)}
            className='h-[30px] w-[30px] rounded-[8px] hover-hover:bg-[var(--surface-active)]'
            aria-label='Expand resource view'
          >
            <PanelLeft className='h-[16px] w-[16px] text-[var(--text-icon)]' />
          </Button>
        </div>
      )}
    </div>
  )
}
