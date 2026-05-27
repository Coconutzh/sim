'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * Keeps workflow registry workspace scope synchronized without analytics side effects.
 */
export function WorkspaceScopeSyncLite() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const hydrationWorkspaceId = useWorkflowRegistry((state) => state.hydration.workspaceId)
  const switchToWorkspace = useWorkflowRegistry((state) => state.switchToWorkspace)

  useEffect(() => {
    if (!workspaceId || hydrationWorkspaceId === workspaceId) return
    switchToWorkspace(workspaceId)
  }, [hydrationWorkspaceId, switchToWorkspace, workspaceId])

  return null
}
