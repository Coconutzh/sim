/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createLocalAgentIterationBudget,
  formatLocalAgentMaxStepSummary,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/iteration-budget'

describe('local canvas agent iteration budget', () => {
  it('preserves a fixed max-step budget without refunds', () => {
    const budget = createLocalAgentIterationBudget(2)

    expect(budget.maxSteps).toBe(2)
    expect(budget.tryConsume()).toBe(true)
    expect(budget.usedSteps).toBe(1)
    expect(budget.hasRemaining()).toBe(true)
    expect(budget.refund()).toBe(false)
    expect(budget.usedSteps).toBe(1)
    expect(budget.tryConsume()).toBe(true)
    expect(budget.isLastConsumedStep()).toBe(true)
    expect(budget.tryConsume()).toBe(false)
  })

  it('keeps the existing max-step stop summary stable', () => {
    expect(formatLocalAgentMaxStepSummary(10)).toBe(
      'Stopped after reaching the local canvas agent max step limit (10).'
    )
  })
})
