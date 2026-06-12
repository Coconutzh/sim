'use client'

import type { ChangeEvent, RefObject } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  FolderKanban,
  Layers3,
  LayoutDashboard,
  ListChecks,
  Maximize2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Send,
  UploadCloud,
  X,
} from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  Textarea,
  toast,
} from '@/components/emcn'
import type { WorkgroupAdminSummary, WorkgroupSummary } from '@/lib/api/contracts/collaboration'
import type {
  ProductionShowcaseCategory,
  ProductionShowcaseItem,
} from '@/lib/api/contracts/production-showcase-items'
import type {
  ProductionTask,
  ProductionTaskAttachment,
  ProductionTaskAttachmentInput,
  ProductionTaskMessage,
  ProductionTaskStatus,
  ProductionTaskSubmission,
} from '@/lib/api/contracts/production-tasks'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import {
  useCopilotAgentProfile,
  useMyWorkgroups,
  useOrganizationWorkgroups,
} from '@/hooks/queries/collaboration'
import {
  useCreateProductionShowcaseItem,
  useProductionShowcaseItem,
  useProductionShowcaseItems,
  useUpdateProductionShowcaseItem,
  useWithdrawProductionShowcaseItem,
} from '@/hooks/queries/production-showcase-items'
import {
  useCreateProductionTask,
  useCreateProductionTaskMessage,
  useMarkProductionTaskRead,
  useProductionTaskMessages,
  useProductionTasks,
  useReviewProductionTask,
  useSubmitProductionTask,
} from '@/hooks/queries/production-tasks'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'

interface ProjectOverviewProps {
  workspaceId: string
}

interface UploadedAttachmentDraft {
  source: 'workspace_file'
  name: string
  workspaceFileId: string
  url: string
  key: string
  contentType: string
  size: number
}

interface AssignableWorkgroup {
  id: string
  name: string
  disciplineName: string | null
}

type OverviewTab = 'results' | 'tasks'
type TaskViewMode = 'team' | 'timeline'
type TaskFilter = 'all' | 'active' | 'review' | 'done'

const STATUS_LABELS: Record<ProductionTaskStatus, string> = {
  todo: '待处理',
  in_progress: '进行中',
  submitted: '待审核',
  approved: '已通过',
  changes_requested: '需修改',
  archived: '已归档',
}

const FILTER_LABELS: Record<TaskFilter, string> = {
  all: '全部',
  active: '进行中',
  review: '待审核',
  done: '已完成',
}

const CATEGORY_LABELS: Record<ProductionShowcaseCategory, string> = {
  copywriting: '文案',
  lighting: '灯光',
  sound: '音响',
  stage_design: '舞美',
  visual: '视觉',
  video: '视频',
  image: '图片',
  document: '文档',
  parameter: '参数',
  other: '其他',
}

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as ProductionShowcaseCategory[]
const ACTIVE_STATUSES = new Set<ProductionTaskStatus>(['todo', 'in_progress', 'changes_requested'])
const DONE_STATUSES = new Set<ProductionTaskStatus>(['approved', 'archived'])

