/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LocalAgentContext,
  LocalAgentPlan,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const {
  mockBuildLocalAgentPlan,
  mockBuildLocalAgentAnswer,
  mockExecuteLocalAgentTool,
  mockSelectLocalAgentNextToolCall,
} = vi.hoisted(() => ({
  mockBuildLocalAgentPlan: vi.fn(),
  mockBuildLocalAgentAnswer: vi.fn(async () => 'done'),
  mockExecuteLocalAgentTool: vi.fn(),
  mockSelectLocalAgentNextToolCall: vi.fn(({ candidates }) => candidates[0] ?? null),
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/planner', () => ({
  buildLocalAgentPlan: mockBuildLocalAgentPlan,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/models/actor', () => ({
  buildLocalAgentAnswer: mockBuildLocalAgentAnswer,
  selectLocalAgentNextToolCall: mockSelectLocalAgentNextToolCall,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/tool-executor-bridge', () => ({
  executeLocalAgentTool: mockExecuteLocalAgentTool,
}))

import { runLocalAgentToolLoop } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-loop'

function buildContext(overrides: Partial<LocalAgentContext> = {}): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    message: '读取 node-does-not-exist 并修改它。',
    sessionScope: 'personal',
    agent: { code: 'chief_director', name: 'Canvas Agent', description: '', systemPrompt: '' },
    discipline: { id: '', code: 'chief_director', name: '总导演' },
    workgroup: { id: '', name: 'Workspace', organizationId: '', teamWorkspaceId: null },
    permissions: { canRead: true, canWrite: true, canPublish: false },
    selectedNodeIds: [],
    conversationHistory: [],
    skills: [],
    model: { model: 'test-model', mode: 'structured' },
    confirmationMode: 'auto',
    thinkingLevel: 'standard',
    requestPayload: {},
    execContext: {
      userId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    },
    streamContext: {} as LocalAgentContext['streamContext'],
    options: {},
    ...overrides,
  }
}

