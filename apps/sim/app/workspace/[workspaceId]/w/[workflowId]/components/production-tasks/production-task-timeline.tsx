'use client'

import type { ChangeEvent, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  Check,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  GanttChart,
  Inbox,
  ListChecks,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  UploadCloud,
  X,
} from 'lucide-react'
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  type ComboboxOption,
  Input,
  Modal,
  ModalContent,
  Textarea,
  toast,
} from '@/components/emcn'
import type {
  ProductionTask,
  ProductionTaskAttachment,
  ProductionTaskAttachmentInput,
  ProductionTaskStatus,
} from '@/lib/api/contracts/production-tasks'
import { cn } from '@/lib/core/utils/cn'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import {
  collaborationKeys,
  useCopilotAgentProfile,
  useMyWorkgroups,
  useOrganizationWorkgroups,
} from '@/hooks/queries/collaboration'
import {
  productionTaskKeys,
  useCreateProductionTask,
  useCreateProductionTaskMessage,
  useMarkProductionTaskRead,
  useProductionTaskMessages,
  useProductionTasks,
  useReviewProductionTask,
  useSubmitProductionTask,
  useUpdateProductionTask,
} from '@/hooks/queries/production-tasks'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'
import { useContentCanvasSelectionStore } from '@/stores/copilot/content-canvas-selection/store'

interface ProductionTaskTimelineProps {
  workspaceId: string
  workflowId: string
}

interface SkillTaskDraft {
  title?: string
  description?: string
  dueAtOffsetHours?: number
}

interface AssignableWorkgroup {
  id: string
  name: string
  agentCode?: string
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

type DashboardView = 'gantt' | 'list'
type TaskFilter = 'all' | 'active' | 'submittable' | 'review' | 'done'

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
  submittable: '可提交',
  review: '待审核',
  done: '已完成',
}

const ACTIVE_STATUSES = new Set<ProductionTaskStatus>(['todo', 'in_progress', 'changes_requested'])
const DONE_STATUSES = new Set<ProductionTaskStatus>(['approved', 'archived'])
const EMPTY_SELECTED_CANVAS_NODE_IDS: string[] = []
const GANTT_START_CLASSES = [
  'col-start-1',
  'col-start-2',
  'col-start-3',
  'col-start-4',
  'col-start-5',
  'col-start-6',
  'col-start-7',
] as const
const GANTT_SPAN_CLASSES = [
  'col-span-1',
  'col-span-2',
  'col-span-3',
  'col-span-4',
  'col-span-5',
  'col-span-6',
  'col-span-7',
] as const

