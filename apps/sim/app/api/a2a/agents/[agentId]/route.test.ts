/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckSessionOrInternalAuth, mockCheckWorkspaceAccess, mockDbSelect } = vi.hoisted(() => ({
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockDbSelect: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    update: vi.fn(),
    delete: vi.fn(),
  },
}))
vi.mock('@sim/db/schema', () => ({
  a2aAgent: { id: 'id', archivedAt: 'archivedAt', workspaceId: 'workspaceId' },
  workflow: {},
  workspace: { id: 'id', workspaceMode: 'workspaceMode' },
}))
vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth }))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ checkWorkspaceAccess: mockCheckWorkspaceAccess }))
vi.mock('@/lib/api/server', () => ({ parseRequest: vi.fn() }))
vi.mock('@/lib/api/contracts/a2a-agents', () => ({
  a2aAgentParamsSchema: { parse: vi.fn(() => ({ agentId: 'agent-1' })) },
  publishA2AAgentContract: {},
  updateA2AAgentContract: {},
}))
vi.mock('@/lib/core/utils/with-route-handler', () => ({ withRouteHandler: vi.fn((handler) => handler) }))
vi.mock('@sim/logger', () => ({ createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })) }))
vi.mock('@/lib/a2a/agent-card', () => ({ generateAgentCard: vi.fn(), generateSkillsFromWorkflow: vi.fn() }))
vi.mock('@/lib/core/config/redis', () => ({ getRedisClient: vi.fn() }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('@/lib/workflows/persistence/utils', () => ({ loadWorkflowFromNormalizedTables: vi.fn() }))

import { GET, PUT } from '@/app/api/a2a/agents/[agentId]/route'

describe('/api/a2a/agents/[agentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockDbSelect.mockReturnValueOnce(
      createSelectChain([
        {
          agent: { id: 'agent-1', workspaceId: 'ws-hidden', workflowId: 'wf-1', isPublished: true },
          workflow: { id: 'wf-1', name: 'Workflow', description: null },
          workspace: { id: 'ws-hidden', workspaceMode: 'personal' },
        },
      ])
    )
  })

  it('hides foreign personal workspace published agent cards behind 404', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({ success: false, userId: null })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/a2a/agents/agent-1'),
      { params: Promise.resolve({ agentId: 'agent-1' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Agent not found' })
  })

  it('hides foreign personal workspace A2A agent updates behind 404', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({ success: true, userId: 'user-1' })
    mockDbSelect.mockReturnValueOnce(
      createSelectChain([{ id: 'agent-1', workspaceId: 'ws-hidden', workflowId: 'wf-1' }])
    )
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await PUT(
      new NextRequest('http://localhost:3000/api/a2a/agents/agent-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Agent' }),
      }),
      { params: Promise.resolve({ agentId: 'agent-1' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Agent not found' })
  })
})
