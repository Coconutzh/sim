import type React from 'react'
import { InvitationBell } from '@/app/workspace/[workspaceId]/components/invitation-bell'
import { LiteSidebar } from '@/app/workspace/[workspaceId]/lite-sidebar'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { LowMemoryWorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-context'
import { WorkspaceScopeSyncLite } from '@/app/workspace/[workspaceId]/providers/workspace-scope-sync-lite'

interface WorkspaceLayoutProps {
  children: React.ReactNode
  params: Promise<{
    workspaceId: string
  }>
}

export default async function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  if (process.env.SIM_LOW_MEMORY_DEV !== 'true') {
    const { WorkspaceFullLayout } = await import(
      '@/app/workspace/[workspaceId]/workspace-full-layout'
    )
    return <WorkspaceFullLayout params={params}>{children}</WorkspaceFullLayout>
  }

  const { workspaceId } = await params

  return (
    <GlobalCommandsProvider>
      <LowMemoryWorkspacePermissionsProvider>
        <WorkspaceScopeSyncLite />
        <div className='flex h-screen w-full flex-col overflow-hidden bg-[var(--surface-1)]'>
          <InvitationBell />
          <div className='flex min-h-0 flex-1'>
            <div className='shrink-0' suppressHydrationWarning>
              <LiteSidebar workspaceId={workspaceId} />
            </div>
            <div className='flex min-w-0 flex-1 flex-col p-[8px] pl-0'>
              <div className='flex-1 overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--bg)]'>
                {children}
              </div>
            </div>
          </div>
        </div>
      </LowMemoryWorkspacePermissionsProvider>
    </GlobalCommandsProvider>
  )
}
