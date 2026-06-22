import type {
  LocalAgentPlan,
  LocalCanvasPatch,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

export function patchRequiresDeleteConfirmation(patch: LocalCanvasPatch | undefined): boolean {
  return (
    patch?.operations.some((operation) => {
      const type = (operation as { type?: string }).type
      return type === 'delete_node' || type === 'clear_canvas'
    }) ?? false
  )
}

export function planRequiresDeleteConfirmation(plan: LocalAgentPlan): boolean {
  return patchRequiresDeleteConfirmation(plan.patch)
}
