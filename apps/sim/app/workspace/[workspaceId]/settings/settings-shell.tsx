'use client'

import { useMemo, useState } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { ChevronDown, Settings } from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import { allNavigationItems } from '@/app/workspace/[workspaceId]/settings/navigation'

const ADMIN_CONSOLE_SECTIONS = [
  'admin-console-users',
  'admin-console-credits',
  'admin-console-api-keys',
  'admin-console-usage',
] as const

const BASIC_SECTIONS = ['account'] as const
const ADMIN_SECTIONS = [...ADMIN_CONSOLE_SECTIONS, 'user-management'] as const

interface SettingsShellProps {
  children: React.ReactNode
}

function isAdminConsoleSection(section: SettingsSection): boolean {
  return (ADMIN_CONSOLE_SECTIONS as readonly string[]).includes(section)
}

export function SettingsShell({ children }: SettingsShellProps) {
  const params = useParams()
  const pathname = usePathname()
  const router = useRouter()
  const { data: session } = useSession()
  const [consoleOpen, setConsoleOpen] = useState(true)

  const workspaceId = params.workspaceId as string
  const activeSection = useMemo(() => {
    const segments = pathname?.split('/') ?? []
    const settingsIndex = segments.indexOf('settings')
    return (segments[settingsIndex + 1] ?? 'account') as SettingsSection
  }, [pathname])

  const isPlatformAdmin = session?.user?.role === 'admin'
  const visibleItems = useMemo(() => {
    const allowedSections = isPlatformAdmin
      ? new Set<SettingsSection>([...BASIC_SECTIONS, ...ADMIN_SECTIONS])
      : new Set<SettingsSection>(BASIC_SECTIONS)
    return allNavigationItems.filter((item) => allowedSections.has(item.id))
  }, [isPlatformAdmin])

  const accountItems = visibleItems.filter((item) => item.section === 'account')
  const consoleItems = visibleItems.filter((item) => isAdminConsoleSection(item.id))
  const managementItems = visibleItems.filter((item) => item.id === 'user-management')

  const navigateToSection = (section: SettingsSection) => {
    router.replace(`/workspace/${workspaceId}/settings/${section}`, { scroll: false })
  }

  return (
    <div className='h-full overflow-y-auto [scrollbar-gutter:stable]'>
      <div className='flex min-h-full w-full gap-8 px-8 pt-8 pb-12'>
        <aside className='hidden w-[220px] flex-shrink-0 md:block'>
          <nav className='sticky top-8 flex flex-col gap-6'>
            <div className='flex flex-col gap-1'>
              <div className='px-2 pb-1.5 font-medium text-[var(--text-muted)] text-xs'>账号</div>
              {accountItems.map((item) => {
                const Icon = item.icon
                const active = activeSection === item.id || activeSection === 'general'
                return (
                  <button
                    key={item.id}
                    type='button'
                    className={cn(
                      'flex h-8 items-center gap-2 rounded-[6px] px-2 text-sm',
                      active
                        ? 'bg-[var(--surface-active)] text-[var(--text-primary)]'
                        : 'text-[var(--text-body)] hover-hover:bg-[var(--surface-hover)]'
                    )}
                    onClick={() => navigateToSection(item.id)}
                  >
                    <Icon className='h-4 w-4 flex-shrink-0 text-[var(--text-icon)]' />
                    <span className='truncate'>{item.label}</span>
                  </button>
                )
              })}
            </div>

            {isPlatformAdmin && (
              <div className='flex flex-col gap-1'>
                <div className='px-2 pb-1.5 font-medium text-[var(--text-muted)] text-xs'>
                  平台管理
                </div>
                <button
                  type='button'
                  className={cn(
                    'flex h-8 items-center gap-2 rounded-[6px] px-2 text-sm',
                    isAdminConsoleSection(activeSection)
                      ? 'bg-[var(--surface-active)] text-[var(--text-primary)]'
                      : 'text-[var(--text-body)] hover-hover:bg-[var(--surface-hover)]'
                  )}
                  onClick={() => setConsoleOpen((open) => !open)}
                >
                  <Settings className='h-4 w-4 flex-shrink-0 text-[var(--text-icon)]' />
                  <span className='min-w-0 flex-1 truncate text-left'>控制台</span>
                  <ChevronDown
                    className={cn(
                      'h-3 w-3 flex-shrink-0 text-[var(--text-icon)] transition-transform',
                      !consoleOpen && '-rotate-90'
                    )}
                  />
                </button>
                {consoleOpen &&
                  consoleItems.map((item) => {
                    const Icon = item.icon
                    const active = activeSection === item.id
                    return (
                      <button
                        key={item.id}
                        type='button'
                        className={cn(
                          'flex h-7 items-center gap-2 rounded-[6px] pr-2 pl-7 text-[13px]',
                          active
                            ? 'bg-[var(--surface-active)] text-[var(--text-primary)]'
                            : 'text-[var(--text-body)] hover-hover:bg-[var(--surface-hover)]'
                        )}
                        onClick={() => navigateToSection(item.id)}
                      >
                        <Icon className='h-3.5 w-3.5 flex-shrink-0 text-[var(--text-icon)]' />
                        <span className='truncate'>{item.label}</span>
                      </button>
                    )
                  })}
                {managementItems.map((item) => {
                  const Icon = item.icon
                  const active = activeSection === item.id
                  return (
                    <button
                      key={item.id}
                      type='button'
                      className={cn(
                        'flex h-8 items-center gap-2 rounded-[6px] px-2 text-sm',
                        active
                          ? 'bg-[var(--surface-active)] text-[var(--text-primary)]'
                          : 'text-[var(--text-body)] hover-hover:bg-[var(--surface-hover)]'
                      )}
                      onClick={() => navigateToSection(item.id)}
                    >
                      <Icon className='h-4 w-4 flex-shrink-0 text-[var(--text-icon)]' />
                      <span className='truncate'>{item.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </nav>
        </aside>
        <main className='min-w-0 flex-1'>{children}</main>
      </div>
    </div>
  )
}
