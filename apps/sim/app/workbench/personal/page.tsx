'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useMyWorkgroups, usePersonalWorkspace } from '@/hooks/queries/collaboration'
import { useSession } from '@/lib/auth/auth-client'

export default function PersonalWorkbenchPage() {
  const router = useRouter()
  const { data: session, isPending } = useSession()
  const { data: workgroupData } = useMyWorkgroups(Boolean(session?.user))
  const workgroupId = workgroupData?.defaultWorkgroupId ?? workgroupData?.workgroups[0]?.id
  const { data: workspaceData, isLoading } = usePersonalWorkspace(workgroupId)

  useEffect(() => {
    if (workspaceData?.workspace.id) {
      router.replace(`/workspace/${workspaceData.workspace.id}/home`)
    }
  }, [router, workspaceData?.workspace.id])

  if (isPending || isLoading) {
    return <div className='flex min-h-screen items-center justify-center text-muted-foreground'>正在打开个人草稿画布...</div>
  }

  return <div className='flex min-h-screen items-center justify-center'>无法打开个人草稿画布，请确认你已加入团队。</div>
}
