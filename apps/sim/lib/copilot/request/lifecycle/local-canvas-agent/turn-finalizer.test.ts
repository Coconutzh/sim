/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { prepareLocalAgentMemoryPersistDecision } from '@/lib/copilot/request/lifecycle/local-canvas-agent/turn-finalizer'
import type {
  LocalAgentContext,
  LocalAgentMemoryData,
  LocalAgentPlan,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

function buildContext(overrides: Partial<LocalAgentContext> = {}): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    chatId: 'chat-1',
    message: 'test',
    sessionScope: 'personal',
    agent: { code: 'chief_director', name: 'Canvas Agent', description: '', systemPrompt: '' },
    discipline: { id: '', code: 'chief_director', name: 'Chief Director' },
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

function buildMemory(): LocalAgentMemoryData {
  return {
    version: 2,
    scope: 'thread',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    agentCode: 'chief_director',
    chatId: 'chat-1',
    conversationSummary: '',
    taskState: { completedSteps: [], openQuestions: [] },
    canvasSummary: '',
    recentObservations: [],
    toolResultRefs: [],
    updatedAt: '2026-06-10T00:00:00.000Z',
  }
}

const plan: LocalAgentPlan = {
  goal: 'test',
  risk: 'low',
  requiresClarification: false,
  steps: [],
  successCriteria: [],
}

describe('local canvas agent turn finalizer', () => {
  it('allows memory persistence for completed turns', () => {
    expect(
      prepareLocalAgentMemoryPersistDecision({
        context: buildContext(),
        memory: buildMemory(),
        plan,
        observations: [],
      })
    ).toMatchObject({ persist: true })
  })

  it('skips memory persistence for aborted turns', () => {
    expect(
      prepareLocalAgentMemoryPersistDecision({
        context: buildContext({
          streamContext: { wasAborted: true } as LocalAgentContext['streamContext'],
        }),
        memory: buildMemory(),
        plan,
        observations: [],
      })
    ).toEqual({ persist: false, reason: 'aborted' })
  })
})
