'use client'

import Link from 'next/link'
import { useMyWorkgroups, useShowcasePublications } from '@/hooks/queries/collaboration'
import { useSession } from '@/lib/auth/auth-client'

export default function ShowcaseWorkbenchPage() {
  const { data: session, isPending } = useSession()
  const { data: workgroupData, isLoading: isWorkgroupLoading } = useMyWorkgroups(Boolean(session?.user))
  const workgroupId = workgroupData?.defaultWorkgroupId ?? workgroupData?.workgroups[0]?.id
  const { data, isLoading } = useShowcasePublications(workgroupId)

  if (isPending || isWorkgroupLoading || isLoading) {
    return <div className='flex min-h-screen items-center justify-center text-muted-foreground'>正在加载展示画布...</div>
  }

  if (!workgroupId) {
    return <div className='flex min-h-screen items-center justify-center'>请先加入团队后查看展示画布。</div>
  }

  return (
    <main className='min-h-screen bg-[#f7f4ed] px-6 py-8 text-[#271f18]'>
      <section className='mx-auto max-w-5xl space-y-5'>
        <div className='rounded-[2rem] border border-[#e2d8c7] bg-white p-6 shadow-sm'>
          <p className='text-sm font-medium text-[#9b5b2e]'>Showcase Canvas</p>
          <h1 className='mt-2 text-3xl font-semibold tracking-tight'>展示画布</h1>
          <p className='mt-3 text-[#6f6256]'>这里显示已发布方案。展示画布为只读，不能保存、运行或加入实时编辑房间。</p>
        </div>
        <div className='grid gap-4'>
          {(data?.publications ?? []).map((item) => (
            <Link key={item.id} href={`/workbench/showcase/${item.id}`} className='rounded-2xl border border-[#e2d8c7] bg-white p-5 shadow-sm transition hover:shadow-md'>
              <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
                <div>
                  <h2 className='text-xl font-semibold'>{item.title}</h2>
                  <p className='mt-2 text-sm text-[#6f6256]'>{item.sourceDiscipline.name} · {item.sourceWorkgroup.name} · v{item.versionNumber}</p>
                </div>
                <span className='text-sm text-[#9b5b2e]'>{new Date(item.publishedAt).toLocaleString()}</span>
              </div>
            </Link>
          ))}
          {data?.publications.length === 0 && (
            <div className='rounded-2xl border border-dashed border-[#d8cbb8] bg-white p-8 text-center text-[#6f6256]'>暂无可见发布方案。</div>
          )}
        </div>
      </section>
    </main>
  )
}
