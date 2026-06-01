import type React from 'react'
import { redirect } from 'next/navigation'
import { ToastProvider } from '@/components/emcn'
import { getSession } from '@/lib/auth'
import { InvitationBell } from '@/app/workspace/[workspaceId]/components/invitation-bell'
import { ImpersonationBanner } from '@/app/workspace/[workspaceId]/impersonation-banner'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { ProviderModelsLoader } from '@/app/workspace/[workspaceId]/providers/provider-models-loader'
import { SettingsLoader } from '@/app/workspace/[workspaceId]/providers/settings-loader'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { WorkspaceScopeSync } from '@/app/workspace/[workspaceId]/providers/workspace-scope-sync'
import { BrandingProvider } from '@/ee/whitelabeling/components/branding-provider'
import { getOrgWhitelabelSettings } from '@/ee/whitelabeling/org-branding'

interface WorkspaceFullLayoutProps {
  children: React.ReactNode
  params: Promise<{
    workspaceId: string
  }>
}

export async function WorkspaceFullLayout({ children, params }: WorkspaceFullLayoutProps) {
  const { workspaceId } = await params
  const session = await getSession()
  if (!session?.user) {
    redirect('/login')
  }
  const orgId = (session.session as { activeOrganizationId?: string } | null)?.activeOrganizationId
  const initialOrgSettings = orgId ? await getOrgWhitelabelSettings(orgId) : null
  const { Sidebar } = await import('@/app/workspace/[workspaceId]/w/components/sidebar/sidebar')

  return (
    <BrandingProvider initialOrgSettings={initialOrgSettings}>
      <ToastProvider>
        <SettingsLoader />
        <ProviderModelsLoader />
        <GlobalCommandsProvider>
          <div className='flex h-screen w-full flex-col overflow-hidden bg-[var(--surface-1)]'>
            <ImpersonationBanner />
            <WorkspacePermissionsProvider>
              <WorkspaceScopeSync />
              <InvitationBell />
              <div className='flex min-h-0 flex-1'>
                <div className='shrink-0' suppressHydrationWarning>
                  <Sidebar />
                </div>
                <div className='flex min-w-0 flex-1 flex-col p-[8px] pl-0'>
                  <div className='flex-1 overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--bg)]'>
                    {children}
                  </div>
                </div>
              </div>
            </WorkspacePermissionsProvider>
          </div>
        </GlobalCommandsProvider>
      </ToastProvider>
    </BrandingProvider>
  )
}
