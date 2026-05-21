'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { usePublication, usePublicationTree } from '@/hooks/queries/collaboration'

export default function ShowcasePublicationPage() {
  const params = useParams<{ publicationVersionId: string }>()
  const publicationVersionId = params.publicationVersionId
  const { data, isLoading } = usePublication(publicationVersionId)
  const { data: tree } = usePublicationTree(publicationVersionId)

  if (isLoading) {
    return <div className='flex min-h-screen items-center justify-center text-muted-foreground'>正在加载展示方案...</div>
  }

  if (!data?.publication) {
    return <div className='flex min-h-screen items-center justify-center'>展示方案不存在或你没有查看权限。</div>
  }

  const blocks = countRecordItems(data.publication.snapshotState, 'blocks')
  const edges = countArrayItems(data.publication.snapshotState, 'edges')

  return (
    <main className='min-h-screen bg-[#f7f4ed] px-6 py-8 text-[#271f18]'>
      <section className='mx-auto grid max-w-7xl gap-5 lg:grid-cols-[1fr_320px]'>
        <div className='space-y-5'>
          <div className='rounded-[2rem] border border-[#e2d8c7] bg-white p-6 shadow-sm'>
            <Link href='/workbench/showcase' className='text-sm font-semibold text-[#9b5b2e]'>返回展示列表</Link>
            <h1 className='mt-3 text-3xl font-semibold tracking-tight'>{data.publication.title}</h1>
            <p className='mt-3 text-[#6f6256]'>
              {data.publication.sourceDiscipline.name} · {data.publication.sourceWorkgroup.name} · {data.publication.agentCode} · v{data.publication.versionNumber}
            </p>
          </div>
          <div className='min-h-[560px] rounded-[2rem] border border-[#e2d8c7] bg-[#fbf8f2] p-6 shadow-sm'>
            <div className='rounded-2xl border border-dashed border-[#cdbfaa] bg-white p-8'>
              <p className='text-sm font-semibold text-[#9b5b2e]'>只读展示画布</p>
              <h2 className='mt-3 text-2xl font-semibold'>Snapshot 已加载</h2>
              <p className='mt-3 text-[#6f6256]'>当前 v1 使用只读 snapshot 容器承载展示数据，不加入 realtime，不显示保存、运行、部署入口。</p>
              <div className='mt-6 grid gap-3 md:grid-cols-2'>
                <Metric label='节点数' value={String(blocks)} />
                <Metric label='连线数' value={String(edges)} />
              </div>
              <pre className='mt-6 max-h-[320px] overflow-auto rounded-xl bg-[#271f18] p-4 text-xs text-[#f7f4ed]'>
                {JSON.stringify(data.publication.snapshotState, null, 2)}
              </pre>
            </div>
          </div>
        </div>
        <aside className='rounded-[2rem] border border-[#e2d8c7] bg-white p-5 shadow-sm'>
          <h2 className='text-lg font-semibold'>版本树</h2>
          <div className='mt-4 space-y-3'>
            {(tree?.versions ?? []).map((version) => (
              <Link key={version.id} href={`/workbench/showcase/${version.id}`} className='block rounded-xl border border-[#eee4d6] p-3 hover:bg-[#f7f4ed]'>
                <div className='font-medium'>v{version.versionNumber} · {version.title}</div>
                <div className='mt-1 text-xs text-[#6f6256]'>{new Date(version.publishedAt).toLocaleString()}</div>
              </Link>
            ))}
          </div>
        </aside>
      </section>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-xl bg-[#f7f4ed] p-4'>
      <div className='text-sm text-[#6f6256]'>{label}</div>
      <div className='mt-2 text-2xl font-semibold'>{value}</div>
    </div>
  )
}

function countRecordItems(value: unknown, key: string): number {
  if (!value || typeof value !== 'object' || !(key in value)) return 0
  const candidate = (value as Record<string, unknown>)[key]
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return 0
  return Object.keys(candidate).length
}

function countArrayItems(value: unknown, key: string): number {
  if (!value || typeof value !== 'object' || !(key in value)) return 0
  const candidate = (value as Record<string, unknown>)[key]
  return Array.isArray(candidate) ? candidate.length : 0
}
