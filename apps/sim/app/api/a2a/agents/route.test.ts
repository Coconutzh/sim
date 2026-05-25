/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseRequest, mockCheckSessionOrInternalAuth, mockCheckWorkspaceAccess } = vi.hoisted(
  () => ({
    mockParseRequest: vi.fn(),
    mockCheckSessionOrInternalAuth: vi.fn(),
    mockCheckWorkspaceAccess: vi.fn(),
  })
)

vi.mock('@sim/db', () => ({ db: { select: vi.fn(), insert: vi.fn() } }))
vi.mock('@sim/db/schema', () => ({ a2aAgent: {}, workflow: {} }))
vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth }))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))
vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
  getValidationErrorMessage: vi.fn(() => 'Invalid request'),
}))
vi.mock('@/lib/api/contracts/a2a-agents', () => ({
  createA2AAgentContract: {},
  listA2AAgentsQuerySchema: {
    safeParse: vi.fn(() => ({ success: true, data: { workspaceId: 'ws-hidden' } })),
  },
}))
vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}))
vi.mock('@/lib/a2a/agent-card', () => ({ generateSkillsFromWorkflow: vi.fn() }))
vi.mock('@/lib/a2a/constants', () => ({ A2A_DEFAULT_CAPABILITIES: {} }))
vi.mock('@/lib/a2a/utils', () => ({ sanitizeAgentName: vi.fn((name: string) => name) }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('@/lib/workflows/persistence/utils', () => ({ loadWorkflowFromNormalizedTables: vi.fn() }))
vi.mock('@/lib/workflows/triggers/trigger-utils', () => ({ hasValidStartBlockInState: vi.fn() }))
vi.mock('@sim/utils/id', () => ({ generateId: vi.fn(() => 'agent-1') }))

import { GET, POST } from '@/app/api/a2a/agents/route'

describe('/api/a2a/agents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: {
        body: {
          workspaceId: 'ws-hidden',
          workflowId: 'wf-1',
          name: 'Agent',
          description: null,
          capabilities: {},
          authentication: null,
          skillTags: [],
        },
      },
    })
  })

  it('hides foreign personal workspace A2A agent listings behind 404', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/a2a/agents?workspaceId=ws-hidden')
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
  })

  it('hides foreign personal workspace A2A agent creation behind 404', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/a2a/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'ws-hidden', workflowId: 'wf-1' }),
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
  })
})
