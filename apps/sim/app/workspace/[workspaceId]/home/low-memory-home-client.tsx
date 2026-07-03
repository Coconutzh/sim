'use client'

import type { FormEvent, PointerEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock3,
  Loader2,
  LogOut,
  MoveHorizontal,
  Plus,
  Send,
  Sparkles,
  UserCircle,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  FormField,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
  toast,
} from '@/components/emcn'
import type { ProductionProgressAnalysisMessage } from '@/lib/api/contracts/production-progress-analysis'
import type {
  ProductionProjectPhase,
  ProductionProjectPhaseInput,
} from '@/lib/api/contracts/production-projects'
import type { ProductionTask } from '@/lib/api/contracts/production-tasks'
import { signOut, useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import { ProductionNotificationBell } from '@/app/workspace/[workspaceId]/components/production-notification-bell'
import { useLiteCanvasNavigation } from '@/app/workspace/[workspaceId]/use-lite-canvas-navigation'
import { useAnalyzeProductionProgress } from '@/hooks/queries/production-progress-analysis'
import {
  useCreateProductionProject,
  useUpdateProductionProject,
} from '@/hooks/queries/production-projects'
import { useProductionTasksForWorkspaces } from '@/hooks/queries/production-tasks'
import { clearUserData } from '@/stores'

const HomeCopilot = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/home/home-copilot').then((module) => module.HomeCopilot),
  {
    ssr: false,
    loading: () => <div className='h-full bg-[var(--bg)]' />,
  }
)

interface LowMemoryHomeClientProps {
  chatId?: string
  workspaceId: string
}

type ProjectEntry = ReturnType<typeof useLiteCanvasNavigation>['projectEntries'][number]
type HomeViewMode = 'cards' | 'schedule'
type DraftProjectPhase = {
  id?: string
  name: string
  dueAt: string
  status: 'active' | 'completed'
}
type TimelineTaskCluster = {
  id: string
  leftPercent: number
  tasks: ProductionTask[]
}
type FocusedAnalysisTask = {
  taskId: string
  title: string
  projectName: string
  assigneeWorkgroupName: string
}

const DAY_MS = 24 * 60 * 60 * 1000
const TASK_CLUSTER_DISTANCE_PERCENT = 4.5
const TIMELINE_TODAY_ANCHOR_PERCENT = 42
const TIMELINE_ZOOM_DAY_OPTIONS = [7, 14, 30, 60, 120] as const
const DEFAULT_TIMELINE_VISIBLE_DAYS = 30

function getTickIntervalDays(visibleDays: number): number {
  if (visibleDays <= 10) return 1
  if (visibleDays <= 21) return 2
  if (visibleDays <= 45) return 5
  if (visibleDays <= 90) return 10
  return 20
}

function startOfLocalDayMs(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function buildTimelineTicks(startMs: number, endMs: number, visibleDays: number) {
  const intervalMs = getTickIntervalDays(visibleDays) * DAY_MS
  const firstTickMs = startOfLocalDayMs(startMs) + intervalMs
  const ticks: { timestamp: number; label: string; relativeLabel: string }[] = []
  for (let timestamp = firstTickMs; timestamp <= endMs; timestamp += intervalMs) {
    ticks.push({
      timestamp,
      label: formatDate(new Date(timestamp)),
      relativeLabel: formatDaysUntilTimestamp(timestamp),
    })
  }
  return ticks
}

function getTimestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.getTime()
}

function formatDateTime(value: string | null): string {
  if (!value) return '未设置'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(value)
}

function formatDaysUntil(value: string | null): string {
  const timestamp = getTimestamp(value)
  if (timestamp === null) return '未设置'
  const diffDays = Math.ceil((timestamp - Date.now()) / DAY_MS)
  if (diffDays < 0) return `已超 ${Math.abs(diffDays)} 天`
  if (diffDays === 0) return '今天'
  return `还剩 ${diffDays} 天`
}

function formatDaysUntilTimestamp(timestamp: number): string {
  const diffDays = Math.ceil((timestamp - Date.now()) / DAY_MS)
  if (diffDays < 0) return `已超 ${Math.abs(diffDays)} 天`
  if (diffDays === 0) return '今天'
  return `还剩 ${diffDays} 天`
}

function toDateTimeLocal(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000)
  return local.toISOString().slice(0, 16)
}

function fromDateTimeLocal(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function projectPhasesToDrafts(phases: ProductionProjectPhase[]): DraftProjectPhase[] {
  return phases.map((phase) => ({
    id: phase.id,
    name: phase.name,
    dueAt: toDateTimeLocal(phase.dueAt),
    status: phase.status,
  }))
}

function draftPhasesToInput(phases: DraftProjectPhase[]): ProductionProjectPhaseInput[] {
  return phases
    .map((phase) => ({
      id: phase.id,
      name: phase.name.trim(),
      dueAt: fromDateTimeLocal(phase.dueAt),
      status: phase.status,
    }))
    .filter((phase) => phase.name)
}

function getPercent(completed: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.round((completed / total) * 100))
}

function getTimelinePercent(value: string | null, startMs: number, endMs: number): number {
  const timestamp = getTimestamp(value)
  if (timestamp === null || endMs <= startMs) return 0
  return Math.min(100, Math.max(0, ((timestamp - startMs) / (endMs - startMs)) * 100))
}

function buildTaskClusters(
  tasks: ProductionTask[],
  startMs: number,
  endMs: number
): TimelineTaskCluster[] {
  const nodes = tasks
    .map((task) => {
      const timestamp = getTimestamp(task.dueAt)
      if (timestamp === null) return null
      return {
        task,
        leftPercent: getTimelinePercent(task.dueAt, startMs, endMs),
      }
    })
    .filter((node): node is { leftPercent: number; task: ProductionTask } => node !== null)
    .sort((a, b) => a.leftPercent - b.leftPercent)

  const clusters: TimelineTaskCluster[] = []
  for (const node of nodes) {
    const current = clusters.at(-1)
    if (!current || node.leftPercent - current.leftPercent > TASK_CLUSTER_DISTANCE_PERCENT) {
      clusters.push({
        id: node.task.id,
        leftPercent: node.leftPercent,
        tasks: [node.task],
      })
      continue
    }

    current.tasks.push(node.task)
    current.leftPercent =
      current.tasks.reduce((sum, task) => {
        return sum + getTimelinePercent(task.dueAt, startMs, endMs)
      }, 0) / current.tasks.length
  }
  return clusters
}

interface HomeAccountMenuProps {
  session:
    | {
        user?: {
          email?: string | null
          image?: string | null
          name?: string | null
        } | null
      }
    | null
    | undefined
}

