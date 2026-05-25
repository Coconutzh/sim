/**
 * @vitest-environment node
 */
import { authMockFns, workflowsApiUtilsMock, workflowsApiUtilsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockGetWorkspaceBilledAccountUserId } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockGetWorkspaceBilledAccountUserId: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}))

vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)

vi.mock(import('@/lib/core/config/env'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    env: {
      ...actual.env,
      OPENAI_API_KEY: 'test-openai-key',
      WAND_OPENAI_MODEL_NAME: 'gpt-4o',
    },
    getEnv: vi.fn(() => ''),
  }
})

vi.mock('@/lib/table/llm/wand', () => ({
  enrichTableSchema: vi.fn(),
}))

vi.mock('@/lib/api-key/byok', () => ({
  getBYOKKey: vi.fn(),
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBilledAccountUserId: mockGetWorkspaceBilledAccountUserId,
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  recordUsage: vi.fn(),
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillOverageThreshold: vi.fn(),
}))

vi.mock('@/providers/openai/utils', () => ({
  extractResponseText: vi.fn(),
  parseResponsesUsage: vi.fn(),
}))

vi.mock('@/providers/utils', () => ({
  getModelPricing: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

import { POST } from '@/app/api/wand/route'

describe('WandGenerateAPI POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    workflowsApiUtilsMockFns.mockGetWorkspaceMembershipAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      permission: 'write',
      canWrite: true,
    })
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('billing-user-1')
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => [{ workspaceId: 'ws-hidden' }],
        }),
      }),
    })
  })

  it('hides foreign personal workspace wand access behind workflow not found', async () => {
    workflowsApiUtilsMockFns.mockGetWorkspaceMembershipAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      permission: null,
      canWrite: false,
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/wand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Generate a table schema',
          workflowId: 'wf-hidden',
        }),
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Workflow not found',
    })
  })

  it('uses canvas wording when legacy workflows have no workspace container', async () => {
    mockDbSelect.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => [{ workspaceId: null }],
        }),
      }),
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/wand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Generate a table schema',
          workflowId: 'wf-legacy',
        }),
      })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error:
        'This workflow is not attached to a canvas. Legacy personal workflows are deprecated and cannot be accessed.',
    })
  })

  it('uses canvas wording when billing account lookup fails', async () => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValueOnce(null)

    const response = await POST(
      new NextRequest('http://localhost:3000/api/wand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Generate a table schema',
          workflowId: 'wf-billing-missing',
        }),
      })
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Unable to resolve billing account for this canvas',
    })
  })
})
