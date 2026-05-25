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
  isNullMock,
  inArrayMock,
  limitMock,
  orderByMock,
  whereMock,
} = vi.hoisted(() => {
  const limitMock = vi.fn()
  const orderByMock = vi.fn(() => ({ limit: limitMock }))
  const whereMock = vi.fn(() => ({ orderBy: orderByMock }))
  const fromMock = vi.fn(() => ({ where: whereMock }))
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
    inArrayMock: vi.fn((left, right) => ({ kind: 'inArray', left, right })),
    isNullMock: vi.fn((value) => ({ kind: 'isNull', value })),
    limitMock,
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
  permissions: {},
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
  inArray: inArrayMock,
  isNull: isNullMock,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: checkWorkspaceAccessMock,
  getUserEntityPermissions: getUserEntityPermissionsMock,
  listAccessibleWorkspaceIds: vi.fn(),
}))

import {
  ensureWorkflowAccess,
  ensureWorkspaceAccess,
  getDefaultWorkspaceId,
} from '@/lib/copilot/tools/handlers/access'
import { listAccessibleWorkspaceIds } from '@/lib/workspaces/permissions/utils'

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
      'Canvas access required for workflow tools'
    )
  })
})

describe('getDefaultWorkspaceId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbSelectMock.mockReturnValue(chain)
    fromMock.mockReturnValue({ where: whereMock })
    whereMock.mockReturnValue({ orderBy: orderByMock })
    orderByMock.mockReturnValue({ limit: limitMock })
  })

  it('returns the newest owner workspace without an explicit permission row', async () => {
    vi.mocked(listAccessibleWorkspaceIds).mockResolvedValueOnce(['ws-owner', 'ws-team'])
    limitMock.mockResolvedValue([{ workspaceId: 'ws-owner' }])

    await expect(getDefaultWorkspaceId('user-owner')).resolves.toBe('ws-owner')

    expect(fromMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'workspace.id' }))
    expect(inArrayMock).toHaveBeenCalledWith('workspace.id', ['ws-owner', 'ws-team'])
  })

  it('throws when the user has no accessible workspace', async () => {
    vi.mocked(listAccessibleWorkspaceIds).mockResolvedValueOnce([])

    await expect(getDefaultWorkspaceId('user-missing')).rejects.toThrow('No canvas found for user')
  })
})

describe('ensureWorkspaceAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses canvas wording when the canvas is hidden or unavailable', async () => {
    checkWorkspaceAccessMock.mockResolvedValueOnce({
      exists: false,
      hasAccess: false,
    })

    await expect(ensureWorkspaceAccess('ws-hidden', 'user-1')).rejects.toThrow(
      'Canvas ws-hidden not found'
    )
  })

  it('uses canvas wording when admin access is required', async () => {
    checkWorkspaceAccessMock.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      workspace: { ownerId: 'owner-1' },
    })
    getUserEntityPermissionsMock.mockResolvedValueOnce('write')

    await expect(ensureWorkspaceAccess('ws-1', 'user-1', 'admin')).rejects.toThrow(
      'Admin access required for this canvas'
    )
  })

  it('uses canvas wording when write access is required', async () => {
    checkWorkspaceAccessMock.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: false,
      workspace: { ownerId: 'owner-1' },
    })

    await expect(ensureWorkspaceAccess('ws-1', 'user-1', 'write')).rejects.toThrow(
      'Write or admin access required for this canvas'
    )
  })
})