function HomeAccountMenu({ session }: HomeAccountMenuProps) {
  const router = useRouter()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const userName = session?.user?.name?.trim() || session?.user?.email?.trim() || '当前账号'
  const userEmail = session?.user?.email?.trim() || '未绑定邮箱'

  const handleSignOut = async (switchAccount = false) => {
    setIsSigningOut(true)
    try {
      await Promise.all([signOut(), clearUserData()])
    } catch {
      toast.error('退出登录失败，请刷新后重试')
    } finally {
      router.push(switchAccount ? '/login?switchAccount=true' : '/login?fromLogout=true')
      setIsSigningOut(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          variant='outline'
          className='h-9 max-w-[220px] gap-2 rounded-full px-2.5'
          disabled={isSigningOut}
        >
          {session?.user?.image ? (
            <img src={session.user.image} alt='' className='h-5 w-5 rounded-full object-cover' />
          ) : (
            <UserCircle className='h-4 w-4 text-[var(--text-icon)]' />
          )}
          <span className='min-w-0 truncate text-[12px]'>{userName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-[240px]'>
        <DropdownMenuLabel>
          <span className='block truncate text-[13px] text-[var(--text-primary)]'>{userName}</span>
          <span className='mt-0.5 block truncate text-[11px] text-[var(--text-tertiary)]'>
            {userEmail}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => void handleSignOut(true)}>
          <UserCircle className='mr-2 h-3.5 w-3.5' />
          切换账号
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleSignOut(false)}>
          <LogOut className='mr-2 h-3.5 w-3.5' />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProjectStatsOverview({ projects }: { projects: ProjectEntry[] }) {
  const stats = useMemo(() => {
    const taskTotal = projects.reduce((sum, project) => sum + project.taskStats.total, 0)
    const taskCompleted = projects.reduce((sum, project) => sum + project.taskStats.completed, 0)
    const taskUnfinished = projects.reduce((sum, project) => sum + project.taskStats.unfinished, 0)
    return {
      projectTotal: projects.length,
      projectCompleted: projects.filter((project) => project.projectStatus === 'completed').length,
      taskCompleted,
      taskPercent: getPercent(taskCompleted, taskTotal),
      taskTotal,
      taskUnfinished,
    }
  }, [projects])

  return (
    <section className='mb-4 grid gap-3 md:grid-cols-4'>
      <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3'>
        <div className='flex items-center gap-2 text-[12px] text-[var(--text-tertiary)]'>
          <BriefcaseBusiness className='h-[14px] w-[14px] text-[var(--text-icon)]' />
          项目
        </div>
        <div className='mt-2 font-medium text-[24px] text-[var(--text-primary)]'>
          {stats.projectTotal}
        </div>
        <div className='text-[11px] text-[var(--text-muted)]'>已完成 {stats.projectCompleted}</div>
      </div>
      <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3'>
        <div className='flex items-center gap-2 text-[12px] text-[var(--text-tertiary)]'>
          <CheckCircle2 className='h-[14px] w-[14px] text-[var(--text-icon)]' />
          任务完成
        </div>
        <div className='mt-2 font-medium text-[24px] text-[var(--text-primary)]'>
          {stats.taskCompleted}
        </div>
        <div className='text-[11px] text-[var(--text-muted)]'>共 {stats.taskTotal} 个任务</div>
      </div>
      <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3'>
        <div className='flex items-center gap-2 text-[12px] text-[var(--text-tertiary)]'>
          <Clock3 className='h-[14px] w-[14px] text-[var(--text-icon)]' />
          未完成
        </div>
        <div className='mt-2 font-medium text-[24px] text-[var(--text-primary)]'>
          {stats.taskUnfinished}
        </div>
        <div className='text-[11px] text-[var(--text-muted)]'>需要继续推进</div>
      </div>
      <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3'>
        <div className='flex items-center justify-between gap-2 text-[12px] text-[var(--text-tertiary)]'>
          <span>任务完成率</span>
          <span>{stats.taskPercent}%</span>
        </div>
        <div className='mt-4 h-2 overflow-hidden rounded-full bg-[var(--surface-3)]'>
          <div
            className='h-full rounded-full bg-[var(--brand-accent)] transition-[width]'
            style={{ width: `${stats.taskPercent}%` }}
          />
        </div>
        <div className='mt-3 text-[11px] text-[var(--text-muted)]'>按审核通过/归档统计</div>
      </div>
    </section>
  )
}

function ProjectEntryCard({
  project,
  onOpen,
  onManage,
  isLoading,
}: {
  isLoading: boolean
  onOpen: () => void
  onManage: () => void
  project: ProjectEntry
}) {
  const taskPercent = getPercent(project.taskStats.completed, project.taskStats.total)
  return (
    <article className='group rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-4 text-left shadow-subtle transition-all hover-hover:-translate-y-0.5 hover-hover:border-[var(--border-1)] hover-hover:bg-[var(--surface-hover)] hover-hover:shadow-medium'>
      <div className='flex items-start justify-between gap-4'>
        <div className='flex items-start gap-3'>
          <div className='flex h-10 w-10 items-center justify-center overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'>
            {project.logoUrl ? (
              <img src={project.logoUrl} alt='' className='h-full w-full object-cover' />
            ) : (
              <BriefcaseBusiness className='h-[18px] w-[18px] text-[var(--text-icon)]' />
            )}
          </div>
          <ProductionNotificationBell
            workspaceId={project.teamWorkspaceId}
            projectName={project.name}
            buttonClassName='h-8 w-8 shadow-subtle'
          />
        </div>
        <div className='flex shrink-0 flex-col items-end gap-2'>
          <Badge
            variant={project.projectStatus === 'completed' ? 'green' : 'amber'}
            size='sm'
            className='rounded-full px-2'
          >
            {project.projectStatus === 'completed' ? '已完成' : '未完成'}
          </Badge>
          {project.canManageProject ? (
            <Button type='button' size='sm' variant='ghost' onClick={onManage}>
              <CalendarClock className='mr-1 h-3.5 w-3.5' />
              设置 DDL
            </Button>
          ) : (
            <span className='rounded-[6px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
              {project.role === 'admin' ? '管理员' : '成员'}
            </span>
          )}
        </div>
      </div>
      <Button
        type='button'
        variant='ghost'
        onClick={onOpen}
        disabled={isLoading}
        className='mt-5 flex h-auto min-h-[150px] w-full flex-col items-stretch justify-start rounded-[8px] border border-transparent bg-transparent p-0 text-left disabled:opacity-60'
      >
        <h2 className='truncate font-medium text-[18px] text-[var(--text-primary)]'>
          {project.name}
        </h2>
        <p className='mt-2 text-[13px] text-[var(--text-muted)] leading-5'>
          {project.disciplineName} / {project.primaryWorkgroupName}
        </p>
        <div className='mt-3 flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]'>
          <CalendarClock className='h-[14px] w-[14px] text-[var(--text-icon)]' />
          预估 DDL：{formatDateTime(project.estimatedDueAt)}
        </div>
        <div className='mt-2 flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]'>
          <span>阶段 DDL</span>
          <span className='rounded-full bg-[var(--surface-2)] px-2 py-0.5'>
            {project.phases.length > 0 ? `${project.phases.length} 个阶段` : '未设置'}
          </span>
        </div>
        <div className='mt-4 grid grid-cols-2 gap-2 text-[12px]'>
          <div className='rounded-[7px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5'>
            <div className='text-[10px] text-[var(--text-tertiary)]'>团队</div>
            <div className='mt-0.5 text-[var(--text-primary)]'>{project.teamCount}</div>
          </div>
          <div className='rounded-[7px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5'>
            <div className='text-[10px] text-[var(--text-tertiary)]'>成员</div>
            <div className='mt-0.5 text-[var(--text-primary)]'>{project.memberCount}</div>
          </div>
        </div>
        <div className='mt-3 rounded-[7px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-2'>
          <div className='flex items-center justify-between text-[11px] text-[var(--text-tertiary)]'>
            <span>任务</span>
            <span>
              {project.taskStats.completed}/{project.taskStats.total}
            </span>
          </div>
          <div className='mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]'>
            <div
              className='h-full rounded-full bg-[var(--brand-accent)] transition-[width]'
              style={{ width: `${taskPercent}%` }}
            />
          </div>
        </div>
        <div className='mt-auto flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[12px] text-[var(--text-secondary)] transition-colors group-hover:border-[var(--border-1)] group-hover:text-[var(--text-primary)]'>
          <span className='truncate font-medium'>进入项目</span>
          {isLoading ? (
            <Loader2 className='h-[15px] w-[15px] animate-spin text-[var(--text-icon)]' />
          ) : (
            <ArrowRight className='h-[15px] w-[15px] shrink-0 text-[var(--text-icon)]' />
          )}
        </div>
      </Button>
    </article>
  )
}

function CreateProjectCard({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Button
      type='button'
      variant='ghost'
      disabled={disabled}
      className='flex min-h-[300px] flex-col items-center justify-center rounded-[8px] border border-[var(--border)] border-dashed bg-[var(--surface-1)] p-4 text-center shadow-subtle transition-all hover-hover:-translate-y-0.5 hover-hover:border-[var(--border-1)] hover-hover:bg-[var(--surface-hover)] hover-hover:shadow-medium disabled:opacity-60'
      onClick={onClick}
    >
      <span className='flex h-12 w-12 items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'>
        <Plus className='h-5 w-5 text-[var(--text-icon)]' />
      </span>
      <span className='mt-4 font-medium text-[16px] text-[var(--text-primary)]'>新建项目</span>
      <span className='mt-2 text-[12px] text-[var(--text-muted)]'>创建项目入口</span>
    </Button>
  )
}

function ProjectPhaseEditor({
  phases,
  onChange,
}: {
  onChange: (phases: DraftProjectPhase[]) => void
  phases: DraftProjectPhase[]
}) {
  const updatePhase = (index: number, updates: Partial<DraftProjectPhase>) => {
    onChange(
      phases.map((phase, itemIndex) => (itemIndex === index ? { ...phase, ...updates } : phase))
    )
  }

  const removePhase = (index: number) => {
    onChange(phases.filter((_, itemIndex) => itemIndex !== index))
  }

  return (
    <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <div className='font-medium text-[13px] text-[var(--text-primary)]'>阶段 DDL</div>
          <div className='mt-0.5 text-[11px] text-[var(--text-tertiary)]'>
            用于项目排期视图，可随时调整。
          </div>
        </div>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          onClick={() => onChange([...phases, { name: '', dueAt: '', status: 'active' }])}
        >
          <Plus className='mr-1 h-3.5 w-3.5' />
          添加阶段
        </Button>
      </div>

      {phases.length === 0 ? (
        <div className='mt-3 rounded-[7px] border border-[var(--border)] border-dashed bg-[var(--surface-1)] px-3 py-4 text-center text-[12px] text-[var(--text-muted)]'>
          还没有阶段。可以添加「初稿」「联排」「终审」等节点。
        </div>
      ) : (
        <div className='mt-3 space-y-2'>
          {phases.map((phase, index) => (
            <div
              key={`${phase.id ?? 'draft'}-${index}`}
              className='grid gap-2 rounded-[7px] border border-[var(--border)] bg-[var(--surface-1)] p-2 md:grid-cols-[1fr_190px_104px_32px]'
            >
              <Input
                value={phase.name}
                onChange={(event) => updatePhase(index, { name: event.target.value })}
                placeholder='阶段名称'
              />
              <Input
                type='datetime-local'
                value={phase.dueAt}
                onChange={(event) => updatePhase(index, { dueAt: event.target.value })}
              />
              <Button
                type='button'
                size='sm'
                variant={phase.status === 'completed' ? 'active' : 'outline'}
                onClick={() =>
                  updatePhase(index, {
                    status: phase.status === 'completed' ? 'active' : 'completed',
                  })
                }
              >
                {phase.status === 'completed' ? '已完成' : '未完成'}
              </Button>
              <Button
                type='button'
                size='sm'
                variant='ghost'
                aria-label='删除阶段'
                onClick={() => removePhase(index)}
              >
                <X className='h-3.5 w-3.5' />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectSettingsModal({
  isSaving,
  onOpenChange,
  onSave,
  project,
}: {
  isSaving: boolean
  onOpenChange: (open: boolean) => void
  onSave: (values: {
    estimatedDueAt: string | null
    phases: ProductionProjectPhaseInput[]
    status: 'active' | 'completed'
  }) => void
  project: ProjectEntry | null
}) {
  const [status, setStatus] = useState<'active' | 'completed'>('active')
  const [estimatedDueAt, setEstimatedDueAt] = useState('')
  const [phases, setPhases] = useState<DraftProjectPhase[]>([])

  useEffect(() => {
    if (!project) return
    setStatus(project.projectStatus)
    setEstimatedDueAt(toDateTimeLocal(project.estimatedDueAt))
    setPhases(projectPhasesToDrafts(project.phases))
  }, [project])

  return (
    <Modal open={Boolean(project)} onOpenChange={onOpenChange}>
      <ModalContent size='lg'>
        <ModalHeader>项目设置</ModalHeader>
        <ModalBody>
          <div className='space-y-4'>
            <div>
              <div className='font-medium text-[14px] text-[var(--text-primary)]'>
                {project?.name ?? '项目'}
              </div>
              <div className='mt-1 text-[12px] text-[var(--text-muted)]'>
                手动标记项目完成状态，并维护一个可随时调整的预估 DDL。
              </div>
            </div>
            <FormField label='项目状态' htmlFor='project-status'>
              <div id='project-status' className='grid grid-cols-2 gap-2'>
                <Button
                  type='button'
                  variant={status === 'active' ? 'active' : 'outline'}
                  onClick={() => setStatus('active')}
                >
                  <Circle className='mr-1.5 h-[14px] w-[14px]' />
                  未完成
                </Button>
                <Button
                  type='button'
                  variant={status === 'completed' ? 'active' : 'outline'}
                  onClick={() => setStatus('completed')}
                >
                  <CheckCircle2 className='mr-1.5 h-[14px] w-[14px]' />
                  已完成
                </Button>
              </div>
            </FormField>
            <FormField label='预估 DDL' htmlFor='project-estimated-due-at' optional>
              <Input
                id='project-estimated-due-at'
                type='datetime-local'
                value={estimatedDueAt}
                onChange={(event) => setEstimatedDueAt(event.target.value)}
              />
            </FormField>
            <ProjectPhaseEditor phases={phases} onChange={setPhases} />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button type='button' variant='default' onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type='button'
            variant='primary'
            disabled={isSaving}
            onClick={() =>
              onSave({
                status,
                estimatedDueAt: fromDateTimeLocal(estimatedDueAt),
                phases: draftPhasesToInput(phases),
              })
            }
          >
            {isSaving ? <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' /> : null}
            保存
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

function getTaskNodeClassName(task: ProductionTask): string {
  if (getTimestamp(task.dueAt) !== null && getTimestamp(task.dueAt)! < Date.now()) {
    return 'border-[var(--error)] bg-[var(--surface-2)] text-[var(--text-error)]'
  }
  if (task.status === 'approved' || task.status === 'archived') {
    return 'border-[var(--success)] bg-[var(--surface-2)] text-[var(--success)]'
  }
  if (task.status === 'submitted') {
    return 'border-[var(--brand-secondary)] bg-[var(--surface-2)] text-[var(--brand-secondary)]'
  }
  if (task.status === 'changes_requested') {
    return 'border-[var(--caution)] bg-[var(--surface-2)] text-[var(--warning)]'
  }
  if (task.status === 'in_progress') {
    return 'border-[var(--brand-accent)] bg-[var(--surface-2)] text-[var(--brand-accent)]'
  }
  return 'border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)]'
}

function getTaskClusterClassName(tasks: ProductionTask[]): string {
  if (tasks.length === 1) return getTaskNodeClassName(tasks[0])
  if (
    tasks.some(
      (task) => getTimestamp(task.dueAt) !== null && getTimestamp(task.dueAt)! < Date.now()
    )
  ) {
    return 'border-[var(--error)] bg-[var(--surface-2)] text-[var(--text-error)]'
  }
  if (tasks.some((task) => task.status === 'submitted')) {
    return 'border-[var(--brand-secondary)] bg-[var(--surface-2)] text-[var(--brand-secondary)]'
  }
  if (tasks.every((task) => task.status === 'approved' || task.status === 'archived')) {
    return 'border-[var(--success)] bg-[var(--surface-2)] text-[var(--success)]'
  }
  if (tasks.some((task) => task.status === 'changes_requested')) {
    return 'border-[var(--caution)] bg-[var(--surface-2)] text-[var(--warning)]'
  }
  if (tasks.some((task) => task.status === 'in_progress')) {
    return 'border-[var(--brand-accent)] bg-[var(--surface-2)] text-[var(--brand-accent)]'
  }
  return 'border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)]'
}

function TaskClusterMarker({
  cluster,
  compact,
  onOpenTask,
  project,
}: {
  cluster: TimelineTaskCluster
  compact: boolean
  onOpenTask: (project: ProjectEntry, taskId: string) => void
  project: ProjectEntry
}) {
  const className = cn(
    'absolute bottom-5 h-7 -translate-x-1/2 rounded-full border px-2 text-[11px] shadow-subtle transition-transform hover-hover:scale-[1.03]',
    getTaskClusterClassName(cluster.tasks)
  )

  if (cluster.tasks.length === 1) {
    const task = cluster.tasks[0]
    return (
      <Button
        type='button'
        size='sm'
        variant='ghost'
        className={cn(className, compact ? 'max-w-[180px] gap-1.5' : 'w-7 px-0')}
        style={{ left: `${cluster.leftPercent}%` }}
        title={`${task.title} / ${formatDaysUntil(task.dueAt)}`}
        onClick={() => onOpenTask(project, task.id)}
      >
        <span className='h-1.5 w-1.5 rounded-full bg-current' />
        {compact ? <span className='truncate'>{task.title}</span> : null}
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          className={cn(className, 'min-w-9 gap-1')}
          style={{ left: `${cluster.leftPercent}%` }}
          title={`${cluster.tasks.length} 个相近任务`}
        >
          <span className='h-1.5 w-1.5 rounded-full bg-current' />
          <span>{cluster.tasks.length}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='center' className='w-[220px] max-w-[260px]'>
        <DropdownMenuLabel>相近任务</DropdownMenuLabel>
        {cluster.tasks.map((task) => (
          <DropdownMenuItem key={task.id} onClick={() => onOpenTask(project, task.id)}>
            <span className='flex min-w-0 flex-col'>
              <span className='truncate'>{task.title}</span>
              <span className='text-[11px] text-[var(--text-tertiary)]'>
                {formatDaysUntil(task.dueAt)}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function getProjectHealthClassName(health: 'attention' | 'blocked' | 'normal') {
  if (health === 'blocked') {
    return 'border-[var(--error)] bg-[var(--surface-2)] text-[var(--text-error)]'
  }
  if (health === 'attention') {
    return 'border-[var(--caution)] bg-[var(--surface-2)] text-[var(--warning)]'
  }
  return 'border-[var(--success)] bg-[var(--surface-2)] text-[var(--success)]'
}

function getProjectHealthLabel(health: 'attention' | 'blocked' | 'normal') {
  if (health === 'blocked') return '阻塞'
  if (health === 'attention') return '关注'
  return '正常'
}

function ProjectProgressAnalysisPanel({
  onOpenTask,
  projects,
}: {
  onOpenTask: (project: ProjectEntry, taskId: string) => void
  projects: ProjectEntry[]
}) {
  const analyzeProgress = useAnalyzeProductionProgress()
  const [messages, setMessages] = useState<ProductionProgressAnalysisMessage[]>([])
  const [input, setInput] = useState('请分析当前所有项目的任务进度，指出异常拖延任务和原因。')
  const [focusedTask, setFocusedTask] = useState<FocusedAnalysisTask | null>(null)
  const analysis = analyzeProgress.data?.analysis
  const projectInputs = useMemo(
    () =>
      projects
        .filter((project) => Boolean(project.teamWorkspaceId))
        .map((project) => ({
          organizationId: project.id,
          name: project.name,
          teamWorkspaceId: project.teamWorkspaceId,
          estimatedDueAt: project.estimatedDueAt,
          status: project.projectStatus,
          phases: project.phases,
        })),
    [projects]
  )
  const canAnalyze = projectInputs.length > 0

  const submitQuestion = async (
    question: string,
    options?: { focusTask?: FocusedAnalysisTask | null; clearFocus?: boolean }
  ) => {
    const trimmed = question.trim()
    if (!trimmed || !canAnalyze || analyzeProgress.isPending) return
    const nextFocusedTask = options?.clearFocus ? null : (options?.focusTask ?? focusedTask)
    if (options?.clearFocus || options?.focusTask !== undefined) {
      setFocusedTask(nextFocusedTask)
    }
    const userMessage: ProductionProgressAnalysisMessage = { role: 'user', content: trimmed }
    const nextMessages = [...messages, userMessage].slice(-12)
    setMessages(nextMessages)
    setInput('')

    try {
      const response = await analyzeProgress.mutateAsync({
        projects: projectInputs,
        question: trimmed,
        history: messages.slice(-8),
        focusTaskId: nextFocusedTask?.taskId,
      })
      setMessages((current) =>
        [
          ...current,
          {
            role: 'assistant',
            content: response.analysis.answer,
          } satisfies ProductionProgressAnalysisMessage,
        ].slice(-12)
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : '进度分析失败'
      toast.error(message)
      setMessages((current) =>
        [
          ...current,
          {
            role: 'assistant',
            content: `分析失败：${message}`,
          } satisfies ProductionProgressAnalysisMessage,
        ].slice(-12)
      )
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submitQuestion(input)
  }

  const askAboutTask = (task: FocusedAnalysisTask) => {
    void submitQuestion(
      `请结合这个任务的所有提交版本和任务聊天记录，分析「${task.title}」当前状态、主要问题和下一步建议。`,
      { focusTask: task }
    )
  }

  const riskTasks = analysis?.riskTasks.slice(0, 12) ?? []
  const blockedProjects = analysis?.projects.filter((project) => project.health === 'blocked') ?? []
  const projectHighlights = analysis
    ? blockedProjects.length > 0
      ? blockedProjects
      : analysis.projects
    : []

  return (
    <div className='border-[var(--border)] border-b bg-[var(--surface-1)] px-4 py-3'>
      <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
        <div className='flex min-w-0 items-center gap-2'>
          <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-2)]'>
            <Bot className='h-4 w-4 text-[var(--text-icon)]' />
          </div>
          <div className='min-w-0'>
            <div className='font-medium text-[14px] text-[var(--text-primary)]'>
              项目生产助手
            </div>
            <div className='truncate text-[12px] text-[var(--text-tertiary)]'>
              可聊项目节奏、任务版本、聊天记录、DDL 与延期原因。
            </div>
          </div>
        </div>
        <Button
          type='button'
          size='sm'
          variant='primary'
          className='w-fit'
          disabled={!canAnalyze || analyzeProgress.isPending}
          onClick={() =>
            void submitQuestion('请分析当前所有项目的任务进度，指出异常拖延任务和原因。', {
              clearFocus: true,
            })
          }
        >
          {analyzeProgress.isPending ? (
            <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
          ) : (
            <Sparkles className='mr-1.5 h-3.5 w-3.5' />
          )}
          分析当前进度
        </Button>
      </div>

      <div className='mt-3 grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_420px]'>
        <div className='min-h-0 space-y-3'>
          {analysis ? (
            <div className='grid gap-2 sm:grid-cols-4'>
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                <div className='text-[11px] text-[var(--text-tertiary)]'>超期任务</div>
                <div className='mt-1 font-semibold text-[20px] text-[var(--text-primary)]'>
                  {analysis.metrics.overdueTaskCount}
                </div>
              </div>
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                <div className='text-[11px] text-[var(--text-tertiary)]'>缺少延期理由</div>
                <div className='mt-1 font-semibold text-[20px] text-[var(--text-primary)]'>
                  {analysis.metrics.delayReasonMissingCount}
                </div>
              </div>
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                <div className='text-[11px] text-[var(--text-tertiary)]'>24h 内到期</div>
                <div className='mt-1 font-semibold text-[20px] text-[var(--text-primary)]'>
                  {analysis.metrics.dueWithin24hCount}
                </div>
              </div>
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
                <div className='text-[11px] text-[var(--text-tertiary)]'>待审核</div>
                <div className='mt-1 font-semibold text-[20px] text-[var(--text-primary)]'>
                  {analysis.metrics.submittedAwaitingReviewCount}
                </div>
              </div>
            </div>
          ) : null}

          {analysis ? (
            <div className='grid min-h-0 gap-3 md:grid-cols-2'>
              <div className='flex h-[230px] min-h-0 flex-col rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'>
                <div className='flex shrink-0 items-center justify-between gap-2 border-[var(--border)] border-b px-3 py-2'>
                  <div className='flex items-center gap-1.5 font-medium text-[12px] text-[var(--text-primary)]'>
                    <AlertTriangle className='h-3.5 w-3.5 text-[var(--text-icon)]' />
                    异常任务
                  </div>
                  <span className='text-[10px] text-[var(--text-tertiary)]'>
                    {analysis.riskTasks.length} 项
                  </span>
                </div>
                <div className='min-h-0 flex-1 overflow-y-auto px-3 py-2 [scrollbar-gutter:stable]'>
                  {riskTasks.length > 0 ? (
                    <div className='space-y-2'>
                      {riskTasks.map((task) => {
                        const project = projects.find((item) => item.id === task.organizationId)
                        const focusedTaskPayload: FocusedAnalysisTask = {
                          taskId: task.taskId,
                          title: task.title,
                          projectName: task.projectName,
                          assigneeWorkgroupName: task.assigneeWorkgroupName,
                        }
                        return (
                          <div
                            key={task.taskId}
                            className='rounded-[7px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2'
                          >
                            <div className='flex items-center justify-between gap-2'>
                              <span className='min-w-0 truncate font-medium text-[12px] text-[var(--text-primary)]'>
                                {task.title}
                              </span>
                              <span
                                className={cn(
                                  'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]',
                                  task.severity === 'critical'
                                    ? 'border-[var(--error)] text-[var(--text-error)]'
                                    : task.severity === 'warning'
                                      ? 'border-[var(--caution)] text-[var(--warning)]'
                                      : 'border-[var(--border)] text-[var(--text-tertiary)]'
                                )}
                              >
                                {task.severity === 'critical'
                                  ? '高风险'
                                  : task.severity === 'warning'
                                    ? '需关注'
                                    : '提示'}
                              </span>
                            </div>
                            <div className='mt-1 truncate text-[11px] text-[var(--text-tertiary)]'>
                              {task.projectName} / {task.assigneeWorkgroupName}
                            </div>
                            <div className='mt-1 line-clamp-2 text-[11px] text-[var(--text-muted)]'>
                              {task.reason}
                            </div>
                            <div className='mt-2 flex items-center justify-end gap-1.5'>
                              <Button
                                type='button'
                                size='sm'
                                variant='ghost'
                                disabled={!project}
                                className='h-6 px-2 text-[11px]'
                                onClick={() => project && onOpenTask(project, task.taskId)}
                              >
                                打开任务
                              </Button>
                              <Button
                                type='button'
                                size='sm'
                                variant='outline'
                                className='h-6 px-2 text-[11px]'
                                disabled={analyzeProgress.isPending}
                                onClick={() => askAboutTask(focusedTaskPayload)}
                              >
                                <Bot className='mr-1 h-3 w-3' />
                                问助手
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className='rounded-[7px] border border-[var(--border)] border-dashed p-3 text-[12px] text-[var(--text-muted)]'>
                      暂无明显异常任务。
                    </div>
                  )}
                </div>
              </div>

              <div className='flex h-[230px] min-h-0 flex-col rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'>
                <div className='flex shrink-0 items-center justify-between gap-2 border-[var(--border)] border-b px-3 py-2'>
                  <div className='font-medium text-[12px] text-[var(--text-primary)]'>项目状态</div>
                  <span className='text-[10px] text-[var(--text-tertiary)]'>
                    {analysis.projects.length} 个项目
                  </span>
                </div>
                <div className='min-h-0 flex-1 overflow-y-auto px-3 py-2 [scrollbar-gutter:stable]'>
                  <div className='space-y-2'>
                    {projectHighlights.map((project) => (
                      <div
                        key={project.organizationId}
                        className='rounded-[7px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2'
                      >
                        <div className='flex items-center justify-between gap-2'>
                          <span className='min-w-0 truncate font-medium text-[12px] text-[var(--text-primary)]'>
                            {project.projectName}
                          </span>
                          <span
                            className={cn(
                              'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]',
                              getProjectHealthClassName(project.health)
                            )}
                          >
                            {getProjectHealthLabel(project.health)}
                          </span>
                        </div>
                        <div className='mt-1 line-clamp-2 text-[11px] text-[var(--text-muted)]'>
                          {project.summary}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className='flex h-[230px] items-center justify-center rounded-[8px] border border-[var(--border)] border-dashed bg-[var(--surface-2)] px-4 text-center text-[12px] text-[var(--text-muted)] leading-5'>
              暂无分析结果
            </div>
          )}
        </div>

        <div className='flex h-[420px] min-h-0 flex-col overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'>
          <div className='flex shrink-0 items-center justify-between gap-2 border-[var(--border)] border-b px-3 py-2'>
            <div className='font-medium text-[12px] text-[var(--text-primary)]'>助手对话</div>
            <span className='text-[10px] text-[var(--text-tertiary)]'>
              {analysis?.generatedBy === 'hermes' ? 'Hermes' : analysis ? '规则' : '待分析'}
            </span>
          </div>
          {focusedTask ? (
            <div className='flex shrink-0 items-center justify-between gap-2 border-[var(--border)] border-b bg-[var(--surface-1)] px-3 py-2'>
              <div className='min-w-0 truncate text-[11px] text-[var(--text-tertiary)]'>
                正在聚焦：
                <span className='font-medium text-[var(--text-primary)]'>{focusedTask.title}</span>
                <span className='ml-1'>/ {focusedTask.projectName}</span>
              </div>
              <button
                type='button'
                className='flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover-hover:bg-[var(--surface-hover)] hover-hover:text-[var(--text-primary)]'
                onClick={() => setFocusedTask(null)}
                aria-label='清除聚焦任务'
              >
                <X className='h-3 w-3' />
              </button>
            </div>
          ) : null}
          <div className='min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3 [scrollbar-gutter:stable]'>
            {messages.length > 0 ? (
              messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-full break-words whitespace-pre-wrap rounded-[8px] px-3 py-2 text-[12px] leading-5',
                      message.role === 'user'
                        ? 'max-w-[86%] bg-[var(--brand-accent)] text-white'
                        : 'border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-primary)]'
                    )}
                  >
                    {message.content}
                  </div>
                </div>
              ))
            ) : (
              <div className='rounded-[8px] border border-[var(--border)] border-dashed p-3 text-[12px] text-[var(--text-muted)] leading-5'>
                暂无对话
              </div>
            )}
          </div>
          <form className='shrink-0 border-[var(--border)] border-t p-3' onSubmit={handleSubmit}>
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={2}
              className='min-h-[58px] resize-none text-[12px]'
              placeholder='自由追问项目、任务版本、聊天记录或延期原因'
            />
            <div className='mt-2 flex items-center justify-between gap-2'>
              <span className='text-[10px] text-[var(--text-tertiary)]'>
                {focusedTask ? '当前任务上下文已启用' : '项目上下文'}
              </span>
              <Button
                type='submit'
                size='sm'
                variant='primary'
                disabled={!input.trim() || !canAnalyze || analyzeProgress.isPending}
              >
                {analyzeProgress.isPending ? (
                  <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                ) : (
                  <Send className='mr-1.5 h-3.5 w-3.5' />
                )}
                发送
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function ProjectScheduleOverview({
  onManageProject,
  onOpenTask,
  projects,
}: {
  onManageProject: (project: ProjectEntry) => void
  onOpenTask: (project: ProjectEntry, taskId: string) => void
  projects: ProjectEntry[]
}) {
  const workspaceIds = useMemo(
    () => projects.map((project) => project.teamWorkspaceId).filter(Boolean),
    [projects]
  )
  const taskResults = useProductionTasksForWorkspaces(workspaceIds, {
    scope: 'auto',
    limit: 100,
  })
  const timelineRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    rangeMs: number
    startOffsetMs: number
    startX: number
    width: number
  } | null>(null)
  const [visibleDays, setVisibleDays] = useState<number>(DEFAULT_TIMELINE_VISIBLE_DAYS)
  const [panOffsetMs, setPanOffsetMs] = useState(0)
  const tasksByWorkspace = useMemo(() => {
    const next = new Map<string, ProductionTask[]>()
    workspaceIds.forEach((workspaceId, index) => {
      next.set(workspaceId, taskResults[index]?.data?.tasks ?? [])
    })
    return next
  }, [taskResults, workspaceIds])

  const timeline = useMemo(() => {
    const now = Date.now()
    const rangeMs = visibleDays * DAY_MS
    const startMs = now + panOffsetMs - (TIMELINE_TODAY_ANCHOR_PERCENT / 100) * rangeMs
    const endMs = startMs + rangeMs
    const ticks = buildTimelineTicks(startMs, endMs, visibleDays)
    return {
      endMs,
      nowPercent: TIMELINE_TODAY_ANCHOR_PERCENT,
      rangeMs,
      startMs,
      ticks,
    }
  }, [panOffsetMs, visibleDays])

  const isLoadingTasks = taskResults.some((result) => result.isLoading)
  const currentZoomIndex = TIMELINE_ZOOM_DAY_OPTIONS.findIndex((days) => days === visibleDays)
  const canZoomIn = currentZoomIndex > 0
  const canZoomOut =
    currentZoomIndex >= 0 && currentZoomIndex < TIMELINE_ZOOM_DAY_OPTIONS.length - 1

  const zoomTimeline = (direction: 'in' | 'out') => {
    const fallbackIndex = TIMELINE_ZOOM_DAY_OPTIONS.indexOf(DEFAULT_TIMELINE_VISIBLE_DAYS)
    const index = currentZoomIndex >= 0 ? currentZoomIndex : fallbackIndex
    const nextIndex =
      direction === 'in'
        ? Math.max(0, index - 1)
        : Math.min(TIMELINE_ZOOM_DAY_OPTIONS.length - 1, index + 1)
    setVisibleDays(TIMELINE_ZOOM_DAY_OPTIONS[nextIndex])
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button,a,[role="menuitem"]')) return
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    dragRef.current = {
      pointerId: event.pointerId,
      rangeMs: timeline.rangeMs,
      startOffsetMs: panOffsetMs,
      startX: event.clientX,
      width: rect.width,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    setPanOffsetMs(drag.startOffsetMs - (deltaX / drag.width) * drag.rangeMs)
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
    }
  }

  if (projects.length === 0) {
    return (
      <div className='rounded-[8px] border border-[var(--border)] border-dashed bg-[var(--surface-1)] p-6 text-[13px] text-[var(--text-muted)]'>
        暂无项目可生成排期。
      </div>
    )
  }

  return (
    <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
      <div className='flex flex-col gap-3 border-[var(--border)] border-b px-4 py-3 md:flex-row md:items-center md:justify-between'>
        <div>
          <div className='font-semibold text-[15px] text-[var(--text-primary)]'>项目总排期</div>
          <div className='mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-tertiary)]'>
            <span className='inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5'>
              <MoveHorizontal className='h-3 w-3' />
              当前视窗 {visibleDays} 天
            </span>
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            disabled={!canZoomIn}
            onClick={() => zoomTimeline('in')}
            title='放大时间轴'
          >
            <ZoomIn className='h-3.5 w-3.5' />
          </Button>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            disabled={!canZoomOut}
            onClick={() => zoomTimeline('out')}
            title='缩小时间轴'
          >
            <ZoomOut className='h-3.5 w-3.5' />
          </Button>
          <Button type='button' size='sm' variant='outline' onClick={() => setPanOffsetMs(0)}>
            今天
          </Button>
          <Badge variant='gray-secondary' size='sm' className='w-fit rounded-full px-2'>
            {isLoadingTasks ? '任务加载中' : `${projects.length} 个项目`}
          </Badge>
        </div>
      </div>

      <ProjectProgressAnalysisPanel projects={projects} onOpenTask={onOpenTask} />

      <div className='overflow-x-auto p-4'>
        <div
          ref={timelineRef}
          className='min-w-[980px] touch-none space-y-3 cursor-grab active:cursor-grabbing'
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className='grid grid-cols-[220px_minmax(0,1fr)] gap-4 px-2 text-[11px] text-[var(--text-tertiary)]'>
            <div>项目</div>
            <div className='relative h-8'>
              <div className='absolute top-4 right-0 left-0 h-px bg-[var(--border)]' />
              {timeline.ticks.map((tick) => (
                <div
                  key={tick.label}
                  className='absolute top-0 flex -translate-x-1/2 flex-col items-center gap-1'
                  style={{
                    left: `${((tick.timestamp - timeline.startMs) / (timeline.endMs - timeline.startMs)) * 100}%`,
                  }}
                >
                  <span>{tick.label}</span>
                  <span className='text-[10px] text-[var(--text-muted)]'>{tick.relativeLabel}</span>
                  <span className='h-3 w-px bg-[var(--border)]' />
                </div>
              ))}
              <div
                className='absolute top-1 bottom-0 w-px bg-[var(--brand-accent)]'
                style={{ left: `${timeline.nowPercent}%` }}
              >
                <span className='absolute -top-1 left-1 rounded-full bg-[var(--brand-accent)] px-1.5 py-0.5 text-[10px] text-white'>
                  今天
                </span>
              </div>
            </div>
          </div>

          {projects.map((project) => {
            const tasks = [...(tasksByWorkspace.get(project.teamWorkspaceId) ?? [])].sort(
              (a, b) => {
                return (getTimestamp(a.dueAt) ?? 0) - (getTimestamp(b.dueAt) ?? 0)
              }
            )
            const scheduledTasks = tasks.filter((task) => getTimestamp(task.dueAt) !== null)
            const unscheduledTaskCount = tasks.length - scheduledTasks.length
            const taskClusters = buildTaskClusters(scheduledTasks, timeline.startMs, timeline.endMs)
            const hasNodes = project.phases.length > 0 || tasks.length > 0 || project.estimatedDueAt
            return (
              <div
                key={project.id}
                className='grid min-h-[112px] grid-cols-[220px_minmax(0,1fr)] gap-4 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3'
              >
                <div className='min-w-0'>
                  <div className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                    {project.name}
                  </div>
                  <div className='mt-1 truncate text-[11px] text-[var(--text-tertiary)]'>
                    {project.disciplineName} / {project.primaryWorkgroupName}
                  </div>
                  <div className='mt-2 flex flex-wrap gap-1.5'>
                    <Badge
                      variant={project.projectStatus === 'completed' ? 'green' : 'amber'}
                      size='sm'
                      className='rounded-full px-2'
                    >
                      {project.projectStatus === 'completed' ? '已完成' : '未完成'}
                    </Badge>
                    <Badge variant='gray-secondary' size='sm' className='rounded-full px-2'>
                      {formatDaysUntil(project.estimatedDueAt)}
                    </Badge>
                    {project.phases.length > 0 ? (
                      <Badge variant='gray-secondary' size='sm' className='rounded-full px-2'>
                        {project.phases.length} 阶段
                      </Badge>
                    ) : null}
                    {unscheduledTaskCount > 0 ? (
                      <Badge variant='gray-secondary' size='sm' className='rounded-full px-2'>
                        {unscheduledTaskCount} 个未排期
                      </Badge>
                    ) : null}
                  </div>
                  {project.canManageProject ? (
                    <Button
                      type='button'
                      size='sm'
                      variant='ghost'
                      className='mt-3 h-7 px-2 text-[11px]'
                      onClick={() => onManageProject(project)}
                    >
                      <CalendarClock className='mr-1 h-3.5 w-3.5' />
                      设置 DDL
                    </Button>
                  ) : null}
                </div>

                <div className='relative min-h-[88px] overflow-hidden rounded-[7px] border border-[var(--border)] bg-[var(--surface-1)]'>
                  <div className='absolute top-0 right-0 bottom-0 left-0'>
                    {timeline.ticks.map((tick) => (
                      <div
                        key={`${project.id}-${tick.label}`}
                        className='absolute top-0 bottom-0 w-px bg-[var(--border)] opacity-70'
                        style={{
                          left: `${((tick.timestamp - timeline.startMs) / (timeline.endMs - timeline.startMs)) * 100}%`,
                        }}
                      />
                    ))}
                    <div
                      className='absolute top-0 bottom-0 w-px bg-[var(--brand-accent)]'
                      style={{ left: `${timeline.nowPercent}%` }}
                    >
                      <span className='sr-only'>今天</span>
                    </div>
                  </div>

                  {!hasNodes ? (
                    <div className='flex h-full min-h-[88px] items-center justify-center text-[12px] text-[var(--text-muted)]'>
                      暂无阶段或任务节点
                    </div>
                  ) : (
                    <>
                      {project.estimatedDueAt ? (
                        <div
                          className='absolute top-2 flex -translate-x-1/2 flex-col items-center gap-1'
                          style={{
                            left: `${getTimelinePercent(project.estimatedDueAt, timeline.startMs, timeline.endMs)}%`,
                          }}
                        >
                          <span className='rounded-full border border-[var(--brand-accent)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] text-[var(--text-primary)]'>
                            总 DDL
                          </span>
                          <span className='h-3 w-px bg-[var(--brand-accent)]' />
                        </div>
                      ) : null}

                      {project.phases.map((phase) =>
                        phase.dueAt ? (
                          <div
                            key={phase.id}
                            className='absolute top-8 flex -translate-x-1/2 flex-col items-center gap-1'
                            style={{
                              left: `${getTimelinePercent(phase.dueAt, timeline.startMs, timeline.endMs)}%`,
                            }}
                          >
                            <span
                              className={cn(
                                'max-w-[120px] truncate rounded-full border px-2 py-0.5 text-[10px]',
                                phase.status === 'completed'
                                  ? 'border-[var(--success)] bg-[var(--surface-3)] text-[var(--text-primary)]'
                                  : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]'
                              )}
                              title={`${phase.name} / ${formatDaysUntil(phase.dueAt)}`}
                            >
                              {phase.name}
                            </span>
                            <span className='h-3 w-px bg-[var(--border)]' />
                          </div>
                        ) : null
                      )}

                      {taskClusters.map((cluster) => (
                        <TaskClusterMarker
                          key={cluster.id}
                          cluster={cluster}
                          compact={visibleDays <= 21}
                          project={project}
                          onOpenTask={onOpenTask}
                        />
                      ))}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export function LowMemoryHomeClient({ chatId, workspaceId }: LowMemoryHomeClientProps) {
  const canvas = useLiteCanvasNavigation({ workspaceId })
  const { data: session } = useSession()
  const createProject = useCreateProductionProject()
  const updateProject = useUpdateProductionProject()
  const [viewMode, setViewMode] = useState<HomeViewMode>('cards')
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDueAt, setNewProjectDueAt] = useState('')
  const [newProjectPhases, setNewProjectPhases] = useState<DraftProjectPhase[]>([])
  const [projectToManage, setProjectToManage] = useState<ProjectEntry | null>(null)
  const canCreateProject =
    session?.user?.role === 'admin' ||
    canvas.isProjectAdmin ||
    canvas.projectEntries.some((project) => project.canManageProject)
  const hasProjectCards = canvas.projectEntries.length > 0
  const isProjectMutationPending = createProject.isPending || updateProject.isPending

  if (chatId) {
    return <HomeCopilot chatId={chatId} />
  }

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return
    try {
      await createProject.mutateAsync({
        name: newProjectName.trim(),
        estimatedDueAt: fromDateTimeLocal(newProjectDueAt),
        phases: draftPhasesToInput(newProjectPhases),
      })
      setNewProjectName('')
      setNewProjectDueAt('')
      setNewProjectPhases([])
      setIsCreateProjectOpen(false)
      toast.success('项目已创建')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '新建项目失败')
    }
  }

  const handleUpdateProject = async (values: {
    estimatedDueAt: string | null
    phases: ProductionProjectPhaseInput[]
    status: 'active' | 'completed'
  }) => {
    if (!projectToManage) return
    try {
      await updateProject.mutateAsync({
        organizationId: projectToManage.id,
        status: values.status,
        estimatedDueAt: values.estimatedDueAt,
        phases: values.phases,
      })
      setProjectToManage(null)
      toast.success('项目状态已更新')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新项目失败')
    }
  }

  return (
    <div className='h-full overflow-y-auto bg-[var(--bg)] [scrollbar-gutter:stable_both-edges]'>
      <div className='mx-auto flex min-h-full w-full max-w-[72rem] flex-col px-4 pt-10 pb-8 sm:px-6 lg:px-10'>
        <div className='mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between'>
          <div className='min-w-0'>
            <span className='text-[12px] text-[var(--text-muted)]'>
              {canvas.activeWorkgroup
                ? `${canvas.activeWorkgroup.discipline.name} / ${canvas.activeWorkgroup.name}`
                : '项目工作区'}
            </span>
            <h1
              data-tour='home-greeting'
              className='max-w-[42rem] text-balance font-[430] font-season text-[32px] text-[var(--text-primary)]'
            >
              我的项目
            </h1>
            <p className='text-[14px] text-[var(--text-muted)]'>团队项目与排期</p>
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            <ProductionNotificationBell
              includeAllInvitations
              workspaceId={workspaceId}
              showLabel
              buttonClassName='shadow-subtle'
            />
            <HomeAccountMenu session={session} />
          </div>
        </div>

        {hasProjectCards ? <ProjectStatsOverview projects={canvas.projectEntries} /> : null}

        <div className='mb-5 flex flex-col gap-3 lg:flex-row lg:items-stretch lg:justify-between'>
          <div className='grid gap-3 sm:grid-cols-2 lg:min-w-[520px]'>
            <Button
              type='button'
              variant='ghost'
              className={cn(
                'h-auto min-h-[72px] justify-start rounded-[8px] border p-4 text-left transition-all',
                viewMode === 'cards'
                  ? 'border-[var(--brand-accent)] bg-[var(--surface-2)] text-[var(--text-primary)] shadow-medium'
                  : 'border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover-hover:border-[var(--border-1)] hover-hover:bg-[var(--surface-hover)]'
              )}
              onClick={() => setViewMode('cards')}
            >
              <BriefcaseBusiness className='mr-3 h-5 w-5 shrink-0 text-[var(--text-icon)]' />
              <span className='flex min-w-0 flex-col items-start'>
                <span className='font-medium text-[15px]'>项目</span>
                <span className='mt-1 text-[11px] text-[var(--text-tertiary)]'>
                  {canvas.projectEntries.length} 个项目
                </span>
              </span>
            </Button>
            <Button
              type='button'
              variant='ghost'
              className={cn(
                'h-auto min-h-[72px] justify-start rounded-[8px] border p-4 text-left transition-all',
                viewMode === 'schedule'
                  ? 'border-[var(--brand-accent)] bg-[var(--surface-2)] text-[var(--text-primary)] shadow-medium'
                  : 'border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover-hover:border-[var(--border-1)] hover-hover:bg-[var(--surface-hover)]'
              )}
              onClick={() => setViewMode('schedule')}
            >
              <CalendarClock className='mr-3 h-5 w-5 shrink-0 text-[var(--text-icon)]' />
              <span className='flex min-w-0 flex-col items-start'>
                <span className='font-medium text-[15px]'>排期</span>
                <span className='mt-1 text-[11px] text-[var(--text-tertiary)]'>全局时间线</span>
              </span>
            </Button>
          </div>
          {viewMode === 'schedule' && canCreateProject ? (
            <Button
              type='button'
              variant='outline'
              className='h-[44px] self-start rounded-[8px] px-4 lg:self-center'
              disabled={isProjectMutationPending}
              onClick={() => setIsCreateProjectOpen(true)}
            >
              <Plus className='mr-1.5 h-3.5 w-3.5' />
              新建项目
            </Button>
          ) : null}
        </div>

        {viewMode === 'schedule' ? (
          <ProjectScheduleOverview
            projects={canvas.projectEntries}
            onManageProject={setProjectToManage}
            onOpenTask={(project, taskId) =>
              void canvas.openProjectTask(project.primaryWorkgroupId, taskId)
            }
          />
        ) : hasProjectCards || canCreateProject ? (
          <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
            {canvas.projectEntries.map((project) => (
              <ProjectEntryCard
                key={project.id}
                project={project}
                isLoading={canvas.isSettingActiveWorkgroup}
                onManage={() => setProjectToManage(project)}
                onOpen={() => void canvas.openProjectWorkspace(project.primaryWorkgroupId)}
              />
            ))}
            {canCreateProject ? (
              <CreateProjectCard
                disabled={isProjectMutationPending}
                onClick={() => setIsCreateProjectOpen(true)}
              />
            ) : null}
          </div>
        ) : (
          <div className='rounded-[8px] border border-[var(--border)] border-dashed bg-[var(--surface-1)] p-6 text-[13px] text-[var(--text-muted)]'>
            你还没有被分配到任何项目。请联系项目管理员，把你加入对应团队。
          </div>
        )}
      </div>
      <Modal open={isCreateProjectOpen} onOpenChange={setIsCreateProjectOpen}>
        <ModalContent size='md'>
          <ModalHeader>新建项目</ModalHeader>
          <ModalBody>
            <div className='space-y-4'>
              <FormField label='项目名称' htmlFor='new-project-name'>
                <Input
                  id='new-project-name'
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.target.value)}
                  placeholder='例如：城市音乐节开幕秀'
                />
              </FormField>
              <FormField label='预估 DDL' htmlFor='new-project-due-at' optional>
                <Input
                  id='new-project-due-at'
                  type='datetime-local'
                  value={newProjectDueAt}
                  onChange={(event) => setNewProjectDueAt(event.target.value)}
                />
              </FormField>
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px] text-[var(--text-muted)] leading-5'>
                创建后会自动生成导演组和团队画布。后续可在团队管理中继续添加灯光、舞美等工种团队。
              </div>
              <ProjectPhaseEditor phases={newProjectPhases} onChange={setNewProjectPhases} />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button type='button' variant='default' onClick={() => setIsCreateProjectOpen(false)}>
              取消
            </Button>
            <Button
              type='button'
              variant='primary'
              disabled={createProject.isPending || !newProjectName.trim()}
              onClick={() => void handleCreateProject()}
            >
              {createProject.isPending ? (
                <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
              ) : (
                <Plus className='mr-1.5 h-3.5 w-3.5' />
              )}
              创建项目
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <ProjectSettingsModal
        project={projectToManage}
        isSaving={updateProject.isPending}
        onOpenChange={(open) => !open && setProjectToManage(null)}
        onSave={(values) => void handleUpdateProject(values)}
      />
    </div>
  )
}
