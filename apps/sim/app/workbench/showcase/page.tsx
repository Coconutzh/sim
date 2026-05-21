'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CanvasModeHeader } from '@/components/workbench/canvas-mode-header'
import { WorkbenchShell } from '@/components/workbench/workbench-shell'
import { WorkbenchStatusCard } from '@/components/workbench/workbench-status-card'
import { useSession } from '@/lib/auth/auth-client'
import { getWorkbenchAccessIssue } from '@/lib/workbench/access-errors'
import {
  useDisciplines,
  useMyWorkgroups,
  useSetActiveWorkgroup,
  useShowcasePublications,
} from '@/hooks/queries/collaboration'

export default function ShowcaseWorkbenchPage() {
  const { data: session, isPending } = useSession()
  const {
    data: workgroupData,
    error: workgroupError,
    isLoading: isWorkgroupLoading,
  } = useMyWorkgroups(Boolean(session?.user))
  const { data: disciplinesData } = useDisciplines()
  const setActiveWorkgroup = useSetActiveWorkgroup()
  const [selectedWorkgroupId, setSelectedWorkgroupId] = useState<string | null>(null)
  const [disciplineCode, setDisciplineCode] = useState<string>('')
  const workgroupId =
    selectedWorkgroupId ?? workgroupData?.defaultWorkgroupId ?? workgroupData?.workgroups[0]?.id
  const activeWorkgroup = useMemo(
    () => workgroupData?.workgroups.find((item) => item.id === workgroupId) ?? null,
    [workgroupData?.workgroups, workgroupId]
  )
  const {
    data,
    error: publicationsError,
    isLoading,
  } = useShowcasePublications(workgroupId, disciplineCode ? { disciplineCode } : undefined)

  if (isPending || isWorkgroupLoading || isLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center text-muted-foreground'>
        正在加载展示画布...
      </div>
    )
  }

  const accessIssue = getWorkbenchAccessIssue(workgroupError ?? publicationsError)
  if (accessIssue) {
    return <WorkbenchStatusCard {...accessIssue} />
  }

  if (!activeWorkgroup || !workgroupId) {
    return (
      <WorkbenchStatusCard
        actionHref='/workbench'
        actionLabel='返回工作台切换团队'
        message='你的 active workgroup 可能已失效，或展示画布对当前团队不可用。请返回工作台切换团队后重试。'
        title='当前团队或画布不可用'
      />
    )
  }

  return (
    <WorkbenchShell
      activeNav='showcase'
      activeWorkgroup={activeWorkgroup}
      activeWorkgroupId={workgroupId}
      workgroups={workgroupData?.workgroups ?? []}
      onActiveWorkgroupChange={(nextWorkgroupId) => {
        setSelectedWorkgroupId(nextWorkgroupId)
        setActiveWorkgroup.mutate(nextWorkgroupId)
      }}
    >
      <CanvasModeHeader
        agentName={activeWorkgroup.discipline.agentCode}
        canvasMode='showcase'
        disciplineName={activeWorkgroup.discipline.name}
        organizationName={activeWorkgroup.organizationId}
        permissionText='展示画布只读查看，不能保存、运行、部署或加入实时编辑房间。'
        userRole={activeWorkgroup.role === 'admin' ? '团队管理员' : '团队成员'}
        visibilityText='查看已发布方案和全局状态树；其他被授权团队可查看但不能修改。'
        workgroupName={activeWorkgroup.name}
      />

      <section className='rounded-[1.5rem] border border-[#e2d8c7] bg-white p-5 shadow-sm'>
        <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
          <div>
            <h2 className='text-xl font-semibold'>展示方案列表</h2>
            <p className='mt-2 text-sm text-[#6f6256]'>按工种筛选当前团队有权限查看的发布版本。</p>
          </div>
          <select
            className='rounded-xl border border-[#d8cbb8] bg-[#fbf8f2] px-4 py-3 text-sm outline-none'
            value={disciplineCode}
            onChange={(event) => setDisciplineCode(event.target.value)}
          >
            <option value=''>全部工种</option>
            {(disciplinesData?.disciplines ?? []).map((discipline) => (
              <option key={discipline.code} value={discipline.code}>
                {discipline.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <div className='grid gap-4'>
        {(data?.publications ?? []).map((item) => (
          <Link
            className='rounded-2xl border border-[#e2d8c7] bg-white p-5 shadow-sm transition hover:shadow-md'
            href={`/workbench/showcase/${item.id}`}
            key={item.id}
          >
            <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
              <div>
                <h2 className='text-xl font-semibold'>{item.title}</h2>
                <p className='mt-2 text-sm text-[#6f6256]'>
                  {item.sourceDiscipline.name} · {item.sourceWorkgroup.name} · v{item.versionNumber}
                </p>
              </div>
              <span className='text-sm text-[#9b5b2e]'>
                {new Date(item.publishedAt).toLocaleString()}
              </span>
            </div>
          </Link>
        ))}
        {data?.publications.length === 0 && (
          <div className='rounded-2xl border border-dashed border-[#d8cbb8] bg-white p-8 text-center text-[#6f6256]'>
            还没有可见的展示方案。当团队发布成熟方案后，会在这里显示。
          </div>
        )}
      </div>
    </WorkbenchShell>
  )
}
