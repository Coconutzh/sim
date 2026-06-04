import { useCallback, useMemo } from 'react'
import { generateId } from '@sim/utils/id'
import { useRouter } from 'next/navigation'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
import { useCreateWorkflow, useWorkflowMap } from '@/hooks/queries/workflows'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface UseWorkflowOperationsProps {
  workspaceId: string
}

interface CreateWorkflowOptions {
  name: string
  folderId?: string | null
}

export function useWorkflowOperations({ workspaceId }: UseWorkflowOperationsProps) {
  const router = useRouter()
  const { data: workflows = {}, isLoading: workflowsLoading } = useWorkflowMap(workspaceId)
  const createWorkflowMutation = useCreateWorkflow()

  const regularWorkflows = useMemo(
    () =>
      Object.values(workflows)
        .filter(
          (workflow) => workflow.workspaceId === workspaceId && workflow.track !== 'published'
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [workflows, workspaceId]
  )

  const handleCreateWorkflow = useCallback(
    (options: CreateWorkflowOptions): Promise<string | null> => {
      const { clearDiff } = useWorkflowDiffStore.getState()
      clearDiff()

      const name = options.name.trim()
      if (!name) return Promise.resolve(null)

      const color = getNextWorkflowColor()
      const id = generateId()

      createWorkflowMutation.mutate({
        workspaceId,
        name,
        color,
        id,
        folderId: options.folderId ?? undefined,
      })

      useWorkflowRegistry.getState().markWorkflowCreating(id)
      router.push(`/workspace/${workspaceId}/w/${id}`)
      return Promise.resolve(id)
    },
    [createWorkflowMutation, workspaceId, router]
  )

  return {
    workflows,
    regularWorkflows,
    workflowsLoading,
    isCreatingWorkflow: createWorkflowMutation.isPending,

    handleCreateWorkflow,
  }
}