function formatDateTime(value: string | null): string {
  if (!value) return '未设置'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatDay(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(value)
}

function getRelativeDueLabel(value: string | null): string {
  if (!value) return '无 DDL'
  const due = new Date(value).getTime()
  const diffMs = due - Date.now()
  const absHours = Math.ceil(Math.abs(diffMs) / (60 * 60 * 1000))
  if (diffMs < 0) return `已超 ${absHours}h`
  if (absHours <= 24) return `${absHours}h 后`
  return `${Math.ceil(absHours / 24)}d 后`
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

function toDateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDateTimeLocal(value: string): string | null {
  if (!value) return null
  return new Date(value).toISOString()
}

function getDefaultDueAt(offsetHours = 24): string {
  return toDateTimeLocal(new Date(Date.now() + offsetHours * 60 * 60 * 1000))
}

function isCreateTaskEvent(event: Event): event is CustomEvent<{ draft?: SkillTaskDraft }> {
  return event instanceof CustomEvent
}

function normalizeOrgWorkgroups(
  workgroups: Array<{ id: string; name: string; agentCode: string }>
): AssignableWorkgroup[] {
  return workgroups.map((workgroup) => ({
    id: workgroup.id,
    name: workgroup.name,
    agentCode: workgroup.agentCode,
  }))
}

function normalizeMyWorkgroups(
  workgroups: Array<{
    id: string
    name: string
    discipline: { agentCode: string }
  }>
): AssignableWorkgroup[] {
  return workgroups.map((workgroup) => ({
    id: workgroup.id,
    name: workgroup.name,
    agentCode: workgroup.discipline.agentCode,
  }))
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

function serializeAttachmentItems(
  attachments: ProductionTaskAttachment[] | null | undefined
): string {
  return (attachments ?? [])
    .filter((attachment) => attachment.source === 'url')
    .map((attachment) => `${attachment.name} | ${attachment.url}`)
    .join('\n')
}

function serializeAttachmentLines(task: ProductionTask | null): string {
  return serializeAttachmentItems(task?.attachments)
}

function getUploadedAttachmentDraftsFromItems(
  attachments: ProductionTaskAttachment[] | null | undefined
): UploadedAttachmentDraft[] {
  return (attachments ?? [])
    .filter((attachment) => attachment.source === 'workspace_file' && attachment.workspaceFileId)
    .map((attachment) => ({
      source: 'workspace_file',
      name: attachment.name,
      workspaceFileId: attachment.workspaceFileId as string,
      url: attachment.url,
      key: attachment.key ?? '',
      contentType: attachment.contentType ?? 'application/octet-stream',
      size: attachment.size ?? 0,
    }))
}

function getUploadedAttachmentDrafts(task: ProductionTask | null): UploadedAttachmentDraft[] {
  return getUploadedAttachmentDraftsFromItems(task?.attachments)
}

function getAttachmentHref(attachment: ProductionTaskAttachment): string {
  return attachment.downloadUrl ?? attachment.url
}

function formatBytes(value: number): string {
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

function getTimelineDays(): Date[] {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return day
  })
}

function getDaySlot(value: string | null, fallback = 0): number {
  if (!value) return fallback
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const target = new Date(value)
  target.setHours(0, 0, 0, 0)
  const diffDays = Math.floor((target.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
  return Math.max(0, Math.min(6, diffDays))
}

function getGanttPlacement(task: ProductionTask) {
  const startSlot = getDaySlot(task.createdAt, 0)
  const endSlot = Math.max(startSlot, getDaySlot(task.dueAt, startSlot))
  return {
    startClassName: GANTT_START_CLASSES[startSlot],
    spanClassName: GANTT_SPAN_CLASSES[Math.max(0, endSlot - startSlot)],
  }
}

function filterTasks(tasks: ProductionTask[], filter: TaskFilter): ProductionTask[] {
  if (filter === 'active') return tasks.filter((task) => ACTIVE_STATUSES.has(task.status))
  if (filter === 'submittable') {
    return tasks.filter((task) => task.permissions.canSubmit && ACTIVE_STATUSES.has(task.status))
  }
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
      agentCode: string | null
      tasks: ProductionTask[]
    }
  >()
  for (const task of tasks) {
    const groupId = task.assigneeWorkgroup.id
    const existing = groups.get(groupId)
    if (existing) {
      existing.tasks.push(task)
    } else {
      groups.set(groupId, {
        id: groupId,
        name: task.assigneeWorkgroup.name,
        agentCode: task.assigneeWorkgroup.discipline.agentCode,
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

function getBlockingDependencyCount(task: ProductionTask): number {
  return task.blockedBy.filter((dependency) => !DONE_STATUSES.has(dependency.status)).length
}

export function ProductionTaskTimeline({ workspaceId, workflowId }: ProductionTaskTimelineProps) {
  const queryClient = useQueryClient()
  const { socket } = useSocket()
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const submissionAttachmentInputRef = useRef<HTMLInputElement>(null)
  const { data: agentProfile } = useCopilotAgentProfile(workspaceId)
  const isDirectorLike =
    agentProfile?.agent.code === 'chief_director' || agentProfile?.agent.code === 'show_director'
  const canLoadOrganizationWorkgroups = Boolean(isDirectorLike)
  const { data: taskData } = useProductionTasks(workspaceId, {
    scope: 'auto',
    limit: 100,
  })
  const { data: myWorkgroupsData } = useMyWorkgroups(true)
  const { data: orgWorkgroupsData } = useOrganizationWorkgroups(
    canLoadOrganizationWorkgroups ? agentProfile?.workgroup.organizationId : undefined
  )
  const selectedCanvasNodeIds = useContentCanvasSelectionStore(
    useCallback(
      (state) => state.selectionByWorkflow[workflowId] ?? EMPTY_SELECTED_CANVAS_NODE_IDS,
      [workflowId]
    )
  )

  const createTask = useCreateProductionTask()
  const updateTask = useUpdateProductionTask()
  const submitTask = useSubmitProductionTask()
  const reviewTask = useReviewProductionTask()
  const createMessage = useCreateProductionTaskMessage()
  const markRead = useMarkProductionTaskRead()
  const uploadWorkspaceFile = useUploadWorkspaceFile()

  const [isDashboardOpen, setIsDashboardOpen] = useState(false)
  const [dashboardView, setDashboardView] = useState<DashboardView>('gantt')
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
  const [panelMode, setPanelMode] = useState<'create' | 'detail' | 'empty'>('empty')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [assigneeWorkgroupId, setAssigneeWorkgroupId] = useState('')
  const [dependencyTaskIds, setDependencyTaskIds] = useState<string[]>([])
  const [attachmentLines, setAttachmentLines] = useState('')
  const [uploadedAttachments, setUploadedAttachments] = useState<UploadedAttachmentDraft[]>([])
  const [submissionNote, setSubmissionNote] = useState('')
  const [submissionAttachmentLines, setSubmissionAttachmentLines] = useState('')
  const [submissionUploadedAttachments, setSubmissionUploadedAttachments] = useState<
    UploadedAttachmentDraft[]
  >([])
  const [messageBody, setMessageBody] = useState('')
  const [reviewNote, setReviewNote] = useState('')

  const tasks = taskData?.tasks ?? []
  const timelineDays = useMemo(() => getTimelineDays(), [])
  const filteredTasks = useMemo(() => filterTasks(tasks, taskFilter), [taskFilter, tasks])
  const groupedTasks = useMemo(() => groupTasksByAssignee(filteredTasks), [filteredTasks])
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks]
  )
  const { data: messagesData } = useProductionTaskMessages(selectedTask?.id)
  const messages = messagesData?.messages ?? []

  const assignableWorkgroups = useMemo<AssignableWorkgroup[]>(() => {
    const orgWorkgroups = orgWorkgroupsData?.workgroups
      ? normalizeOrgWorkgroups(orgWorkgroupsData.workgroups)
      : []
    if (orgWorkgroups.length > 0) return orgWorkgroups
    return myWorkgroupsData?.workgroups ? normalizeMyWorkgroups(myWorkgroupsData.workgroups) : []
  }, [myWorkgroupsData?.workgroups, orgWorkgroupsData?.workgroups])
  const assigneeOptions = useMemo<ComboboxOption[]>(
    () =>
      assignableWorkgroups.map((workgroup) => ({
        value: workgroup.id,
        label: workgroup.name,
      })),
    [assignableWorkgroups]
  )

  const activeSubmitTasks = useMemo(
    () => tasks.filter((task) => task.permissions.canSubmit && ACTIVE_STATUSES.has(task.status)),
    [tasks]
  )
  const totalCount = tasks.length
  const overdueCount = tasks.filter(isOverdue).length
  const dueSoonCount = tasks.filter(isDueSoon).length
  const unreadCount = tasks.reduce((sum, task) => sum + task.unreadMessageCount, 0)
  const reviewCount = tasks.filter((task) => task.status === 'submitted').length
  const dashboardBadgeCount = overdueCount + dueSoonCount + unreadCount + reviewCount

  const availableDependencyTasks = useMemo(
    () => tasks.filter((task) => task.id !== selectedTask?.id),
    [selectedTask?.id, tasks]
  )

  const openCreatePanel = useCallback(
    (draft?: SkillTaskDraft) => {
      const fallbackAssignee =
        assignableWorkgroups.find((workgroup) => workgroup.id !== agentProfile?.workgroup.id)?.id ??
        assignableWorkgroups[0]?.id ??
        ''
      setPanelMode('create')
      setSelectedTaskId(null)
      setTitle(draft?.title ?? '新生产任务')
      setDescription(draft?.description ?? '')
      setDueAt(getDefaultDueAt(draft?.dueAtOffsetHours ?? 24))
      setAssigneeWorkgroupId(fallbackAssignee)
      setDependencyTaskIds([])
      setAttachmentLines('')
      setUploadedAttachments([])
      setSubmissionNote('')
      setSubmissionAttachmentLines('')
      setSubmissionUploadedAttachments([])
      setMessageBody('')
      setReviewNote('')
      setIsDashboardOpen(true)
    },
    [agentProfile?.workgroup.id, assignableWorkgroups]
  )

  const openDetailPanel = useCallback((task: ProductionTask) => {
    setPanelMode('detail')
    setSelectedTaskId(task.id)
    setDependencyTaskIds(task.blockedBy.map((dependency) => dependency.taskId))
    setAttachmentLines(serializeAttachmentLines(task))
    setUploadedAttachments(getUploadedAttachmentDrafts(task))
    setSubmissionNote(task.submissionNote ?? '')
    setSubmissionAttachmentLines(serializeAttachmentItems(task.submissionAttachments))
    setSubmissionUploadedAttachments(
      getUploadedAttachmentDraftsFromItems(task.submissionAttachments)
    )
    setMessageBody('')
    setReviewNote(task.reviewNote ?? '')
    setIsDashboardOpen(true)
  }, [])

  useEffect(() => {
    const handleCreate = (event: Event) => {
      if (!isCreateTaskEvent(event)) return
      openCreatePanel(event.detail?.draft)
    }
    const handleSubmitSelectedNode = () => {
      if (activeSubmitTasks.length === 0) {
        toast({ message: '当前没有可提交的生产任务。', duration: 2400 })
        return
      }
      setIsDashboardOpen(true)
      if (activeSubmitTasks.length === 1) {
        openDetailPanel(activeSubmitTasks[0])
        toast({
          message: '可提交文字、附件，也可以附带 1 个选中画布节点。',
          duration: 2600,
        })
        return
      }
      setTaskFilter('submittable')
      setDashboardView('list')
      setPanelMode('empty')
      setSelectedTaskId(null)
      toast({
        message: '有多个可提交任务，请先在仪表盘中选择具体任务。',
        duration: 2800,
      })
    }
    window.addEventListener('production-task:create', handleCreate)
    window.addEventListener('production-task:submit-selected-node', handleSubmitSelectedNode)
    return () => {
      window.removeEventListener('production-task:create', handleCreate)
      window.removeEventListener('production-task:submit-selected-node', handleSubmitSelectedNode)
    }
  }, [activeSubmitTasks, openCreatePanel, openDetailPanel])

  useEffect(() => {
    if (!socket) return
    const handleProductionTaskUpdated = (event: { organizationId?: string | null }) => {
      if (
        event.organizationId &&
        agentProfile?.workgroup.organizationId &&
        event.organizationId !== agentProfile.workgroup.organizationId
      ) {
        return
      }
      queryClient.invalidateQueries({ queryKey: productionTaskKeys.lists() })
      if (agentProfile?.workgroup.organizationId) {
        queryClient.invalidateQueries({
          queryKey: collaborationKeys.organizationProjectNotificationCenter(
            agentProfile.workgroup.organizationId
          ),
        })
      }
    }
    socket.on('production-task-updated', handleProductionTaskUpdated)
    return () => {
      socket.off('production-task-updated', handleProductionTaskUpdated)
    }
  }, [agentProfile?.workgroup.organizationId, queryClient, socket])

  useEffect(() => {
    if (!selectedTask?.id || !isDashboardOpen || panelMode !== 'detail') return
    markRead.mutate(selectedTask.id)
  }, [isDashboardOpen, panelMode, selectedTask?.id])

  const toggleDependency = (taskId: string) => {
    setDependencyTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId]
    )
  }

  const getAttachmentInputs = (): ProductionTaskAttachmentInput[] =>
    [...uploadedAttachments, ...parseAttachmentLines(attachmentLines)].slice(0, 20)

  const getSubmissionAttachmentInputs = (): ProductionTaskAttachmentInput[] =>
    [...submissionUploadedAttachments, ...parseAttachmentLines(submissionAttachmentLines)].slice(
      0,
      20
    )

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
      toast({
        message: `已上传 ${uploaded.length} 个${label}。`,
        duration: 2200,
      })
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
        message: error instanceof Error ? error.message : `上传${label}失败。`,
        duration: 3000,
      })
      return []
    }
  }

  const handleUploadAttachments = async (event: ChangeEvent<HTMLInputElement>) => {
    const drafts = await uploadAttachmentDrafts(event, '附件')
    if (drafts.length === 0) return
    setUploadedAttachments((current) => [...current, ...drafts])
  }

  const handleUploadSubmissionAttachments = async (event: ChangeEvent<HTMLInputElement>) => {
    const drafts = await uploadAttachmentDrafts(event, '交付附件')
    if (drafts.length === 0) return
    setSubmissionUploadedAttachments((current) => [...current, ...drafts])
  }

  const removeUploadedAttachment = (workspaceFileId: string) => {
    setUploadedAttachments((current) =>
      current.filter((attachment) => attachment.workspaceFileId !== workspaceFileId)
    )
  }

  const removeSubmissionUploadedAttachment = (workspaceFileId: string) => {
    setSubmissionUploadedAttachments((current) =>
      current.filter((attachment) => attachment.workspaceFileId !== workspaceFileId)
    )
  }

  const handleCreateTask = async () => {
    if (!title.trim() || !assigneeWorkgroupId) {
      toast({ message: '请填写任务标题并选择负责工种。', duration: 2400 })
      return
    }
    try {
      const result = await createTask.mutateAsync({
        workspaceId,
        sourceWorkflowId: workflowId,
        assigneeWorkgroupId,
        title: title.trim(),
        description: description.trim() || null,
        dueAt: fromDateTimeLocal(dueAt),
        dependencyTaskIds,
        attachments: getAttachmentInputs(),
      })
      setPanelMode('detail')
      setSelectedTaskId(result.task.id)
      setDependencyTaskIds(result.task.blockedBy.map((dependency) => dependency.taskId))
      setAttachmentLines(serializeAttachmentLines(result.task))
      setUploadedAttachments(getUploadedAttachmentDrafts(result.task))
      toast({ message: '生产任务已创建。', duration: 2200 })
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : '创建任务失败。',
        duration: 2600,
      })
    }
  }

  const handleSaveTaskCollaboration = async () => {
    if (!selectedTask) return
    try {
      await updateTask.mutateAsync({
        taskId: selectedTask.id,
        body: {
          dependencyTaskIds,
          attachments: getAttachmentInputs(),
        },
      })
      toast({ message: '协作信息已更新。', duration: 2200 })
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : '保存协作信息失败。',
        duration: 2600,
      })
    }
  }

  const handleStartTask = async () => {
    if (!selectedTask) return
    try {
      await updateTask.mutateAsync({
        taskId: selectedTask.id,
        body: { status: 'in_progress' },
      })
      toast({ message: '任务已进入进行中。', duration: 2200 })
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : '更新任务失败。',
        duration: 2600,
      })
    }
  }

  const handleSubmitTask = async () => {
    if (!selectedTask) return
    if (selectedCanvasNodeIds.length > 1) {
      toast({
        message: '一次提交只能附带 1 个画布节点，请只保留一个选中节点。',
        duration: 2800,
      })
      return
    }

    const selectedNodeId = selectedCanvasNodeIds[0]
    const note = submissionNote.trim()
    const attachments = getSubmissionAttachmentInputs()
    if (!selectedNodeId && !note && attachments.length === 0) {
      toast({
        message: '请填写交付说明、上传附件、粘贴链接，或选中 1 个画布节点。',
        duration: 3000,
      })
      return
    }

    try {
      const result = await submitTask.mutateAsync({
        taskId: selectedTask.id,
        workspaceId,
        workflowId: selectedNodeId ? workflowId : undefined,
        nodeId: selectedNodeId,
        submissionNote: note || null,
        attachments,
      })
      setSubmissionNote(result.task.submissionNote ?? '')
      setSubmissionAttachmentLines(serializeAttachmentItems(result.task.submissionAttachments))
      setSubmissionUploadedAttachments(
        getUploadedAttachmentDraftsFromItems(result.task.submissionAttachments)
      )
      toast({ message: '交付内容已提交审核。', duration: 2200 })
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : '提交审核失败。',
        duration: 2600,
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
      toast({
        message: action === 'approve' ? '审核已通过。' : '已要求修改。',
        duration: 2200,
      })
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : '审核失败。',
        duration: 2600,
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
        message: error instanceof Error ? error.message : '发送消息失败。',
        duration: 2600,
      })
    }
  }

  const renderDependencySelector = () => (
    <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-2'>
      <div className='mb-2 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]'>
        <ListChecks className='h-3.5 w-3.5' />
        依赖任务
      </div>
      {availableDependencyTasks.length === 0 ? (
        <div className='text-[12px] text-[var(--text-tertiary)]'>暂无可选依赖任务</div>
      ) : (
        <div className='grid max-h-[150px] gap-1 overflow-y-auto'>
          {availableDependencyTasks.map((task) => (
            <label
              key={task.id}
              className='flex min-h-[30px] items-center gap-2 rounded-[6px] px-2 text-[12px] hover-hover:bg-[var(--surface-3)]'
            >
              <Checkbox
                size='sm'
                checked={dependencyTaskIds.includes(task.id)}
                onCheckedChange={() => toggleDependency(task.id)}
              />
              <span className='min-w-0 flex-1 truncate'>{task.title}</span>
              <span className='shrink-0 text-[10px] text-[var(--text-tertiary)]'>
                {STATUS_LABELS[task.status]}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )

  const renderAttachmentEditor = ({
    title: editorTitle,
    inputRef,
    uploadedItems,
    onUpload,
    onRemove,
  }: {
    title: string
    inputRef: RefObject<HTMLInputElement | null>
    uploadedItems: UploadedAttachmentDraft[]
    onUpload: (event: ChangeEvent<HTMLInputElement>) => void
    onRemove: (workspaceFileId: string) => void
  }) => (
    <div className='space-y-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-2'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex items-center gap-2 text-[12px] text-[var(--text-secondary)]'>
          <Paperclip className='h-3.5 w-3.5' />
          {editorTitle}
        </div>
        <Button
          type='button'
          size='sm'
          variant='secondary'
          onClick={() => inputRef.current?.click()}
          disabled={uploadWorkspaceFile.isPending}
        >
          <UploadCloud className='mr-1.5 h-3.5 w-3.5' />
          {uploadWorkspaceFile.isPending ? '上传中...' : '上传文件'}
        </Button>
        <input ref={inputRef} type='file' multiple className='hidden' onChange={onUpload} />
      </div>
      {uploadedItems.length > 0 && (
        <div className='grid gap-1'>
          {uploadedItems.map((attachment) => (
            <div
              key={attachment.workspaceFileId}
              className='flex items-center gap-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-[12px]'
            >
              <FileText className='h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]' />
              <span className='min-w-0 flex-1 truncate text-[var(--text-primary)]'>
                {attachment.name}
              </span>
              <span className='shrink-0 text-[10px] text-[var(--text-tertiary)]'>
                {formatBytes(attachment.size)}
              </span>
              <button
                type='button'
                className='shrink-0 rounded-[6px] p-1 text-[var(--text-tertiary)] hover-hover:bg-[var(--surface-3)] hover-hover:text-[var(--text-primary)]'
                onClick={() => onRemove(attachment.workspaceFileId)}
                aria-label='Remove uploaded attachment'
              >
                <X className='h-3.5 w-3.5' />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const renderAttachmentList = (items: ProductionTaskAttachment[], title: string) => {
    if (items.length === 0) return null
    return (
      <div className='rounded-[8px] border border-[var(--border)] px-3 py-2'>
        <div className='mb-1 flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]'>
          <Paperclip className='h-3.5 w-3.5' />
          {title}
        </div>
        <div className='space-y-1'>
          {items.map((attachment) => (
            <a
              key={attachment.id}
              href={getAttachmentHref(attachment)}
              target='_blank'
              rel='noreferrer'
              download={attachment.name}
              className='flex items-center gap-2 rounded-[6px] px-1 py-1 text-[12px] text-[var(--badge-blue-text)] hover-hover:bg-[var(--surface-2)]'
            >
              <span className='min-w-0 flex-1 truncate'>{attachment.name}</span>
              {attachment.size ? (
                <span className='shrink-0 text-[10px] text-[var(--text-tertiary)]'>
                  {formatBytes(attachment.size)}
                </span>
              ) : null}
              {attachment.source === 'workspace_file' ? (
                <Download className='h-3 w-3 shrink-0' />
              ) : (
                <ExternalLink className='h-3 w-3 shrink-0' />
              )}
            </a>
          ))}
        </div>
      </div>
    )
  }

  const renderTaskRow = (task: ProductionTask) => {
    const placement = getGanttPlacement(task)
    const blockingCount = getBlockingDependencyCount(task)
    return (
      <button
        key={task.id}
        type='button'
        className={cn(
          'grid w-full gap-3 rounded-[8px] border p-3 text-left transition-colors hover-hover:bg-[var(--surface-2)] lg:grid-cols-[minmax(220px,1fr)_minmax(260px,1.4fr)_120px]',
          selectedTaskId === task.id
            ? 'border-[var(--brand-accent)] bg-[var(--surface-3)]'
            : 'border-[var(--border)] bg-[var(--surface-1)]',
          task.unreadMessageCount > 0 && 'ring-1 ring-[var(--badge-blue-text)]/20'
        )}
        onClick={() => openDetailPanel(task)}
      >
        <div className='min-w-0'>
          <div className='flex items-start gap-2'>
            <div className='min-w-0 flex-1'>
              <div className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                {task.title}
              </div>
              <div className='mt-1 truncate text-[11px] text-[var(--text-tertiary)]'>
                {task.sourceWorkgroup.name} → {task.assigneeWorkgroup.name}
              </div>
            </div>
            {task.unreadMessageCount > 0 && (
              <Badge variant='blue' size='sm' className='shrink-0 rounded-full px-1.5 text-[10px]'>
                {task.unreadMessageCount}
              </Badge>
            )}
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
            {blockingCount > 0 && (
              <Badge variant='amber' size='sm' className='h-5 rounded-full px-2 text-[10px]'>
                阻塞 {blockingCount}
              </Badge>
            )}
            {task.attachments.length > 0 && (
              <Badge
                variant='gray-secondary'
                size='sm'
                className='h-5 rounded-full px-2 text-[10px]'
              >
                附件 {task.attachments.length}
              </Badge>
            )}
          </div>
        </div>

        {dashboardView === 'gantt' ? (
          <div className='min-w-0'>
            <div className='grid h-[30px] grid-cols-7 gap-1 rounded-[7px] bg-[var(--surface-2)] p-1'>
              {timelineDays.map((day) => (
                <div key={day.toISOString()} className='rounded-[5px] bg-[var(--surface-1)]' />
              ))}
              <div
                className={cn(
                  'row-start-1 h-full rounded-[5px] opacity-90',
                  placement.startClassName,
                  placement.spanClassName,
                  getTaskRailClassName(task)
                )}
              />
            </div>
            <div className='mt-1 grid grid-cols-7 gap-1 text-center text-[9px] text-[var(--text-tertiary)]'>
              {timelineDays.map((day) => (
                <span key={day.toISOString()}>{formatDay(day)}</span>
              ))}
            </div>
          </div>
        ) : (
          <div className='min-w-0 text-[12px] text-[var(--text-secondary)]'>
            <div className='line-clamp-2 leading-5'>{task.description || '暂无任务说明'}</div>
          </div>
        )}

        <div className='flex items-center justify-between gap-2 lg:justify-end'>
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
              {getRelativeDueLabel(task.dueAt)}
            </div>
            <div className='mt-1 text-[10px] text-[var(--text-tertiary)]'>
              {formatDateTime(task.dueAt)}
            </div>
          </div>
          <ChevronRight className='h-4 w-4 shrink-0 text-[var(--text-tertiary)]' />
        </div>
      </button>
    )
  }

  return (
    <>
      <div className='pointer-events-none absolute top-[72px] left-4 z-10'>
        <Button
          type='button'
          variant='secondary'
          size='sm'
          className='pointer-events-auto h-9 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]/95 px-3 shadow-subtle backdrop-blur'
          onClick={() => setIsDashboardOpen(true)}
        >
          <BarChart3 className='mr-1.5 h-4 w-4' />
          仪表盘
          {dashboardBadgeCount > 0 && (
            <Badge variant='red' size='sm' className='ml-2 rounded-full px-1.5 text-[10px]'>
              {dashboardBadgeCount}
            </Badge>
          )}
        </Button>
      </div>

      <Modal open={isDashboardOpen} onOpenChange={setIsDashboardOpen}>
        <ModalContent
          size='full'
          showClose={false}
          className='h-[min(84vh,820px)] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-0 shadow-overlay'
        >
          <div className='flex h-full min-h-0 flex-col'>
            <div className='flex min-h-[64px] items-center justify-between gap-3 border-[var(--border)] border-b px-4 py-3'>
              <div className='min-w-0'>
                <div className='flex items-center gap-2'>
                  <GanttChart className='h-4 w-4 text-[var(--text-secondary)]' />
                  <h2 className='truncate font-semibold text-[15px] text-[var(--text-primary)]'>
                    生产仪表盘
                  </h2>
                </div>
                <div className='mt-1 truncate text-[12px] text-[var(--text-tertiary)]'>
                  {isDirectorLike
                    ? '导演总览，按工种查看任务进度'
                    : (agentProfile?.workgroup.name ?? '当前工种')}
                </div>
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                <Button type='button' size='sm' onClick={() => openCreatePanel()}>
                  <Plus className='mr-1.5 h-3.5 w-3.5' />
                  新建任务
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  className='h-8 w-8 p-0'
                  onClick={() => setIsDashboardOpen(false)}
                >
                  <X className='h-4 w-4' />
                </Button>
              </div>
            </div>

            <div className='grid gap-3 border-[var(--border)] border-b px-4 py-3 lg:grid-cols-[1fr_auto]'>
              <div className='grid grid-cols-2 gap-2 md:grid-cols-5'>
                <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                  <div className='text-[11px] text-[var(--text-tertiary)]'>总任务</div>
                  <div className='mt-1 font-semibold text-[16px] text-[var(--text-primary)]'>
                    {totalCount}
                  </div>
                </div>
                <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                  <div className='text-[11px] text-[var(--text-error)]'>已超时</div>
                  <div className='mt-1 font-semibold text-[16px] text-[var(--text-error)]'>
                    {overdueCount}
                  </div>
                </div>
                <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                  <div className='text-[11px] text-[var(--badge-amber-text)]'>24h 内</div>
                  <div className='mt-1 font-semibold text-[16px] text-[var(--badge-amber-text)]'>
                    {dueSoonCount}
                  </div>
                </div>
                <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                  <div className='text-[11px] text-[var(--badge-blue-text)]'>待审核</div>
                  <div className='mt-1 font-semibold text-[16px] text-[var(--badge-blue-text)]'>
                    {reviewCount}
                  </div>
                </div>
                <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                  <div className='text-[11px] text-[var(--text-tertiary)]'>未读消息</div>
                  <div className='mt-1 font-semibold text-[16px] text-[var(--text-primary)]'>
                    {unreadCount}
                  </div>
                </div>
              </div>
              <div className='flex flex-wrap items-center gap-2'>
                <div className='flex h-8 overflow-hidden rounded-[8px] border border-[var(--border)]'>
                  {(['gantt', 'list'] as DashboardView[]).map((view) => (
                    <button
                      key={view}
                      type='button'
                      className={cn(
                        'px-3 text-[12px] transition-colors',
                        dashboardView === view
                          ? 'bg-[var(--surface-3)] text-[var(--text-primary)]'
                          : 'text-[var(--text-secondary)] hover-hover:bg-[var(--surface-2)]'
                      )}
                      onClick={() => setDashboardView(view)}
                    >
                      {view === 'gantt' ? '甘特' : '列表'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className='flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_360px]'>
              <div className='flex min-h-0 flex-col border-[var(--border)] border-b lg:border-r lg:border-b-0'>
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

                <div className='min-h-0 flex-1 overflow-y-auto px-4 py-3'>
                  {groupedTasks.length === 0 ? (
                    <div className='flex min-h-[280px] flex-col items-center justify-center rounded-[8px] border border-[var(--border)] border-dashed text-center'>
                      <Inbox className='h-8 w-8 text-[var(--text-tertiary)]' />
                      <div className='mt-3 font-medium text-[13px] text-[var(--text-primary)]'>
                        暂无匹配任务
                      </div>
                      <div className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
                        新建任务后会按负责工种出现在这里。
                      </div>
                    </div>
                  ) : (
                    <div className='space-y-4'>
                      {groupedTasks.map((group) => {
                        const groupOverdue = group.tasks.filter(isOverdue).length
                        const groupReview = group.tasks.filter(
                          (task) => task.status === 'submitted'
                        ).length
                        return (
                          <section key={group.id} className='space-y-2'>
                            <div className='flex items-center justify-between gap-3'>
                              <div className='min-w-0'>
                                <div className='truncate font-semibold text-[13px] text-[var(--text-primary)]'>
                                  {group.name}
                                </div>
                                <div className='mt-0.5 text-[11px] text-[var(--text-tertiary)]'>
                                  {group.tasks.length} 个任务
                                  {groupOverdue > 0 ? ` · ${groupOverdue} 个超时` : ''}
                                  {groupReview > 0 ? ` · ${groupReview} 个待审核` : ''}
                                </div>
                              </div>
                              <div className='h-px min-w-[24px] flex-1 bg-[var(--border)]' />
                            </div>
                            <div className='space-y-2'>{group.tasks.map(renderTaskRow)}</div>
                          </section>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              <aside className='flex min-h-0 flex-col'>
                {panelMode === 'create' ? (
                  <div className='flex min-h-0 flex-1 flex-col'>
                    <div className='border-[var(--border)] border-b px-4 py-3'>
                      <div className='font-semibold text-[14px] text-[var(--text-primary)]'>
                        新建生产任务
                      </div>
                      <div className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
                        派发给具体工种，并写清 DDL、依赖和交付材料。
                      </div>
                    </div>
                    <div className='min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4'>
                      <div className='space-y-1.5'>
                        <label
                          htmlFor='production-task-title'
                          className='font-medium text-[12px] text-[var(--text-secondary)]'
                        >
                          标题
                        </label>
                        <Input
                          id='production-task-title'
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                        />
                      </div>
                      <div className='space-y-1.5'>
                        <label
                          htmlFor='production-task-assignee'
                          className='font-medium text-[12px] text-[var(--text-secondary)]'
                        >
                          负责工种
                        </label>
                        <Combobox
                          id='production-task-assignee'
                          value={assigneeWorkgroupId}
                          options={assigneeOptions}
                          onChange={setAssigneeWorkgroupId}
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
                          value={dueAt}
                          onChange={(event) => setDueAt(event.target.value)}
                        />
                      </div>
                      <div className='space-y-1.5'>
                        <label
                          htmlFor='production-task-description'
                          className='font-medium text-[12px] text-[var(--text-secondary)]'
                        >
                          说明
                        </label>
                        <Textarea
                          id='production-task-description'
                          value={description}
                          onChange={(event) => setDescription(event.target.value)}
                          className='min-h-[110px]'
                        />
                      </div>
                      {renderDependencySelector()}
                      {renderAttachmentEditor({
                        title: '任务资料',
                        inputRef: attachmentInputRef,
                        uploadedItems: uploadedAttachments,
                        onUpload: handleUploadAttachments,
                        onRemove: removeUploadedAttachment,
                      })}
                      <div className='space-y-1.5'>
                        <label
                          htmlFor='production-task-attachments'
                          className='font-medium text-[12px] text-[var(--text-secondary)]'
                        >
                          附件链接
                        </label>
                        <Textarea
                          id='production-task-attachments'
                          value={attachmentLines}
                          onChange={(event) => setAttachmentLines(event.target.value)}
                          placeholder='每行一个：资料名 | https://...'
                          className='min-h-[88px]'
                        />
                      </div>
                    </div>
                    <div className='border-[var(--border)] border-t p-3'>
                      <Button
                        type='button'
                        className='w-full'
                        onClick={handleCreateTask}
                        disabled={createTask.isPending}
                      >
                        {createTask.isPending ? '创建中...' : '创建任务'}
                      </Button>
                    </div>
                  </div>
                ) : panelMode === 'detail' && selectedTask ? (
                  <div className='flex min-h-0 flex-1 flex-col'>
                    <div className='space-y-3 border-[var(--border)] border-b px-4 py-4'>
                      <div className='flex items-start justify-between gap-3'>
                        <div className='min-w-0'>
                          <div className='font-semibold text-[15px] text-[var(--text-primary)] leading-5'>
                            {selectedTask.title}
                          </div>
                          <div className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
                            {selectedTask.sourceWorkgroup.name} →{' '}
                            {selectedTask.assigneeWorkgroup.name}
                          </div>
                        </div>
                        <Badge
                          variant={getStatusBadgeVariant(selectedTask.status)}
                          size='sm'
                          dot
                          className='shrink-0 rounded-full px-2 text-[10px]'
                        >
                          {STATUS_LABELS[selectedTask.status]}
                        </Badge>
                      </div>

                      <div className='grid grid-cols-2 gap-2 text-[12px]'>
                        <div className='rounded-[8px] border border-[var(--border)] px-2.5 py-2'>
                          <div className='flex items-center gap-1.5 text-[var(--text-tertiary)]'>
                            <Clock3 className='h-3.5 w-3.5' />
                            DDL
                          </div>
                          <div className='mt-1 text-[var(--text-primary)]'>
                            {formatDateTime(selectedTask.dueAt)}
                          </div>
                        </div>
                        <div className='rounded-[8px] border border-[var(--border)] px-2.5 py-2'>
                          <div className='flex items-center gap-1.5 text-[var(--text-tertiary)]'>
                            <FileText className='h-3.5 w-3.5' />
                            画布节点
                          </div>
                          <div className='mt-1 truncate text-[var(--text-primary)]'>
                            {selectedTask.resultNodeId ?? '未提交'}
                          </div>
                        </div>
                      </div>

                      {selectedTask.description && (
                        <div className='whitespace-pre-wrap text-[12px] text-[var(--text-secondary)] leading-5'>
                          {selectedTask.description}
                        </div>
                      )}

                      {selectedTask.blockedBy.length > 0 && (
                        <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                          <div className='mb-1 flex items-center gap-1.5 text-[12px] text-[var(--badge-amber-text)]'>
                            <AlertTriangle className='h-3.5 w-3.5' />
                            依赖
                          </div>
                          <div className='space-y-1'>
                            {selectedTask.blockedBy.map((dependency) => (
                              <div
                                key={dependency.taskId}
                                className='flex items-center justify-between gap-2 text-[12px]'
                              >
                                <span className='min-w-0 flex-1 truncate text-[var(--text-secondary)]'>
                                  {dependency.title}
                                </span>
                                <span className='shrink-0 text-[10px] text-[var(--badge-amber-text)]'>
                                  {STATUS_LABELS[dependency.status]}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {renderAttachmentList(selectedTask.attachments, '任务资料')}

                      {(selectedTask.resultNodeId || selectedTask.submissionNote) && (
                        <div className='rounded-[8px] border border-[var(--border)] px-3 py-2'>
                          <div className='mb-1 flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]'>
                            <Send className='h-3.5 w-3.5' />
                            提交内容
                          </div>
                          {selectedTask.resultNodeId && (
                            <div className='text-[12px] text-[var(--text-secondary)]'>
                              画布节点：{selectedTask.resultNodeId}
                            </div>
                          )}
                          {selectedTask.submissionNote && (
                            <div className='mt-2 whitespace-pre-wrap text-[12px] text-[var(--text-secondary)] leading-5'>
                              {selectedTask.submissionNote}
                            </div>
                          )}
                        </div>
                      )}

                      {renderAttachmentList(selectedTask.submissionAttachments, '交付附件')}

                      {selectedTask.reviewNote && (
                        <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[12px] text-[var(--badge-amber-text)]'>
                          {selectedTask.reviewNote}
                        </div>
                      )}

                      <div className='flex flex-wrap gap-2'>
                        {selectedTask.permissions.canSubmit && selectedTask.status === 'todo' && (
                          <Button
                            type='button'
                            size='sm'
                            variant='secondary'
                            onClick={handleStartTask}
                          >
                            开始处理
                          </Button>
                        )}
                        {selectedTask.permissions.canReview &&
                          selectedTask.status === 'submitted' && (
                            <>
                              <Button
                                type='button'
                                size='sm'
                                onClick={() => handleReviewTask('approve')}
                              >
                                <Check className='mr-1.5 h-3.5 w-3.5' />
                                通过
                              </Button>
                              <Button
                                type='button'
                                size='sm'
                                variant='secondary'
                                onClick={() => handleReviewTask('request_changes')}
                              >
                                要求修改
                              </Button>
                            </>
                          )}
                      </div>

                      {selectedTask.permissions.canReview &&
                        selectedTask.status === 'submitted' && (
                          <Textarea
                            value={reviewNote}
                            onChange={(event) => setReviewNote(event.target.value)}
                            placeholder='审核意见（可选）'
                            className='min-h-[72px]'
                          />
                        )}
                    </div>

                    <div className='min-h-0 flex-1 overflow-y-auto'>
                      {selectedTask.permissions.canSubmit &&
                        ACTIVE_STATUSES.has(selectedTask.status) && (
                          <div className='space-y-3 border-[var(--border)] border-b px-4 py-4'>
                            <div className='flex items-center gap-2 font-medium text-[12px] text-[var(--text-secondary)]'>
                              <Send className='h-3.5 w-3.5' />
                              交付提交
                            </div>
                            <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[12px] text-[var(--text-secondary)]'>
                              {selectedCanvasNodeIds.length === 1
                                ? `将附带当前选中节点：${selectedCanvasNodeIds[0]}`
                                : selectedCanvasNodeIds.length > 1
                                  ? '当前选中了多个节点，提交前请只保留一个节点。'
                                  : '未附带画布节点，可只提交文字、图片、视频或文档。'}
                            </div>
                            <Textarea
                              value={submissionNote}
                              onChange={(event) => setSubmissionNote(event.target.value)}
                              placeholder='填写交付说明、修改说明或审核备注'
                              className='min-h-[86px]'
                            />
                            {renderAttachmentEditor({
                              title: '交付附件',
                              inputRef: submissionAttachmentInputRef,
                              uploadedItems: submissionUploadedAttachments,
                              onUpload: handleUploadSubmissionAttachments,
                              onRemove: removeSubmissionUploadedAttachment,
                            })}
                            <Textarea
                              value={submissionAttachmentLines}
                              onChange={(event) => setSubmissionAttachmentLines(event.target.value)}
                              placeholder='每行一个：成果名 | https://...'
                              className='min-h-[78px]'
                            />
                            <Button
                              type='button'
                              size='sm'
                              onClick={handleSubmitTask}
                              disabled={submitTask.isPending}
                            >
                              <Send className='mr-1.5 h-3.5 w-3.5' />
                              {submitTask.isPending ? '提交中...' : '提交交付物'}
                            </Button>
                          </div>
                        )}

                      {selectedTask.permissions.canEdit && (
                        <div className='space-y-3 border-[var(--border)] border-b px-4 py-4'>
                          <div className='font-medium text-[12px] text-[var(--text-secondary)]'>
                            协作信息
                          </div>
                          {renderDependencySelector()}
                          {renderAttachmentEditor({
                            title: '任务资料',
                            inputRef: attachmentInputRef,
                            uploadedItems: uploadedAttachments,
                            onUpload: handleUploadAttachments,
                            onRemove: removeUploadedAttachment,
                          })}
                          <Textarea
                            value={attachmentLines}
                            onChange={(event) => setAttachmentLines(event.target.value)}
                            placeholder='每行一个：资料名 | https://...'
                            className='min-h-[78px]'
                          />
                          <Button
                            type='button'
                            size='sm'
                            variant='secondary'
                            onClick={handleSaveTaskCollaboration}
                            disabled={updateTask.isPending}
                          >
                            保存协作信息
                          </Button>
                        </div>
                      )}

                      <div className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-2 font-medium text-[12px] text-[var(--text-secondary)]'>
                        <MessageSquare className='h-3.5 w-3.5' />
                        节点内聊天
                      </div>
                      <div className='space-y-3 px-4 py-3'>
                        {messages.length === 0 ? (
                          <div className='py-6 text-center text-[12px] text-[var(--text-tertiary)]'>
                            暂无消息
                          </div>
                        ) : (
                          messages.map((message) => (
                            <div
                              key={message.id}
                              className='rounded-[8px] bg-[var(--surface-2)] px-3 py-2'
                            >
                              <div className='flex items-center justify-between gap-2'>
                                <span className='truncate font-medium text-[12px] text-[var(--text-primary)]'>
                                  {message.senderUser?.name ?? '成员'}
                                </span>
                                <span className='shrink-0 text-[10px] text-[var(--text-tertiary)]'>
                                  {formatDateTime(message.createdAt)}
                                </span>
                              </div>
                              <div className='mt-1 whitespace-pre-wrap text-[12px] text-[var(--text-secondary)] leading-5'>
                                {message.body}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {selectedTask.permissions.canMessage && (
                      <div className='border-[var(--border)] border-t p-3'>
                        <Textarea
                          value={messageBody}
                          onChange={(event) => setMessageBody(event.target.value)}
                          placeholder='输入任务消息，可直接 @工种说明协作事项'
                          className='min-h-[72px]'
                        />
                        <div className='mt-2 flex justify-end'>
                          <Button
                            type='button'
                            size='sm'
                            onClick={handleSendMessage}
                            disabled={createMessage.isPending || !messageBody.trim()}
                          >
                            发送
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className='flex flex-1 flex-col items-center justify-center px-6 text-center'>
                    <CalendarClock className='h-8 w-8 text-[var(--text-tertiary)]' />
                    <div className='mt-3 font-medium text-[13px] text-[var(--text-primary)]'>
                      选择一个任务
                    </div>
                    <div className='mt-1 text-[12px] text-[var(--text-tertiary)] leading-5'>
                      在左侧选择任务查看聊天、依赖、附件和提交审核入口。
                    </div>
                  </div>
                )}
              </aside>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </>
  )
}
