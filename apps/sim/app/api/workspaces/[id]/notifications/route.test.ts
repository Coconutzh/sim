/**
 * @vitest-environment node
 */
import {
  authMock,
  authMockFns,
  createMockRequest,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).orderBy = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  workflow: { id: 'id' },
  workspaceNotificationSubscription: {
    id: 'id',
    workspaceId: 'workspaceId',
    notificationType: 'notificationType',
    workflowIds: 'workflowIds',
    allWorkflows: 'allWorkflows',
    levelFilter: 'levelFilter',
    triggerFilter: 'triggerFilter',
    includeFinalOutput: 'includeFinalOutput',
    includeTraceSpans: 'includeTraceSpans',
    includeRateLimits: 'includeRateLimits',
    includeUsageData: 'includeUsageData',
    webhookConfig: 'webhookConfig',
    emailRecipients: 'emailRecipients',
    slackConfig: 'slackConfig',
    alertConfig: 'alertConfig',
    active: 'active',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { GET, POST } from './route'

describe('/api/workspaces/[id]/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' },
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-owner', ownerId: 'owner-1', workspaceMode: 'organization' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockDbSelect.mockReturnValue(
      createSelectChain([
        {
          id: 'sub-1',
          notificationType: 'email',
          workflowIds: [],
          allWorkflows: true,
          levelFilter: 'all',
          triggerFilter: 'all',
          includeFinalOutput: false,
          includeTraceSpans: false,
          includeRateLimits: false,
          includeUsageData: false,
          webhookConfig: null,
          emailRecipients: ['ops@example.com'],
          slackConfig: null,
          alertConfig: null,
          active: true,
          createdAt: new Date('2026-05-21T00:00:00.000Z'),
          updatedAt: new Date('2026-05-21T00:00:00.000Z'),
        },
      ])
    )
  })

  it('lists subscriptions for accessible workspaces', async () => {
    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toHaveLength(1)
    expect(data.data[0]).toEqual(
      expect.objectContaining({
        id: 'sub-1',
        notificationType: 'email',
      })
    )
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-owner', 'owner-1')
  })

  it('returns 401 before validating invalid params for unauthenticated notification reads', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('returns 401 before validating invalid params or body for unauthenticated notification creates', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const response = await POST(createMockRequest('POST', {}), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('returns 404 for stale foreign personal workspaces before write checks', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-owner', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(
      createMockRequest('POST', {
        notificationType: 'email',
        workflowIds: [],
        allWorkflows: true,
        emailRecipients: ['ops@example.com'],
      }),
      { params: Promise.resolve({ id: 'ws-owner' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})
