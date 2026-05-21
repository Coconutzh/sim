'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { CanvasModeHeader } from '@/components/workbench/canvas-mode-header'
import { WorkbenchShell } from '@/components/workbench/workbench-shell'
import { useSession } from '@/lib/auth/auth-client'
import { useMyWorkgroups, usePublication, usePublicationTree } from '@/hooks/queries/collaboration'

export default function ShowcasePublicationPage() {
  const params = useParams<{ publicationVersionId: string }>()
  const publicationVersionId = params.publicationVersionId
  const { data: session } = useSession()
  const { data: workgroupData } = useMyWorkgroups(Boolean(session?.user))
  const activeWorkgroupId =
    workgroupData?.defaultWorkgroupId ?? workgroupData?.workgroups[0]?.id ?? null
  const activeWorkgroup =
    workgroupData?.workgroups.find((item) => item.id === activeWorkgroupId) ?? null
  const { data, isLoading } = usePublication(publicationVersionId)
  const { data: tree } = usePublicationTree(publicationVersionId)

  if (isLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center text-muted-foreground'>
        正在加载展示方案...
      </div>
    )
  }

  if (!data?.publication) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        展示方案不存在或你没有查看权限。
      </div>
    )
  }

  const blocks = countRecordItems(data.publication.snapshotState, 'blocks')
  const edges = countArrayItems(data.publication.snapshotState, 'edges')
  const shellWorkgroup = activeWorkgroup ?? {
    id: data.publication.sourceWorkgroup.id,
    name: data.publication.sourceWorkgroup.name,
    organizationId: '',
    discipline: {
      id: '',
      code: data.publication.sourceDiscipline.code,
      name: data.publication.sourceDiscipline.name,
      agentCode: data.publication.agentCode,
    },
    role: 'member' as const,
    teamWorkspaceId: '',
    memberCount: 0,
  }

  return (
    <WorkbenchShell
      activeNav='showcase'
      activeWorkgroup={shellWorkgroup}
      activeWorkgroupId={activeWorkgroupId}
      workgroups={workgroupData?.workgroups ?? []}
    >
      <section className='grid gap-5 lg:grid-cols-[1fr_320px]'>
        <div className='space-y-5'>
          <CanvasModeHeader
            agentName={data.publication.agentCode}
            canvasMode='showcase'
            disciplineName={data.publication.sourceDiscipline.name}
            organizationName={shellWorkgroup.organizationId || '当前项目'}
            permissionText='只读发布版本：不显示保存、运行、部署入口，不加入实时编辑房间。'
            userRole='只读查看'
            versionText={`v${data.publication.versionNumber}`}
            visibilityText='这是团队发布后的展示快照，不会随源团队画布后续修改自动变化。'
            workgroupName={data.publication.sourceWorkgroup.name}
            actions={
              <Link
                className='rounded-xl border border-[#d8cbb8] px-5 py-3 text-sm font-semibold text-[#9b5b2e]'
                href='/workbench/showcase'
              >
                返回展示列表
              </Link>
            }
          />

          <div className='min-h-[560px] rounded-[2rem] border border-[#e2d8c7] bg-[#fbf8f2] p-6 shadow-sm'>
            <div className='rounded-2xl border border-dashed border-[#cdbfaa] bg-white p-8'>
              <p className='text-sm font-semibold text-[#9b5b2e]'>只读展示画布</p>
              <h2 className='mt-3 text-2xl font-semibold'>{data.publication.title}</h2>
              <p className='mt-3 text-[#6f6256]'>
                当前 v1 使用只读 snapshot 容器承载展示数据，不加入
                realtime，不显示保存、运行、部署入口。
              </p>
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
              <Link
                className='block rounded-xl border border-[#eee4d6] p-3 hover:bg-[#f7f4ed]'
                href={`/workbench/showcase/${version.id}`}
                key={version.id}
              >
                <div className='font-medium'>
                  v{version.versionNumber} · {version.title}
                </div>
                <div className='mt-1 text-xs text-[#6f6256]'>
                  {new Date(version.publishedAt).toLocaleString()}
                </div>
              </Link>
            ))}
          </div>
        </aside>
      </section>
    </WorkbenchShell>
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
