'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useMyWorkgroups, useSetActiveWorkgroup } from '@/hooks/queries/collaboration'
import { useSession } from '@/lib/auth/auth-client'

export default function WorkbenchPage() {
  const { data: session, isPending } = useSession()
  const { data, isLoading } = useMyWorkgroups(Boolean(session?.user))
  const setActiveWorkgroup = useSetActiveWorkgroup()
  const [selectedWorkgroupId, setSelectedWorkgroupId] = useState<string | null>(null)

  const activeWorkgroupId = selectedWorkgroupId ?? data?.defaultWorkgroupId ?? data?.workgroups[0]?.id ?? null
  const activeWorkgroup = useMemo(
    () => data?.workgroups.find((item) => item.id === activeWorkgroupId) ?? null,
    [activeWorkgroupId, data?.workgroups]
  )

  if (isPending || isLoading) {
    return <div className='flex min-h-screen items-center justify-center text-muted-foreground'>加载工作台...</div>
  }

  if (!session?.user) {
    return <div className='flex min-h-screen items-center justify-center'>请先登录。</div>
  }

  if (!data?.workgroups.length) {
    return (
      <main className='min-h-screen bg-[#f7f4ed] px-6 py-10'>
        <section className='mx-auto max-w-3xl rounded-[2rem] border border-[#e2d8c7] bg-white p-10 shadow-sm'>
          <p className='text-sm font-medium text-[#9b5b2e]'>等待分配</p>
          <h1 className='mt-3 text-3xl font-semibold tracking-tight text-[#271f18]'>你还没有加入任何工种团队</h1>
          <p className='mt-4 text-[#6f6256]'>请联系项目管理员把你加入指定工种下的团队。普通员工不能自行创建 workspace。</p>
        </section>
      </main>
    )
  }

  return (
    <main className='min-h-screen bg-[#f7f4ed] text-[#271f18]'>
      <div className='mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-[240px_1fr]'>
        <aside className='rounded-[1.5rem] border border-[#e2d8c7] bg-white p-4 shadow-sm'>
          <div className='text-xs font-semibold uppercase tracking-[0.24em] text-[#9b5b2e]'>Workbench</div>
          <nav className='mt-6 grid gap-2 text-sm'>
            <Link className='rounded-xl bg-[#271f18] px-4 py-3 text-white' href='/workbench'>工作台</Link>
            <Link className='rounded-xl px-4 py-3 hover:bg-[#f0e7d9]' href='/workbench/personal'>个人草稿</Link>
            <Link className='rounded-xl px-4 py-3 hover:bg-[#f0e7d9]' href='/workbench/team'>团队画布</Link>
            <Link className='rounded-xl px-4 py-3 hover:bg-[#f0e7d9]' href='/workbench/showcase'>展示画布</Link>
            <span className='rounded-xl px-4 py-3 text-[#8a7b6d]'>我的任务</span>
            <span className='rounded-xl px-4 py-3 text-[#8a7b6d]'>文件资料</span>
          </nav>
        </aside>

        <section className='space-y-6'>
          <div className='rounded-[2rem] border border-[#e2d8c7] bg-white p-6 shadow-sm'>
            <div className='flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
              <div>
                <p className='text-sm font-medium text-[#9b5b2e]'>当前操作身份</p>
                <h1 className='mt-2 text-3xl font-semibold tracking-tight'>主操作界面</h1>
                {activeWorkgroup && (
                  <p className='mt-3 text-[#6f6256]'>
                    当前项目：{activeWorkgroup.organizationId} · 当前工种：{activeWorkgroup.discipline.name} · 当前团队：{activeWorkgroup.name} · 当前身份：{activeWorkgroup.role === 'admin' ? '团队管理员' : '团队成员'} · 当前 Agent：{activeWorkgroup.discipline.agentCode}
                  </p>
                )}
              </div>
              <select
                className='rounded-xl border border-[#d8cbb8] bg-[#fbf8f2] px-4 py-3 text-sm outline-none'
                value={activeWorkgroupId ?? ''}
                onChange={(event) => {
                  setSelectedWorkgroupId(event.target.value)
                  setActiveWorkgroup.mutate(event.target.value)
                }}
              >
                {data.workgroups.map((item) => (
                  <option key={item.id} value={item.id}>{item.discipline.name} / {item.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className='grid gap-5 md:grid-cols-3'>
            <CanvasCard
              href='/workbench/personal'
              label='Private Draft'
              title='个人草稿画布'
              description='只有你能看到和修改。适合试验节点、准备方案，再复制到团队画布。'
            />
            <CanvasCard
              href='/workbench/team'
              label='Team Live'
              title='团队协作画布'
              description='团队成员共同编辑。右上角展示在线成员头像，成熟方案可发布。'
            />
            <CanvasCard
              href='/workbench/showcase'
              label='Read Only'
              title='展示画布'
              description='查看已发布方案和全局状态树。其他团队可看但不能修改。'
            />
          </div>
        </section>
      </div>
    </main>
  )
}

function CanvasCard({ href, label, title, description }: { href: string; label: string; title: string; description: string }) {
  return (
    <Link href={href} className='group rounded-[1.5rem] border border-[#e2d8c7] bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md'>
      <span className='rounded-full bg-[#e8f0d8] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#53622d]'>{label}</span>
      <h2 className='mt-5 text-2xl font-semibold'>{title}</h2>
      <p className='mt-3 text-sm leading-6 text-[#6f6256]'>{description}</p>
      <div className='mt-6 text-sm font-semibold text-[#9b5b2e] group-hover:text-[#271f18]'>进入 →</div>
    </Link>
  )
}
