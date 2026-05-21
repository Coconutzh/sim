'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CanvasModeHeader } from '@/components/workbench/canvas-mode-header'
import { WorkbenchShell } from '@/components/workbench/workbench-shell'
import { useSession } from '@/lib/auth/auth-client'
import {
  useMyWorkgroups,
  useSetActiveWorkgroup,
  useTeamWorkspace,
} from '@/hooks/queries/collaboration'

export default function TeamWorkbenchPage() {
  const { data: session, isPending } = useSession()
  const { data: workgroupData, isLoading: isWorkgroupLoading } = useMyWorkgroups(
    Boolean(session?.user)
  )
  const setActiveWorkgroup = useSetActiveWorkgroup()
  const [selectedWorkgroupId, setSelectedWorkgroupId] = useState<string | null>(null)
  const workgroupId =
    selectedWorkgroupId ?? workgroupData?.defaultWorkgroupId ?? workgroupData?.workgroups[0]?.id
  const activeWorkgroup = useMemo(
    () => workgroupData?.workgroups.find((item) => item.id === workgroupId) ?? null,
    [workgroupData?.workgroups, workgroupId]
  )
  const { data: workspaceData, isLoading } = useTeamWorkspace(workgroupId)

  if (isPending || isWorkgroupLoading || isLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center text-muted-foreground'>
        正在准备团队画布...
      </div>
    )
  }

  if (!activeWorkgroup || !workspaceData?.workspace.id) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        请先加入团队后打开团队画布。
      </div>
    )
  }

  return (
    <WorkbenchShell
      activeNav='team'
      activeWorkgroup={activeWorkgroup}
      activeWorkgroupId={workgroupId ?? null}
      workgroups={workgroupData?.workgroups ?? []}
      onActiveWorkgroupChange={(nextWorkgroupId) => {
        setSelectedWorkgroupId(nextWorkgroupId)
        setActiveWorkgroup.mutate(nextWorkgroupId)
      }}
    >
      <CanvasModeHeader
        agentName={activeWorkgroup.discipline.agentCode}
        canvasMode='team'
        disciplineName={activeWorkgroup.discipline.name}
        organizationName={activeWorkgroup.organizationId}
        permissionText='同团队成员可见可编辑；非团队成员不可见不可编辑。'
        presenceAvatars={[]}
        userRole={activeWorkgroup.role === 'admin' ? '团队管理员' : '团队成员'}
        visibilityText='团队成员共同编辑，右上角只显示同团队同画布在线成员。'
        workgroupName={activeWorkgroup.name}
        actions={
          <>
            <Link
              className='rounded-xl bg-[#271f18] px-5 py-3 text-sm font-semibold text-white'
              href={`/workspace/${workspaceData.workspace.id}/home`}
            >
              进入团队画布
            </Link>
            <button
              className='rounded-xl border border-[#d8cbb8] px-5 py-3 text-sm font-semibold text-[#9b5b2e] disabled:cursor-not-allowed disabled:opacity-50'
              disabled={activeWorkgroup.role !== 'admin'}
              title={
                activeWorkgroup.role === 'admin' ? '发布团队成熟方案' : '只有团队管理员可以发布'
              }
              type='button'
            >
              发布方案
            </button>
            <Link
              className='rounded-xl border border-[#d8cbb8] px-5 py-3 text-sm font-semibold text-[#9b5b2e]'
              href='/workbench/split?left=personal&right=team'
            >
              打开分屏
            </Link>
          </>
        }
      />
    </WorkbenchShell>
  )
}
