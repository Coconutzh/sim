'use client'

import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { WorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-context'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import {
  useWorkspacePermissionsQuery,
  useWorkspacesWithMetadata,
  type WorkspacePermissions,
  workspaceKeys,
} from '@/hooks/queries/workspace'
import { useUserPermissions, type WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import { useNotificationStore } from '@/stores/notifications'
import { useOperationQueueStore } from '@/stores/operation-queue/store'

const logger = createLogger('WorkspacePermissionsProvider')

interface WorkspacePermissionsProviderProps {
  children: React.ReactNode
}

/**
 * Provides workspace permissions and connection-aware user access throughout the app.
 * Enforces read-only mode when offline to prevent data loss.
 */
export function WorkspacePermissionsProvider({ children }: WorkspacePermissionsProviderProps) {
  return <WorkspacePermissionsProviderInner>{children}</WorkspacePermissionsProviderInner>
}

function WorkspacePermissionsProviderInner({ children }: WorkspacePermissionsProviderProps) {
  const params = useParams()
  const workspaceId = params?.workspaceId as string
  const queryClient = useQueryClient()

  const [hasShownOfflineNotification, setHasShownOfflineNotification] = useState(false)
  const hasOperationError = useOperationQueueStore((state) => state.hasOperationError)
  const addNotification = useNotificationStore((state) => state.addNotification)
  const removeNotification = useNotificationStore((state) => state.removeNotification)
  const { isReconnecting, isRetryingWorkflowJoin } = useSocket()
  const realtimeStatusNotificationIdRef = useRef<string | null>(null)
  const realtimeStatusNotificationMessageRef = useRef<string | null>(null)
  const { data: workspacesMetadata, isLoading: workspacesLoading } = useWorkspacesWithMetadata()
  const currentWorkspace = useMemo(
    () => workspacesMetadata?.workspaces.find((workspace) => workspace.id === workspaceId) ?? null,
    [workspacesMetadata, workspaceId]
  )
  const hasResolvedCurrentWorkspace = Boolean(currentWorkspace)
  const isPersonalCanvas = currentWorkspace?.workspaceMode === 'personal'

  const isOfflineMode = hasOperationError
  const realtimeStatusMessage = isReconnecting
    ? 'Reconnecting...'
    : isRetryingWorkflowJoin
      ? 'Joining workflow...'
      : null

  const clearRealtimeStatusNotification = useCallback(() => {
    if (!realtimeStatusNotificationIdRef.current) {
      return
    }

    removeNotification(realtimeStatusNotificationIdRef.current)
    realtimeStatusNotificationIdRef.current = null
    realtimeStatusNotificationMessageRef.current = null
  }, [removeNotification])

  useEffect(() => {
    if (isOfflineMode || !realtimeStatusMessage) {
      clearRealtimeStatusNotification()
      return
    }

    if (
      realtimeStatusNotificationIdRef.current &&
      realtimeStatusNotificationMessageRef.current === realtimeStatusMessage
    ) {
      return
    }

    clearRealtimeStatusNotification()

    const id = addNotification({
      level: 'error',
      message: realtimeStatusMessage,
    })

    realtimeStatusNotificationIdRef.current = id
    realtimeStatusNotificationMessageRef.current = realtimeStatusMessage
  }, [addNotification, clearRealtimeStatusNotification, isOfflineMode, realtimeStatusMessage])

  useEffect(() => {
    return clearRealtimeStatusNotification
  }, [clearRealtimeStatusNotification])

  useEffect(() => {
    if (!isOfflineMode || hasShownOfflineNotification) {
      return
    }

    clearRealtimeStatusNotification()

    try {
      addNotification({
        level: 'error',
        message: 'Connection unavailable',
        action: {
          type: 'refresh',
          message: '',
        },
      })
      setHasShownOfflineNotification(true)
    } catch (error) {
      logger.error('Failed to add offline notification', { error })
    }
  }, [addNotification, clearRealtimeStatusNotification, hasShownOfflineNotification, isOfflineMode])

  const {
    data: sharedWorkspacePermissions,
    isLoading: sharedPermissionsLoading,
    error: permissionsErrorObj,
    refetch,
  } = useWorkspacePermissionsQuery(workspaceId, hasResolvedCurrentWorkspace && !isPersonalCanvas)

  const personalCanvasPermissions = useMemo<WorkspacePermissions | null>(() => {
    if (!isPersonalCanvas || !currentWorkspace) return null
    const permissionType = currentWorkspace.permissions ?? 'admin'
    return {
      users: [],
      total: 1,
      viewer: {
        userId: currentWorkspace.ownerId,
        isAdmin: permissionType === 'admin',
        permissionType,
      },
    }
  }, [currentWorkspace, isPersonalCanvas])

  const workspacePermissions = personalCanvasPermissions ?? sharedWorkspacePermissions ?? null
  const permissionsLoading = isPersonalCanvas
    ? workspacesLoading
    : workspacesLoading || sharedPermissionsLoading

  const permissionsError = personalCanvasPermissions ? null : (permissionsErrorObj?.message ?? null)

  const updatePermissions = useCallback(
    (newPermissions: WorkspacePermissions) => {
      if (!workspaceId) return
      queryClient.setQueryData(workspaceKeys.permissions(workspaceId), newPermissions)
    },
    [workspaceId, queryClient]
  )

  const refetchPermissions = useCallback(async () => {
    await refetch()
  }, [refetch])

  const baseUserPermissions = useUserPermissions(
    workspacePermissions ?? null,
    permissionsLoading,
    permissionsError
  )

  const userPermissions = useMemo((): WorkspaceUserPermissions & { isOfflineMode?: boolean } => {
    if (isOfflineMode) {
      return {
        ...baseUserPermissions,
        canEdit: false,
        canAdmin: false,
        canRead: baseUserPermissions.canRead,
        isOfflineMode: true,
      }
    }

    return {
      ...baseUserPermissions,
      isOfflineMode: false,
    }
  }, [baseUserPermissions, isOfflineMode])

  const contextValue = useMemo(
    () => ({
      workspacePermissions: workspacePermissions ?? null,
      permissionsLoading,
      permissionsError,
      updatePermissions,
      refetchPermissions,
      userPermissions,
    }),
    [
      workspacePermissions,
      permissionsLoading,
      permissionsError,
      updatePermissions,
      refetchPermissions,
      userPermissions,
    ]
  )

  return (
    <WorkspacePermissionsContext.Provider value={contextValue}>
      {children}
    </WorkspacePermissionsContext.Provider>
  )
}

export {
  SandboxWorkspacePermissionsProvider,
  useUserPermissionsContext,
  useWorkspacePermissionsContext,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-context'
