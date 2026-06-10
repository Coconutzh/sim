/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  normalizeLocalAgentToolName,
  parseLocalAgentToolInputWithRepair,
  parseLooseJsonObject,
  repairLocalAgentToolInput,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-call-repair'

describe('local canvas agent tool call repair', () => {
  it('normalizes only obvious unique tool aliases', () => {
    expect(normalizeLocalAgentToolName('verify_patch')).toBe('canvas.verify_patch')
    expect(normalizeLocalAgentToolName('read_node')).toBe('canvas.read_node')
    expect(normalizeLocalAgentToolName('search')).toBeUndefined()
  })

  it('parses wrapped JSON objects and rejects likely truncated JSON', () => {
    expect(parseLooseJsonObject('```json\n{"ok":true,}\n```')).toEqual({
      success: true,
      value: { ok: true },
    })
    expect(parseLooseJsonObject('{"ok":true')).toEqual({
      success: false,
      reason: 'truncated',
    })
  })

  it('repairs stringified tool input without inventing fields', () => {
    expect(
      repairLocalAgentToolInput({
        toolName: 'canvas.read_node',
        input: '{"nodeId":"node-1"}',
      })
    ).toMatchObject({
      status: 'repaired',
      input: { nodeId: 'node-1' },
      reason: 'json_string_input',
    })
    expect(
      repairLocalAgentToolInput({
        toolName: 'canvas.read_node',
        input: 'node-1',
      })
    ).toMatchObject({ status: 'unchanged', input: 'node-1' })
  })

  it('repairs JSON-encoded patch operation objects', () => {
    const result = repairLocalAgentToolInput({
      toolName: 'canvas.apply_patch',
      input: {
        patch: {
          operations: ['{"type":"layout_nodes","direction":"horizontal"}'],
        },
      },
    })

    expect(result).toMatchObject({
      status: 'repaired',
      reason: 'json_string_patch_operation',
      input: {
        patch: {
          operations: [{ type: 'layout_nodes', direction: 'horizontal' }],
        },
      },
    })
  })

  it('retries schema parsing only when repair succeeds', () => {
    const schema = z.object({ nodeId: z.string().min(1) }).passthrough()

    expect(
      parseLocalAgentToolInputWithRepair({
        toolName: 'canvas.read_node',
        input: '{"nodeId":"node-1"}',
        inputSchema: schema,
      })
    ).toMatchObject({ success: true, data: { nodeId: 'node-1' }, repaired: true })
    expect(
      parseLocalAgentToolInputWithRepair({
        toolName: 'canvas.read_node',
        input: '{"nodeId":',
        inputSchema: schema,
      })
    ).toMatchObject({ success: false, repaired: false, repairReason: 'truncated' })
  })
})
