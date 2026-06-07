/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRunStreamLoop,
  mockRunLocalWorkflowFallback,
  mockShouldUseLocalWorkflowFallback,
  mockRunLocalCanvasAgent,
  mockPrepareExecutionContext,
} = vi.hoisted(() => ({
  mockRunStreamLoop: vi.fn(),
  mockRunLocalWorkflowFallback: vi.fn(),
  mockShouldUseLocalWorkflowFallback: vi.fn(() => false),
  mockRunLocalCanvasAgent: vi.fn(
    async ({ context }: { context: { accumulatedContent: string } }) => {
      context.accumulatedContent = 'agent done'
    }
  ),
  mockPrepareExecutionContext: vi.fn(async () => ({
    userId: 'user-1',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
  })),
}))

vi.mock('@/lib/copilot/request/context/request-context', () => ({
  createStreamingContext: vi.fn(() => ({
    messageId: 'message-1',
    accumulatedContent: '',
    contentBlocks: [],
    toolCalls: new Map(),
    pendingToolPromises: new Map(),
    currentThinkingBlock: null,
    currentSubagentThinkingBlock: null,
    isInThinkingBlock: false,
    subAgentParentStack: [],
    subAgentContent: {},
    subAgentToolCalls: {},
    pendingContent: '',
    streamComplete: false,
    wasAborted: false,
    errors: [],
    trace: {} as Record<string, never>,
  })),
}))

vi.mock('@sim/db', () => ({
  db: {},
}))

vi.mock('@/lib/copilot/request/context/result', () => ({
  buildToolCallSummaries: vi.fn(() => []),
}))

vi.mock('@/lib/copilot/request/go/stream', () => ({
  BillingLimitError: class BillingLimitError extends Error {
    userId = 'user-1'
  },
  CopilotBackendError: class CopilotBackendError extends Error {
    status?: number
    constructor(message: string, status?: number) {
      super(message)
      this.status = status
    }
  },
  runStreamLoop: mockRunStreamLoop,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-workflow-fallback', () => ({
  runLocalWorkflowFallback: mockRunLocalWorkflowFallback,
  shouldUseLocalWorkflowFallback: mockShouldUseLocalWorkflowFallback,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent', () => ({
  runLocalCanvasAgent: mockRunLocalCanvasAgent,
}))

vi.mock('@/lib/copilot/request/tool-call-state', () => ({
  getToolCallTerminalData: vi.fn(),
  requireToolCallStateResult: vi.fn(),
  setTerminalToolCallState: vi.fn(),
}))

vi.mock('@/lib/copilot/request/tools/billing', () => ({
  handleBillingLimitResponse: vi.fn(),
}))

vi.mock('@/lib/copilot/request/tools/executor', () => ({
  executeToolAndReport: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/handlers/context', () => ({
  prepareExecutionContext: mockPrepareExecutionContext,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {
    DISABLE_AUTH: false,
    COPILOT_API_KEY: undefined,
  },
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv: vi.fn(),
}))

import { runCopilotLifecycle } from '@/lib/copilot/request/lifecycle/run'

describe('runCopilotLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockShouldUseLocalWorkflowFallback.mockReturnValue(false)
  })

  it('routes content_canvas_v1 to the local content canvas agent only', async () => {
    const result = await runCopilotLifecycle(
      {
        message: '帮我新增一个图片节点',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        workflowCopilotMode: 'content_canvas_v1',
      },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      }
    )

    expect(mockRunLocalCanvasAgent).toHaveBeenCalledTimes(1)
    expect(mockRunStreamLoop).not.toHaveBeenCalled()
    expect(mockRunLocalWorkflowFallback).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect(result.content).toBe('agent done')
  })
})
