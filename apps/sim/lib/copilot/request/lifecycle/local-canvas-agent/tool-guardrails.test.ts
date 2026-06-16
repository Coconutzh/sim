/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  assessLocalAgentToolGuardrails,
  type LocalAgentToolGuardrailHistoryEntry,
  recordLocalAgentToolGuardrailHistory,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-guardrails'
import type { LocalAgentToolCall } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

describe('local canvas agent tool guardrails', () => {
  it('warns about repeated failures with the same tool input without blocking execution', () => {
    const history: LocalAgentToolGuardrailHistoryEntry[] = []
    const call: LocalAgentToolCall = {
      name: 'canvas.read_node',
      input: { nodeId: 'missing-node' },
    }
    recordLocalAgentToolGuardrailHistory({
      history,
      call,
      readOnly: true,
      result: {
        name: 'canvas.read_node',
        success: false,
        summary: 'Node was not found',
      },
    })

    const assessment = assessLocalAgentToolGuardrails({
      history,
      call,
      readOnly: true,
    })

    expect(assessment.repeatedFailureCount).toBe(1)
    expect(assessment.warnings.join(' ')).toContain('already failed')
  })

  it('detects no-progress read-only repeats from matching result signatures', () => {
    const history: LocalAgentToolGuardrailHistoryEntry[] = []
    const call: LocalAgentToolCall = {
      name: 'canvas.read_summary',
      input: {},
    }
    for (let index = 0; index < 2; index += 1) {
      recordLocalAgentToolGuardrailHistory({
        history,
        call,
        readOnly: true,
        result: {
          name: 'canvas.read_summary',
          success: true,
          summary: 'Read canvas summary',
          output: { nodes: [] },
        },
      })
    }

    const assessment = assessLocalAgentToolGuardrails({
      history,
      call,
      readOnly: true,
    })

    expect(assessment.repeatCount).toBe(2)
    expect(assessment.noProgressRepeatCount).toBe(2)
    expect(assessment.warnings.join(' ')).toContain('same result')
  })
})
