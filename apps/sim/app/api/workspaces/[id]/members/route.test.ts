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

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { GET } from './route'

describe('GET /api/workspaces/[id]/members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' },
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: {
        id: 'ws-owner',
        name: 'Owner Workspace',
        ownerId: 'owner-1',
        workspaceMode: 'organization',
      },
    })
    permissionsMockFns.mockGetWorkspaceMemberProfiles.mockResolvedValue([
      { userId: 'owner-1', name: 'Owner', image: null },
      { userId: 'member-1', name: 'Member', image: null },
    ])
  })

  it('returns member profiles for workspace owners without explicit permission rows', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: {
        id: 'ws-owner',
        name: 'Owner Workspace',
        ownerId: 'owner-1',
        workspaceMode: 'organization',
      },
    })

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      members: [
        { userId: 'owner-1', name: 'Owner', image: null },
        { userId: 'member-1', name: 'Member', image: null },
      ],
    })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-owner', 'owner-1')
    expect(permissionsMockFns.mockGetWorkspaceMemberProfiles).toHaveBeenCalledWith('ws-owner')
  })

  it('returns 404 when the user cannot access the workspace', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: {
        id: 'ws-owner',
        name: 'Owner Workspace',
        ownerId: 'owner-1',
        workspaceMode: 'organization',
      },
    })

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Workspace not found or access denied' })
    expect(permissionsMockFns.mockGetWorkspaceMemberProfiles).not.toHaveBeenCalled()
  })

  it('returns 403 for personal workspaces', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: {
        id: 'ws-owner',
        name: 'Owner Workspace',
        ownerId: 'owner-1',
        workspaceMode: 'personal',
      },
    })

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Personal workspaces do not expose shared member lists' })
    expect(permissionsMockFns.mockGetWorkspaceMemberProfiles).not.toHaveBeenCalled()
  })
})
