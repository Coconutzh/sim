import type { ProductionTaskStatus } from '@/lib/api/contracts/production-tasks'

export const TASK_STATUS_LABELS: Record<ProductionTaskStatus, string> = {
  todo: '待开始',
  in_progress: '进行中',
  submitted: '待审核',
  approved: '已完成',
  changes_requested: '需修改',
  archived: '已归档',
}

export function formatMobileDate(value: string | null): string {
  if (!value) return '未设置'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

export function isMobileTaskOverdue(status: ProductionTaskStatus, dueAt: string | null): boolean {
  return Boolean(
    dueAt &&
      status !== 'approved' &&
      status !== 'archived' &&
      new Date(dueAt).getTime() < Date.now()
  )
}
