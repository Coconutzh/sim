'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { CanvasModeHeader } from '@/components/workbench/canvas-mode-header'
import { ShowcaseReadOnlyCanvas } from '@/components/workbench/showcase-readonly-canvas'
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
                className='rounded-xl border border-[#d8cbb8] px-5 py-3 font-semibold text-[#9b5b2e] text-sm'
                href='/workbench/showcase'
              >
                返回展示列表
              </Link>
            }
          />

          <ShowcaseReadOnlyCanvas
            description={data.publication.description}
            snapshotState={data.publication.snapshotState}
            title={data.publication.title}
            versionLabel={`v${data.publication.versionNumber}`}
          />
        </div>
        <aside className='rounded-[2rem] border border-[#e2d8c7] bg-white p-5 shadow-sm'>
          <h2 className='font-semibold text-lg'>版本树</h2>
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
                <div className='mt-1 text-[#6f6256] text-xs'>
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
