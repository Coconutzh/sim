export interface LocalAgentIterationBudget {
  readonly maxSteps: number
  readonly usedSteps: number
  readonly remainingSteps: number
  tryConsume(): boolean
  hasRemaining(): boolean
  isLastConsumedStep(): boolean
  refund(): boolean
}

export function createLocalAgentIterationBudget(maxSteps: number): LocalAgentIterationBudget {
  let usedSteps = 0
  const boundedMaxSteps = Math.max(0, Math.floor(maxSteps))
  return {
    maxSteps: boundedMaxSteps,
    get usedSteps() {
      return usedSteps
    },
    get remainingSteps() {
      return Math.max(0, boundedMaxSteps - usedSteps)
    },
    tryConsume() {
      if (usedSteps >= boundedMaxSteps) return false
      usedSteps += 1
      return true
    },
    hasRemaining() {
      return usedSteps < boundedMaxSteps
    },
    isLastConsumedStep() {
      return usedSteps >= boundedMaxSteps
    },
    refund() {
      return false
    },
  }
}

export function formatLocalAgentMaxStepSummary(maxSteps: number): string {
  return `Stopped after reaching the local canvas agent max step limit (${maxSteps}).`
}
