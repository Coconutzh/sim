/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  andMock,
  authorizeWorkflowByWorkspacePermissionMock,
  chain,
  checkWorkspaceAccessMock,
  dbSelectMock,
  descMock,
  eqMock,
  fromMock,
  getUserEntityPermissionsMock,
  isNotNullMock,
  isNullMock,
  leftJoinMock,
  limitMock,
  orMock,
  orderByMock,
  whereMock,
} = vi.hoisted(() => {
  const limitMock = vi.fn()
  const orderByMock = vi.fn(() => ({ limit: limitMock }))
  const whereMock = vi.fn(() => ({ orderBy: orderByMock }))
  const leftJoinMock = vi.fn(() => ({ where: whereMock }))
  const fromMock = vi.fn(() => ({ leftJoin: leftJoinMock }))
  const chain = { from: fromMock }

  return {
    andMock: vi.fn((...args) => ({ kind: 'and', args })),
    authorizeWorkflowByWorkspacePermissionMock: vi.fn(),
    chain,
    checkWorkspaceAccessMock: vi.fn(),
    dbSelectMock: vi.fn(() => chain),
    descMock: vi.fn((value) => ({ kind: 'desc', value })),
    eqMock: vi.fn((left, right) => ({ kind: 'eq', left, right })),
    fromMock,
    getUserEntityPermissionsMock: vi.fn(),
    isNotNullMock: vi.fn((value) => ({ kind: 'isNotNull', value })),
    isNullMock: vi.fn((value) => ({ kind: 'isNull', value })),
    leftJoinMock,
    limitMock,
    orMock: vi.fn((...args) => ({ kind: 'or', args })),
    orderByMock,
    whereMock,
  }
})

vi.mock('@sim/db', () => ({
  db: {
    select: dbSelectMock,
  },
}))

vi.mock('@sim/db/schema', () => ({
  permissions: {
    entityId: 'permissions.entityId',
    entityType: 'permissions.entityType',
    id: 'permissions.id',
    userId: 'permissions.userId',
  },
  workspace: {
    archivedAt: 'workspace.archivedAt',
    createdAt: 'workspace.createdAt',
    id: 'workspace.id',
    ownerId: 'workspace.ownerId',
  },
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: authorizeWorkflowByWorkspacePermissionMock,
}))

vi.mock('drizzle-orm', () => ({
  and: andMock,
  desc: descMock,
  eq: eqMock,
  isNotNull: isNotNullMock,
  isNull: isNullMock,
  or: orMock,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: checkWorkspaceAccessMock,
  getUserEntityPermissions: getUserEntityPermissionsMock,
}))

import { ensureWorkflowAccess, getDefaultWorkspaceId } from '@/lib/copilot/tools/handlers/access'

describe('ensureWorkflowAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the workflow for workspace-backed access', async () => {
    authorizeWorkflowByWorkspacePermissionMock.mockResolvedValueOnce({
      allowed: true,
      accessSource: 'workspace',
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
    })

    await expect(ensureWorkflowAccess('wf-1', 'user-1')).resolves.toEqual({
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
      workspaceId: 'ws-1',
    })
  })

  it('rejects published workflow access for copilot workflow tools', async () => {
    authorizeWorkflowByWorkspacePermissionMock.mockResolvedValueOnce({
      allowed: true,
      accessSource: 'published',
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
    })

    await expect(ensureWorkflowAccess('wf-1', 'user-1')).rejects.toThrow(
      'Workspace access required for workflow tools'
    )
  })
})

describe('getDefaultWorkspaceId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbSelectMock.mockReturnValue(chain)
    fromMock.mockReturnValue({ leftJoin: leftJoinMock })
    leftJoinMock.mockReturnValue({ where: whereMock })
    whereMock.mockReturnValue({ orderBy: orderByMock })
    orderByMock.mockReturnValue({ limit: limitMock })
  })

  it('returns the newest owner workspace without an explicit permission row', async () => {
    limitMock.mockResolvedValue([{ workspaceId: 'ws-owner' }])

    await expect(getDefaultWorkspaceId('user-owner')).resolves.toBe('ws-owner')

    expect(fromMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'workspace.id' }))
    expect(leftJoinMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'permissions.entityId' }),
      expect.anything()
    )
    expect(isNotNullMock).toHaveBeenCalledWith('permissions.id')
    expect(orMock).toHaveBeenCalled()
  })

  it('throws when the user has no accessible workspace', async () => {
    limitMock.mockResolvedValue([])

    await expect(getDefaultWorkspaceId('user-missing')).rejects.toThrow(
      'No workspace found for user'
    )
  })
})
