/**
 * @vitest-environment node
 */
import {
  auditMock,
  authMock,
  authMockFns,
  createMockRequest,
  permissionsMock,
  permissionsMockFns,
  posthogServerMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAnnotateWorkspaceCanvasMetadata, mockDbSelect, mockArchiveWorkspace } = vi.hoisted(
  () => ({
    mockAnnotateWorkspaceCanvasMetadata: vi.fn(async (workspaces: unknown[]) => workspaces),
    mockDbSelect: vi.fn(),
    mockArchiveWorkspace: vi.fn(),
  })
)

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  ;(chain as any).then = (resolve: (value: T) => unknown) => resolve(result)
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  },
}))

vi.mock('@sim/db/schema', () => schemaMock)
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/workspaces/lifecycle', () => ({
  archiveWorkspace: mockArchiveWorkspace,
}))

vi.mock('@/lib/workspaces/canvas-metadata', () => ({
  annotateWorkspaceCanvasMetadata: mockAnnotateWorkspaceCanvasMetadata,
}))

import { DELETE, GET, PATCH } from './route'

describe('DELETE /api/workspaces/[id]', () => {
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
    mockArchiveWorkspace.mockResolvedValue({ archived: true })
  })

  it('blocks deleting an owner-only canvas when it is the last accessible canvas', async () => {
    permissionsMockFns.mockListAccessibleWorkspaceIds.mockResolvedValueOnce(['ws-owner'])
    mockDbSelect.mockReturnValueOnce(createSelectChain([{ name: 'Owner Workspace' }]))

    const response = await DELETE(createMockRequest('DELETE', { deleteTemplates: false }), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Cannot delete the only canvas' })
    expect(permissionsMockFns.mockListAccessibleWorkspaceIds).toHaveBeenCalledWith('owner-1')
    expect(mockArchiveWorkspace).not.toHaveBeenCalled()
  })

  it('allows deleting an owner-only workspace when another accessible workspace exists', async () => {
    permissionsMockFns.mockListAccessibleWorkspaceIds.mockResolvedValueOnce(['ws-owner', 'ws-team'])
    mockDbSelect
      .mockReturnValueOnce(createSelectChain([{ name: 'Owner Workspace' }]))
      .mockReturnValueOnce(createSelectChain([]))

    const response = await DELETE(createMockRequest('DELETE', { deleteTemplates: false }), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ success: true })
    expect(mockArchiveWorkspace).toHaveBeenCalledWith('ws-owner', {
      requestId: 'workspace-ws-owner',
    })
  })

  it('returns 404 when stale personal rows no longer grant delete visibility', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-owner', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await DELETE(createMockRequest('DELETE', { deleteTemplates: false }), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(permissionsMockFns.mockListAccessibleWorkspaceIds).not.toHaveBeenCalled()
  })

  it('authenticates before reading delete workspace params', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    const params = {
      then: () => {
        throw new Error('params should not be parsed before auth')
      },
    } as Promise<{ id: string }>

    const response = await DELETE(createMockRequest('DELETE', { deleteTemplates: false }), {
      params,
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/workspaces/[id]', () => {
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
    permissionsMockFns.mockHasAdminPermission.mockResolvedValue(false)
  })

  it('rejects billed-account reassignment when helper denies admin access for a shared workspace member', async () => {
    mockDbSelect.mockReturnValueOnce(
      createSelectChain([
        {
          id: 'ws-shared',
          ownerId: 'owner-1',
          organizationId: null,
          workspaceMode: 'grandfathered_shared',
          archivedAt: null,
        },
      ])
    )

    const response = await PATCH(createMockRequest('PATCH', { billedAccountUserId: 'member-2' }), {
      params: Promise.resolve({ id: 'ws-shared' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Billed account must be a canvas admin' })
    expect(permissionsMockFns.mockHasAdminPermission).toHaveBeenCalledWith('member-2', 'ws-shared')
  })

  it('returns 404 when stale personal rows no longer grant canvas update visibility', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-owner', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await PATCH(createMockRequest('PATCH', { name: 'Renamed' }), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})

describe('GET /api/workspaces/[id]', () => {
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
    mockAnnotateWorkspaceCanvasMetadata.mockImplementation(async (workspaces) => workspaces)
  })

  it('returns 404 when stale personal rows no longer grant canvas visibility', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-owner', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-owner' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('authenticates before reading workspace params', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    const params = {
      then: () => {
        throw new Error('params should not be parsed before auth')
      },
    } as Promise<{ id: string }>

    const response = await GET(createMockRequest('GET'), { params })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })

  it('returns collaboration canvas compatibility metadata on workspace detail', async () => {
    mockDbSelect.mockReturnValueOnce(
      createSelectChain([
        {
          id: 'ws-team',
          name: 'Team Canvas',
          ownerId: 'owner-1',
          organizationId: 'org-1',
          workgroupId: 'wg-stage',
          workspaceMode: 'organization',
          billedAccountUserId: 'owner-1',
          archivedAt: null,
        },
      ])
    )
    mockAnnotateWorkspaceCanvasMetadata.mockImplementationOnce(
      async (workspaces: Array<Record<string, unknown>>) =>
        workspaces.map((workspace) => ({
          ...workspace,
          canvasScope: 'team',
          disciplineId: 'discipline-stage',
          isInternalWorkspace: true,
        }))
    )

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-team' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockAnnotateWorkspaceCanvasMetadata).toHaveBeenCalled()
    expect(data.workspace).toMatchObject({
      id: 'ws-team',
      canvasScope: 'team',
      workgroupId: 'wg-stage',
      disciplineId: 'discipline-stage',
      isInternalWorkspace: true,
      permissions: 'admin',
    })
  })
})
