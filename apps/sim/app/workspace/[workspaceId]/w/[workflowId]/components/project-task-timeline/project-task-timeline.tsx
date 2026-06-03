'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Clock,
  Eye,
  Plus,
  Send,
  UserRound,
  XCircle,
} from 'lucide-react'
import {
  Badge,
  Button,
  Combobox,
  FormField,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
  Textarea,
  Tooltip,
  toast,
} from '@/components/emcn'
import type {
  CreateProjectTaskBody,
  ListProjectTasksQueryInput,
  ProjectTask,
  ProjectTaskAssignee,
  ProjectTaskEventsQueryInput,
  ProjectTaskReviewAction,
  ProjectTaskStatus,
  UpdateProjectTaskBody,
} from '@/lib/api/contracts/project-tasks'
import {
  useArchiveProjectTask,
  useCreateProjectTask,
  useProjectTaskEvents,
  useProjectTasks,
  useReviewProjectTask,
  useSubmitProjectTask,
  useUpdateProjectTask,
} from '@/hooks/queries/project-tasks'

interface ProjectTaskTimelineProps {
  organizationId: string
  workspaceId: string
  workflowId: string
  activeWorkgroupId: string
  isDirector: boolean
  selectedNodeIds: string[]
  canEditCanvas: boolean
}

interface TaskFormModalProps {
  open: boolean
  mode: 'create' | 'edit'
  organizationId: string
  task: ProjectTask | null
  assignees: ProjectTaskAssignee[]
  onOpenChange: (open: boolean) => void
}

interface TaskDetailModalProps {
  open: boolean
  task: ProjectTask | null
  activeWorkgroupId: string
  workspaceId: string
  workflowId: string
  selectedNodeIds: string[]
  canEditCanvas: boolean
  canManage: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (task: ProjectTask) => void
}

const STATUS_META: Record<
  ProjectTaskStatus,
  {
    label: string
    badge: 'gray' | 'blue' | 'amber' | 'green' | 'red'
    actionLabel: string
  }
> = {
  todo: { label: '待提交', badge: 'gray', actionLabel: '等待工种提交' },
  submitted: { label: '已提交', badge: 'blue', actionLabel: '等待导演审核' },
  in_review: { label: '审核中', badge: 'amber', actionLabel: '导演正在审核' },
  completed: { label: '已完成', badge: 'green', actionLabel: '审核通过' },
  rejected: { label: '已驳回', badge: 'red', actionLabel: '需要重新提交' },
}

function formatDateTime(value: string | null): string {
  if (!value) return '未设置 DDL'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatRemaining(value: string | null): {
  label: string
  tone: 'default' | 'danger' | 'warn'
} {
  if (!value) return { label: '无 DDL', tone: 'default' }
  const due = new Date(value).getTime()
  const now = Date.now()
  const diffDays = Math.ceil((due - now) / (24 * 60 * 60 * 1000))
  if (diffDays < 0) return { label: `逾期 ${Math.abs(diffDays)} 天`, tone: 'danger' }
  if (diffDays === 0) return { label: '今天截止', tone: 'warn' }
  if (diffDays === 1) return { label: '明天截止', tone: 'warn' }
  return { label: `剩余 ${diffDays} 天`, tone: 'default' }
}

function toDateTimeLocal(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function fromDateTimeLocal(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function getTaskSortTime(task: ProjectTask): number {
  return task.dueAt ? new Date(task.dueAt).getTime() : Number.MAX_SAFE_INTEGER
}

function TaskStatusBadge({ status }: { status: ProjectTaskStatus }) {
  const meta = STATUS_META[status]
  return (
    <Badge variant={meta.badge} size='sm' dot>
      {meta.label}
    </Badge>
  )
}

function TaskCard({ task, onOpen }: { task: ProjectTask; onOpen: (task: ProjectTask) => void }) {
  const remaining = formatRemaining(task.dueAt)
  const statusMeta = STATUS_META[task.status]

  return (
    <Button
      type='button'
      variant='ghost'
      className='h-auto min-w-[220px] max-w-[260px] flex-col items-stretch gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-left shadow-card transition-colors hover-hover:border-[var(--border-1)] hover-hover:bg-[var(--surface-hover)]'
      onClick={() => onOpen(task)}
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='truncate font-medium text-[var(--text-primary)] text-small'>
            {task.title}
          </div>
          <div className='mt-1 flex items-center gap-1 text-[var(--text-secondary)] text-xs'>
            <UserRound className='h-3 w-3 text-[var(--text-icon)]' />
            <span className='truncate'>{task.assigneeWorkgroup.name}</span>
          </div>
        </div>
        <TaskStatusBadge status={task.status} />
      </div>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex items-center gap-1 text-[var(--text-tertiary)] text-xs'>
          <CalendarClock className='h-[14px] w-[14px] text-[var(--text-icon)]' />
          <span>{formatDateTime(task.dueAt)}</span>
        </div>
        <Badge
          variant={
            remaining.tone === 'danger'
              ? 'red'
              : remaining.tone === 'warn'
                ? 'amber'
                : 'gray-secondary'
          }
          size='sm'
        >
          {remaining.label}
        </Badge>
      </div>
      <div className='flex items-center gap-1 text-[var(--text-muted)] text-xs'>
        <ClipboardCheck className='h-[14px] w-[14px] text-[var(--text-icon)]' />
        <span>{statusMeta.actionLabel}</span>
      </div>
    </Button>
  )
}

function TimelineSkeleton() {
  return (
    <div className='flex gap-3 overflow-hidden px-3 pb-3'>
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className='min-w-[220px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3'
        >
          <Skeleton className='mb-3 h-4 w-[160px] rounded-md' />
          <Skeleton className='mb-2 h-3 w-[120px] rounded-md' />
          <Skeleton className='h-6 w-full rounded-md' />
        </div>
      ))}
    </div>
  )
}

