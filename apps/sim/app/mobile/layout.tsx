import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ToastProvider } from '@/components/emcn'
import { getSession } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'SIM 项目监控',
}

interface MobileLayoutProps {
  children: React.ReactNode
}

export default async function MobileLayout({ children }: MobileLayoutProps) {
  const session = await getSession()
  if (!session?.user) redirect('/login?callbackUrl=/mobile')

  return (
    <ToastProvider>
      <div className='min-h-[100dvh] min-w-[320px] bg-[var(--surface-1)] text-[var(--text-primary)]'>
        {children}
      </div>
    </ToastProvider>
  )
}
