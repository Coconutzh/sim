import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRunSmoke } = vi.hoisted(() => ({
  mockRunSmoke: vi.fn(),
}))

vi.mock('./hermes-sim-smoke', () => ({
  loadDefaultLocalEnvFiles: vi.fn(),
  runSmoke: mockRunSmoke,
}))

import { parseSimulatedManualOptions, runSimulatedManualCases } from './hermes-sim-simulate-manual'

describe('hermes simulated manual runner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.HERMES_API_URL = 'http://127.0.0.1:8642'
    process.env.HERMES_API_KEY = 'test-key'
    process.env.HERMES_SMOKE_USER_ID = 'user-1'
    process.env.HERMES_SMOKE_WORKSPACE_ID = 'workspace-1'
    process.env.HERMES_SMOKE_WORKFLOW_ID = 'workflow-1'
    process.env.HERMES_SERVICE_TOKEN = 'service-token'
    process.env.HERMES_SMOKE_WRITE_CONFIRM = 'APPLY_CANVAS_PROPOSAL'
  })

  it('parses repeated cases and de-duplicates them', () => {
    const options = parseSimulatedManualOptions([
      '--case',
      'canvas-summary',
      '--case',
      'canvas-summary',
      '--json',
    ])

    expect(options).toEqual({
      cases: ['canvas-summary'],
      json: true,
    })
  })

  it('runs a smoke-backed canvas apply simulation and emits required fields', async () => {
    mockRunSmoke.mockResolvedValueOnce({
      results: [
        {
          name: 'hermes.sim-canvas-apply-after-confirm',
          status: 'pass',
          detail: 'changed node-created',
          data: {
            responseId: 'resp-apply-1',
            toolCallId: 'call-apply-1',
            pendingActionId: 'pending-1',
            changedNodeIds: ['node-created'],
            verificationSummary: 'canvas.verify_patch: success',
          },
        },
        {
          name: 'sim.canvas-write-verify',
          status: 'pass',
          detail: 'node count 1 -> 2',
        },
      ],
    })

    const [result] = await runSimulatedManualCases({
      cases: ['canvas-propose-confirm-apply'],
      json: true,
    })

    expect(mockRunSmoke).toHaveBeenCalledWith(['--canvas-propose-apply', '--skip-sim-health'])
    expect(result.pass).toBe(true)
    expect(result.requestIds.responseId).toBe('resp-apply-1')
    expect(result.requestIds.toolCallId).toBe('call-apply-1')
    expect(result.requestIds.pendingActionId).toBe('pending-1')
    expect(result.toolCalls).toContain('sim_canvas_agent_run')
    expect(result.stateDiff.changedNodeIds).toEqual(['node-created'])
    expect(result.dbChecks['sim.canvas-write-verify']).toEqual(
      expect.objectContaining({ status: 'pass' })
    )
  })

  it('does not infer SIM memory tool calls from the chat-memory case name alone', async () => {
    mockRunSmoke.mockResolvedValueOnce({
      results: [
        {
          name: 'hermes.conversation-chain',
          status: 'pass',
          detail: 'chat-memory phrase was remembered in the current conversation',
        },
      ],
    })

    const [result] = await runSimulatedManualCases({
      cases: ['chat-memory'],
      json: true,
    })

    expect(result.pass).toBe(true)
    expect(result.toolCalls).not.toContain('sim_memory_run')
  })

  it('fails before smoke when required explicit context is missing', async () => {
    process.env.HERMES_SMOKE_WORKFLOW_ID = ''

    const [result] = await runSimulatedManualCases({
      cases: ['canvas-summary'],
      json: true,
    })

    expect(result.pass).toBe(false)
    expect(result.failureReason).toContain('HERMES_SMOKE_WORKFLOW_ID')
    expect(mockRunSmoke).not.toHaveBeenCalled()
  })
})
