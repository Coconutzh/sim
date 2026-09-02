'use client'

import { AlertTriangle, CheckCircle2, ChevronRight, Clock3, ListChecks } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/emcn'
import { formatMobileDate } from '@/app/mobile/components/mobile-format'
import { MobileHeader } from '@/app/mobile/components/mobile-header'
import {
  MobileEmptyState,
  MobileErrorState,
  MobileLoadingState,
} from '@/app/mobile/components/mobile-states'
import { useMobileProjects } from '@/hooks/queries/mobile-production'

export function MobileProjectsPage() {
  const projectsQuery = useMobileProjects()
  const projects = projectsQuery.data?.projects ?? []

  return (
    <div className='min-h-[100dvh]'>
      <MobileHeader
        title='项目监控'
        onRefresh={() => void projectsQuery.refetch()}
        refreshing={projectsQuery.isFetching}
      />
      <main className='mx-auto max-w-3xl px-3 pt-3 pb-[calc(24px+env(safe-area-inset-bottom))]'>
        {projectsQuery.isLoading ? <MobileLoadingState message='正在汇总项目风险' /> : null}
        {projectsQuery.isError ? (
          <MobileErrorState
            message={projectsQuery.error.message || '项目加载失败'}
            onRetry={() => void projectsQuery.refetch()}
          />
        ) : null}
        {!projectsQuery.isLoading && !projectsQuery.isError && projects.length === 0 ? (
          <MobileEmptyState message='当前账号没有可访问的生产项目' />
        ) : null}
        <div className='space-y-3'>
          {projects.map((project) => (
            <Link
              key={project.workspaceId}
              href={`/mobile/project/${project.workspaceId}`}
              className='block min-h-44 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-4 transition-colors active:bg-[var(--surface-2)]'
            >
              <div className='flex items-start gap-3'>
                <div className='min-w-0 flex-1'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <h2 className='break-words font-semibold text-[16px]'>{project.name}</h2>
                    <Badge variant={project.status === 'completed' ? 'green' : 'amber'}>
                      {project.status === 'completed' ? '已完成' : '进行中'}
                    </Badge>
                  </div>
                  <p className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
                    项目 DDL {formatMobileDate(project.estimatedDueAt)}
                  </p>
                </div>
                <ChevronRight className='mt-1 h-5 w-5 shrink-0 text-[var(--text-tertiary)]' />
              </div>
              <div className='mt-4 grid grid-cols-2 gap-2 min-[390px]:grid-cols-4'>
                <div className='rounded-md bg-[var(--badge-red-bg)] px-3 py-2 text-[var(--badge-red-text)]'>
                  <div className='flex items-center gap-1 text-[11px]'>
                    <AlertTriangle className='h-3.5 w-3.5' />
                    超期
                  </div>
                  <p className='mt-1 font-semibold text-[18px]'>{project.metrics.overdue}</p>
                </div>
                <div className='rounded-md bg-[var(--badge-amber-bg)] px-3 py-2 text-[var(--badge-amber-text)]'>
                  <div className='flex items-center gap-1 text-[11px]'>
                    <Clock3 className='h-3.5 w-3.5' />
                    24 小时
                  </div>
                  <p className='mt-1 font-semibold text-[18px]'>{project.metrics.dueSoon}</p>
                </div>
                <div className='rounded-md bg-[var(--badge-blue-bg)] px-3 py-2 text-[var(--badge-blue-text)]'>
                  <div className='flex items-center gap-1 text-[11px]'>
                    <ListChecks className='h-3.5 w-3.5' />
                    待审核
                  </div>
                  <p className='mt-1 font-semibold text-[18px]'>{project.metrics.pendingReview}</p>
                </div>
                <div className='rounded-md bg-[var(--surface-2)] px-3 py-2 text-[var(--text-secondary)]'>
                  <div className='flex items-center gap-1 text-[11px]'>
                    <CheckCircle2 className='h-3.5 w-3.5' />
                    已完成
                  </div>
                  <p className='mt-1 font-semibold text-[18px]'>
                    {project.metrics.completed}/{project.metrics.total}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
