'use client'

import type React from 'react'
import { createContext, useContext, useMemo } from 'react'
import type { WorkspacePermissions } from '@/hooks/queries/workspace'
import type { WorkspaceUserPermissions } from '@/hooks/use-user-permissions'

export interface WorkspacePermissionsContextType {
  workspacePermissions: WorkspacePermissions | null
  permissionsLoading: boolean
  permissionsError: string | null
  updatePermissions: (newPermissions: WorkspacePermissions) => void
  refetchPermissions: () => Promise<void>
  userPermissions: WorkspaceUserPermissions & { isOfflineMode?: boolean }
}

export const WorkspacePermissionsContext = createContext<WorkspacePermissionsContextType>({
  workspacePermissions: null,
  permissionsLoading: false,
  permissionsError: null,
  updatePermissions: () => {},
  refetchPermissions: async () => {},
  userPermissions: {
    canRead: false,
    canEdit: false,
    canAdmin: false,
    userPermissions: 'read',
    isLoading: false,
    error: null,
  },
})

function useStaticPermissionsContextValue({
  canAdmin,
  userPermissions,
}: {
  canAdmin: boolean
  userPermissions: 'admin' | 'write'
}) {
  return useMemo(
    (): WorkspacePermissionsContextType => ({
      workspacePermissions: null,
      permissionsLoading: false,
      permissionsError: null,
      updatePermissions: () => {},
      refetchPermissions: async () => {},
      userPermissions: {
        canRead: true,
        canEdit: true,
        canAdmin,
        userPermissions,
        isLoading: false,
        error: null,
        isOfflineMode: false,
      },
    }),
    [canAdmin, userPermissions]
  )
}

export function LowMemoryWorkspacePermissionsProvider({ children }: { children: React.ReactNode }) {
  const contextValue = useStaticPermissionsContextValue({
    canAdmin: true,
    userPermissions: 'admin',
  })

  return (
    <WorkspacePermissionsContext.Provider value={contextValue}>
      {children}
    </WorkspacePermissionsContext.Provider>
  )
}

/**
 * Accesses workspace permissions data and operations from context.
 * Must be used within a WorkspacePermissionsProvider.
 */
export function useWorkspacePermissionsContext(): WorkspacePermissionsContextType {
  const context = useContext(WorkspacePermissionsContext)
  if (!context) {
    throw new Error(
      'useWorkspacePermissionsContext must be used within a WorkspacePermissionsProvider'
    )
  }
  return context
}

/**
 * Accesses the current user's computed permissions including offline mode status.
 * Convenience hook that extracts userPermissions from the context.
 */
export function useUserPermissionsContext(): WorkspaceUserPermissions & {
  isOfflineMode?: boolean
} {
  const { userPermissions } = useWorkspacePermissionsContext()
  return userPermissions
}

/**
 * Lightweight permissions provider for sandbox/academy contexts.
 * Grants full edit access without any API calls or workspace dependencies.
 */
export function SandboxWorkspacePermissionsProvider({ children }: { children: React.ReactNode }) {
  const sandboxPermissions = useStaticPermissionsContextValue({
    canAdmin: false,
    userPermissions: 'write',
  })

  return (
    <WorkspacePermissionsContext.Provider value={sandboxPermissions}>
      {children}
    </WorkspacePermissionsContext.Provider>
  )
}
