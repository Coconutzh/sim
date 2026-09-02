'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  ChevronRight,
  Clock3,
  FileText,
  ListChecks,
  MessageCircle,
  Paperclip,
  Plus,
} from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/emcn'
import type { MobileTaskFilter } from '@/lib/api/contracts/mobile-production'
import { cn } from '@/lib/core/utils/cn'
import {
  formatMobileDate,
  isMobileTaskOverdue,
  TASK_STATUS_LABELS,
} from '@/app/mobile/components/mobile-format'
import { MobileHeader } from '@/app/mobile/components/mobile-header'
import {
  MobileEmptyState,
  MobileErrorState,
  MobileLoadingState,
} from '@/app/mobile/components/mobile-states'
import { useMobileProject } from '@/hooks/queries/mobile-production'

interface MobileProjectPageProps {
  workspaceId: string
}

type ProjectTab = 'tasks' | 'results'

const TASK_FILTERS: Array<{ label: string; value: MobileTaskFilter }> = [
  { label: '全部', value: 'all' },
  { label: '进行中', value: 'in_progress' },
  { label: '待审核', value: 'pending_review' },
  { label: '已完成', value: 'completed' },
]

export function MobileProjectPage({ workspaceId }: MobileProjectPageProps) {
  const [activeTab, setActiveTab] = useState<ProjectTab>('tasks')
  const [taskFilter, setTaskFilter] = useState<MobileTaskFilter>('all')
  const projectQuery = useMobileProject(workspaceId, taskFilter)
  const data = projectQuery.data

  return (
    <div className='min-h-[100dvh]'>
      <MobileHeader
        backHref='/mobile'
        title={data?.project.name ?? '项目总览'}
        onRefresh={() => void projectQuery.refetch()}
        refreshing={projectQuery.isFetching}
      />
      {projectQuery.isLoading ? <MobileLoadingState message='正在加载项目总览' /> : null}
      {projectQuery.isError ? (
        <MobileErrorState
          message={projectQuery.error.message || '项目加载失败'}
          onRetry={() => void projectQuery.refetch()}
        />
      ) : null}
      {data ? (
        <main className='mx-auto max-w-3xl px-3 pt-3 pb-[calc(88px+env(safe-area-inset-bottom))]'>
          <section className='grid grid-cols-3 gap-2'>
            {[
              {
                icon: AlertTriangle,
                label: '超期',
                tone: 'red',
                value: data.project.metrics.overdue,
              },
              {
                icon: Clock3,
                label: '24 小时',
                tone: 'amber',
                value: data.project.metrics.dueSoon,
              },
              {
                icon: ListChecks,
                label: '待审核',
                tone: 'blue',
                value: data.project.metrics.pendingReview,
              },
              {
                icon: MessageCircle,
                label: '未读消息',
                tone: 'neutral',
                value: data.project.metrics.unreadMessages,
              },
              {
                icon: CheckCheck,
                label: '已采用',
                tone: 'neutral',
                value: data.project.metrics.adoptedResults,
              },
              {
                icon: FileText,
                label: '任务总数',
                tone: 'neutral',
                value: data.project.metrics.total,
              },
            ].map((metric) => (
              <div
                key={metric.label}
                className={cn(
                  'min-h-20 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-3',
                  metric.tone === 'red' && 'border-[var(--badge-red-border)]',
                  metric.tone === 'amber' && 'border-[var(--badge-amber-border)]',
                  metric.tone === 'blue' && 'border-[var(--badge-blue-border)]'
                )}
              >
                <div className='flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]'>
                  <metric.icon className='h-3.5 w-3.5' />
                  <span>{metric.label}</span>
                </div>
                <p className='mt-2 font-semibold text-[20px]'>{metric.value}</p>
              </div>
            ))}
          </section>

          <div className='mt-4 grid h-11 grid-cols-2 rounded-[8px] bg-[var(--surface-2)] p-1'>
            <button
              type='button'
              className={cn(
                'rounded-md text-[13px]',
                activeTab === 'tasks' && 'bg-[var(--bg)] font-medium shadow-sm'
              )}
              onClick={() => setActiveTab('tasks')}
            >
              任务
            </button>
            <button
              type='button'
              className={cn(
                'rounded-md text-[13px]',
                activeTab === 'results' && 'bg-[var(--bg)] font-medium shadow-sm'
              )}
              onClick={() => setActiveTab('results')}
            >
              成果
            </button>
          </div>

          {activeTab === 'tasks' ? (
            <section className='mt-3'>
              <div className='flex gap-2 overflow-x-auto pb-2'>
                {TASK_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type='button'
                    className={cn(
                      'h-11 shrink-0 rounded-md border border-[var(--border)] px-4 text-[12px]',
                      taskFilter === filter.value &&
                        'border-[var(--brand-primary)] bg-[var(--surface-active)] font-medium'
                    )}
                    onClick={() => setTaskFilter(filter.value)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              {data.tasks.length === 0 ? <MobileEmptyState message='当前筛选下暂无任务' /> : null}
              <div className='space-y-2'>
                {data.tasks.map((task) => {
                  const overdue = isMobileTaskOverdue(task.status, task.dueAt)
                  return (
                    <Link
                      key={task.id}
                      href={`/mobile/project/${workspaceId}/task/${task.id}`}
                      className={cn(
                        'block min-h-32 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-4 active:bg-[var(--surface-2)]',
                        overdue && 'border-[var(--badge-red-border)]'
                      )}
                    >
                      <div className='flex items-start gap-3'>
                        <div className='min-w-0 flex-1'>
                          <div className='flex flex-wrap items-center gap-2'>
                            <h3 className='break-words font-medium text-[14px]'>{task.title}</h3>
                            <Badge
                              variant={
                                overdue ? 'red' : task.status === 'submitted' ? 'blue' : 'gray'
                              }
                            >
                              {overdue ? '已超期' : TASK_STATUS_LABELS[task.status]}
                            </Badge>
                          </div>
                          <p className='mt-2 text-[12px] text-[var(--text-secondary)]'>
                            {task.assigneeWorkgroup.discipline.name || task.assigneeWorkgroup.name}
                          </p>
                          <p
                            className={cn(
                              'mt-1 text-[11px] text-[var(--text-tertiary)]',
                              overdue && 'text-[var(--badge-red-text)]'
                            )}
                          >
                            DDL {formatMobileDate(task.dueAt)}
                          </p>
                        </div>
                        <ChevronRight className='h-5 w-5 shrink-0 text-[var(--text-tertiary)]' />
                      </div>
                      {task.delayReason ? (
                        <p className='mt-3 line-clamp-2 rounded-md bg-[var(--badge-amber-bg)] px-2 py-1.5 text-[11px] text-[var(--badge-amber-text)]'>
                          延期原因：{task.delayReason}
                        </p>
                      ) : null}
                      {task.unreadMessageCount > 0 ? (
                        <div className='mt-2 flex items-center gap-1 text-[11px] text-[var(--badge-blue-text)]'>
                          <Bell className='h-3.5 w-3.5' />
                          {task.unreadMessageCount} 条未读
                        </div>
                      ) : null}
                    </Link>
                  )
                })}
              </div>
            </section>
          ) : (
            <section className='mt-3 space-y-2'>
              {data.showcaseItems.length === 0 ? (
                <MobileEmptyState message='暂无已发布成果' />
              ) : null}
              {data.showcaseItems.map((item) => (
                <article
                  key={item.id}
                  className='rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-4'
                >
                  <div className='flex flex-wrap items-center gap-2'>
                    <h3 className='break-words font-medium text-[14px]'>{item.title}</h3>
                    <Badge variant='gray'>{item.category}</Badge>
                  </div>
                  <p className='mt-2 text-[11px] text-[var(--text-tertiary)]'>
                    {item.sourceWorkgroup.name} · {formatMobileDate(item.createdAt)}
                  </p>
                  {item.description || item.content ? (
                    <p className='mt-3 line-clamp-4 whitespace-pre-wrap break-words text-[12px] text-[var(--text-secondary)] leading-5'>
                      {item.description || item.content}
                    </p>
                  ) : null}
                  {item.attachments.length > 0 ? (
                    <div className='mt-3 space-y-1'>
                      {item.attachments.map((attachment) => (
                        <a
                          key={attachment.id}
                          href={attachment.downloadUrl || attachment.url}
                          className='flex min-h-11 items-center gap-2 rounded-md bg-[var(--surface-2)] px-3 text-[12px]'
                        >
                          <Paperclip className='h-4 w-4 shrink-0' />
                          <span className='min-w-0 break-all'>{attachment.name}</span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </section>
          )}
        </main>
      ) : null}
      {data?.project.canCreateProductionTask ? (
        <div className='fixed inset-x-0 bottom-0 z-30 border-[var(--border)] border-t bg-[var(--bg)] px-3 pt-2 pb-[calc(8px+env(safe-area-inset-bottom))]'>
          <div className='mx-auto max-w-3xl'>
            <Link
              href={`/mobile/project/${workspaceId}/tasks/new`}
              className='flex h-12 w-full items-center justify-center rounded-md bg-[var(--brand-primary)] font-medium text-[14px] text-[var(--brand-primary-foreground)]'
            >
              <Plus className='mr-2 h-5 w-5' />
              发布任务
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}
