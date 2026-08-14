import { createLogger } from '@sim/logger'
import { useVariablesStore } from '@/stores/variables/store'
import type { Variable } from '@/stores/variables/types'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowStateSync')

export function cloneWorkflowState(state: WorkflowState): WorkflowState {
  return {
    ...state,
    blocks: structuredClone(state.blocks || {}),
    edges: structuredClone(state.edges || []),
    loops: structuredClone(state.loops || {}),
    parallels: structuredClone(state.parallels || {}),
  }
}

export function extractSubBlockValues(
  workflowState: WorkflowState
): Record<string, Record<string, unknown>> {
  const values: Record<string, Record<string, unknown>> = {}
  Object.entries(workflowState.blocks || {}).forEach(([blockId, block]) => {
    values[blockId] = {}
    Object.entries(block.subBlocks || {}).forEach(([subBlockId, subBlock]) => {
      values[blockId][subBlockId] = subBlock?.value ?? null
    })
  })
  return values
}

export function applyWorkflowStateToStores(
  workflowId: string,
  workflowState: WorkflowState,
  options?: { updateLastSaved?: boolean }
) {
  const workflowStore = useWorkflowStore.getState()
  const cloned = cloneWorkflowState(workflowState)
  workflowStore.replaceWorkflowState(cloned, options)
  useSubBlockStore.getState().setWorkflowValues(workflowId, extractSubBlockValues(workflowState))
  if (Object.hasOwn(workflowState, 'variables')) {
    applyWorkflowVariablesToStore(workflowId, workflowState.variables)
  }

  logger.info('Applied workflow state to stores', {
    workflowId,
    blockCount: Object.keys(workflowState.blocks || {}).length,
    edgeCount: workflowState.edges?.length ?? 0,
  })
}

export function applyWorkflowVariablesToStore(
  workflowId: string,
  variables?: WorkflowState['variables'] | null
) {
  const stampedVariables: Record<string, Variable> = {}

  Object.entries(variables || {}).forEach(([id, variable]) => {
    if (!variable?.name) return
    stampedVariables[id] = {
      id: variable.id || id,
      workflowId,
      name: variable.name,
      type: variable.type || 'plain',
      value: Object.hasOwn(variable, 'value') ? variable.value : '',
    }
  })

  useVariablesStore.setState((state) => ({
    variables: {
      ...Object.fromEntries(
        Object.entries(state.variables).filter(([, variable]) => variable.workflowId !== workflowId)
      ),
      ...stampedVariables,
    },
  }))
}
