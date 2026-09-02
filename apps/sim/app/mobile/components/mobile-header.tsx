'use client'

import { ArrowLeft, LogOut, RefreshCw, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'
import { signOut, useSession } from '@/lib/auth/auth-client'

interface MobileHeaderProps {
  backHref?: string
  onRefresh?: () => void
  refreshing?: boolean
  title: string
}

export function MobileHeader({ backHref, onRefresh, refreshing, title }: MobileHeaderProps) {
  const router = useRouter()
  const { data: session } = useSession()

  const handleSignOut = async () => {
    await signOut()
    router.replace('/login')
    router.refresh()
  }

  return (
    <header className='sticky top-0 z-30 border-[var(--border)] border-b bg-[var(--bg)]/95 pt-[env(safe-area-inset-top)] backdrop-blur'>
      <div className='mx-auto flex h-14 max-w-3xl items-center gap-2 px-3'>
        {backHref ? (
          <Link
            href={backHref}
            aria-label='返回'
            className='flex h-11 w-11 shrink-0 items-center justify-center rounded-md'
          >
            <ArrowLeft className='h-5 w-5' />
          </Link>
        ) : (
          <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[var(--surface-2)]'>
            <UserRound className='h-5 w-5 text-[var(--text-secondary)]' />
          </div>
        )}
        <div className='min-w-0 flex-1'>
          <h1 className='truncate font-semibold text-[16px]'>{title}</h1>
          {!backHref && session?.user ? (
            <p className='truncate text-[11px] text-[var(--text-tertiary)]'>
              {session.user.name || session.user.email}
            </p>
          ) : null}
        </div>
        {onRefresh ? (
          <Button
            type='button'
            variant='ghost'
            className='h-11 w-11 shrink-0 p-0'
            aria-label='刷新'
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        ) : null}
        {!backHref ? (
          <Button
            type='button'
            variant='ghost'
            className='h-11 w-11 shrink-0 p-0'
            aria-label='退出登录'
            onClick={() => void handleSignOut()}
          >
            <LogOut className='h-5 w-5' />
          </Button>
        ) : null}
      </div>
    </header>
  )
}
