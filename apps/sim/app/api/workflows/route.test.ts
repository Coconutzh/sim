/**
 * @vitest-environment node
 */
import {
  auditMock,
  createMockRequest,
  hybridAuthMockFns,
  permissionsMock,
  permissionsMockFns,
  workflowsApiUtilsMock,
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { drizzleOrmMock } from '@sim/testing/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockWorkflowCreated, mockDbSelect, mockDbInsert } = vi.hoisted(() => ({
  mockWorkflowCreated: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
}))

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions
const mockListAccessibleWorkspaceIds = permissionsMockFns.mockListAccessibleWorkspaceIds
const mockGetWorkspaceWithOwner = permissionsMockFns.mockGetWorkspaceWithOwner
const mockCheckWorkspaceAccess = permissionsMockFns.mockCheckWorkspaceAccess
const mockGetActiveFolderInWorkspace = workflowsUtilsMockFns.mockGetActiveFolderInWorkspace

vi.mock('drizzle-orm', () => ({
  ...drizzleOrmMock,
  min: vi.fn((field) => ({ type: 'min', field })),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    transaction: vi.fn(async (fn: (tx: Record<string, unknown>) => Promise<void>) => {
      const tx = {
        select: (...args: unknown[]) => mockDbSelect(...args),
        insert: (...args: unknown[]) => mockDbInsert(...args),
      }
      await fn(tx)
    }),
  },
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: {
    workflowCreated: (...args: unknown[]) => mockWorkflowCreated(...args),
  },
}))

vi.mock('@/lib/workflows/defaults', () => ({
  buildDefaultWorkflowArtifacts: vi.fn().mockReturnValue({
    workflowState: { blocks: {}, edges: [], loops: {}, parallels: {} },
    subBlockValues: {},
    startBlockId: 'start-block-id',
  }),
}))

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

import { GET, POST } from '@/app/api/workflows/route'

