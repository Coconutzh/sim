/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildBudgetedObservationPrompt,
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
})