function formatDateTime(value: string | null): string {
  if (!value) return '未设置'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatBytes(value: number | null): string {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`
}

function getDefaultDueAt(offsetHours = 24): string {
  const date = new Date(Date.now() + offsetHours * 60 * 60 * 1000)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

function fromDateTimeLocal(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function isOverdue(task: ProductionTask): boolean {
  return Boolean(
    task.dueAt && new Date(task.dueAt).getTime() < Date.now() && !DONE_STATUSES.has(task.status)
  )
}

function isDueSoon(task: ProductionTask): boolean {
  if (!task.dueAt || DONE_STATUSES.has(task.status)) return false
  const diffMs = new Date(task.dueAt).getTime() - Date.now()
  return diffMs >= 0 && diffMs <= 24 * 60 * 60 * 1000
}

function getStatusBadgeVariant(status: ProductionTaskStatus) {
  if (status === 'approved') return 'green' as const
  if (status === 'submitted') return 'blue' as const
  if (status === 'changes_requested') return 'amber' as const
  if (status === 'in_progress') return 'cyan' as const
  if (status === 'archived') return 'gray-secondary' as const
  return 'gray' as const
}

function getTaskRailClassName(task: ProductionTask): string {
  if (isOverdue(task)) return 'bg-[var(--badge-error-text)]'
  if (task.status === 'approved') return 'bg-[var(--badge-success-text)]'
  if (task.status === 'submitted') return 'bg-[var(--badge-blue-text)]'
  if (task.status === 'changes_requested') return 'bg-[var(--badge-amber-text)]'
  if (task.status === 'in_progress') return 'bg-[var(--badge-cyan-text)]'
  return 'bg-[var(--text-tertiary)]'
}

function parseAttachmentLines(value: string): ProductionTaskAttachmentInput[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [rawName, rawUrl] = line.includes('|')
        ? line.split('|').map((part) => part.trim())
        : ['', line]
      const url = rawUrl || rawName
      if (!url) return []
      const fallbackName = url.split('/').filter(Boolean).at(-1) ?? '附件'
      return [{ source: 'url' as const, name: rawName || fallbackName, url }]
    })
    .slice(0, 20)
}

function getAttachmentHref(attachment: ProductionTaskAttachment): string {
  return attachment.downloadUrl ?? attachment.url
}

function filterTasks(tasks: ProductionTask[], filter: TaskFilter): ProductionTask[] {
  if (filter === 'active') return tasks.filter((task) => ACTIVE_STATUSES.has(task.status))
  if (filter === 'review') return tasks.filter((task) => task.status === 'submitted')
  if (filter === 'done') return tasks.filter((task) => DONE_STATUSES.has(task.status))
  return tasks
}

function groupTasksByAssignee(tasks: ProductionTask[]) {
  const groups = new Map<
    string,
    {
      id: string
      name: string
      tasks: ProductionTask[]
    }
  >()
  for (const task of tasks) {
    const existing = groups.get(task.assigneeWorkgroup.id)
    if (existing) {
      existing.tasks.push(task)
    } else {
      groups.set(task.assigneeWorkgroup.id, {
        id: task.assigneeWorkgroup.id,
        name: task.assigneeWorkgroup.name,
        tasks: [task],
      })
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      tasks: group.tasks.sort((a, b) => {
        const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER
        const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER
        return aDue - bDue
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

function normalizeOrganizationWorkgroups(
  workgroups: WorkgroupAdminSummary[]
): AssignableWorkgroup[] {
  return workgroups.map((workgroup) => ({
    id: workgroup.id,
    name: workgroup.name,
    disciplineName: workgroup.disciplineName,
  }))
}

function normalizeMyWorkgroups(workgroups: WorkgroupSummary[]): AssignableWorkgroup[] {
  return workgroups.map((workgroup) => ({
    id: workgroup.id,
    name: workgroup.name,
    disciplineName: workgroup.discipline.name,
  }))
}

function getUploadedAttachmentInputs(
  attachments: UploadedAttachmentDraft[],
  attachmentLines: string
): ProductionTaskAttachmentInput[] {
  return [...attachments, ...parseAttachmentLines(attachmentLines)].slice(0, 20)
}

function getUploadedAttachmentDraftsFromItems(
  attachments: ProductionTaskAttachment[]
): UploadedAttachmentDraft[] {
  return attachments
    .filter((attachment) => attachment.source === 'workspace_file' && attachment.workspaceFileId)
    .map((attachment) => ({
      source: 'workspace_file' as const,
      name: attachment.name,
      workspaceFileId: attachment.workspaceFileId as string,
      url: attachment.url,
      key: attachment.key ?? '',
      contentType: attachment.contentType ?? '',
      size: attachment.size ?? 0,
    }))
}

function getAttachmentLinesFromItems(attachments: ProductionTaskAttachment[]): string {
  return attachments
    .filter((attachment) => attachment.source === 'url' || !attachment.workspaceFileId)
    .map((attachment) => `${attachment.name} | ${attachment.url}`)
    .join('\n')
}

function AttachmentList({ items }: { items: ProductionTaskAttachment[] }) {
  if (items.length === 0) return null
  return (
    <div className='mt-3 space-y-1'>
      {items.map((attachment) => (
        <a
          key={attachment.id}
          href={getAttachmentHref(attachment)}
          target='_blank'
          rel='noreferrer'
          download={attachment.name}
          onClick={(event) => event.stopPropagation()}
          className='flex items-center gap-2 rounded-[7px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[12px] text-[var(--badge-blue-text)] transition-colors hover-hover:bg-[var(--surface-3)]'
        >
          <FileText className='h-3.5 w-3.5 shrink-0' />
          <span className='min-w-0 flex-1 truncate'>{attachment.name}</span>
          <span className='shrink-0 text-[10px] text-[var(--text-tertiary)]'>
            {formatBytes(attachment.size)}
          </span>
          {attachment.source === 'workspace_file' ? (
            <Download className='h-3.5 w-3.5 shrink-0' />
          ) : (
            <ExternalLink className='h-3.5 w-3.5 shrink-0' />
          )}
        </a>
      ))}
    </div>
  )
}

function UploadedDraftList({
  items,
  onRemove,
}: {
  items: UploadedAttachmentDraft[]
  onRemove: (workspaceFileId: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div className='space-y-1'>
      {items.map((attachment) => (
        <div
          key={attachment.workspaceFileId}
          className='flex items-center gap-2 rounded-[7px] border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-[12px]'
        >
          <FileText className='h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]' />
          <span className='min-w-0 flex-1 truncate text-[var(--text-secondary)]'>
            {attachment.name}
          </span>
          <span className='shrink-0 text-[10px] text-[var(--text-tertiary)]'>
            {formatBytes(attachment.size)}
          </span>
          <button
            type='button'
            className='rounded-[6px] p-1 text-[var(--text-tertiary)] transition-colors hover-hover:bg-[var(--surface-3)] hover-hover:text-[var(--text-primary)]'
            onClick={() => onRemove(attachment.workspaceFileId)}
          >
            <X className='h-3.5 w-3.5' />
          </button>
        </div>
      ))}
    </div>
  )
}

function UploadButton({
  inputRef,
  isPending,
  onUpload,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  isPending: boolean
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <>
      <Button
        type='button'
        size='sm'
        variant='secondary'
        disabled={isPending}
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloud className='mr-1.5 h-3.5 w-3.5' />
        上传
      </Button>
      <input ref={inputRef} type='file' multiple className='hidden' onChange={onUpload} />
    </>
  )
}

function TaskChatMessages({
  currentUserId,
  expanded = false,
  messages,
}: {
  currentUserId?: string
  expanded?: boolean
  messages: ProductionTaskMessage[]
}) {
  if (messages.length === 0) {
    return <div className='py-6 text-center text-[12px] text-[var(--text-tertiary)]'>暂无消息</div>
  }

  return (
    <div className={cn('space-y-3', expanded && 'px-1')}>
      {messages.map((message) => {
        const isMine = Boolean(currentUserId && message.senderUser?.id === currentUserId)
        return (
          <div
            key={message.id}
            className={cn('flex w-full', isMine ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[82%] rounded-[12px] border px-3 py-2',
                isMine
                  ? 'border-[var(--badge-success-bg)] bg-[var(--badge-success-bg)]'
                  : 'border-[var(--border)] bg-[var(--surface-1)]'
              )}
            >
              <div
                className={cn(
                  'flex items-center gap-2 text-[10px]',
                  isMine
                    ? 'justify-end text-[var(--badge-success-text)]'
                    : 'text-[var(--text-tertiary)]'
                )}
              >
                <span className='max-w-[160px] truncate'>
                  {isMine ? '我' : (message.senderUser?.name ?? '成员')}
                </span>
                <span>{formatDateTime(message.createdAt)}</span>
              </div>
              <div className='mt-1 whitespace-pre-wrap break-words text-[12px] text-[var(--text-primary)] leading-5'>
                {message.body}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TaskChatSurface({
  canMessage,
  currentUserId,
  expanded = false,
  isSending,
  messageBody,
  messages,
  onMessageBodyChange,
  onSend,
}: {
  canMessage: boolean
  currentUserId?: string
  expanded?: boolean
  isSending: boolean
  messageBody: string
  messages: ProductionTaskMessage[]
  onMessageBodyChange: (value: string) => void
  onSend: () => void
}) {
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div
        className={cn(
          'overflow-y-auto px-3 py-3',
          expanded ? 'min-h-[420px] flex-1' : 'max-h-[260px]'
        )}
      >
        <TaskChatMessages currentUserId={currentUserId} expanded={expanded} messages={messages} />
      </div>
      {canMessage ? (
        <div className='border-[var(--border)] border-t p-3'>
          <Textarea
            value={messageBody}
            onChange={(event) => onMessageBodyChange(event.target.value)}
            placeholder='输入任务消息，可直接说明协作事项'
            className={cn(expanded ? 'min-h-[96px]' : 'min-h-[72px]')}
          />
          <div className='mt-2 flex justify-end'>
            <Button
              type='button'
              size='sm'
              onClick={onSend}
              disabled={isSending || !messageBody.trim()}
            >
              发送
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function ProjectOverview({ workspaceId }: ProjectOverviewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const routedResultItemId = searchParams.get('itemId') ?? undefined
  const resultAttachmentInputRef = useRef<HTMLInputElement>(null)
  const taskAttachmentInputRef = useRef<HTMLInputElement>(null)
  const submissionAttachmentInputRef = useRef<HTMLInputElement>(null)
  const { data: session } = useSession()
  const { data: agentProfile } = useCopilotAgentProfile(workspaceId)
  const isDirectorLike =
    agentProfile?.agent.code === 'chief_director' || agentProfile?.agent.code === 'show_director'
  const { data: myWorkgroupsData } = useMyWorkgroups(true)
  const canCreateTask = isDirectorLike
  const { data: orgWorkgroupsData } = useOrganizationWorkgroups(
    isDirectorLike ? agentProfile?.workgroup.organizationId : undefined
  )
  const { data: taskData } = useProductionTasks(workspaceId, { scope: 'auto', limit: 100 })
  const { data: showcaseData } = useProductionShowcaseItems(workspaceId, { limit: 100 })
  const { data: routedShowcaseItemData } = useProductionShowcaseItem(
    routedResultItemId,
    workspaceId
  )
  const createShowcaseItem = useCreateProductionShowcaseItem()
  const updateShowcaseItem = useUpdateProductionShowcaseItem()
  const withdrawShowcaseItem = useWithdrawProductionShowcaseItem()
  const createTask = useCreateProductionTask()
  const submitTask = useSubmitProductionTask()
  const reviewTask = useReviewProductionTask()
  const createMessage = useCreateProductionTaskMessage()
  const markRead = useMarkProductionTaskRead()
  const uploadWorkspaceFile = useUploadWorkspaceFile()

  const [activeTab, setActiveTab] = useState<OverviewTab>('results')
  const [taskViewMode, setTaskViewMode] = useState<TaskViewMode>('team')
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set())
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskDueAt, setTaskDueAt] = useState('')
  const [taskAssigneeWorkgroupId, setTaskAssigneeWorkgroupId] = useState('')
  const [taskAttachmentLines, setTaskAttachmentLines] = useState('')
  const [taskUploadedAttachments, setTaskUploadedAttachments] = useState<UploadedAttachmentDraft[]>(
    []
  )
  const [resultTitle, setResultTitle] = useState('')
  const [resultCategory, setResultCategory] = useState<ProductionShowcaseCategory>('copywriting')
  const [resultDescription, setResultDescription] = useState('')
  const [resultContent, setResultContent] = useState('')
  const [resultAttachmentLines, setResultAttachmentLines] = useState('')
  const [resultUploadedAttachments, setResultUploadedAttachments] = useState<
    UploadedAttachmentDraft[]
  >([])
  const [editingResultId, setEditingResultId] = useState<string | null>(null)
  const [resultTaskId, setResultTaskId] = useState<string | null>(null)
  const [resultSubmissionId, setResultSubmissionId] = useState<string | null>(null)
  const [submissionNote, setSubmissionNote] = useState('')
  const [submissionAttachmentLines, setSubmissionAttachmentLines] = useState('')
  const [submissionUploadedAttachments, setSubmissionUploadedAttachments] = useState<
    UploadedAttachmentDraft[]
  >([])
  const [reviewNote, setReviewNote] = useState('')
  const [messageBody, setMessageBody] = useState('')
  const [isChatExpanded, setIsChatExpanded] = useState(false)

  const tasks = taskData?.tasks ?? []
  const showcaseItems = showcaseData?.items ?? []
  const filteredTasks = useMemo(() => filterTasks(tasks, taskFilter), [taskFilter, tasks])
  const groupedTasks = useMemo(() => groupTasksByAssignee(filteredTasks), [filteredTasks])
  const timelineTasks = useMemo(
    () =>
      [...filteredTasks].sort((a, b) => {
        const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER
        const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER
        return aDue - bDue
      }),
    [filteredTasks]
  )
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks]
  )
  const editingResult = useMemo(
    () =>
      showcaseItems.find((item) => item.id === editingResultId) ??
      (routedShowcaseItemData?.item.id === editingResultId ? routedShowcaseItemData.item : null),
    [editingResultId, routedShowcaseItemData?.item, showcaseItems]
  )
  const { data: messagesData } = useProductionTaskMessages(selectedTask?.id)
  const messages = messagesData?.messages ?? []
  const assignableWorkgroups = useMemo<AssignableWorkgroup[]>(() => {
    const orgWorkgroups = orgWorkgroupsData?.workgroups
      ? normalizeOrganizationWorkgroups(orgWorkgroupsData.workgroups)
      : []
    if (orgWorkgroups.length > 0) return orgWorkgroups
    return myWorkgroupsData?.workgroups ? normalizeMyWorkgroups(myWorkgroupsData.workgroups) : []
  }, [myWorkgroupsData?.workgroups, orgWorkgroupsData?.workgroups])
  const assigneeOptions = useMemo<ComboboxOption[]>(
    () =>
      assignableWorkgroups.map((workgroup) => ({
        value: workgroup.id,
        label: workgroup.disciplineName
          ? `${workgroup.disciplineName} / ${workgroup.name}`
          : workgroup.name,
      })),
    [assignableWorkgroups]
  )

  const totalCount = tasks.length
  const overdueCount = tasks.filter(isOverdue).length
  const dueSoonCount = tasks.filter(isDueSoon).length
  const reviewCount = tasks.filter((task) => task.status === 'submitted').length
  const unreadCount = tasks.reduce((sum, task) => sum + task.unreadMessageCount, 0)
  const adoptedSubmissionCount = tasks.filter((task) =>
    task.submissions.some((submission) => submission.adoptedAt)
  ).length

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'tasks' || tab === 'results') {
      setActiveTab(tab)
    }
    if (searchParams.get('createTask') === '1') {
      setActiveTab('tasks')
      if (canCreateTask) {
        setIsCreateTaskOpen(true)
      }
    }
    const taskId = searchParams.get('taskId')
    if (taskId) {
      setActiveTab('tasks')
      setIsCreateTaskOpen(false)
      setSelectedTaskId(taskId)
    }
    if (routedResultItemId) {
      setActiveTab('results')
      setIsCreateTaskOpen(false)
      setSelectedTaskId(null)
    }
  }, [canCreateTask, routedResultItemId, searchParams])

  useEffect(() => {
    if (!routedResultItemId || searchParams.get('edit') !== '1') return
    if (editingResultId === routedResultItemId) return
    const item =
      showcaseItems.find((showcaseItem) => showcaseItem.id === routedResultItemId) ??
      routedShowcaseItemData?.item
    if (!item) return

    setEditingResultId(item.id)
    setResultTitle(item.title)
    setResultCategory(item.category)
    setResultDescription(item.description ?? '')
    setResultContent(item.content ?? '')
    setResultAttachmentLines(getAttachmentLinesFromItems(item.attachments))
    setResultUploadedAttachments(getUploadedAttachmentDraftsFromItems(item.attachments))
    setResultTaskId(item.taskId)
    setResultSubmissionId(item.submissionId)
  }, [
    editingResultId,
    routedResultItemId,
    routedShowcaseItemData?.item,
    searchParams,
    showcaseItems,
  ])

  useEffect(() => {
    if (!isCreateTaskOpen || taskAssigneeWorkgroupId || assignableWorkgroups.length === 0) return
    const fallback =
      assignableWorkgroups.find((workgroup) => workgroup.id !== agentProfile?.workgroup.id)?.id ??
      assignableWorkgroups[0]?.id ??
      ''
    setTaskAssigneeWorkgroupId(fallback)
  }, [agentProfile?.workgroup.id, assignableWorkgroups, isCreateTaskOpen, taskAssigneeWorkgroupId])

  useEffect(() => {
    if (activeTab !== 'tasks' || !selectedTask?.id) return
    markRead.mutate(selectedTask.id)
  }, [activeTab, selectedTask?.id])

  useEffect(() => {
    setIsChatExpanded(false)
  }, [selectedTask?.id])

  const uploadAttachmentDrafts = async (
    event: ChangeEvent<HTMLInputElement>,
    label: string
  ): Promise<UploadedAttachmentDraft[]> => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return []

    try {
      const uploaded = await Promise.all(
        files.map((file) =>
          uploadWorkspaceFile.mutateAsync({
            workspaceId,
            file,
            skipToast: true,
          })
        )
      )
      toast({ message: `已上传 ${uploaded.length} 个${label}`, duration: 2200 })
      return uploaded.map(({ file }) => ({
        source: 'workspace_file' as const,
        name: file.name,
        workspaceFileId: file.id,
        url: file.url,
        key: file.key,
        contentType: file.type,
        size: file.size,
      }))
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : `上传${label}失败`,
        duration: 3000,
      })
      return []
    }
  }

  const handleUploadResultAttachments = async (event: ChangeEvent<HTMLInputElement>) => {
    const drafts = await uploadAttachmentDrafts(event, '成果附件')
    setResultUploadedAttachments((current) => [...current, ...drafts])
  }

  const handleUploadTaskAttachments = async (event: ChangeEvent<HTMLInputElement>) => {
    const drafts = await uploadAttachmentDrafts(event, '任务附件')
    setTaskUploadedAttachments((current) => [...current, ...drafts])
  }

  const handleUploadSubmissionAttachments = async (event: ChangeEvent<HTMLInputElement>) => {
    const drafts = await uploadAttachmentDrafts(event, '提交附件')
    setSubmissionUploadedAttachments((current) => [...current, ...drafts])
  }

  const resetResultForm = () => {
    setEditingResultId(null)
    setResultTitle('')
    setResultCategory('copywriting')
    setResultDescription('')
    setResultContent('')
    setResultAttachmentLines('')
    setResultUploadedAttachments([])
    setResultTaskId(null)
    setResultSubmissionId(null)
  }

  const loadResultIntoForm = (item: ProductionShowcaseItem) => {
    setEditingResultId(item.id)
    setResultTitle(item.title)
    setResultCategory(item.category)
    setResultDescription(item.description ?? '')
    setResultContent(item.content ?? '')
    setResultAttachmentLines(getAttachmentLinesFromItems(item.attachments))
    setResultUploadedAttachments(getUploadedAttachmentDraftsFromItems(item.attachments))
    setResultTaskId(item.taskId)
    setResultSubmissionId(item.submissionId)
  }

  const openResultEditor = (item: ProductionShowcaseItem) => {
    setActiveTab('results')
    loadResultIntoForm(item)
    router.replace(`/workspace/${workspaceId}/showcase?tab=results&itemId=${item.id}&edit=1`)
  }

  const closeResultEditor = () => {
    resetResultForm()
    router.replace(`/workspace/${workspaceId}/showcase?tab=results`)
  }

  const resetCreateTaskForm = () => {
    setTaskTitle('')
    setTaskDescription('')
    setTaskDueAt('')
    setTaskAssigneeWorkgroupId('')
    setTaskAttachmentLines('')
    setTaskUploadedAttachments([])
  }

  const openCreateTaskPanel = () => {
    setActiveTab('tasks')
    setSelectedTaskId(null)
    setIsCreateTaskOpen(true)
    setTaskDueAt((current) => current || getDefaultDueAt())
  }

  const closeCreateTaskPanel = () => {
    setIsCreateTaskOpen(false)
    resetCreateTaskForm()
  }

  const publishSubmissionAsResult = (
    task: ProductionTask,
    submission: ProductionTaskSubmission
  ) => {
    setActiveTab('results')
    setEditingResultId(null)
    setResultTitle(`${task.title} v${submission.versionNumber}`)
    setResultCategory('other')
    setResultDescription(task.description ?? '')
    setResultContent(submission.note ?? '')
    setResultAttachmentLines('')
    setResultUploadedAttachments([])
    setResultTaskId(task.id)
    setResultSubmissionId(submission.id)
  }

  const handleSaveResult = async () => {
    const attachments = getUploadedAttachmentInputs(
      resultUploadedAttachments,
      resultAttachmentLines
    )
    if (!resultTitle.trim()) {
      toast({ message: '请填写成果标题', duration: 2200 })
      return
    }
    if (!resultContent.trim() && attachments.length === 0 && !resultSubmissionId) {
      toast({
        message: '请填写成果内容、上传附件，或从提交版本发布成果',
        duration: 2600,
      })
      return
    }

    try {
      if (editingResultId) {
        const result = await updateShowcaseItem.mutateAsync({
          itemId: editingResultId,
          body: {
            workspaceId,
            title: resultTitle.trim(),
            description: resultDescription.trim() || null,
            category: resultCategory,
            content: resultContent.trim() || null,
            attachments,
          },
        })
        loadResultIntoForm(result.item)
        toast({ message: '成果卡片已保存', duration: 2200 })
      } else {
        await createShowcaseItem.mutateAsync({
          workspaceId,
          title: resultTitle.trim(),
          description: resultDescription.trim() || null,
          category: resultCategory,
          content: resultContent.trim() || null,
          taskId: resultTaskId,
          submissionId: resultSubmissionId,
          attachments,
        })
        resetResultForm()
        toast({ message: '成果已发布到项目总览', duration: 2200 })
      }
    } catch (error) {
      const fallbackMessage = editingResultId ? '保存成果失败' : '发布成果失败'
      toast({
        message: error instanceof Error ? error.message : fallbackMessage,
        duration: 2800,
      })
    }
  }

  const handleWithdrawResult = async (item: ProductionShowcaseItem) => {
    try {
      await withdrawShowcaseItem.mutateAsync({ itemId: item.id, workspaceId })
      toast({ message: '成果已撤回', duration: 2200 })
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : '撤回成果失败',
        duration: 2800,
      })
    }
  }

  const handleCreateTask = async () => {
    if (!canCreateTask) {
      toast({ message: '只有导演团队可以发布任务', duration: 2600 })
      return
    }
    if (!taskTitle.trim() || !taskAssigneeWorkgroupId) {
      toast({ message: '请填写任务标题并选择负责工种', duration: 2400 })
      return
    }

    try {
      const result = await createTask.mutateAsync({
        workspaceId,
        assigneeWorkgroupId: taskAssigneeWorkgroupId,
        title: taskTitle.trim(),
        description: taskDescription.trim() || null,
        dueAt: fromDateTimeLocal(taskDueAt),
        attachments: getUploadedAttachmentInputs(taskUploadedAttachments, taskAttachmentLines),
      })
      closeCreateTaskPanel()
      setSelectedTaskId(result.task.id)
      toast({ message: '生产任务已发布', duration: 2200 })
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : '发布任务失败',
        duration: 2800,
      })
    }
  }

  const handleSubmitTask = async () => {
    if (!selectedTask) return
    const attachments = getUploadedAttachmentInputs(
      submissionUploadedAttachments,
      submissionAttachmentLines
    )
    if (!submissionNote.trim() && attachments.length === 0) {
      toast({ message: '请填写提交说明或上传附件', duration: 2400 })
      return
    }

    try {
      await submitTask.mutateAsync({
        taskId: selectedTask.id,
        workspaceId,
        submissionNote: submissionNote.trim() || null,
        attachments,
      })
      setSubmissionNote('')
      setSubmissionAttachmentLines('')
      setSubmissionUploadedAttachments([])
      toast({ message: '新版本已提交审核', duration: 2200 })
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : '提交任务失败',
        duration: 2800,
      })
    }
  }

  const handleReviewTask = async (action: 'approve' | 'request_changes') => {
    if (!selectedTask) return
    try {
      await reviewTask.mutateAsync({
        taskId: selectedTask.id,
        action,
        reviewNote: reviewNote.trim() || null,
      })
      setReviewNote('')
      toast({ message: action === 'approve' ? '提交已通过' : '已要求修改', duration: 2200 })
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : '审核失败',
        duration: 2800,
      })
    }
  }

  const handleSendMessage = async () => {
    if (!selectedTask || !messageBody.trim()) return
    try {
      await createMessage.mutateAsync({
        taskId: selectedTask.id,
        body: { body: messageBody.trim() },
      })
      setMessageBody('')
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : '发送消息失败',
        duration: 2600,
      })
    }
  }

  const toggleGroup = (groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const renderTaskButton = (task: ProductionTask) => (
    <button
      key={task.id}
      type='button'
      onClick={() => {
        setIsCreateTaskOpen(false)
        setSelectedTaskId(task.id)
      }}
      className={cn(
        'grid w-full gap-3 rounded-[8px] border p-3 text-left transition-colors hover-hover:bg-[var(--surface-2)] md:grid-cols-[minmax(0,1fr)_150px]',
        selectedTaskId === task.id
          ? 'border-[var(--brand-accent)] bg-[var(--surface-3)]'
          : 'border-[var(--border)] bg-[var(--surface-1)]',
        task.unreadMessageCount > 0 && 'ring-1 ring-[var(--badge-blue-text)]/25'
      )}
    >
      <div className='min-w-0'>
        <div className='flex items-start gap-2'>
          <div className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', getTaskRailClassName(task))} />
          <div className='min-w-0 flex-1'>
            <div className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
              {task.title}
            </div>
            <div className='mt-1 truncate text-[11px] text-[var(--text-tertiary)]'>
              {task.sourceWorkgroup.name} {'->'} {task.assigneeWorkgroup.name}
            </div>
          </div>
        </div>
        <div className='mt-2 flex flex-wrap gap-1.5'>
          <Badge
            variant={getStatusBadgeVariant(task.status)}
            size='sm'
            dot
            className='h-5 rounded-full px-2 text-[10px]'
          >
            {STATUS_LABELS[task.status]}
          </Badge>
          {task.submissions.length > 0 && (
            <Badge variant='gray-secondary' size='sm' className='h-5 rounded-full px-2 text-[10px]'>
              {task.submissions.length} 次提交
            </Badge>
          )}
          {task.unreadMessageCount > 0 && (
            <Badge variant='blue' size='sm' className='h-5 rounded-full px-2 text-[10px]'>
              {task.unreadMessageCount} 条新消息
            </Badge>
          )}
          {task.latestSubmission?.adoptedAt && (
            <Badge variant='green' size='sm' className='h-5 rounded-full px-2 text-[10px]'>
              已采用
            </Badge>
          )}
        </div>
      </div>
      <div className='flex items-center justify-between gap-2 md:justify-end'>
        <div className='text-right'>
          <div
            className={cn(
              'text-[12px]',
              isOverdue(task)
                ? 'text-[var(--text-error)]'
                : isDueSoon(task)
                  ? 'text-[var(--badge-amber-text)]'
                  : 'text-[var(--text-secondary)]'
            )}
          >
            {formatDateTime(task.dueAt)}
          </div>
          <div className='mt-1 text-[10px] text-[var(--text-tertiary)]'>DDL</div>
        </div>
        <ChevronRight className='h-4 w-4 shrink-0 text-[var(--text-tertiary)]' />
      </div>
    </button>
  )

  const renderCreateTaskPanel = () => (
    <div className='flex h-full min-h-[560px] flex-col'>
      <div className='flex items-start justify-between gap-3 border-[var(--border)] border-b px-4 py-3'>
        <div>
          <h3 className='font-semibold text-[15px] text-[var(--text-primary)]'>发布生产任务</h3>
          <p className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
            给具体工种下发任务，写清 DDL、说明和交付附件。
          </p>
        </div>
        <Button type='button' size='sm' variant='ghost' onClick={closeCreateTaskPanel}>
          <X className='h-4 w-4' />
        </Button>
      </div>
      <div className='min-h-0 flex-1 space-y-3 overflow-y-auto p-4'>
        <div className='space-y-1.5'>
          <label
            htmlFor='production-task-title'
            className='font-medium text-[12px] text-[var(--text-secondary)]'
          >
            任务标题
          </label>
          <Input
            id='production-task-title'
            value={taskTitle}
            onChange={(event) => setTaskTitle(event.target.value)}
          />
        </div>
        <div className='space-y-1.5'>
          <div className='font-medium text-[12px] text-[var(--text-secondary)]'>负责工种</div>
          <Combobox
            value={taskAssigneeWorkgroupId}
            options={assigneeOptions}
            onChange={setTaskAssigneeWorkgroupId}
            placeholder='选择工种'
            searchable
            emptyMessage='暂无可选工种'
          />
        </div>
        <div className='space-y-1.5'>
          <label
            htmlFor='production-task-due-at'
            className='font-medium text-[12px] text-[var(--text-secondary)]'
          >
            DDL
          </label>
          <Input
            id='production-task-due-at'
            type='datetime-local'
            value={taskDueAt}
            onChange={(event) => setTaskDueAt(event.target.value)}
          />
        </div>
        <div className='space-y-1.5'>
          <label
            htmlFor='production-task-description'
            className='font-medium text-[12px] text-[var(--text-secondary)]'
          >
            任务说明
          </label>
          <Textarea
            id='production-task-description'
            value={taskDescription}
            onChange={(event) => setTaskDescription(event.target.value)}
            className='min-h-[120px]'
            placeholder='说明目标、验收标准、需要提交的文字/图片/视频/文档等材料'
          />
        </div>
        <div className='space-y-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-2'>
          <div className='flex items-center justify-between gap-2'>
            <div className='flex items-center gap-2 text-[12px] text-[var(--text-secondary)]'>
              <Paperclip className='h-3.5 w-3.5' />
              任务附件
            </div>
            <UploadButton
              inputRef={taskAttachmentInputRef}
              isPending={uploadWorkspaceFile.isPending}
              onUpload={handleUploadTaskAttachments}
            />
          </div>
          <UploadedDraftList
            items={taskUploadedAttachments}
            onRemove={(workspaceFileId) =>
              setTaskUploadedAttachments((current) =>
                current.filter((item) => item.workspaceFileId !== workspaceFileId)
              )
            }
          />
          <Textarea
            value={taskAttachmentLines}
            onChange={(event) => setTaskAttachmentLines(event.target.value)}
            placeholder='也可以粘贴外部链接，每行一个，格式：名称 | URL'
            className='min-h-[76px]'
          />
        </div>
      </div>
      <div className='flex items-center justify-end gap-2 border-[var(--border)] border-t p-3'>
        <Button type='button' variant='ghost' onClick={closeCreateTaskPanel}>
          取消
        </Button>
        <Button
          type='button'
          onClick={() => void handleCreateTask()}
          disabled={createTask.isPending}
        >
          <Send className='mr-1.5 h-3.5 w-3.5' />
          发布任务
        </Button>
      </div>
    </div>
  )

  return (
    <>
      <div className='h-full overflow-y-auto bg-[var(--bg)] [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex min-h-full w-full max-w-[88rem] flex-col px-4 py-6 sm:px-6 lg:px-8'>
          <header className='flex flex-col gap-4 border-[var(--border)] border-b pb-5 lg:flex-row lg:items-end lg:justify-between'>
            <div className='min-w-0'>
              <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
                <LayoutDashboard className='h-4 w-4' />
                {agentProfile?.workgroup.name ?? '项目工作区'}
              </div>
              <h1 className='mt-2 font-semibold text-[28px] text-[var(--text-primary)]'>
                项目总览
              </h1>
              <p className='mt-2 max-w-[48rem] text-[14px] text-[var(--text-muted)] leading-6'>
                汇总项目成果、任务进度、全局 DDL
                和每次任务提交版本。这里不再展示主线画布，而是作为生产协作看板使用。
              </p>
            </div>
            <div className='grid grid-cols-2 gap-2 md:grid-cols-5 lg:min-w-[620px]'>
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2'>
                <div className='text-[11px] text-[var(--text-tertiary)]'>任务总数</div>
                <div className='mt-1 font-semibold text-[18px] text-[var(--text-primary)]'>
                  {totalCount}
                </div>
              </div>
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2'>
                <div className='text-[11px] text-[var(--text-error)]'>已超时</div>
                <div className='mt-1 font-semibold text-[18px] text-[var(--text-error)]'>
                  {overdueCount}
                </div>
              </div>
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2'>
                <div className='text-[11px] text-[var(--badge-amber-text)]'>24h 内到期</div>
                <div className='mt-1 font-semibold text-[18px] text-[var(--badge-amber-text)]'>
                  {dueSoonCount}
                </div>
              </div>
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2'>
                <div className='text-[11px] text-[var(--badge-blue-text)]'>待审核/消息</div>
                <div className='mt-1 font-semibold text-[18px] text-[var(--badge-blue-text)]'>
                  {reviewCount}/{unreadCount}
                </div>
              </div>
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2'>
                <div className='text-[11px] text-[var(--badge-success-text)]'>已采用</div>
                <div className='mt-1 font-semibold text-[18px] text-[var(--badge-success-text)]'>
                  {adoptedSubmissionCount}
                </div>
              </div>
            </div>
          </header>

          <div className='mt-4 flex flex-wrap items-center gap-2'>
            {(['results', 'tasks'] as OverviewTab[]).map((tab) => (
              <button
                key={tab}
                type='button'
                className={cn(
                  'flex h-9 items-center gap-2 rounded-[8px] border px-3 text-[13px] transition-colors',
                  activeTab === tab
                    ? 'border-[var(--border)] bg-[var(--surface-3)] text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-secondary)] hover-hover:bg-[var(--surface-1)]'
                )}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'results' ? (
                  <FolderKanban className='h-4 w-4' />
                ) : (
                  <ListChecks className='h-4 w-4' />
                )}
                {tab === 'results' ? '成果中心' : '任务进度'}
              </button>
            ))}
          </div>

          {activeTab === 'results' ? (
            <main className='mt-4 grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]'>
              <section className='min-w-0 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
                <div className='flex items-center justify-between gap-3 border-[var(--border)] border-b px-4 py-3'>
                  <div>
                    <h2 className='font-semibold text-[15px] text-[var(--text-primary)]'>
                      成果中心
                    </h2>
                    <p className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
                      成员可直接发布成果，发布者本人和导演可撤回。
                    </p>
                  </div>
                  <Badge variant='gray-secondary' size='sm' className='rounded-full px-2'>
                    {showcaseItems.length}
                  </Badge>
                </div>
                <div className='grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3'>
                  {showcaseItems.length === 0 ? (
                    <div className='col-span-full flex min-h-[260px] flex-col items-center justify-center rounded-[8px] border border-[var(--border)] border-dashed text-center'>
                      <Archive className='h-8 w-8 text-[var(--text-tertiary)]' />
                      <div className='mt-3 font-medium text-[13px] text-[var(--text-primary)]'>
                        暂无成果
                      </div>
                      <div className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
                        发布文案、参数、图片、视频或文档后会出现在这里。
                      </div>
                    </div>
                  ) : (
                    showcaseItems.map((item) => (
                      <article
                        key={item.id}
                        role={item.permissions.canEdit ? 'button' : undefined}
                        tabIndex={item.permissions.canEdit ? 0 : undefined}
                        onClick={() => {
                          if (item.permissions.canEdit) openResultEditor(item)
                        }}
                        onKeyDown={(event) => {
                          if (!item.permissions.canEdit) return
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            openResultEditor(item)
                          }
                        }}
                        className={cn(
                          'flex min-h-[220px] flex-col rounded-[8px] border bg-[var(--surface-2)] p-3 text-left transition-colors',
                          editingResultId === item.id
                            ? 'border-[var(--brand-accent)] ring-1 ring-[var(--brand-accent)]/25'
                            : 'border-[var(--border)]',
                          item.permissions.canEdit &&
                            'cursor-pointer hover-hover:bg-[var(--surface-3)]'
                        )}
                      >
                        <div className='flex items-start justify-between gap-2'>
                          <Badge variant='gray-secondary' size='sm' className='rounded-full px-2'>
                            {CATEGORY_LABELS[item.category]}
                          </Badge>
                          {item.submissionVersionNumber ? (
                            <Badge variant='blue' size='sm' className='rounded-full px-2'>
                              v{item.submissionVersionNumber}
                            </Badge>
                          ) : null}
                        </div>
                        <h3 className='mt-3 line-clamp-2 font-semibold text-[14px] text-[var(--text-primary)]'>
                          {item.title}
                        </h3>
                        {item.description ? (
                          <p className='mt-2 line-clamp-2 text-[12px] text-[var(--text-muted)] leading-5'>
                            {item.description}
                          </p>
                        ) : null}
                        {item.content ? (
                          <p className='mt-3 line-clamp-4 whitespace-pre-wrap text-[12px] text-[var(--text-secondary)] leading-5'>
                            {item.content}
                          </p>
                        ) : null}
                        <AttachmentList items={item.attachments} />
                        <div className='mt-auto flex items-center justify-between gap-2 pt-4'>
                          <div className='min-w-0 text-[11px] text-[var(--text-tertiary)]'>
                            <div className='truncate'>{item.sourceWorkgroup.name}</div>
                            <div className='mt-0.5'>{formatDateTime(item.createdAt)}</div>
                          </div>
                          <div className='flex shrink-0 items-center gap-1'>
                            {item.permissions.canEdit ? (
                              <Button
                                type='button'
                                size='sm'
                                variant='ghost'
                                onClick={(event) => {
                                  event.stopPropagation()
                                  openResultEditor(item)
                                }}
                              >
                                <Pencil className='mr-1 h-3.5 w-3.5' />
                                编辑
                              </Button>
                            ) : null}
                            {item.permissions.canWithdraw && item.status === 'published' ? (
                              <Button
                                type='button'
                                size='sm'
                                variant='ghost'
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleWithdrawResult(item)
                                }}
                                disabled={withdrawShowcaseItem.isPending}
                              >
                                撤回
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>

              <aside className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
                <div className='border-[var(--border)] border-b px-4 py-3'>
                  <div className='flex items-center gap-2 font-semibold text-[14px] text-[var(--text-primary)]'>
                    {editingResultId ? (
                      <Pencil className='h-4 w-4' />
                    ) : (
                      <Plus className='h-4 w-4' />
                    )}
                    {editingResultId ? '编辑成果' : '发布成果'}
                  </div>
                  <p className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
                    {editingResult
                      ? `来自 ${editingResult.sourceWorkgroup.name}，可继续补充标题、说明、内容和附件。`
                      : '可以发布文字、链接、本地文件，也可以从任务提交版本发布。'}
                  </p>
                </div>
                <div className='space-y-3 p-4'>
                  {editingResult?.sourceWorkflowId ? (
                    <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[12px] text-[var(--text-secondary)]'>
                      已关联团队画布节点，来源团队：{editingResult.sourceWorkgroup.name}
                    </div>
                  ) : null}
                  <div className='space-y-1.5'>
                    <label
                      htmlFor='production-result-title'
                      className='font-medium text-[12px] text-[var(--text-secondary)]'
                    >
                      标题
                    </label>
                    <Input
                      id='production-result-title'
                      value={resultTitle}
                      onChange={(event) => setResultTitle(event.target.value)}
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <label
                      htmlFor='production-result-category'
                      className='font-medium text-[12px] text-[var(--text-secondary)]'
                    >
                      分类
                    </label>
                    <select
                      id='production-result-category'
                      value={resultCategory}
                      onChange={(event) =>
                        setResultCategory(event.target.value as ProductionShowcaseCategory)
                      }
                      className='h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[13px] text-[var(--text-primary)] outline-none'
                    >
                      {CATEGORY_ORDER.map((category) => (
                        <option key={category} value={category}>
                          {CATEGORY_LABELS[category]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className='space-y-1.5'>
                    <label
                      htmlFor='production-result-description'
                      className='font-medium text-[12px] text-[var(--text-secondary)]'
                    >
                      简介
                    </label>
                    <Textarea
                      id='production-result-description'
                      value={resultDescription}
                      onChange={(event) => setResultDescription(event.target.value)}
                      className='min-h-[72px]'
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <label
                      htmlFor='production-result-content'
                      className='font-medium text-[12px] text-[var(--text-secondary)]'
                    >
                      内容
                    </label>
                    <Textarea
                      id='production-result-content'
                      value={resultContent}
                      onChange={(event) => setResultContent(event.target.value)}
                      className='min-h-[120px]'
                    />
                  </div>
                  <div className='space-y-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-2'>
                    <div className='flex items-center justify-between gap-2'>
                      <div className='flex items-center gap-2 text-[12px] text-[var(--text-secondary)]'>
                        <Paperclip className='h-3.5 w-3.5' />
                        附件
                      </div>
                      <UploadButton
                        inputRef={resultAttachmentInputRef}
                        isPending={uploadWorkspaceFile.isPending}
                        onUpload={handleUploadResultAttachments}
                      />
                    </div>
                    <UploadedDraftList
                      items={resultUploadedAttachments}
                      onRemove={(workspaceFileId) =>
                        setResultUploadedAttachments((current) =>
                          current.filter((item) => item.workspaceFileId !== workspaceFileId)
                        )
                      }
                    />
                    <Textarea
                      value={resultAttachmentLines}
                      onChange={(event) => setResultAttachmentLines(event.target.value)}
                      placeholder='也可以粘贴外部链接，每行一个，格式：名称 | URL'
                      className='min-h-[76px]'
                    />
                  </div>
                  {resultSubmissionId ? (
                    <div className='rounded-[8px] border border-[var(--badge-blue-border)] bg-[var(--badge-blue-bg)] px-3 py-2 text-[12px] text-[var(--badge-blue-text)]'>
                      已关联任务提交版本，可直接发布为成果。
                    </div>
                  ) : null}
                  {editingResult && !editingResult.permissions.canEdit ? (
                    <div className='rounded-[8px] border border-[var(--badge-amber-border)] bg-[var(--badge-amber-bg)] px-3 py-2 text-[12px] text-[var(--badge-amber-text)]'>
                      当前账号没有编辑该成果的权限。
                    </div>
                  ) : null}
                  <div className='flex items-center justify-end gap-2'>
                    <Button
                      type='button'
                      variant='ghost'
                      onClick={editingResultId ? closeResultEditor : resetResultForm}
                    >
                      {editingResultId ? '关闭' : '清空'}
                    </Button>
                    <Button
                      type='button'
                      onClick={() => void handleSaveResult()}
                      disabled={
                        createShowcaseItem.isPending ||
                        updateShowcaseItem.isPending ||
                        Boolean(editingResult && !editingResult.permissions.canEdit)
                      }
                    >
                      {editingResultId ? '保存修改' : '发布成果'}
                    </Button>
                  </div>
                </div>
              </aside>
            </main>
          ) : (
            <main className='mt-4 grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]'>
              <section className='min-w-0 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
                <div className='flex flex-col gap-3 border-[var(--border)] border-b px-4 py-3 md:flex-row md:items-center md:justify-between'>
                  <div>
                    <h2 className='font-semibold text-[15px] text-[var(--text-primary)]'>
                      任务进度
                    </h2>
                    <p className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
                      团队视图支持折叠；全局时间线按 DDL 排列所有任务。
                    </p>
                  </div>
                  <div className='flex flex-wrap items-center gap-2'>
                    {canCreateTask ? (
                      <Button type='button' size='sm' onClick={openCreateTaskPanel}>
                        <Plus className='mr-1.5 h-3.5 w-3.5' />
                        发布任务
                      </Button>
                    ) : null}
                    <div className='flex h-8 overflow-hidden rounded-[8px] border border-[var(--border)]'>
                      {(['team', 'timeline'] as TaskViewMode[]).map((mode) => (
                        <button
                          key={mode}
                          type='button'
                          className={cn(
                            'px-3 text-[12px] transition-colors',
                            taskViewMode === mode
                              ? 'bg-[var(--surface-3)] text-[var(--text-primary)]'
                              : 'text-[var(--text-secondary)] hover-hover:bg-[var(--surface-2)]'
                          )}
                          onClick={() => setTaskViewMode(mode)}
                        >
                          {mode === 'team' ? '按团队' : '时间线'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className='flex flex-wrap gap-2 border-[var(--border)] border-b px-4 py-2'>
                  {(Object.keys(FILTER_LABELS) as TaskFilter[]).map((filter) => (
                    <button
                      key={filter}
                      type='button'
                      className={cn(
                        'h-7 rounded-[7px] px-2.5 text-[12px] transition-colors',
                        taskFilter === filter
                          ? 'bg-[var(--surface-3)] text-[var(--text-primary)]'
                          : 'text-[var(--text-secondary)] hover-hover:bg-[var(--surface-2)]'
                      )}
                      onClick={() => setTaskFilter(filter)}
                    >
                      {FILTER_LABELS[filter]}
                    </button>
                  ))}
                </div>
                <div className='p-4'>
                  {filteredTasks.length === 0 ? (
                    <div className='flex min-h-[300px] flex-col items-center justify-center rounded-[8px] border border-[var(--border)] border-dashed text-center'>
                      <ListChecks className='h-8 w-8 text-[var(--text-tertiary)]' />
                      <div className='mt-3 font-medium text-[13px] text-[var(--text-primary)]'>
                        暂无任务
                      </div>
                      <div className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
                        创建生产任务后会在这里按团队或时间线展示。
                      </div>
                    </div>
                  ) : taskViewMode === 'team' ? (
                    <div className='space-y-3'>
                      {groupedTasks.map((group) => {
                        const collapsed = collapsedGroupIds.has(group.id)
                        const groupOverdue = group.tasks.filter(isOverdue).length
                        const groupReview = group.tasks.filter(
                          (task) => task.status === 'submitted'
                        ).length
                        return (
                          <section
                            key={group.id}
                            className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'
                          >
                            <button
                              type='button'
                              className='flex w-full items-center justify-between gap-3 px-3 py-2 text-left'
                              onClick={() => toggleGroup(group.id)}
                            >
                              <div className='min-w-0'>
                                <div className='truncate font-semibold text-[13px] text-[var(--text-primary)]'>
                                  {group.name}
                                </div>
                                <div className='mt-0.5 text-[11px] text-[var(--text-tertiary)]'>
                                  {group.tasks.length} 个任务
                                  {groupOverdue > 0 ? ` / ${groupOverdue} 个超时` : ''}
                                  {groupReview > 0 ? ` / ${groupReview} 个待审核` : ''}
                                </div>
                              </div>
                              {collapsed ? (
                                <ChevronRight className='h-4 w-4 shrink-0 text-[var(--text-tertiary)]' />
                              ) : (
                                <ChevronDown className='h-4 w-4 shrink-0 text-[var(--text-tertiary)]' />
                              )}
                            </button>
                            {!collapsed && (
                              <div className='space-y-2 border-[var(--border)] border-t p-2'>
                                {group.tasks.map(renderTaskButton)}
                              </div>
                            )}
                          </section>
                        )
                      })}
                    </div>
                  ) : (
                    <div className='relative space-y-3'>
                      <div className='absolute top-2 bottom-2 left-[15px] w-px bg-[var(--border)]' />
                      {timelineTasks.map((task) => (
                        <div key={task.id} className='relative pl-9'>
                          <div
                            className={cn(
                              'absolute top-4 left-[10px] h-3 w-3 rounded-full border-2 border-[var(--surface-1)]',
                              getTaskRailClassName(task)
                            )}
                          />
                          {renderTaskButton(task)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <aside className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
                {isCreateTaskOpen ? (
                  renderCreateTaskPanel()
                ) : selectedTask ? (
                  <div className='flex h-full min-h-[560px] flex-col'>
                    <div className='border-[var(--border)] border-b px-4 py-3'>
                      <div className='flex items-start justify-between gap-3'>
                        <div className='min-w-0'>
                          <h3 className='line-clamp-2 font-semibold text-[15px] text-[var(--text-primary)]'>
                            {selectedTask.title}
                          </h3>
                          <div className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
                            {selectedTask.sourceWorkgroup.name} {'->'}{' '}
                            {selectedTask.assigneeWorkgroup.name}
                          </div>
                        </div>
                        <Badge
                          variant={getStatusBadgeVariant(selectedTask.status)}
                          size='sm'
                          dot
                          className='shrink-0 rounded-full px-2'
                        >
                          {STATUS_LABELS[selectedTask.status]}
                        </Badge>
                      </div>
                      <div className='mt-3 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]'>
                        <CalendarClock className='h-3.5 w-3.5' />
                        DDL {formatDateTime(selectedTask.dueAt)}
                      </div>
                    </div>
                    <div className='min-h-0 flex-1 space-y-4 overflow-y-auto p-4'>
                      {selectedTask.description ? (
                        <p className='whitespace-pre-wrap rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px] text-[var(--text-secondary)] leading-5'>
                          {selectedTask.description}
                        </p>
                      ) : null}
                      {selectedTask.attachments.length > 0 ? (
                        <div>
                          <div className='mb-2 flex items-center gap-2 font-semibold text-[13px] text-[var(--text-primary)]'>
                            <Paperclip className='h-4 w-4' />
                            任务附件
                          </div>
                          <AttachmentList items={selectedTask.attachments} />
                        </div>
                      ) : null}

                      <div>
                        <div className='mb-2 flex items-center justify-between gap-2'>
                          <div className='flex items-center gap-2 font-semibold text-[13px] text-[var(--text-primary)]'>
                            <Layers3 className='h-4 w-4' />
                            提交版本
                          </div>
                          <Badge variant='gray-secondary' size='sm' className='rounded-full px-2'>
                            {selectedTask.submissions.length}
                          </Badge>
                        </div>
                        {selectedTask.submissions.length === 0 ? (
                          <div className='rounded-[8px] border border-[var(--border)] border-dashed p-4 text-center text-[12px] text-[var(--text-tertiary)]'>
                            还没有提交版本。
                          </div>
                        ) : (
                          <div className='space-y-2'>
                            {selectedTask.submissions.map((submission) => (
                              <div
                                key={submission.id}
                                className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'
                              >
                                <div className='flex items-start justify-between gap-2'>
                                  <div>
                                    <div className='font-medium text-[13px] text-[var(--text-primary)]'>
                                      v{submission.versionNumber}
                                    </div>
                                    <div className='mt-0.5 text-[11px] text-[var(--text-tertiary)]'>
                                      {formatDateTime(submission.submittedAt)}
                                    </div>
                                  </div>
                                  <div className='flex flex-wrap justify-end gap-1'>
                                    <Badge
                                      variant={getStatusBadgeVariant(submission.status)}
                                      size='sm'
                                      className='rounded-full px-2'
                                    >
                                      {STATUS_LABELS[submission.status]}
                                    </Badge>
                                    {submission.adoptedAt ? (
                                      <Badge
                                        variant='green'
                                        size='sm'
                                        className='rounded-full px-2'
                                      >
                                        已采用
                                      </Badge>
                                    ) : null}
                                  </div>
                                </div>
                                {submission.note ? (
                                  <p className='mt-2 whitespace-pre-wrap text-[12px] text-[var(--text-secondary)] leading-5'>
                                    {submission.note}
                                  </p>
                                ) : null}
                                <AttachmentList items={submission.attachments} />
                                {submission.reviewNote ? (
                                  <div className='mt-2 rounded-[7px] border border-[var(--border)] px-2 py-1.5 text-[12px] text-[var(--text-muted)]'>
                                    审核意见：{submission.reviewNote}
                                  </div>
                                ) : null}
                                <div className='mt-3 flex justify-end'>
                                  <Button
                                    type='button'
                                    size='sm'
                                    variant='secondary'
                                    onClick={() =>
                                      publishSubmissionAsResult(selectedTask, submission)
                                    }
                                  >
                                    发布为成果
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {selectedTask.permissions.canSubmit &&
                      ACTIVE_STATUSES.has(selectedTask.status) ? (
                        <div className='space-y-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                          <div className='font-semibold text-[13px] text-[var(--text-primary)]'>
                            提交新版本
                          </div>
                          <Textarea
                            value={submissionNote}
                            onChange={(event) => setSubmissionNote(event.target.value)}
                            placeholder='填写本次提交说明'
                            className='min-h-[96px]'
                          />
                          <div className='space-y-2'>
                            <div className='flex items-center justify-between gap-2'>
                              <div className='flex items-center gap-2 text-[12px] text-[var(--text-secondary)]'>
                                <Paperclip className='h-3.5 w-3.5' />
                                提交附件
                              </div>
                              <UploadButton
                                inputRef={submissionAttachmentInputRef}
                                isPending={uploadWorkspaceFile.isPending}
                                onUpload={handleUploadSubmissionAttachments}
                              />
                            </div>
                            <UploadedDraftList
                              items={submissionUploadedAttachments}
                              onRemove={(workspaceFileId) =>
                                setSubmissionUploadedAttachments((current) =>
                                  current.filter((item) => item.workspaceFileId !== workspaceFileId)
                                )
                              }
                            />
                            <Textarea
                              value={submissionAttachmentLines}
                              onChange={(event) => setSubmissionAttachmentLines(event.target.value)}
                              placeholder='外部链接，每行一个，格式：名称 | URL'
                              className='min-h-[70px]'
                            />
                          </div>
                          <div className='flex justify-end'>
                            <Button
                              type='button'
                              onClick={() => void handleSubmitTask()}
                              disabled={submitTask.isPending}
                            >
                              <Send className='mr-1.5 h-3.5 w-3.5' />
                              提交审核
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      {selectedTask.permissions.canReview && selectedTask.status === 'submitted' ? (
                        <div className='space-y-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                          <div className='font-semibold text-[13px] text-[var(--text-primary)]'>
                            审核最新提交
                          </div>
                          <Textarea
                            value={reviewNote}
                            onChange={(event) => setReviewNote(event.target.value)}
                            placeholder='填写审核意见'
                            className='min-h-[80px]'
                          />
                          <div className='flex justify-end gap-2'>
                            <Button
                              type='button'
                              variant='secondary'
                              onClick={() => void handleReviewTask('request_changes')}
                              disabled={reviewTask.isPending}
                            >
                              要求修改
                            </Button>
                            <Button
                              type='button'
                              onClick={() => void handleReviewTask('approve')}
                              disabled={reviewTask.isPending}
                            >
                              <Check className='mr-1.5 h-3.5 w-3.5' />
                              通过并采用
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'>
                        <div className='flex items-center justify-between gap-2 border-[var(--border)] border-b px-3 py-2 font-medium text-[12px] text-[var(--text-secondary)]'>
                          <div className='flex items-center gap-2'>
                            <MessageSquare className='h-3.5 w-3.5' />
                            节点内聊天
                          </div>
                          <div className='flex items-center gap-2'>
                            <Badge variant='gray-secondary' size='sm' className='rounded-full px-2'>
                              {messages.length}
                            </Badge>
                            <Button
                              type='button'
                              size='sm'
                              variant='ghost'
                              onClick={() => setIsChatExpanded(true)}
                            >
                              <Maximize2 className='h-3.5 w-3.5' />
                            </Button>
                          </div>
                        </div>
                        <TaskChatSurface
                          canMessage={selectedTask.permissions.canMessage}
                          currentUserId={session?.user?.id}
                          isSending={createMessage.isPending}
                          messageBody={messageBody}
                          messages={messages}
                          onMessageBodyChange={setMessageBody}
                          onSend={() => void handleSendMessage()}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className='flex min-h-[560px] flex-col items-center justify-center p-6 text-center'>
                    <ListChecks className='h-8 w-8 text-[var(--text-tertiary)]' />
                    <div className='mt-3 font-medium text-[13px] text-[var(--text-primary)]'>
                      选择一个任务
                    </div>
                    <div className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
                      查看详情、提交版本、任务聊天、审核意见和成果发布入口。
                    </div>
                    {canCreateTask ? (
                      <Button type='button' className='mt-4' onClick={openCreateTaskPanel}>
                        <Plus className='mr-1.5 h-3.5 w-3.5' />
                        发布任务
                      </Button>
                    ) : null}
                  </div>
                )}
              </aside>
            </main>
          )}
        </div>
      </div>
      {selectedTask ? (
        <Modal open={isChatExpanded} onOpenChange={setIsChatExpanded}>
          <ModalContent size='xl'>
            <ModalHeader>
              <div className='min-w-0'>
                <div className='flex items-center gap-2 font-semibold text-[15px] text-[var(--text-primary)]'>
                  <MessageSquare className='h-4 w-4' />
                  任务聊天
                </div>
                <div className='mt-1 truncate text-[12px] text-[var(--text-tertiary)]'>
                  {selectedTask.title}
                </div>
              </div>
            </ModalHeader>
            <ModalBody>
              <div className='flex h-[min(72vh,680px)] min-h-[520px] flex-col rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'>
                <TaskChatSurface
                  canMessage={selectedTask.permissions.canMessage}
                  currentUserId={session?.user?.id}
                  expanded
                  isSending={createMessage.isPending}
                  messageBody={messageBody}
                  messages={messages}
                  onMessageBodyChange={setMessageBody}
                  onSend={() => void handleSendMessage()}
                />
              </div>
            </ModalBody>
          </ModalContent>
        </Modal>
      ) : null}
    </>
  )
}