describe('local canvas tool loop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteLocalAgentTool.mockResolvedValue({
      name: 'canvas.read_node',
      success: false,
      error: 'Node "node-does-not-exist" was not found',
      summary: 'Node "node-does-not-exist" was not found',
    })
  })

  it('executes explicit read_node calls from plan readNodeIds', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Read missing node',
      risk: 'low',
      requiresClarification: false,
      steps: [
        {
          id: 'read',
          title: 'Read explicitly referenced node',
          intent: 'inspect',
          toolHints: ['canvas.read_node'],
          expectedObservation: 'Node detail or missing node error',
        },
      ],
      successCriteria: ['Do not patch missing nodes'],
      readNodeIds: ['node-does-not-exist'],
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)

    const result = await runLocalAgentToolLoop(buildContext())

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.read_node',
      input: { nodeId: 'node-does-not-exist' },
    })
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'canvas.apply_patch' })
    )
    expect(result.observations.at(-1)).toMatchObject({
      toolName: 'canvas.read_node',
      success: false,
    })
  })

  it('stops before subsequent tools when the abort signal is raised during execution', async () => {
    const abortController = new AbortController()
    const plan: LocalAgentPlan = {
      goal: 'Apply and verify patch',
      risk: 'low',
      requiresClarification: false,
      steps: [
        {
          id: 'apply',
          title: 'Apply patch',
          intent: 'update',
          toolHints: ['canvas.apply_patch'],
          expectedObservation: 'Patch applied',
        },
        {
          id: 'verify',
          title: 'Verify patch',
          intent: 'verify',
          toolHints: ['canvas.verify_patch'],
          expectedObservation: 'Patch verified',
        },
      ],
      successCriteria: ['Patch is verified'],
      patch: { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] },
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)
    mockExecuteLocalAgentTool.mockImplementationOnce(async () => {
      abortController.abort()
      return {
        name: 'canvas.read_summary',
        success: true,
        output: {},
        summary: 'Canvas summary read',
      }
    })

    const context = buildContext({
      options: { abortSignal: abortController.signal },
      streamContext: { wasAborted: false } as LocalAgentContext['streamContext'],
    })
    const result = await runLocalAgentToolLoop(context)

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledTimes(1)
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.read_summary',
      input: {},
    })
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'canvas.apply_patch' })
    )
    expect(context.streamContext.wasAborted).toBe(true)
    expect(result.observations.at(-1)).toMatchObject({
      success: false,
      summary: 'Stopped because the request was cancelled.',
    })
  })

  it('does not auto-apply a proposal-only patch plan', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Propose a risky patch',
      risk: 'medium',
      requiresClarification: false,
      steps: [
        {
          id: 'propose',
          title: 'Propose patch',
          intent: 'update',
          toolHints: ['canvas.propose_patch'],
          expectedObservation: 'Patch proposal is available for review',
        },
      ],
      successCriteria: ['No canvas mutation occurs before confirmation'],
      patch: { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] },
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)
    mockExecuteLocalAgentTool.mockResolvedValue({
      name: 'canvas.propose_patch',
      success: true,
      output: { operationCount: 1 },
      summary: 'Prepared canvas patch proposal',
    })

    await runLocalAgentToolLoop(buildContext())

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.read_summary',
      input: {},
    })
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.propose_patch',
      input: { patch: plan.patch },
    })
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'canvas.apply_patch' })
    )
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'canvas.verify_patch' })
    )
  })

  it('does not execute mutation tools when the plan is read-only', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Discuss a workflow design',
      risk: 'low',
      userIntent: 'consult_design',
      mutationPolicy: 'read_only',
      canvasReadPolicy: 'none',
      requiresClarification: false,
      steps: [
        {
          id: 'bad_apply',
          title: 'Model accidentally tries to apply',
          intent: 'update',
          toolHints: ['canvas.apply_patch'],
          expectedObservation: 'Should not run',
        },
      ],
      successCriteria: ['No canvas mutation occurs'],
      patch: { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] },
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)

    await runLocalAgentToolLoop(
      buildContext({
        message: '先和我讨论这个小红书视频工作流怎么设计。',
      })
    )

    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalled()
    expect(mockBuildLocalAgentAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        plan,
        observations: expect.arrayContaining([
          expect.objectContaining({ toolName: 'planner', success: true }),
        ]),
      })
    )
  })

  it('does not execute verify calls for read-only plans with stale patch hints', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Inspect current canvas only',
      risk: 'low',
      userIntent: 'inspect_canvas',
      mutationPolicy: 'read_only',
      canvasReadPolicy: 'required',
      requiresClarification: false,
      steps: [
        {
          id: 'read',
          title: 'Read canvas',
          intent: 'inspect',
          toolHints: ['canvas.read_summary', 'canvas.verify_patch'],
          expectedObservation: 'Canvas is read without verification side effects',
        },
      ],
      successCriteria: ['No mutation or verify runs'],
      patch: { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] },
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)
    mockExecuteLocalAgentTool.mockResolvedValue({
      name: 'canvas.read_summary',
      success: true,
      output: {},
      summary: 'Canvas summary read',
    })

    await runLocalAgentToolLoop(buildContext({ message: '总结当前画布。' }))

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.read_summary',
      input: {},
    })
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'canvas.verify_patch' })
    )
  })

  it('executes multiple planned tool hints from the same step', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Search current canvas',
      risk: 'low',
      requiresClarification: false,
      steps: [
        {
          id: 'search',
          title: 'Read and search canvas',
          intent: 'inspect',
          toolHints: ['canvas.read_summary', 'canvas.search_nodes'],
          expectedObservation: 'Canvas summary and search matches are available',
        },
      ],
      successCriteria: ['Find matching nodes'],
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.read_summary',
        success: true,
        output: {},
        summary: 'Canvas summary read',
      })
      .mockResolvedValueOnce({
        name: 'canvas.search_nodes',
        success: true,
        output: [],
        summary: 'Search completed',
      })

    await runLocalAgentToolLoop(buildContext({ message: '找到包含“城市霓虹漫游”的节点。' }))

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.read_summary',
      input: {},
    })
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.search_nodes',
      input: { query: '找到包含“城市霓虹漫游”的节点。' },
    })
  })

  it('does not continue to mutation tools after an inspection failure', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Read missing node and update it',
      risk: 'low',
      requiresClarification: false,
      steps: [
        {
          id: 'read',
          title: 'Read explicitly referenced node',
          intent: 'inspect',
          toolHints: ['canvas.read_node'],
          expectedObservation: 'Node detail or missing node error',
        },
        {
          id: 'apply',
          title: 'Apply update',
          intent: 'update',
          toolHints: ['canvas.apply_patch'],
          expectedObservation: 'Patch applied only if the node exists',
        },
      ],
      successCriteria: ['Do not patch missing nodes'],
      readNodeIds: ['node-does-not-exist'],
      patch: {
        operations: [
          {
            type: 'update_node',
            nodeId: 'node-does-not-exist',
            fields: { contentHtml: '<p>updated</p>' },
          },
        ],
      },
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)

    const result = await runLocalAgentToolLoop(buildContext())

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledTimes(1)
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.read_node',
      input: { nodeId: 'node-does-not-exist' },
    })
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'canvas.apply_patch' })
    )
    expect(result.observations.at(-1)).toMatchObject({
      toolName: 'canvas.read_node',
      success: false,
    })
  })

  it('verifies generated output with the target node id and written field', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Generate selected image',
      risk: 'medium',
      requiresClarification: false,
      steps: [],
      successCriteria: ['Generated file is written'],
      generateNodeIds: ['image-1'],
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.read_summary',
        success: true,
        output: {},
        summary: 'Canvas summary read',
      })
      .mockResolvedValueOnce({
        name: 'canvas.generate_node_output',
        success: true,
        output: { nodeId: 'image-1', kind: 'image', verifiedField: 'file' },
        summary: 'Generated image node',
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        output: { success: true },
        summary: 'Verified generated image',
      })

    await runLocalAgentToolLoop(buildContext())

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.verify_patch',
      input: { generation: { nodeId: 'image-1', field: 'file' } },
    })
  })

  it('verifies each generated node with its own target node id and written field', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Generate selected text and video nodes',
      risk: 'medium',
      requiresClarification: false,
      steps: [],
      successCriteria: ['Generated outputs are written'],
      generateNodeIds: ['text-1', 'video-1'],
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)
    mockExecuteLocalAgentTool
      .mockResolvedValueOnce({
        name: 'canvas.read_summary',
        success: true,
        output: {},
        summary: 'Canvas summary read',
      })
      .mockResolvedValueOnce({
        name: 'canvas.generate_node_output',
        success: true,
        output: { nodeId: 'text-1', kind: 'text', verifiedField: 'contentHtml' },
        summary: 'Generated text node',
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        output: { success: true },
        summary: 'Verified generated text',
      })
      .mockResolvedValueOnce({
        name: 'canvas.generate_node_output',
        success: true,
        output: { nodeId: 'video-1', kind: 'video', verifiedField: 'file' },
        summary: 'Generated video node',
      })
      .mockResolvedValueOnce({
        name: 'canvas.verify_patch',
        success: true,
        output: { success: true },
        summary: 'Verified generated video',
      })

    await runLocalAgentToolLoop(buildContext())

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.verify_patch',
      input: { generation: { nodeId: 'text-1', field: 'contentHtml' } },
    })
    expect(mockExecuteLocalAgentTool).toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.verify_patch',
      input: { generation: { nodeId: 'video-1', field: 'file' } },
    })
    expect(mockExecuteLocalAgentTool).not.toHaveBeenCalledWith(expect.anything(), {
      name: 'canvas.verify_patch',
      input: {},
    })
  })

  it('records an observation when the max step limit is reached', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Generate many nodes',
      risk: 'low',
      requiresClarification: false,
      steps: [],
      successCriteria: ['Stop safely at the step limit'],
      generateNodeIds: Array.from({ length: 12 }, (_, index) => `node-${index}`),
    }
    mockBuildLocalAgentPlan.mockResolvedValue(plan)
    mockExecuteLocalAgentTool.mockResolvedValue({
      name: 'canvas.generate_node_output',
      success: true,
      output: {},
      summary: 'Generated node',
    })

    const result = await runLocalAgentToolLoop(buildContext())

    expect(mockExecuteLocalAgentTool).toHaveBeenCalledTimes(10)
    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: expect.stringContaining('max step limit'),
        }),
      ])
    )
  })
})
