/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildBudgetedObservationPrompt,
  buildBudgetedObservationPromptResult,
  buildBudgetedObservationPromptWithOptions,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-result-budget'
import type { LocalAgentObservation } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

function buildObservation(index: number): LocalAgentObservation {
  return {
    toolName: 'canvas.read_summary',
    summary: `Observation ${index}`,
    success: true,
    timestamp: '2026-06-08T00:00:00.000Z',
    output: { text: `payload-${index}-${'A'.repeat(200)}` },
  }
}

describe('local canvas tool result budget', () => {
  it('uses an explicit empty observation marker', () => {
    expect(buildBudgetedObservationPrompt([])).toBe('No tool observations yet.')
  })

  it('clips large outputs behind stable refs', () => {
    const prompt = buildBudgetedObservationPromptWithOptions([buildObservation(0)], {
      maxOutputChars: 140,
    })

    expect(prompt).toContain('outputRef: tool_result_0_canvas_read_summary')
    expect(prompt).toContain('outputPreviewChars: 140/')
    expect(prompt).toContain('...[truncated]')
  })

  it('keeps recent observations and reports omitted older results', () => {
    const observations = Array.from({ length: 10 }, (_, index) => buildObservation(index))
    const prompt = buildBudgetedObservationPromptWithOptions(observations, {
      maxObservations: 3,
      maxOutputChars: 140,
    })

    expect(prompt).toContain('Omitted 7 older tool observations')
    expect(prompt).not.toContain('#1 success')
    expect(prompt).toContain('#8 success canvas.read_summary')
    expect(prompt).toContain('outputRef: tool_result_7_canvas_read_summary')
    expect(prompt).toContain('#10 success canvas.read_summary')
    expect(prompt).toContain('outputRef: tool_result_9_canvas_read_summary')
  })

  it('preserves older verification and mutation summaries within the turn budget', () => {
    const observations = [
      {
        toolName: 'canvas.apply_patch' as const,
        summary: 'Applied a large patch',
        success: true,
        timestamp: '2026-06-08T00:00:00.000Z',
        output: { verification: { success: true }, payload: 'A'.repeat(2000) },
      },
      ...Array.from({ length: 8 }, (_, index) => buildObservation(index)),
      {
        toolName: 'canvas.verify_patch' as const,
        summary: 'Verified the patch',
        success: true,
        timestamp: '2026-06-08T00:00:10.000Z',
        output: { success: true, payload: 'B'.repeat(2000) },
      },
    ]

    const result = buildBudgetedObservationPromptResult(observations, {
      maxObservations: 3,
      maxOutputChars: 180,
      maxPromptChars: 2200,
    })

    expect(result.prompt).toContain('Applied a large patch')
    expect(result.prompt).toContain('Verified the patch')
    expect(result.prompt).toContain('Omitted')
    expect(result.prompt.length).toBeLessThanOrEqual(2200)
    expect(result.truncatedOutputs).toBeGreaterThan(0)
  })

  it('budgets prompt text without mutating raw observation output', () => {
    const output = { text: 'A'.repeat(4000) }
    const observations: LocalAgentObservation[] = [
      {
        toolName: 'canvas.read_summary',
        summary: 'Large read summary',
        success: true,
        timestamp: '2026-06-08T00:00:00.000Z',
        output,
      },
    ]

    const result = buildBudgetedObservationPromptResult(observations, {
      maxOutputChars: 140,
      maxPromptChars: 1200,
    })

    expect(result.prompt).toContain('...[truncated]')
    expect(observations[0].output).toBe(output)
    expect(output.text.length).toBe(4000)
  })
})