describe('Workflows API Route - POST ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('workflow-new-id'),
    })

    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      userName: 'Test User',
      userEmail: 'test@example.com',
    })
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: {
        id: 'workspace-123',
        ownerId: 'user-123',
        workspaceMode: 'organization',
      },
    })
    mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-123',
      name: 'Workspace',
      ownerId: 'user-123',
      organizationId: 'org-1',
      workgroupId: 'wg-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'user-123',
      archivedAt: null,
    })
    workflowsPersistenceUtilsMockFns.mockSaveWorkflowToNormalizedTables.mockResolvedValue({
      success: true,
    })
    workflowsUtilsMockFns.mockDeduplicateWorkflowName.mockResolvedValue('New Workflow')
    mockGetActiveFolderInWorkspace.mockResolvedValue({
      id: 'folder-1',
      workspaceId: 'workspace-123',
      parentId: null,
    })
  })

  it('uses top insertion against mixed siblings (folders + workflows)', async () => {
    const minResultsQueue: Array<Array<{ minOrder: number }>> = [
      [{ minOrder: 5 }],
      [{ minOrder: 2 }],
      [],
    ]

    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(() => Promise.resolve(minResultsQueue.shift() ?? [])),
          then: (onFulfilled: (value: Array<{ minOrder: number }>) => unknown) =>
            Promise.resolve(minResultsQueue.shift() ?? []).then(onFulfilled),
        })),
      }),
    }))

    let insertedValues: Record<string, unknown> | null = null
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockImplementation((values: Record<string, unknown>) => {
        insertedValues = values
        return Promise.resolve(undefined)
      }),
    })

    const req = createMockRequest('POST', {
      name: 'New Workflow',
      description: 'desc',
      color: '#3972F6',
      workspaceId: 'workspace-123',
      folderId: null,
    })

    const response = await POST(req)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.sortOrder).toBe(1)
    expect(insertedValues).not.toBeNull()
    expect(insertedValues?.sortOrder).toBe(1)
  })

  it('defaults to sortOrder 0 when there are no siblings', async () => {
    const minResultsQueue: Array<Array<{ minOrder: number }>> = [[], [], []]

    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(() => Promise.resolve(minResultsQueue.shift() ?? [])),
          then: (onFulfilled: (value: Array<{ minOrder: number }>) => unknown) =>
            Promise.resolve(minResultsQueue.shift() ?? []).then(onFulfilled),
        })),
      }),
    }))

    let insertedValues: Record<string, unknown> | null = null
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockImplementation((values: Record<string, unknown>) => {
        insertedValues = values
        return Promise.resolve(undefined)
      }),
    })

    const req = createMockRequest('POST', {
      name: 'New Workflow',
      description: 'desc',
      color: '#3972F6',
      workspaceId: 'workspace-123',
      folderId: null,
    })

    const response = await POST(req)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.sortOrder).toBe(0)
    expect(insertedValues?.sortOrder).toBe(0)
  })

  it('rejects cross-team workflow creation for workspaces without a workgroup', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-123',
      name: 'Workspace',
      ownerId: 'user-123',
      organizationId: 'org-1',
      workgroupId: null,
      workspaceMode: 'organization',
      billedAccountUserId: 'user-123',
      archivedAt: null,
    })

    const req = createMockRequest('POST', {
      name: 'Shared Workflow',
      description: 'desc',
      color: '#3972F6',
      workspaceId: 'workspace-123',
      visibility: 'organization',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe(
      'Only organization team canvases with a workgroup can create cross-team workflows'
    )
  })

  it('rejects cross-team workflow creation for personal workspaces even with a workgroup', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-123',
      name: 'Workspace',
      ownerId: 'user-123',
      organizationId: 'org-1',
      workgroupId: 'wg-1',
      workspaceMode: 'personal',
      billedAccountUserId: 'user-123',
      archivedAt: null,
    })

    const req = createMockRequest('POST', {
      name: 'Shared Workflow',
      description: 'desc',
      color: '#3972F6',
      workspaceId: 'workspace-123',
      visibility: 'organization',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe(
      'Only organization team canvases with a workgroup can create cross-team workflows'
    )
  })

  it('rejects direct published workflow creation outside the publish flow', async () => {
    const req = createMockRequest('POST', {
      name: 'Published Workflow',
      description: 'desc',
      color: '#3972F6',
      workspaceId: 'workspace-123',
      track: 'published',
      visibility: 'organization',
      sourceWorkflowId: 'workflow-draft-123',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Published workflows must be created via the publish workflow flow')
    expect(mockDbInsert).not.toHaveBeenCalled()
    expect(
      workflowsPersistenceUtilsMockFns.mockSaveWorkflowToNormalizedTables
    ).not.toHaveBeenCalled()
  })

  it('returns 404 when stale personal rows no longer grant workflow creation visibility', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: {
        id: 'workspace-123',
        ownerId: 'owner-2',
        workspaceMode: 'personal',
      },
    })

    const req = createMockRequest('POST', {
      name: 'Hidden Workflow',
      description: 'desc',
      color: '#3972F6',
      workspaceId: 'workspace-123',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Canvas not found')
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('rejects workflow creation in a folder outside the target workspace', async () => {
    mockGetActiveFolderInWorkspace.mockResolvedValueOnce(null)

    const req = createMockRequest('POST', {
      name: 'Hidden Folder Workflow',
      description: 'desc',
      color: '#3972F6',
      workspaceId: 'workspace-123',
      folderId: 'foreign-folder',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Folder not found')
    expect(mockGetActiveFolderInWorkspace).toHaveBeenCalledWith('foreign-folder', 'workspace-123')
    expect(mockDbInsert).not.toHaveBeenCalled()
  })
})

describe('Workflows API Route - GET access', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      userName: 'Test User',
      userEmail: 'test@example.com',
    })
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: {
        id: 'workspace-owned',
        ownerId: 'user-123',
        workspaceMode: 'organization',
      },
    })
  })

  it('lists workflows from owned workspaces when no explicit permission row exists', async () => {
    mockListAccessibleWorkspaceIds.mockResolvedValue(['workspace-owned'])
    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([
            {
              id: 'workflow-1',
              name: 'Owned Workflow',
              description: null,
              color: '#3972F6',
              workspaceId: 'workspace-owned',
              folderId: null,
              sortOrder: 0,
              track: 'draft',
              visibility: 'workspace',
              sourceWorkflowId: null,
              publishedAt: null,
              createdAt: new Date('2026-05-20T00:00:00Z'),
              updatedAt: new Date('2026-05-20T00:00:00Z'),
              archivedAt: null,
              locked: false,
            },
          ]),
        }),
      }),
    }))

    const response = await GET(createMockRequest('GET'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockListAccessibleWorkspaceIds).toHaveBeenCalledWith('user-123')
    expect(data.data).toHaveLength(1)
    expect(data.data[0]).toMatchObject({
      id: 'workflow-1',
      workspaceId: 'workspace-owned',
    })
  })

  it('returns 404 when filtering a stale foreign personal workspace', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: {
        id: 'workspace-hidden',
        ownerId: 'owner-2',
        workspaceMode: 'personal',
      },
    })

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/workflows?workspaceId=workspace-hidden'
      )
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({
      error: 'Canvas not found',
      code: 'WORKSPACE_NOT_FOUND',
    })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
