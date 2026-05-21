'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CanvasModeHeader } from '@/components/workbench/canvas-mode-header'
import { WorkbenchShell } from '@/components/workbench/workbench-shell'
import { WorkbenchStatusCard } from '@/components/workbench/workbench-status-card'
import { useSession } from '@/lib/auth/auth-client'
import { getWorkbenchAccessIssue } from '@/lib/workbench/access-errors'
import {
  useMyWorkgroups,
  usePersonalWorkspace,
  useSetActiveWorkgroup,
} from '@/hooks/queries/collaboration'

export default function PersonalWorkbenchPage() {
  const { data: session, isPending } = useSession()
  const {
    data: workgroupData,
    error: workgroupError,
    isLoading: isWorkgroupLoading,
  } = useMyWorkgroups(Boolean(session?.user))
  const setActiveWorkgroup = useSetActiveWorkgroup()
  const [selectedWorkgroupId, setSelectedWorkgroupId] = useState<string | null>(null)
  const workgroupId =
    selectedWorkgroupId ?? workgroupData?.defaultWorkgroupId ?? workgroupData?.workgroups[0]?.id
  const activeWorkgroup = useMemo(
    () => workgroupData?.workgroups.find((item) => item.id === workgroupId) ?? null,
    [workgroupData?.workgroups, workgroupId]
  )
  const {
    data: workspaceData,
    error: workspaceError,
    isLoading,
  } = usePersonalWorkspace(workgroupId)

  if (isPending || isWorkgroupLoading || isLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center text-muted-foreground'>
        正在准备个人草稿画布...
      </div>
    )
  }

  const accessIssue = getWorkbenchAccessIssue(workgroupError ?? workspaceError)
  if (accessIssue) {
    return <WorkbenchStatusCard {...accessIssue} />
  }

  if (!activeWorkgroup || !workspaceData?.workspace.id) {
    return (
      <WorkbenchStatusCard
        actionHref='/workbench'
        actionLabel='返回工作台切换团队'
        message='你的 active workgroup 可能已失效，或个人草稿画布不再对当前账号可见。请返回工作台切换团队后重试。'
        title='当前团队或画布不可用'
      />
    )
  }

  return (
    <WorkbenchShell
      activeNav='personal'
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
        canvasMode='personal'
        disciplineName={activeWorkgroup.discipline.name}
        organizationName={activeWorkgroup.organizationId}
        permissionText='你可以编辑个人草稿，并主动把成熟节点复制到团队画布；管理员默认不可查看。'
        userRole={activeWorkgroup.role === 'admin' ? '团队管理员' : '团队成员'}
        visibilityText='仅你可见，其他团队成员、团队管理员和项目管理员默认不可见。'
        workgroupName={activeWorkgroup.name}
        actions={
          <>
            <Link
              className='rounded-xl bg-[#271f18] px-5 py-3 text-sm font-semibold text-white'
              href={`/workspace/${workspaceData.workspace.id}/home`}
            >
              打开个人草稿
            </Link>
            <Link
              className='rounded-xl border border-[#d8cbb8] px-5 py-3 text-sm font-semibold text-[#9b5b2e]'
              href='/workbench/team'
            >
              复制到团队画布
            </Link>
          </>
        }
      />
    </WorkbenchShell>
  )
}
