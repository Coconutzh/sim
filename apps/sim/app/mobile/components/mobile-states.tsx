import { AlertCircle, FolderOpen, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/emcn'

interface MobileStateProps {
  message?: string
  onRetry?: () => void
}

export function MobileLoadingState({ message = '正在加载' }: MobileStateProps) {
  return (
    <div className='flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center text-[var(--text-secondary)]'>
      <Loader2 className='h-6 w-6 animate-spin' />
      <p className='text-[13px]'>{message}</p>
    </div>
  )
}

export function MobileEmptyState({ message = '暂无数据' }: MobileStateProps) {
  return (
    <div className='flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center text-[var(--text-secondary)]'>
      <FolderOpen className='h-7 w-7' />
      <p className='text-[13px]'>{message}</p>
    </div>
  )
}

export function MobileErrorState({ message = '加载失败', onRetry }: MobileStateProps) {
  return (
    <div className='flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center'>
      <AlertCircle className='h-7 w-7 text-[var(--badge-red-text)]' />
      <p className='text-[13px] text-[var(--text-secondary)]'>{message}</p>
      {onRetry ? (
        <Button type='button' variant='outline' className='h-11' onClick={onRetry}>
          <RefreshCw className='mr-2 h-4 w-4' />
          重试
        </Button>
      ) : null}
    </div>
  )
}
