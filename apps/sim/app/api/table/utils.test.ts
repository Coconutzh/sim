/**
 * @vitest-environment node
 */
import { permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetTableById } = vi.hoisted(() => ({
  mockGetTableById: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/table', () => ({
  getTableById: mockGetTableById,
}))

vi.mock('@/lib/api/contracts/tables', () => ({
  createTableColumnBodySchema: {},
  deleteTableColumnBodySchema: {},
  updateTableColumnBodySchema: {},
}))

import { checkAccess, checkTableAccess, checkTableWriteAccess } from '@/app/api/table/utils'

describe('table access utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue({
      id: 'tbl-1',
      workspaceId: 'ws-1',
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'user-1', workspaceMode: 'organization' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
  })

  it('hides foreign personal tables behind not found', async () => {
    mockGetTableById.mockResolvedValue({
      id: 'tbl-hidden',
      workspaceId: 'ws-hidden',
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    await expect(checkAccess('tbl-hidden', 'user-1')).resolves.toEqual({
      ok: false,
      status: 404,
    })
    await expect(checkTableAccess('tbl-hidden', 'user-1')).resolves.toEqual({
      hasAccess: false,
      notFound: true,
    })
    await expect(checkTableWriteAccess('tbl-hidden', 'user-1')).resolves.toEqual({
      hasAccess: false,
      notFound: true,
    })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('preserves 403 for visible tables without write permission', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')

    await expect(checkAccess('tbl-1', 'user-1', 'write')).resolves.toEqual({
      ok: false,
      status: 403,
    })
  })
})
