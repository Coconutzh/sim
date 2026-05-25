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

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
  },
}))

vi.mock('@sim/db/schema', () => ({
  account: { accessToken: 'accessToken', id: 'id', userId: 'userId' },
  workspaceNotificationSubscription: {},
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { POST } from './route'

describe('POST /api/workspaces/[id]/notifications/[notificationId]/test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 before validating invalid params for unauthenticated notification tests', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ id: '', notificationId: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })

  it('returns 404 when stale personal rows no longer grant notification-test visibility', async () => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' },
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-owner', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ id: 'ws-owner', notificationId: 'sub-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})
