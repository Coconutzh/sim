'use client'

import type React from 'react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createLogger } from '@sim/logger'
import {
  Check,
  ChevronDown,
  Image as ImageIcon,
  Music4,
  Paperclip,
  Type,
  Video,
} from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { getMothershipAttachmentPreviewUrl } from '@/lib/copilot/chat/attachment-preview'
import { SIM_RESOURCE_DRAG_TYPE, SIM_RESOURCES_DRAG_TYPE } from '@/lib/copilot/resource-types'
import { cn } from '@/lib/core/utils/cn'
import { CHAT_ACCEPT_ATTRIBUTE } from '@/lib/uploads/utils/validation'
import { ContextMentionIcon } from '@/app/workspace/[workspaceId]/home/components/context-mention-icon'
import { useAvailableResources } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown'
import type { PlusMenuHandle } from '@/app/workspace/[workspaceId]/home/components/user-input/components'
import {
  AnimatedPlaceholderEffect,
  AttachedFilesList,
  autoResizeTextarea,
  DropOverlay,
  MAX_CHAT_TEXTAREA_HEIGHT,
  MicButton,
  mapResourceToContext,
  OVERLAY_CLASSES,
  PlusMenuDropdown,
  SendButton,
  type SkillActionCard,
  SkillActionCards,
  TEXTAREA_BASE_CLASSES,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components'
import type {
  AutoSelectionContextForApi,
  CanvasSelectionCard,
  ChatSendOptions,
  ConfirmationMode,
  FileAttachmentForApi,
  MothershipResource,
  MothershipResourceType,
  QueuedMessage,
  ThinkingLevel,
} from '@/app/workspace/[workspaceId]/home/types'
import {
  useContextManagement,
  useFileAttachments,
  useMentionMenu,
  useMentionTokens,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks'
import type { AttachedFile } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import {
  computeMentionHighlightRanges,
  extractContextTokens,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import { useWorkflowMap } from '@/hooks/queries/workflows'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useSpeechToText } from '@/hooks/use-speech-to-text'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
import type { ChatContext } from '@/stores/panel'

export type { FileAttachmentForApi } from '@/app/workspace/[workspaceId]/home/types'

const logger = createLogger('UserInput')
const ALL_RESOURCE_TYPES = [
  'workflow',
  'folder',
  'table',
  'file',
  'knowledgebase',
  'task',
  'log',
] as const satisfies readonly MothershipResourceType[]
const INITIAL_RESOURCE_TYPES = [
  'workflow',
  'folder',
] as const satisfies readonly MothershipResourceType[]

function getCaretAnchor(
  textarea: HTMLTextAreaElement,
  caretPos: number
): { left: number; top: number } {
  const textareaRect = textarea.getBoundingClientRect()
  const style = window.getComputedStyle(textarea)

  const mirror = document.createElement('div')
  mirror.style.position = 'absolute'
  mirror.style.top = '0'
  mirror.style.left = '0'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.font = style.font
  mirror.style.padding = style.padding
  mirror.style.border = style.border
  mirror.style.width = style.width
  mirror.style.lineHeight = style.lineHeight
  mirror.style.boxSizing = style.boxSizing
  mirror.style.letterSpacing = style.letterSpacing
  mirror.style.textTransform = style.textTransform
  mirror.style.textIndent = style.textIndent
  mirror.style.textAlign = style.textAlign
  mirror.textContent = textarea.value.substring(0, caretPos)

  const marker = document.createElement('span')
  marker.style.display = 'inline-block'
  marker.style.width = '0px'
  marker.style.padding = '0'
  marker.style.border = '0'
  marker.style.verticalAlign = 'text-top'
  mirror.appendChild(marker)

  document.body.appendChild(mirror)
  const markerRect = marker.getBoundingClientRect()
  const mirrorRect = mirror.getBoundingClientRect()
  document.body.removeChild(mirror)

  return {
    left: textareaRect.left + (markerRect.left - mirrorRect.left) - textarea.scrollLeft,
    top: textareaRect.top + (markerRect.top - mirrorRect.top) - textarea.scrollTop,
  }
}

function stripHtmlPreview(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildAutoSelectionContexts(
  cards: CanvasSelectionCard[] | undefined
): AutoSelectionContextForApi[] | undefined {
  if (!cards || cards.length === 0) return undefined
  return [
    {
      kind: 'blocks',
      blockIds: cards.map((card) => card.blockId),
      label: `Current canvas selection (${cards.length})`,
    },
  ]
}

function buildManualCanvasContext(cards: CanvasSelectionCard[] | undefined): ChatContext | null {
  if (!cards || cards.length === 0) return null
  const titles = cards
    .slice(0, 2)
    .map((card) => card.title)
    .filter(Boolean)
  const label =
    cards.length <= 2
      ? titles.join(', ')
      : `${titles.join(', ')} +${Math.max(cards.length - titles.length, 0)}`

  return {
    kind: 'blocks',
    blockIds: cards.map((card) => card.blockId),
    label: label || `Canvas nodes (${cards.length})`,
  }
}

function SelectionCardIcon({ variant }: { variant: CanvasSelectionCard['variant'] }) {
  const className = 'h-3.5 w-3.5 text-[var(--text-icon)]'
  if (variant === 'text') return <Type className={className} />
  if (variant === 'image') return <ImageIcon className={className} />
  if (variant === 'video') return <Video className={className} />
  return <Music4 className={className} />
}

interface UserInputProps {
  defaultValue?: string
  draftScopeKey?: string
  onSubmit: (
    text: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[],
    options?: ChatSendOptions
  ) => void
  isSending: boolean
  onStopGeneration: () => void
  isInitialView?: boolean
  userId?: string
  onContextAdd?: (context: ChatContext) => void
  onContextRemove?: (context: ChatContext) => void
  onSendQueuedHead?: () => void
  onEditQueuedTail?: () => void
  enableSpeech?: boolean
  lazyResourceLoading?: boolean
  fixedSendOptions?: ChatSendOptions
  enableContentCanvasAgent?: boolean
  autoSelectionCards?: CanvasSelectionCard[]
  skillActionCards?: SkillActionCard[]
  onSkillActionSelect?: (action: SkillActionCard) => boolean | undefined
}

export interface UserInputHandle {
  loadQueuedMessage: (msg: QueuedMessage) => void
}

export const UserInput = forwardRef<UserInputHandle, UserInputProps>(function UserInput(
  {
    defaultValue = '',
    draftScopeKey,
    onSubmit,
    isSending,
    onStopGeneration,
    isInitialView = true,
    userId,
    onContextAdd,
    onContextRemove,
    onSendQueuedHead,
    onEditQueuedTail,
    enableSpeech = true,
    lazyResourceLoading = false,
    fixedSendOptions,
    enableContentCanvasAgent = false,
    autoSelectionCards,
    skillActionCards,
    onSkillActionSelect,
  },
  ref
) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { navigateToSettings } = useSettingsNavigation()
  const { data: workflowsById = {} } = useWorkflowMap(workspaceId)
  const { data: session } = useSession()
  const [value, setValue] = useState(() => {
    if (defaultValue) return defaultValue
    if (!draftScopeKey) return ''
    const text = useMothershipDraftsStore.getState().drafts[draftScopeKey]?.text
    return typeof text === 'string' ? text : ''
  })
  const overlayRef = useRef<HTMLDivElement>(null)
  const plusMenuRef = useRef<PlusMenuHandle>(null)
  const [confirmationMode, setConfirmationMode] = useState<ConfirmationMode>('manual')
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('standard')

  const [prevDefaultValue, setPrevDefaultValue] = useState(defaultValue)
  const [resourceLookupEnabled, setResourceLookupEnabled] = useState(!lazyResourceLoading)
  const [resourceTypes, setResourceTypes] = useState<readonly MothershipResourceType[]>(() =>
    lazyResourceLoading ? INITIAL_RESOURCE_TYPES : ALL_RESOURCE_TYPES
  )
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [isTextareaFocused, setIsTextareaFocused] = useState(false)
  if (defaultValue && defaultValue !== prevDefaultValue) {
    setPrevDefaultValue(defaultValue)
    setValue(defaultValue)
  } else if (!defaultValue && prevDefaultValue) {
    setPrevDefaultValue(defaultValue)
  }

  const files = useFileAttachments({
    userId: userId || session?.user?.id,
    workspaceId,
    disabled: false,
    isLoading: isSending,
  })
  const hasFiles = files.attachedFiles.some((f) => !f.uploading && f.key)
  const hasUploadingFiles = files.attachedFiles.some((f) => f.uploading)

  const contextManagement = useContextManagement({ message: value })

  const { addContext } = contextManagement

  const handleContextAdd = useCallback(
    (context: ChatContext) => {
      addContext(context)
      onContextAdd?.(context)
    },
    [addContext, onContextAdd]
  )

  const draftScopeKeyRef = useRef(draftScopeKey)
  draftScopeKeyRef.current = draftScopeKey

  const hasRestoredDraftRef = useRef(false)
  useEffect(() => {
    if (hasRestoredDraftRef.current || !draftScopeKey) return
    hasRestoredDraftRef.current = true
    let restoredContexts: ChatContext[] | null = null
    let restoredFiles: AttachedFile[] | null = null
    let caretText: string | null = null
    try {
      const draft = useMothershipDraftsStore.getState().drafts[draftScopeKey]
      if (!draft) return
      if (draft.contexts?.length) {
        restoredContexts = draft.contexts
      }
      if (draft.fileAttachments?.length) {
        restoredFiles = draft.fileAttachments.map((a) => ({
          id: a.id,
          name: a.filename,
          size: a.size,
          type: a.media_type,
          path: a.path ?? '',
          key: a.key,
          uploading: false,
          previewUrl: getMothershipAttachmentPreviewUrl(a),
        }))
      }
      if (typeof draft.text === 'string' && draft.text.length > 0) {
        caretText = draft.text
      }
    } catch (err) {
      logger.error('Failed to read draft, clearing', { err })
      useMothershipDraftsStore.getState().clearDraft(draftScopeKey)
      return
    }
    if (restoredContexts) contextManagement.setSelectedContexts(restoredContexts)
    if (restoredFiles) files.restoreAttachedFiles(restoredFiles)
    if (caretText !== null) {
      const textarea = textareaRef.current
      if (textarea) {
        textarea.focus()
        textarea.setSelectionRange(caretText.length, caretText.length)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- intentional mount-only restore

  const isFirstSaveRef = useRef(true)
  useEffect(() => {
    if (isFirstSaveRef.current) {
      isFirstSaveRef.current = false
      return
    }
    if (!draftScopeKeyRef.current) return
    const fileAttachments = files.attachedFiles
      .filter((f) => !f.uploading && f.key)
      .map((f) => ({
        id: f.id,
        key: f.key!,
        filename: f.name,
        media_type: f.type,
        size: f.size,
        ...(f.path ? { path: f.path } : {}),
      }))
    useMothershipDraftsStore.getState().setDraft(draftScopeKeyRef.current, {
      text: value,
      fileAttachments: fileAttachments.length > 0 ? fileAttachments : undefined,
      contexts:
        contextManagement.selectedContexts.length > 0
          ? contextManagement.selectedContexts
          : undefined,
    })
  }, [value, files.attachedFiles, contextManagement.selectedContexts])

  const onContextRemoveRef = useRef(onContextRemove)
  onContextRemoveRef.current = onContextRemove

  const prevSelectedContextsRef = useRef<ChatContext[]>([])
  useEffect(() => {
    const prev = prevSelectedContextsRef.current
    const curr = contextManagement.selectedContexts
    const contextId = (ctx: ChatContext): string => {
      switch (ctx.kind) {
        case 'workflow':
        case 'current_workflow':
          return `${ctx.kind}:${ctx.workflowId}`
        case 'knowledge':
          return `knowledge:${ctx.knowledgeId ?? ''}`
        case 'table':
          return `table:${ctx.tableId}`
        case 'file':
          return `file:${ctx.fileId}`
        case 'folder':
          return `folder:${ctx.folderId}`
        case 'past_chat':
          return `past_chat:${ctx.chatId}`
        default:
          return `${ctx.kind}:${ctx.label}`
      }
    }
    const removed = prev.filter((p) => !curr.some((c) => contextId(c) === contextId(p)))
    if (removed.length > 0) removed.forEach((ctx) => onContextRemoveRef.current?.(ctx))
    prevSelectedContextsRef.current = curr
  }, [contextManagement.selectedContexts])

  const existingResourceKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const ctx of contextManagement.selectedContexts) {
      if (ctx.kind === 'workflow' && ctx.workflowId) keys.add(`workflow:${ctx.workflowId}`)
      if (ctx.kind === 'knowledge' && ctx.knowledgeId) keys.add(`knowledgebase:${ctx.knowledgeId}`)
      if (ctx.kind === 'table' && ctx.tableId) keys.add(`table:${ctx.tableId}`)
      if (ctx.kind === 'file' && ctx.fileId) keys.add(`file:${ctx.fileId}`)
      if (ctx.kind === 'folder' && ctx.folderId) keys.add(`folder:${ctx.folderId}`)
      if (ctx.kind === 'past_chat' && ctx.chatId) keys.add(`task:${ctx.chatId}`)
    }
    return keys
  }, [contextManagement.selectedContexts])

  useEffect(() => {
    if (!lazyResourceLoading) {
      setResourceTypes(ALL_RESOURCE_TYPES)
      return
    }
    if (!resourceLookupEnabled) {
      setResourceTypes(INITIAL_RESOURCE_TYPES)
      return
    }

    setResourceTypes(INITIAL_RESOURCE_TYPES)
  }, [lazyResourceLoading, resourceLookupEnabled])

  useEffect(() => {
    if (!lazyResourceLoading || !resourceLookupEnabled) return
    if (mentionQuery && mentionQuery.trim().length > 0) {
      setResourceTypes(ALL_RESOURCE_TYPES)
    }
  }, [lazyResourceLoading, mentionQuery, resourceLookupEnabled])

  const handleRequestFullResources = useCallback(() => {
    if (lazyResourceLoading) {
      setResourceTypes(ALL_RESOURCE_TYPES)
    }
  }, [lazyResourceLoading])

  const availableResources = useAvailableResources(workspaceId, existingResourceKeys, undefined, {
    enabled: resourceLookupEnabled,
    includeTypes: resourceTypes,
  })

  const mentionMenu = useMentionMenu({
    message: value,
    selectedContexts: contextManagement.selectedContexts,
    onContextSelect: handleContextAdd,
    onMessageChange: setValue,
  })

  const mentionTokensWithContext = useMentionTokens({
    message: value,
    selectedContexts: contextManagement.selectedContexts,
    mentionMenu,
    setMessage: setValue,
    setSelectedContexts: contextManagement.setSelectedContexts,
  })

  const canSubmit = (value.trim().length > 0 || hasFiles) && !isSending && !hasUploadingFiles

  const valueRef = useRef(value)
  valueRef.current = value
  const sttPrefixRef = useRef('')

  function handleTranscript(text: string) {
    const prefix = sttPrefixRef.current
    const newVal = prefix ? `${prefix} ${text}` : text
    setValue(newVal)
    valueRef.current = newVal
  }

  function handleUsageLimitExceeded() {
    navigateToSettings({ section: 'subscription' })
  }

  const {
    isListening,
    isSupported: isSttSupported,
    toggleListening: rawToggle,
    resetTranscript,
  } = useSpeechToText({
    onTranscript: handleTranscript,
    onUsageLimitExceeded: handleUsageLimitExceeded,
    enabled: enableSpeech,
  })

  const toggleListening = useCallback(() => {
    if (!isListening) {
      sttPrefixRef.current = valueRef.current
    }
    rawToggle()
  }, [isListening, rawToggle])

  const filesRef = useRef(files)
  filesRef.current = files
  const contextRef = useRef(contextManagement)
  contextRef.current = contextManagement
  const onSendQueuedHeadRef = useRef(onSendQueuedHead)
  onSendQueuedHeadRef.current = onSendQueuedHead
  const onEditQueuedTailRef = useRef(onEditQueuedTail)
  onEditQueuedTailRef.current = onEditQueuedTail
  const isSendingRef = useRef(isSending)
  isSendingRef.current = isSending

  const textareaRef = mentionMenu.textareaRef
  const wasSendingRef = useRef(false)
  const atInsertPosRef = useRef<number | null>(null)
  const pendingCursorRef = useRef<number | null>(null)
  const mentionRangeRef = useRef<{ start: number; end: number } | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      loadQueuedMessage: (msg: QueuedMessage) => {
        setValue(msg.content)
        const restored: AttachedFile[] = (msg.fileAttachments ?? []).map((a) => ({
          id: a.id,
          name: a.filename,
          size: a.size,
          type: a.media_type,
          path: a.path ?? '',
          key: a.key,
          uploading: false,
          previewUrl: getMothershipAttachmentPreviewUrl(a),
        }))
        files.restoreAttachedFiles(restored)
        contextManagement.setSelectedContexts(msg.contexts ?? [])
        requestAnimationFrame(() => {
          const textarea = textareaRef.current
          if (!textarea) return
          textarea.focus()
          const end = textarea.value.length
          textarea.setSelectionRange(end, end)
        })
      },
    }),
    [files.restoreAttachedFiles, contextManagement.setSelectedContexts, textareaRef]
  )

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const maxHeight = isInitialView ? window.innerHeight * 0.3 : MAX_CHAT_TEXTAREA_HEIGHT
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
    if (overlayRef.current) {
      overlayRef.current.scrollTop = textarea.scrollTop
    }
  }, [value, isInitialView, textareaRef])

  const handleResourceSelect = useCallback(
    (resource: MothershipResource) => {
      const textarea = textareaRef.current
      if (textarea) {
        const currentValue = valueRef.current
        const range = mentionRangeRef.current
        let before: string
        let after: string
        let insertText: string
        let newPos: number

        if (range) {
          before = currentValue.slice(0, range.start)
          after = currentValue.slice(range.end)
          const needsSpaceBefore =
            range.start > 0 && !/\s/.test(currentValue.charAt(range.start - 1))
          insertText = `${needsSpaceBefore ? ' ' : ''}@${resource.title} `
          newPos = before.length + insertText.length
        } else {
          const insertAt = atInsertPosRef.current ?? textarea.selectionStart ?? currentValue.length
          const needsSpaceBefore = insertAt > 0 && !/\s/.test(currentValue.charAt(insertAt - 1))
          insertText = `${needsSpaceBefore ? ' ' : ''}@${resource.title} `
          before = currentValue.slice(0, insertAt)
          after = currentValue.slice(insertAt)
          newPos = before.length + insertText.length
        }

        const newValue = `${before}${insertText}${after}`
        pendingCursorRef.current = newPos
        valueRef.current = newValue
        atInsertPosRef.current = newPos
        mentionRangeRef.current = null
        setMentionQuery(null)
        setValue(newValue)
      }

      const context = mapResourceToContext(resource)
      handleContextAdd(context)
    },
    [textareaRef, handleContextAdd]
  )

  const handlePlusMenuClose = useCallback(() => {
    atInsertPosRef.current = null
    mentionRangeRef.current = null
    setMentionQuery(null)
  }, [])

  const handleFileSelectStable = useCallback(() => {
    filesRef.current.handleFileSelect()
  }, [])

  const handleAddCanvasSelectionContext = useCallback(() => {
    const context = buildManualCanvasContext(autoSelectionCards)
    if (!context) return
    handleContextAdd(context)
  }, [autoSelectionCards, handleContextAdd])

  const handleFileClick = useCallback((file: AttachedFile) => {
    filesRef.current.handleFileClick(file)
  }, [])

  const handleRemoveFile = useCallback((id: string) => {
    filesRef.current.removeFile(id)
  }, [])

  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    if (
      e.dataTransfer.types.includes(SIM_RESOURCE_DRAG_TYPE) ||
      e.dataTransfer.types.includes(SIM_RESOURCES_DRAG_TYPE)
    ) {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      return
    }
    filesRef.current.handleDragOver(e)
  }, [])

  const handleContainerDrop = useCallback(
    (e: React.DragEvent) => {
      const resourcesJson = e.dataTransfer.getData(SIM_RESOURCES_DRAG_TYPE)
      if (resourcesJson) {
        e.preventDefault()
        e.stopPropagation()
        try {
          const resources = JSON.parse(resourcesJson) as MothershipResource[]
          for (const resource of resources) {
            handleResourceSelect(resource)
          }
          // Reset after batch so the next non-drop insert uses the cursor position
          atInsertPosRef.current = null
        } catch {}
        textareaRef.current?.focus()
        return
      }
      const resourceJson = e.dataTransfer.getData(SIM_RESOURCE_DRAG_TYPE)
      if (resourceJson) {
        e.preventDefault()
        e.stopPropagation()
        try {
          const resource = JSON.parse(resourceJson) as MothershipResource
          handleResourceSelect(resource)
          atInsertPosRef.current = null
        } catch {}
        textareaRef.current?.focus()
        return
      }
      filesRef.current.handleDrop(e)
      requestAnimationFrame(() => textareaRef.current?.focus())
    },
    [handleResourceSelect, textareaRef]
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    const isResourceDrag =
      e.dataTransfer.types.includes(SIM_RESOURCE_DRAG_TYPE) ||
      e.dataTransfer.types.includes(SIM_RESOURCES_DRAG_TYPE)
    if (!isResourceDrag) filesRef.current.handleDragEnter(e)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const isResourceDrag =
      e.dataTransfer.types.includes(SIM_RESOURCE_DRAG_TYPE) ||
      e.dataTransfer.types.includes(SIM_RESOURCES_DRAG_TYPE)
    if (!isResourceDrag) filesRef.current.handleDragLeave(e)
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    filesRef.current.handleFileChange(e)
  }, [])

  useEffect(() => {
    if (wasSendingRef.current && !isSending) {
      const active = document.activeElement
      const isEditingElsewhere =
        active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
      if (!isEditingElsewhere) {
        textareaRef.current?.focus()
      }
    }
    wasSendingRef.current = isSending
  }, [isSending, textareaRef])

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      const active = document.activeElement
      const isEditingElsewhere =
        active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
      if (!isEditingElsewhere) {
        textareaRef.current?.focus()
      }
    })
    return () => window.cancelAnimationFrame(raf)
  }, [textareaRef])

  const handleContainerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button')) return
      textareaRef.current?.focus()
    },
    [textareaRef]
  )

  const handleTextareaFocus = useCallback(() => {
    setIsTextareaFocused(true)
  }, [])

  const handleTextareaBlur = useCallback(() => {
    setIsTextareaFocused(false)
  }, [])

  const handleSkillActionSelect = useCallback(
    (action: SkillActionCard) => {
      if (onSkillActionSelect?.(action)) {
        plusMenuRef.current?.close()
        return
      }

      const nextValue = action.prompt
      setValue(nextValue)
      valueRef.current = nextValue
      sttPrefixRef.current = ''
      mentionRangeRef.current = null
      setMentionQuery(null)
      plusMenuRef.current?.close()

      requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.focus()
        textarea.setSelectionRange(nextValue.length, nextValue.length)
      })
    },
    [onSkillActionSelect, textareaRef]
  )

  const handleSubmit = useCallback(() => {
    const currentFiles = filesRef.current
    const currentContext = contextRef.current
    const currentValue = valueRef.current

    const fileAttachmentsForApi: FileAttachmentForApi[] = currentFiles.attachedFiles
      .filter((f) => !f.uploading && f.key)
      .map((f) => ({
        id: f.id,
        key: f.key!,
        filename: f.name,
        media_type: f.type,
        size: f.size,
        ...(f.path ? { path: f.path } : {}),
      }))

    const autoSelectionContexts = buildAutoSelectionContexts(
      enableContentCanvasAgent ? autoSelectionCards : undefined
    )

    onSubmit(
      currentValue,
      fileAttachmentsForApi.length > 0 ? fileAttachmentsForApi : undefined,
      currentContext.selectedContexts.length > 0 ? currentContext.selectedContexts : undefined,
      {
        ...fixedSendOptions,
        ...(enableContentCanvasAgent ? { confirmationMode, thinkingLevel } : {}),
        ...(autoSelectionContexts ? { autoSelectionContexts } : {}),
      }
    )
    setValue('')
    valueRef.current = ''
    sttPrefixRef.current = ''
    if (draftScopeKeyRef.current) {
      useMothershipDraftsStore.getState().clearDraft(draftScopeKeyRef.current)
    }
    resetTranscript()
    currentFiles.clearAttachedFiles()
    prevSelectedContextsRef.current = []
    currentContext.clearContexts()
    // Programmatic close() bypasses Radix's onOpenChange, so handlePlusMenuClose won't
    // fire — clear mention state inline so ArrowUp etc. aren't intercepted post-submit.
    plusMenuRef.current?.close()
    mentionRangeRef.current = null
    setMentionQuery(null)

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [
    autoSelectionCards,
    confirmationMode,
    enableContentCanvasAgent,
    fixedSendOptions,
    onSubmit,
    resetTranscript,
    textareaRef,
    thinkingLevel,
  ])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionRangeRef.current && !e.nativeEvent.isComposing) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          plusMenuRef.current?.moveActive(1)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          plusMenuRef.current?.moveActive(-1)
          return
        }
        if ((e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey) {
          // Confirm the highlighted match if there is one. If no items match, fall
          // through so Enter still submits and Tab still does its default thing.
          if (plusMenuRef.current?.selectActive()) {
            e.preventDefault()
            return
          }
        }
      }

      if (e.key === 'ArrowUp' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const isEmpty = valueRef.current.length === 0 && filesRef.current.attachedFiles.length === 0
        if (isEmpty && onEditQueuedTailRef.current) {
          e.preventDefault()
          onEditQueuedTailRef.current()
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        // Mirror canSubmit's uploading guard; Enter reads refs, not rendered state.
        if (filesRef.current.attachedFiles.some((f) => f.uploading)) return
        const hasSubmitPayload =
          valueRef.current.trim().length > 0 ||
          filesRef.current.attachedFiles.some((file) => !file.uploading && file.key)
        if (!hasSubmitPayload) {
          if (isSendingRef.current) {
            onSendQueuedHeadRef.current?.()
          }
          return
        }
        handleSubmit()
        return
      }

      const textarea = textareaRef.current
      const selStart = textarea?.selectionStart ?? 0
      const selEnd = textarea?.selectionEnd ?? selStart
      const selectionLength = Math.abs(selEnd - selStart)

      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectionLength > 0) {
          mentionTokensWithContext.removeContextsInSelection(selStart, selEnd)
        } else {
          const ranges = mentionTokensWithContext.computeMentionRanges()
          const target =
            e.key === 'Backspace'
              ? ranges.find((r) => selStart > r.start && selStart <= r.end)
              : ranges.find((r) => selStart >= r.start && selStart < r.end)

          if (target) {
            e.preventDefault()
            mentionTokensWithContext.deleteRange(target)
            return
          }
        }
      }

      if (selectionLength === 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        if (textarea) {
          if (e.key === 'ArrowLeft') {
            const nextPos = Math.max(0, selStart - 1)
            const r = mentionTokensWithContext.findRangeContaining(nextPos)
            if (r) {
              e.preventDefault()
              const target = r.start
              setTimeout(() => textarea.setSelectionRange(target, target), 0)
              return
            }
          } else if (e.key === 'ArrowRight') {
            const nextPos = Math.min(value.length, selStart + 1)
            const r = mentionTokensWithContext.findRangeContaining(nextPos)
            if (r) {
              e.preventDefault()
              const target = r.end
              setTimeout(() => textarea.setSelectionRange(target, target), 0)
              return
            }
          }
        }
      }

      if (e.key.length === 1 || e.key === 'Space') {
        const blocked =
          selectionLength === 0 && !!mentionTokensWithContext.findRangeContaining(selStart)
        if (blocked) {
          e.preventDefault()
          const r = mentionTokensWithContext.findRangeContaining(selStart)
          if (r && textarea) {
            setTimeout(() => {
              textarea.setSelectionRange(r.end, r.end)
            }, 0)
          }
          return
        }
      }
    },
    [handleSubmit, mentionTokensWithContext, value, textareaRef]
  )

  const getActiveMentionAtRef = useRef(mentionMenu.getActiveMentionQueryAtPosition)
  getActiveMentionAtRef.current = mentionMenu.getActiveMentionQueryAtPosition

  const syncMentionState = useCallback(
    (textarea: HTMLTextAreaElement, text: string, caret: number) => {
      const active = getActiveMentionAtRef.current(caret, text)
      // Treat any whitespace inside the query as a closer — typing a space
      // after `@foo` should leave the raw `@foo` text and dismiss the menu.
      const isOpenable = active && !/\s/.test(active.query)
      if (!isOpenable) {
        if (mentionRangeRef.current !== null) {
          mentionRangeRef.current = null
          setMentionQuery(null)
          plusMenuRef.current?.close()
        }
        return
      }

      const wasActive = mentionRangeRef.current !== null
      mentionRangeRef.current = { start: active.start, end: active.end }
      setResourceLookupEnabled(true)
      setMentionQuery(active.query)
      if (!wasActive) {
        // Anchor at the caret so the menu floats above the user's cursor.
        const anchor = getCaretAnchor(textarea, active.start)
        plusMenuRef.current?.open(anchor, { mention: true })
      }
    },
    []
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      const caret = e.target.selectionStart ?? newValue.length
      setValue(newValue)
      syncMentionState(e.target, newValue, caret)
    },
    [syncMentionState]
  )

  const handleSelectAdjust = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const pos = textarea.selectionStart ?? 0
    const r = mentionTokensWithContext.findRangeContaining(pos)
    if (r) {
      const snapPos = pos - r.start < r.end - pos ? r.start : r.end
      setTimeout(() => {
        textarea.setSelectionRange(snapPos, snapPos)
      }, 0)
      return
    }
    syncMentionState(textarea, textarea.value, pos)
  }, [textareaRef, mentionTokensWithContext, syncMentionState])

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      const maxHeight = isInitialView ? window.innerHeight * 0.3 : MAX_CHAT_TEXTAREA_HEIGHT
      autoResizeTextarea(e, maxHeight)

      if (overlayRef.current) {
        overlayRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop
      }
    },
    [isInitialView]
  )

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return

    const pastedFiles: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) pastedFiles.push(file)
      }
    }

    if (pastedFiles.length === 0) return

    e.preventDefault()
    const dt = new DataTransfer()
    for (const file of pastedFiles) {
      dt.items.add(file)
    }
    filesRef.current.processFiles(dt.files)
  }, [])

  const handleScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    if (overlayRef.current) {
      overlayRef.current.scrollTop = e.currentTarget.scrollTop
    }
  }, [])

  const overlayContent = useMemo(() => {
    const contexts = contextManagement.selectedContexts

    if (!value) {
      return <span>{'\u00A0'}</span>
    }

    if (contexts.length === 0) {
      const displayText = value.endsWith('\n') ? `${value}\u200B` : value
      return <span>{displayText}</span>
    }

    const tokens = extractContextTokens(contexts)
    const ranges = computeMentionHighlightRanges(value, tokens)

    if (ranges.length === 0) {
      const displayText = value.endsWith('\n') ? `${value}\u200B` : value
      return <span>{displayText}</span>
    }

    const elements: React.ReactNode[] = []
    let lastIndex = 0
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i]

      if (range.start > lastIndex) {
        const before = value.slice(lastIndex, range.start)
        elements.push(<span key={`text-${i}-${lastIndex}-${range.start}`}>{before}</span>)
      }

      const mentionLabel =
        range.token.startsWith('@') || range.token.startsWith('/')
          ? range.token.slice(1)
          : range.token
      const matchingCtx = contexts.find((c) => c.label === mentionLabel)

      const wfId =
        matchingCtx?.kind === 'workflow' || matchingCtx?.kind === 'current_workflow'
          ? matchingCtx.workflowId
          : undefined
      const mentionIconNode = matchingCtx ? (
        <ContextMentionIcon
          context={matchingCtx}
          workflowColor={wfId ? (workflowsById[wfId]?.color ?? null) : null}
          className='absolute inset-0 m-auto h-[12px] w-[12px] text-[var(--text-icon)]'
        />
      ) : null

      elements.push(
        <span
          key={`mention-${i}-${range.start}-${range.end}`}
          className='rounded-[5px] bg-[var(--surface-5)] py-0.5'
          style={{
            boxShadow: '-2px 0 0 var(--surface-5), 2px 0 0 var(--surface-5)',
          }}
        >
          <span className='relative'>
            <span className='invisible'>{range.token.charAt(0)}</span>
            {mentionIconNode}
          </span>
          {mentionLabel}
        </span>
      )
      lastIndex = range.end
    }

    const tail = value.slice(lastIndex)
    if (tail) {
      const displayTail = tail.endsWith('\n') ? `${tail}\u200B` : tail
      elements.push(<span key={`tail-${lastIndex}`}>{displayTail}</span>)
    }

    return elements.length > 0 ? elements : <span>{'\u00A0'}</span>
  }, [value, contextManagement.selectedContexts, workflowsById])

  const showSkillActionCards =
    Boolean(skillActionCards?.length) &&
    isTextareaFocused &&
    value.trim().length === 0 &&
    !hasFiles &&
    !hasUploadingFiles &&
    contextManagement.selectedContexts.length === 0 &&
    !isSending
  const canAddCanvasSelectionContext = Boolean(autoSelectionCards && autoSelectionCards.length > 0)

  return (
    <div
      onClick={handleContainerClick}
      className={cn(
        'relative z-10 mx-auto w-full max-w-[42rem] cursor-text rounded-[20px] border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 dark:bg-[var(--surface-4)]',
        isInitialView && 'shadow-sm'
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
    >
      {showSkillActionCards && (
        <SkillActionCards actions={skillActionCards ?? []} onSelect={handleSkillActionSelect} />
      )}

      <AnimatedPlaceholderEffect textareaRef={textareaRef} isInitialView={isInitialView} />

      <AttachedFilesList
        attachedFiles={files.attachedFiles}
        onFileClick={handleFileClick}
        onRemoveFile={handleRemoveFile}
      />

      {enableContentCanvasAgent && autoSelectionCards && autoSelectionCards.length > 0 && (
        <div className='mb-2 flex flex-wrap gap-2'>
          {autoSelectionCards.map((card) => (
            <div
              key={card.blockId}
              className='flex min-w-[160px] max-w-[220px] items-start gap-2 rounded-[14px] border border-[var(--border-1)] bg-[var(--surface-2)] px-2.5 py-2'
            >
              {card.variant === 'image' && card.mediaPath ? (
                <img
                  src={card.mediaPath}
                  alt={card.title}
                  className='h-10 w-10 rounded-[8px] object-cover'
                />
              ) : (
                <div className='flex h-10 w-10 items-center justify-center rounded-[8px] bg-[var(--surface-4)]'>
                  <SelectionCardIcon variant={card.variant} />
                </div>
              )}
              <div className='min-w-0 flex-1'>
                <div className='truncate font-medium text-[12px] text-[var(--text-primary)]'>
                  {card.title}
                </div>
                <div className='mt-0.5 line-clamp-2 text-[11px] text-[var(--text-secondary)]'>
                  {card.previewText || card.mediaName || 'Selected canvas node'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className='relative'>
        <div
          ref={overlayRef}
          className={cn(OVERLAY_CLASSES, isInitialView ? 'max-h-[30vh]' : 'max-h-[200px]')}
          aria-hidden='true'
        >
          {overlayContent}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInputChange}
          onFocus={handleTextareaFocus}
          onBlur={handleTextareaBlur}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          onCut={mentionTokensWithContext.handleCut}
          onSelect={handleSelectAdjust}
          onMouseUp={handleSelectAdjust}
          onScroll={handleScroll}
          placeholder=''
          rows={1}
          className={cn(TEXTAREA_BASE_CLASSES, isInitialView ? 'max-h-[30vh]' : 'max-h-[200px]')}
        />
      </div>

      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-1.5'>
          <PlusMenuDropdown
            ref={plusMenuRef}
            availableResources={availableResources}
            onResourceSelect={handleResourceSelect}
            onOpen={() => setResourceLookupEnabled(true)}
            onRequestFullResources={handleRequestFullResources}
            onClose={handlePlusMenuClose}
            textareaRef={textareaRef}
            pendingCursorRef={pendingCursorRef}
            mentionQuery={mentionQuery ?? undefined}
            hideTriggerButton={enableContentCanvasAgent}
          />
          {enableContentCanvasAgent ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type='button'
                    variant='ghost'
                    className='h-[28px] rounded-full border border-[var(--border-1)] px-2 text-[12px] text-[var(--text-secondary)] hover-hover:bg-[var(--surface-hover)]'
                  >
                    功能菜单
                    <ChevronDown className='ml-1 h-3.5 w-3.5' />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start' side='top' sideOffset={8}>
                  <DropdownMenuItem
                    onClick={handleAddCanvasSelectionContext}
                    disabled={!canAddCanvasSelectionContext}
                  >
                    从画布添加
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleFileSelectStable}>上传</DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>思考等级</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onClick={() => setThinkingLevel('standard')}>
                        <span className='flex items-center gap-2'>
                          {thinkingLevel === 'standard' && <Check className='h-3.5 w-3.5' />}
                          <span>standard</span>
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setThinkingLevel('extra')}>
                        <span className='flex items-center gap-2'>
                          {thinkingLevel === 'extra' && <Check className='h-3.5 w-3.5' />}
                          <span>extra</span>
                        </span>
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type='button'
                    variant='ghost'
                    className='h-[28px] rounded-full border border-[var(--border-1)] px-2 text-[12px] text-[var(--text-secondary)] hover-hover:bg-[var(--surface-hover)]'
                  >
                    {confirmationMode === 'manual' ? '手动确认' : '自动确认'}
                    <ChevronDown className='ml-1 h-3.5 w-3.5' />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start' side='top' sideOffset={8}>
                  <DropdownMenuItem onClick={() => setConfirmationMode('manual')}>
                    <span className='flex items-center gap-2'>
                      {confirmationMode === 'manual' && <Check className='h-3.5 w-3.5' />}
                      <span>手动确认</span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setConfirmationMode('auto')}>
                    <span className='flex items-center gap-2'>
                      {confirmationMode === 'auto' && <Check className='h-3.5 w-3.5' />}
                      <span>自动确认</span>
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  type='button'
                  variant='ghost'
                  onClick={handleFileSelectStable}
                  aria-label='Attach file'
                  className='h-[28px] w-[28px] rounded-full p-0 hover-hover:bg-[var(--surface-hover)]'
                >
                  <Paperclip
                    className='h-[14px] w-[14px] text-[var(--text-icon)]'
                    strokeWidth={2}
                  />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>Attach file</Tooltip.Content>
            </Tooltip.Root>
          )}
        </div>
        <div className='flex items-center gap-1.5'>
          {isSttSupported && <MicButton isListening={isListening} onToggle={toggleListening} />}
          <SendButton
            isSending={isSending}
            canSubmit={canSubmit}
            onSubmit={handleSubmit}
            onStopGeneration={onStopGeneration}
          />
        </div>
      </div>

      <input
        ref={files.fileInputRef}
        type='file'
        onChange={handleFileChange}
        className='hidden'
        accept={CHAT_ACCEPT_ATTRIBUTE}
        multiple
      />

      {files.isDragging && <DropOverlay />}
    </div>
  )
})
