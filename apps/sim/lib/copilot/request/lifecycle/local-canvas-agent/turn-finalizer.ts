import type {
  LocalAgentContext,
  LocalAgentMemoryData,
  LocalAgentObservation,
  LocalAgentPlan,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

export type LocalAgentMemoryPersistDecision =
  | {
      persist: true
      context: LocalAgentContext
      memory: LocalAgentMemoryData
      plan: LocalAgentPlan
      observations: LocalAgentObservation[]
    }
  | {
      persist: false
      reason: 'aborted'
    }

export function isLocalAgentTurnInterrupted(context: LocalAgentContext): boolean {
  return Boolean(context.options.abortSignal?.aborted || context.streamContext.wasAborted)
}

export function prepareLocalAgentMemoryPersistDecision(params: {
  context: LocalAgentContext
  memory: LocalAgentMemoryData
  plan: LocalAgentPlan
  observations: LocalAgentObservation[]
}): LocalAgentMemoryPersistDecision {
  if (isLocalAgentTurnInterrupted(params.context)) return { persist: false, reason: 'aborted' }
  return {
    persist: true,
    context: params.context,
    memory: params.memory,
    plan: params.plan,
    observations: params.observations,
  }
}