function EmptyTimeline({ canManage }: { canManage: boolean }) {
  return (
    <div className='px-4 py-5 text-center'>
      <div className='mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-4)]'>
        <Clock className='h-[16px] w-[16px] text-[var(--text-icon)]' />
      </div>
      <div className='font-medium text-[var(--text-primary)] text-small'>暂无未完成项目任务</div>
      <div className='mt-1 text-[var(--text-secondary)] text-xs'>
        {canManage ? '可从右上角新建任务并指派给工种。' : '导演组指派后会在这里显示。'}
      </div>
    </div>
  )
}

function TaskFormModal({
  open,
  mode,
  organizationId,
  task,
  assignees,
  onOpenChange,
}: TaskFormModalProps) {
  const createMutation = useCreateProjectTask()
  const updateMutation = useUpdateProjectTask()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [assigneeWorkgroupId, setAssigneeWorkgroupId] = useState('')

  useEffect(() => {
    if (!open) return
    setTitle(task?.title ?? '')
    setDescription(task?.description ?? '')
    setDueAt(toDateTimeLocal(task?.dueAt ?? null))
    setAssigneeWorkgroupId(task?.assigneeWorkgroup.id ?? assignees[0]?.id ?? '')
  }, [assignees, open, task])

  const assigneeOptions = useMemo(
    () =>
      assignees.map((assignee) => ({
        label: `${assignee.name} · ${assignee.discipline.name}`,
        value: assignee.id,
      })),
    [assignees]
  )

  const isPending = createMutation.isPending || updateMutation.isPending

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('请输入任务标题')
      return
    }
    if (!assigneeWorkgroupId) {
      toast.error('请选择负责工种')
      return
    }

    try {
      if (mode === 'create') {
        const body: CreateProjectTaskBody = {
          title,
          description,
          assigneeWorkgroupId,
          dueAt: fromDateTimeLocal(dueAt),
        }
        await createMutation.mutateAsync({ organizationId, body })
        toast.success('任务已创建')
      } else if (task) {
        const body: UpdateProjectTaskBody = {
          title,
          description,
          assigneeWorkgroupId,
          dueAt: fromDateTimeLocal(dueAt),
        }
        await updateMutation.mutateAsync({ taskId: task.id, body })
        toast.success('任务已更新')
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存任务失败')
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='md'>
        <ModalHeader>{mode === 'create' ? '新建项目任务' : '编辑项目任务'}</ModalHeader>
        <ModalBody className='flex flex-col gap-4'>
          <FormField label='任务标题' htmlFor='project-task-title'>
            <Input
              id='project-task-title'
              value={title}
              maxLength={160}
              placeholder='例如：完成灯光走位方案'
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>
          <FormField label='负责工种' htmlFor='project-task-assignee'>
            <Combobox
              value={assigneeWorkgroupId}
              options={assigneeOptions}
              placeholder='选择工种'
              searchable
              emptyMessage='暂无可指派工种'
              onChange={setAssigneeWorkgroupId}
            />
          </FormField>
          <FormField label='DDL' htmlFor='project-task-due-at' optional>
            <Input
              id='project-task-due-at'
              type='datetime-local'
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </FormField>
          <FormField label='任务说明' htmlFor='project-task-description' optional>
            <Textarea
              id='project-task-description'
              value={description}
              rows={4}
              maxLength={4000}
              placeholder='补充提交标准、注意事项或参考链接'
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant='primary' disabled={isPending} onClick={handleSubmit}>
            {isPending ? '保存中...' : '保存任务'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

function TaskInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-start justify-between gap-4 border-[var(--border-muted)] border-b py-2 last:border-b-0'>
      <span className='text-[var(--text-secondary)] text-xs'>{label}</span>
      <span className='max-w-[320px] text-right text-[var(--text-primary)] text-xs'>{value}</span>
    </div>
  )
}

function TaskDetailModal({
  open,
  task,
  activeWorkgroupId,
  workspaceId,
  workflowId,
  selectedNodeIds,
  canEditCanvas,
  canManage,
  onOpenChange,
  onEdit,
}: TaskDetailModalProps) {
  const submitMutation = useSubmitProjectTask()
  const reviewMutation = useReviewProjectTask()
  const archiveMutation = useArchiveProjectTask()
  const [reviewNote, setReviewNote] = useState('')

  useEffect(() => {
    if (open) setReviewNote(task?.reviewNote ?? '')
  }, [open, task?.id, task?.reviewNote])

  if (!task) return null

  const canSubmit =
    canEditCanvas &&
    task.assigneeWorkgroup.id === activeWorkgroupId &&
    (task.status === 'todo' || task.status === 'rejected')
  const selectedNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null
  const canReview = canManage && (task.status === 'submitted' || task.status === 'in_review')

  const handleSubmitTask = async () => {
    if (!selectedNodeId) {
      toast.error('请先在画布中选中一个结果节点')
      return
    }
    try {
      await submitMutation.mutateAsync({
        taskId: task.id,
        body: {
          resultWorkspaceId: workspaceId,
          resultWorkflowId: workflowId,
          resultNodeId: selectedNodeId,
        },
      })
      toast.success('任务已提交审核')
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提交任务失败')
    }
  }

  const handleReview = async (action: ProjectTaskReviewAction) => {
    if (action === 'reject' && !reviewNote.trim()) {
      toast.error('驳回时需要填写审核意见')
      return
    }
    try {
      await reviewMutation.mutateAsync({
        taskId: task.id,
        body: { action, reviewNote },
      })
      toast.success(
        action === 'approve' ? '任务已通过' : action === 'reject' ? '任务已驳回' : '已进入审核中'
      )
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '审核操作失败')
    }
  }

  const handleArchive = async () => {
    try {
      await archiveMutation.mutateAsync({ taskId: task.id })
      toast.success('任务已归档')
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '归档任务失败')
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='lg'>
        <ModalHeader>{task.title}</ModalHeader>
        <ModalBody className='flex flex-col gap-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <TaskStatusBadge status={task.status} />
            <Badge variant='gray-secondary' size='sm'>
              {task.assigneeWorkgroup.discipline.name}
            </Badge>
            <Badge variant='outline' size='sm'>
              {task.assigneeWorkgroup.name}
            </Badge>
          </div>

          {task.description ? (
            <div className='rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[var(--text-primary)] text-small'>
              {task.description}
            </div>
          ) : null}

          <div className='rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3'>
            <TaskInfoRow label='DDL' value={formatDateTime(task.dueAt)} />
            <TaskInfoRow
              label='创建者'
              value={task.creator.name ?? task.creator.email ?? task.creator.id}
            />
            <TaskInfoRow label='结果节点' value={task.resultNodeId ?? '尚未提交'} />
            <TaskInfoRow
              label='提交人'
              value={task.submittedBy?.name ?? task.submittedBy?.email ?? '尚未提交'}
            />
            <TaskInfoRow label='审核意见' value={task.reviewNote ?? '暂无'} />
          </div>

          {canSubmit ? (
            <div className='rounded-lg border border-[var(--border)] bg-[var(--surface-3)] p-3'>
              <div className='mb-2 font-medium text-[var(--text-primary)] text-small'>
                提交当前选中节点
              </div>
              <div className='mb-3 text-[var(--text-secondary)] text-xs'>
                {selectedNodeId
                  ? `将节点 ${selectedNodeId} 绑定为任务结果。`
                  : '请在画布中选中一个结果节点后提交。'}
              </div>
              <Button
                variant='primary'
                disabled={!selectedNodeId || submitMutation.isPending}
                onClick={handleSubmitTask}
              >
                <Send className='mr-1 h-[14px] w-[14px]' />
                {submitMutation.isPending ? '提交中...' : '提交审核'}
              </Button>
            </div>
          ) : null}

          {canReview ? (
            <div className='rounded-lg border border-[var(--border)] bg-[var(--surface-3)] p-3'>
              <div className='mb-2 font-medium text-[var(--text-primary)] text-small'>导演审核</div>
              <Textarea
                value={reviewNote}
                rows={3}
                maxLength={2000}
                placeholder='审核意见，驳回时必填'
                onChange={(event) => setReviewNote(event.target.value)}
              />
              <div className='mt-3 flex flex-wrap gap-2'>
                {task.status === 'submitted' ? (
                  <Button
                    variant='default'
                    disabled={reviewMutation.isPending}
                    onClick={() => handleReview('start')}
                  >
                    <Eye className='mr-1 h-[14px] w-[14px]' />
                    开始审核
                  </Button>
                ) : null}
                <Button
                  variant='primary'
                  disabled={reviewMutation.isPending}
                  onClick={() => handleReview('approve')}
                >
                  <CheckCircle2 className='mr-1 h-[14px] w-[14px]' />
                  通过
                </Button>
                <Button
                  variant='destructive'
                  disabled={reviewMutation.isPending}
                  onClick={() => handleReview('reject')}
                >
                  <XCircle className='mr-1 h-[14px] w-[14px]' />
                  驳回
                </Button>
              </div>
            </div>
          ) : null}
        </ModalBody>
        <ModalFooter>
          {canManage ? (
            <Button
              variant='destructive'
              disabled={archiveMutation.isPending}
              onClick={handleArchive}
            >
              <Archive className='mr-1 h-[14px] w-[14px]' />
              归档
            </Button>
          ) : null}
          {canManage ? (
            <Button variant='default' onClick={() => onEdit(task)}>
              编辑
            </Button>
          ) : null}
          <Button variant='default' onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export function ProjectTaskTimeline({
  organizationId,
  workspaceId,
  workflowId,
  activeWorkgroupId,
  isDirector,
  selectedNodeIds,
  canEditCanvas,
}: ProjectTaskTimelineProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [includeCompleted, setIncludeCompleted] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const scope = isDirector ? 'director' : 'self'

  const taskQuery = useMemo<ListProjectTasksQueryInput>(
    () => ({
      scope,
      workgroupId: scope === 'self' ? activeWorkgroupId : undefined,
      includeCompleted,
      includeArchived: false,
      limit: 150,
    }),
    [activeWorkgroupId, includeCompleted, scope]
  )
  const eventQuery = useMemo<ProjectTaskEventsQueryInput>(
    () => ({
      organizationId,
      scope,
      workgroupId: scope === 'self' ? activeWorkgroupId : undefined,
    }),
    [activeWorkgroupId, organizationId, scope]
  )

  const tasksQuery = useProjectTasks({
    organizationId,
    query: taskQuery,
    enabled: Boolean(organizationId && activeWorkgroupId),
  })

  useProjectTaskEvents({
    query: eventQuery,
    enabled: Boolean(organizationId && activeWorkgroupId),
    showToast: true,
  })

  const tasks = useMemo(
    () =>
      [...(tasksQuery.data?.tasks ?? [])].sort((a, b) => getTaskSortTime(a) - getTaskSortTime(b)),
    [tasksQuery.data?.tasks]
  )
  const assignees = tasksQuery.data?.assigneeWorkgroups ?? []
  const canManage = Boolean(tasksQuery.data?.access.canManage)
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null

  return (
    <div className='pointer-events-none absolute right-4 bottom-4 left-4 z-[var(--z-dropdown)]'>
      <div className='pointer-events-auto mx-auto max-w-[1120px] rounded-xl border border-[var(--border)] bg-[var(--surface-1)] shadow-overlay'>
        <div className='flex items-center justify-between gap-3 border-[var(--border-muted)] border-b px-3 py-2'>
          <div className='flex min-w-0 items-center gap-2'>
            <div className='flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--surface-4)]'>
              <CalendarClock className='h-[16px] w-[16px] text-[var(--text-icon)]' />
            </div>
            <div className='min-w-0'>
              <div className='font-medium text-[var(--text-primary)] text-small'>
                {isDirector ? '导演任务时间轴' : '本组任务时间轴'}
              </div>
              <div className='text-[var(--text-secondary)] text-xs'>
                {isDirector ? '按 DDL 查看所有工种未完成任务' : '仅显示分配给当前工种的任务'}
              </div>
            </div>
            <Badge variant='gray-secondary' size='sm'>
              {tasks.length} 项
            </Badge>
          </div>
          <div className='flex flex-shrink-0 items-center gap-2'>
            <Button
              variant={includeCompleted ? 'active' : 'default'}
              size='sm'
              onClick={() => setIncludeCompleted((value) => !value)}
            >
              {includeCompleted ? '隐藏已完成' : '显示已完成'}
            </Button>
            {canManage ? (
              <Button variant='primary' size='sm' onClick={() => setIsCreateOpen(true)}>
                <Plus className='mr-1 h-[14px] w-[14px]' />
                新建任务
              </Button>
            ) : null}
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  aria-label={isExpanded ? '收起任务时间轴' : '展开任务时间轴'}
                  onClick={() => setIsExpanded((value) => !value)}
                >
                  {isExpanded ? (
                    <ChevronDown className='h-[14px] w-[14px]' />
                  ) : (
                    <ChevronUp className='h-[14px] w-[14px]' />
                  )}
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>{isExpanded ? '收起任务时间轴' : '展开任务时间轴'}</Tooltip.Content>
            </Tooltip.Root>
          </div>
        </div>

        {isExpanded ? (
          <div className='relative'>
            <div className='pointer-events-none absolute top-1/2 right-3 left-3 h-px bg-[var(--border-muted)]' />
            {tasksQuery.isLoading ? (
              <TimelineSkeleton />
            ) : tasks.length > 0 ? (
              <div className='allow-scroll relative flex gap-3 overflow-x-auto px-3 py-3'>
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onOpen={(item) => setSelectedTaskId(item.id)}
                  />
                ))}
              </div>
            ) : (
              <EmptyTimeline canManage={canManage} />
            )}
            {tasksQuery.isError ? (
              <div className='border-[var(--border-muted)] border-t px-4 py-2 text-[var(--text-error)] text-xs'>
                任务加载失败：{tasksQuery.error.message}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <TaskFormModal
        open={isCreateOpen || Boolean(editingTask)}
        mode={editingTask ? 'edit' : 'create'}
        organizationId={organizationId}
        task={editingTask}
        assignees={assignees}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateOpen(false)
            setEditingTask(null)
          }
        }}
      />
      <TaskDetailModal
        open={Boolean(selectedTask)}
        task={selectedTask}
        activeWorkgroupId={activeWorkgroupId}
        workspaceId={workspaceId}
        workflowId={workflowId}
        selectedNodeIds={selectedNodeIds}
        canEditCanvas={canEditCanvas}
        canManage={canManage}
        onOpenChange={(open) => {
          if (!open) setSelectedTaskId(null)
        }}
        onEdit={(task) => {
          setSelectedTaskId(null)
          setEditingTask(task)
        }}
      />
    </div>
  )
}
