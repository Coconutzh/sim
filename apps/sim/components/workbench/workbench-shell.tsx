'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import type { WorkgroupSummary } from '@/lib/api/contracts/collaboration'

type WorkbenchNavKey = 'home' | 'personal' | 'team' | 'showcase' | 'copilot' | 'team-management'

interface WorkbenchShellProps {
  activeNav: WorkbenchNavKey
  activeWorkgroup: WorkgroupSummary | null
  activeWorkgroupId: string | null
  workgroups: WorkgroupSummary[]
  onActiveWorkgroupChange?: (workgroupId: string) => void
  children: ReactNode
}

const NAV_ITEMS: Array<{ key: WorkbenchNavKey; label: string; href?: string }> = [
  { key: 'home', label: '工作台', href: '/workbench' },
  { key: 'personal', label: '个人草稿', href: '/workbench/personal' },
  { key: 'team', label: '团队画布', href: '/workbench/team' },
  { key: 'showcase', label: '展示画布', href: '/workbench/showcase' },
  { key: 'copilot', label: 'Copilot' },
]

export function WorkbenchShell({
  activeNav,
  activeWorkgroup,
  activeWorkgroupId,
  workgroups,
  onActiveWorkgroupChange,
  children,
}: WorkbenchShellProps) {
  const isTeamAdmin = activeWorkgroup?.role === 'admin'

  return (
    <main className='min-h-screen bg-[#f7f4ed] text-[#271f18]'>
      <div className='mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-[248px_1fr]'>
        <aside className='rounded-[1.5rem] border border-[#e2d8c7] bg-white p-4 shadow-sm'>
          <div className='text-xs font-semibold uppercase tracking-[0.24em] text-[#9b5b2e]'>
            Theater Workbench
          </div>
          <nav className='mt-6 grid gap-2 text-sm'>
            {NAV_ITEMS.map((item) =>
              item.href ? (
                <Link
                  key={item.key}
                  className={navClassName(activeNav === item.key)}
                  href={item.href}
                >
                  {item.label}
                </Link>
              ) : (
                <span key={item.key} className={navClassName(activeNav === item.key, true)}>
                  {item.label}
                </span>
              )
            )}
            {isTeamAdmin && (
              <Link
                className={navClassName(activeNav === 'team-management')}
                href='/workbench/team-management'
              >
                团队管理
              </Link>
            )}
          </nav>
        </aside>

        <section className='space-y-6'>
          <div className='rounded-[2rem] border border-[#e2d8c7] bg-white p-6 shadow-sm'>
            <div className='flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
              <div>
                <p className='text-sm font-medium text-[#9b5b2e]'>当前操作身份</p>
                <h1 className='mt-2 text-3xl font-semibold tracking-tight'>剧场项目协作工作台</h1>
                {activeWorkgroup ? (
                  <p className='mt-3 text-sm leading-6 text-[#6f6256]'>
                    当前项目：{activeWorkgroup.organizationId} · 当前工种：
                    {activeWorkgroup.discipline.name} · 当前团队：{activeWorkgroup.name} ·
                    当前身份：
                    {activeWorkgroup.role === 'admin' ? '团队管理员' : '团队成员'} · 当前 Agent：
                    {activeWorkgroup.discipline.agentCode}
                  </p>
                ) : (
                  <p className='mt-3 text-sm text-[#6f6256]'>
                    你还没有活跃团队，请联系项目管理员完成工种团队分配。
                  </p>
                )}
              </div>
              {workgroups.length > 0 && (
                <select
                  className='rounded-xl border border-[#d8cbb8] bg-[#fbf8f2] px-4 py-3 text-sm outline-none'
                  disabled={!onActiveWorkgroupChange}
                  value={activeWorkgroupId ?? ''}
                  onChange={(event) => onActiveWorkgroupChange?.(event.target.value)}
                >
                  {workgroups.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.discipline.name} / {item.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          {children}
        </section>
      </div>
    </main>
  )
}

function navClassName(active: boolean, disabled = false): string {
  if (active) return 'rounded-xl bg-[#271f18] px-4 py-3 font-semibold text-white'
  if (disabled) return 'rounded-xl px-4 py-3 text-[#8a7b6d]'
  return 'rounded-xl px-4 py-3 text-[#271f18] hover:bg-[#f0e7d9]'
}
