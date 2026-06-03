'use client'

import { useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { requestJson } from '@/lib/api/client/request'
import { listMyPendingInvitationsContract } from '@/lib/api/contracts/invitations'
import { getWorkflowStateContract } from '@/lib/api/contracts/workflows'
import { createWorkspaceContract } from '@/lib/api/contracts/workspaces'
import { useSession } from '@/lib/auth/auth-client'
import { WorkspaceRecencyStorage } from '@/lib/core/utils/browser-storage'
import { selectNoWorkspaceRedirect } from '@/app/workspace/no-workspace-redirect'
import { selectCanvasLandingTarget } from '@/app/workspace/canvas-landing-target'
import { getWorkflowRedirectPath } from '@/app/workspace/redirect-workflow'
import { useMyWorkgroups } from '@/hooks/queries/collaboration'
import { useWorkspacesWithMetadata, type WorkspaceCreationPolicy } from '@/hooks/queries/workspace'

const logger = createLogger('WorkspacePage')

export default function WorkspacePage() {
  const router = useRouter()
  const { data: session, isPending: isSessionPending } = useSession()
  const isAuthenticated = !isSessionPending && !!session?.user
  const hasRedirectedRef = useRef(false)

  const { data, isLoading: isWorkspacesLoading } = useWorkspacesWithMetadata(isAuthenticated)
  const { data: workgroupData, isLoading: isWorkgroupsLoading } = useMyWorkgroups(isAuthenticated)

  useEffect(() => {
    if (isSessionPending || hasRedirectedRef.current) return

    if (!session?.user) {
      logger.info('User not authenticated, redirecting to login')
      router.replace('/login')
      return
    }

    if (isWorkspacesLoading || isWorkgroupsLoading || !data || !workgroupData) return

    hasRedirectedRef.current = true

    const urlParams = new URLSearchParams(window.location.search)
    const redirectWorkflowId = urlParams.get('redirect_workflow')

    const { workspaces, lastActiveWorkspaceId, creationPolicy } = data

    if (workspaces.length === 0) {
      handleNoWorkspaces(router, creationPolicy)
      return
    }

    const localRecentId = WorkspaceRecencyStorage.getMostRecent()
    const targetWorkspace = selectCanvasLandingTarget({
      workspaces,
      workgroups: workgroupData.workgroups,
      defaultWorkgroupId: workgroupData.defaultWorkgroupId,
      localRecentWorkspaceId: localRecentId,
      lastActiveWorkspaceId,
    })

    if (!targetWorkspace) {
      handleNoWorkspaces(router, creationPolicy)
      return
    }

    if (redirectWorkflowId) {
      handleWorkflowRedirect(redirectWorkflowId, targetWorkspace.id, router)
      return
    }

    logger.info('Redirecting to canvas inside the original workspace shell', {
      workspaceId: targetWorkspace.id,
      canvasScope: targetWorkspace.canvasScope ?? null,
    })
    router.replace(`/workspace/${targetWorkspace.id}/home`)
  }, [
    session,
    isSessionPending,
    isWorkspacesLoading,
    isWorkgroupsLoading,
    data,
    workgroupData,
    router,
  ])

  if (isSessionPending || isWorkspacesLoading || isWorkgroupsLoading) {
    return (
      <div className='flex h-screen w-full items-center justify-center'>
        <div
          className='h-[18px] w-[18px] animate-spin rounded-full'
          style={{
            background:
              'conic-gradient(from 0deg, hsl(var(--muted-foreground)) 0deg 120deg, transparent 120deg 180deg, hsl(var(--muted-foreground)) 180deg 300deg, transparent 300deg 360deg)',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))',
            WebkitMask:
              'radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))',
          }}
        />
      </div>
    )
  }

  return null
}

async function handleWorkflowRedirect(
  workflowId: string,
  fallbackWorkspaceId: string,
  router: ReturnType<typeof useRouter>
): Promise<void> {
  try {
    const workflowData = await requestJson(getWorkflowStateContract, {
      params: { id: workflowId },
    })
    const redirectPath = getWorkflowRedirectPath({
      workflowId,
      fallbackWorkspaceId,
      workflow: workflowData.data,
    })
    logger.info(`Redirecting workflow ${workflowId} to ${redirectPath}`)
    router.replace(redirectPath)
    return
  } catch (error) {
    logger.error('Error fetching workflow for redirect:', error)
  }
  router.replace(`/workspace/${fallbackWorkspaceId}/home`)
}

async function handleNoWorkspaces(
  router: ReturnType<typeof useRouter>,
  creationPolicy: WorkspaceCreationPolicy | null
): Promise<void> {
  if (creationPolicy && !creationPolicy.canCreate) {
    const pendingInvitations = await listMyPendingInvitations()
    const redirectPath = selectNoWorkspaceRedirect({
      creationPolicy,
      invitations: pendingInvitations,
    })
    logger.warn('No canvases found and canvas creation is blocked', {
      reason: creationPolicy.reason,
      workspaceMode: creationPolicy.workspaceMode,
      organizationId: creationPolicy.organizationId,
      pendingInvitationCount: pendingInvitations.length,
    })
    router.replace(redirectPath ?? '/')
    return
  }

  logger.warn('No canvases found, creating default canvas')
  try {
    const data = await requestJson(createWorkspaceContract, {
      body: { name: 'My Canvas' },
    })
    if (data.workspace?.id) {
      logger.info(`Created default canvas: ${data.workspace.id}`)
      router.replace(`/workspace/${data.workspace.id}/home`)
      return
    }
    logger.error('Failed to create default canvas')
  } catch (error) {
    logger.error('Error creating default canvas:', error)
  }
  router.replace('/login')
}

async function listMyPendingInvitations() {
  try {
    const data = await requestJson(listMyPendingInvitationsContract, {})
    return data.invitations
  } catch (error) {
    logger.warn('Failed to load pending invitations during no-canvas redirect', { error })
    return []
  }
}
