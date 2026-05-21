import { isApiClientError } from '@/lib/api/client/errors'

export interface WorkbenchAccessIssue {
  title: string
  message: string
  actionLabel?: string
  actionHref?: string
}

export function getWorkbenchAccessIssue(error: unknown): WorkbenchAccessIssue | null {
  if (!error) return null

  if (isApiClientError(error)) {
    if (error.status === 401) {
      return {
        title: '请先登录',
        message: '登录状态失效，请重新登录后再进入协作工作台。',
        actionLabel: '返回登录',
        actionHref: '/login',
      }
    }

    if (error.status === 403) {
      return {
        title: '你没有权限访问这个画布',
        message:
          error.message || '当前账号没有访问该团队、画布或展示版本的权限，请切换团队或联系管理员。',
        actionLabel: '返回工作台切换团队',
        actionHref: '/workbench',
      }
    }

    if (error.status === 404) {
      return {
        title: '当前团队或画布不可用',
        message: '你的 active workgroup 可能已失效，或该画布不再对当前账号可见。请切换团队后重试。',
        actionLabel: '返回工作台切换团队',
        actionHref: '/workbench',
      }
    }
  }

  return {
    title: '协作数据加载失败',
    message: error instanceof Error ? error.message : '请稍后重试，或联系管理员检查协作权限配置。',
    actionLabel: '返回工作台',
    actionHref: '/workbench',
  }
}
