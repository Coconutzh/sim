'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { WorkbenchShell } from '@/components/workbench/workbench-shell'
import { WorkbenchStatusCard } from '@/components/workbench/workbench-status-card'
import { useSession } from '@/lib/auth/auth-client'
import { getWorkbenchAccessIssue } from '@/lib/workbench/access-errors'
import { useMyWorkgroups, useSetActiveWorkgroup } from '@/hooks/queries/collaboration'

export default function WorkbenchPage() {
  const { data: session, isPending } = useSession()
  const { data, error, isLoading } = useMyWorkgroups(Boolean(session?.user))
  const setActiveWorkgroup = useSetActiveWorkgroup()
  const [selectedWorkgroupId, setSelectedWorkgroupId] = useState<string | null>(null)

  const activeWorkgroupId =
    selectedWorkgroupId ?? data?.defaultWorkgroupId ?? data?.workgroups[0]?.id ?? null
  const activeWorkgroup = useMemo(
    () => data?.workgroups.find((item) => item.id === activeWorkgroupId) ?? null,
    [activeWorkgroupId, data?.workgroups]
  )

  if (isPending || isLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center text-muted-foreground'>
        加载工作台...
      </div>
    )
  }

  if (!session?.user) {
    return <div className='flex min-h-screen items-center justify-center'>请先登录。</div>
  }

  const accessIssue = getWorkbenchAccessIssue(error)
  if (accessIssue) {
    return <WorkbenchStatusCard {...accessIssue} />
  }

  if (!data?.workgroups.length) {
    return (
      <main className='min-h-screen bg-[#f7f4ed] px-6 py-10'>
        <section className='mx-auto max-w-3xl rounded-[2rem] border border-[#e2d8c7] bg-white p-10 shadow-sm'>
          <p className='text-sm font-medium text-[#9b5b2e]'>等待分配</p>
          <h1 className='mt-3 text-3xl font-semibold tracking-tight text-[#271f18]'>
            你还没有加入任何工种团队
          </h1>
          <p className='mt-4 text-[#6f6256]'>
            请联系项目管理员把你加入指定工种下的团队。普通员工不能自行创建 workspace。
          </p>
          <div className='mt-6 rounded-2xl bg-[#fbf8f2] p-4 text-sm text-[#6f6256]'>
            项目管理员后续将在项目管理中心完成工种、团队和成员分配。
          </div>
        </section>
      </main>
    )
  }

  return (
    <WorkbenchShell
      activeNav='home'
      activeWorkgroup={activeWorkgroup}
      activeWorkgroupId={activeWorkgroupId}
      workgroups={data.workgroups}
      onActiveWorkgroupChange={(workgroupId) => {
        setSelectedWorkgroupId(workgroupId)
        setActiveWorkgroup.mutate(workgroupId)
      }}
    >
      <div className='grid gap-5 md:grid-cols-3'>
        <CanvasCard
          description='仅自己可见，用于个人构思、试验节点、准备提交给团队的方案。'
          href='/workbench/personal'
          label='仅自己可见'
          title='个人草稿画布'
        />
        <CanvasCard
          description='团队成员实时协作，成熟方案可发布到展示画布。'
          href='/workbench/team'
          label='团队共同编辑'
          title='团队画布'
        />
        <CanvasCard
          description='查看各团队已发布方案和全局状态树，跨团队只读查看。'
          href='/workbench/showcase'
          label='跨团队只读'
          title='展示画布'
        />
      </div>

      <div className='grid gap-5 lg:grid-cols-[1.2fr_0.8fr]'>
        <section className='rounded-[1.5rem] border border-[#e2d8c7] bg-white p-6 shadow-sm'>
          <p className='text-sm font-medium text-[#9b5b2e]'>当前 Agent 建议</p>
          <h2 className='mt-3 text-2xl font-semibold'>围绕当前工种推进协作</h2>
          <p className='mt-3 text-sm leading-6 text-[#6f6256]'>
            Copilot 将根据 active workgroup 的工种映射到对应 Agent；PMO 工种映射到 chief_director
            Agent。
          </p>
        </section>
        {activeWorkgroup?.role === 'admin' && (
          <Link
            className='rounded-[1.5rem] border border-[#e2d8c7] bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md'
            href='/workbench/team-management'
          >
            <p className='text-sm font-medium text-[#9b5b2e]'>团队管理员</p>
            <h2 className='mt-3 text-2xl font-semibold'>团队管理入口</h2>
            <p className='mt-3 text-sm leading-6 text-[#6f6256]'>
              管理成员、团队画布状态、发布准备和团队 Agent Skill 设置。
            </p>
          </Link>
        )}
      </div>
    </WorkbenchShell>
  )
}

function CanvasCard({
  href,
  label,
  title,
  description,
}: {
  href: string
  label: string
  title: string
  description: string
}) {
  return (
    <Link
      className='group rounded-[1.5rem] border border-[#e2d8c7] bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md'
      href={href}
    >
      <span className='rounded-full bg-[#e8f0d8] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#53622d]'>
        {label}
      </span>
      <h2 className='mt-5 text-2xl font-semibold'>{title}</h2>
      <p className='mt-3 text-sm leading-6 text-[#6f6256]'>{description}</p>
      <div className='mt-6 text-sm font-semibold text-[#9b5b2e] group-hover:text-[#271f18]'>
        进入
      </div>
    </Link>
  )
}
