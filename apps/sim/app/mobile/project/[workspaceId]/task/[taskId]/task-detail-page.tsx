'use client'

import { CalendarClock, FileText, History, Paperclip, UsersRound } from 'lucide-react'
import { Badge } from '@/components/emcn'
import { formatMobileDate, TASK_STATUS_LABELS } from '@/app/mobile/components/mobile-format'
import { MobileHeader } from '@/app/mobile/components/mobile-header'
import { MobileErrorState, MobileLoadingState } from '@/app/mobile/components/mobile-states'
import { useMobileProductionTask } from '@/hooks/queries/mobile-production'

interface MobileTaskDetailPageProps {
  workspaceId: string
  taskId: string
}

export function MobileTaskDetailPage({ workspaceId, taskId }: MobileTaskDetailPageProps) {
  const taskQuery = useMobileProductionTask(workspaceId, taskId)
  const task = taskQuery.data?.task

  return (
    <div className='min-h-[100dvh]'>
      <MobileHeader
        backHref={`/mobile/project/${workspaceId}`}
        title='任务详情'
        onRefresh={() => void taskQuery.refetch()}
        refreshing={taskQuery.isFetching}
      />
      {taskQuery.isLoading ? <MobileLoadingState message='正在加载任务详情' /> : null}
      {taskQuery.isError ? (
        <MobileErrorState
          message={taskQuery.error.message || '任务不存在或当前账号无权访问'}
          onRetry={() => void taskQuery.refetch()}
        />
      ) : null}
      {task ? (
        <main className='mx-auto max-w-3xl space-y-3 px-3 pt-3 pb-[calc(24px+env(safe-area-inset-bottom))]'>
          <section className='rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-4'>
            <div className='flex flex-wrap items-center gap-2'>
              <h2 className='break-words font-semibold text-[18px]'>{task.title}</h2>
              <Badge
                variant={
                  task.status === 'submitted'
                    ? 'blue'
                    : task.status === 'approved'
                      ? 'green'
                      : 'gray'
                }
              >
                {TASK_STATUS_LABELS[task.status]}
              </Badge>
            </div>
            <div className='mt-4 grid gap-3 text-[12px] text-[var(--text-secondary)] min-[390px]:grid-cols-2'>
              <div className='flex min-h-11 items-center gap-2 rounded-md bg-[var(--surface-2)] px-3'>
                <UsersRound className='h-4 w-4 shrink-0' />
                <span className='break-words'>
                  {task.assigneeWorkgroup.discipline.name || task.assigneeWorkgroup.name}
                </span>
              </div>
              <div className='flex min-h-11 items-center gap-2 rounded-md bg-[var(--surface-2)] px-3'>
                <CalendarClock className='h-4 w-4 shrink-0' />
                <span>DDL {formatMobileDate(task.dueAt)}</span>
              </div>
            </div>
          </section>

          <section className='rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-4'>
            <h3 className='flex items-center gap-2 font-medium text-[13px]'>
              <FileText className='h-4 w-4' />
              任务说明
            </h3>
            <p className='mt-3 whitespace-pre-wrap break-words text-[13px] text-[var(--text-secondary)] leading-6'>
              {task.description || '未填写任务说明'}
            </p>
          </section>

          {task.delayReason ? (
            <section className='rounded-[8px] border border-[var(--badge-amber-border)] bg-[var(--badge-amber-bg)] p-4'>
              <h3 className='font-medium text-[13px] text-[var(--badge-amber-text)]'>延期原因</h3>
              <p className='mt-2 whitespace-pre-wrap break-words text-[12px] text-[var(--badge-amber-text)] leading-5'>
                {task.delayReason}
              </p>
            </section>
          ) : null}

          <section className='rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-4'>
            <h3 className='flex items-center gap-2 font-medium text-[13px]'>
              <Paperclip className='h-4 w-4' />
              任务附件
            </h3>
            {task.attachments.length === 0 ? (
              <p className='mt-3 text-[12px] text-[var(--text-tertiary)]'>无附件</p>
            ) : (
              <div className='mt-3 space-y-2'>
                {task.attachments.map((attachment) => (
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
            )}
          </section>

          <section className='rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-4'>
            <h3 className='flex items-center gap-2 font-medium text-[13px]'>
              <History className='h-4 w-4' />
              提交版本
            </h3>
            {task.submissions.length === 0 ? (
              <p className='mt-3 text-[12px] text-[var(--text-tertiary)]'>暂无提交版本</p>
            ) : (
              <div className='mt-3 space-y-3'>
                {task.submissions.map((submission) => (
                  <article key={submission.id} className='rounded-md bg-[var(--surface-2)] p-3'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <p className='font-medium text-[12px]'>版本 {submission.versionNumber}</p>
                      <span className='text-[11px] text-[var(--text-tertiary)]'>
                        {formatMobileDate(submission.submittedAt)}
                      </span>
                    </div>
                    {submission.note ? (
                      <p className='mt-2 whitespace-pre-wrap break-words text-[12px] text-[var(--text-secondary)] leading-5'>
                        {submission.note}
                      </p>
                    ) : null}
                    {submission.attachments.map((attachment) => (
                      <a
                        key={attachment.id}
                        href={attachment.downloadUrl || attachment.url}
                        className='mt-2 flex min-h-11 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 text-[12px]'
                      >
                        <Paperclip className='h-4 w-4 shrink-0' />
                        <span className='break-all'>{attachment.name}</span>
                      </a>
                    ))}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-4 text-[12px] text-[var(--text-secondary)]'>
            当前可用操作：{task.permissions.canEdit ? '管理任务' : '查看任务'}
            {task.permissions.canSubmit ? '、提交版本' : ''}
            {task.permissions.canReview ? '、审核任务' : ''}
          </section>
        </main>
      ) : null}
    </div>
  )
}
