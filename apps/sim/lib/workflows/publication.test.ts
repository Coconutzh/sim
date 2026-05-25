/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockResultsQueue,
  mockCheckWorkspaceAccess,
  permissionsTable,
  workflowTable,
  workflowPublicationScopeTable,
  workgroupTable,
  workgroupMemberTable,
  workspaceTable,
} = vi.hoisted(() => {
  const resultsQueue: unknown[] = []

  function createChain() {
    const chain: Record<string, unknown> = {}
    const resolveNext = () => (resultsQueue.shift() as unknown) ?? []

    ;(chain as any).from = vi.fn(() => chain)
    ;(chain as any).innerJoin = vi.fn(() => chain)
    ;(chain as any).leftJoin = vi.fn(() => chain)
    ;(chain as any).where = vi.fn(() => chain)
    ;(chain as any).orderBy = vi.fn(() => chain)
    ;(chain as any).limit = vi.fn(() => Promise.resolve(resolveNext()))
    ;(chain as any).then = (resolve: (value: unknown) => unknown) => resolve(resolveNext())

    return chain
  }

  return {
    mockResultsQueue: resultsQueue,
    mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
    mockCheckWorkspaceAccess: vi.fn(),
    permissionsTable: {
      id: 'permissions.id',
      entityId: 'permissions.entityId',
      entityType: 'permissions.entityType',
      userId: 'permissions.userId',
    },
    workflowTable: {
      id: 'workflow.id',
      name: 'workflow.name',
      description: 'workflow.description',
      color: 'workflow.color',
      workspaceId: 'workflow.workspaceId',
      folderId: 'workflow.folderId',
      sortOrder: 'workflow.sortOrder',
      track: 'workflow.track',
      visibility: 'workflow.visibility',
      sourceWorkflowId: 'workflow.sourceWorkflowId',
      publishedAt: 'workflow.publishedAt',
      createdAt: 'workflow.createdAt',
      updatedAt: 'workflow.updatedAt',
      archivedAt: 'workflow.archivedAt',
      locked: 'workflow.locked',
    },
    workflowPublicationScopeTable: {
      workflowId: 'workflowPublicationScope.workflowId',
      viewerWorkgroupId: 'workflowPublicationScope.viewerWorkgroupId',
    },
    workgroupTable: {
      id: 'workgroup.id',
      organizationId: 'workgroup.organizationId',
    },
    workgroupMemberTable: {
      id: 'workgroupMember.id',
      userId: 'workgroupMember.userId',
      workgroupId: 'workgroupMember.workgroupId',
    },
    workspaceTable: {
      id: 'workspace.id',
      name: 'workspace.name',
      ownerId: 'workspace.ownerId',
      workspaceMode: 'workspace.workspaceMode',
      workgroupId: 'workspace.workgroupId',
      organizationId: 'workspace.organizationId',
      archivedAt: 'workspace.archivedAt',
    },
    mockDb: {
      select: vi.fn(() => createChain()),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  }
})

vi.mock('@sim/db', () => ({
  db: mockDb,
}))

vi.mock('@sim/db/schema', () => ({
  permissions: permissionsTable,
  workflow: workflowTable,
  workflowPublicationScope: workflowPublicationScopeTable,
  workgroup: workgroupTable,
  workgroupMember: workgroupMemberTable,
  workspace: workspaceTable,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: vi.fn(),
  saveWorkflowToNormalizedTables: vi.fn(),
}))

vi.mock('@/lib/workflows/utils', () => ({
  deduplicateWorkflowName: vi.fn(),
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

import {
  getWorkflowPublicationDetails,
  listPublishedWorkflowsForWorkgroup,
  listWorkflowTracksForWorkspace,
  publishWorkflowToMainline,
  updateWorkflowPublicationDetails,
} from './publication'

describe('workflow publication access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResultsQueue.length = 0
    mockAuthorizeWorkflowByWorkspacePermission.mockReset()
  })

  it('lets a workspace owner load workflow tracks without an explicit permission row', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1' },
    })
    mockResultsQueue.push([
      {
        id: 'draft-1',
        name: 'Draft canvas',
        description: null,
        color: '#000000',
        workspaceId: 'ws-1',
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
    ])

    const result = await listWorkflowTracksForWorkspace({ workspaceId: 'ws-1', userId: 'owner-1' })

    expect(result.drafts).toHaveLength(1)
    expect(result.published).toHaveLength(0)
    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'owner-1')
  })

  it('lets a workgroup member browse published workflows for their workgroup', async () => {
    mockResultsQueue.push(
      [{ id: 'membership-1' }],
      [{ organizationId: 'org-1' }],
      [],
      [
        {
          id: 'published-1',
          name: 'Team canvas',
          description: null,
          color: '#000000',
          workspaceId: 'ws-team',
          folderId: null,
          sortOrder: 0,
          track: 'published',
          visibility: 'workspace',
          sourceWorkflowId: 'draft-1',
          publishedAt: new Date('2026-05-20T00:00:00Z'),
          createdAt: new Date('2026-05-20T00:00:00Z'),
          updatedAt: new Date('2026-05-20T00:00:00Z'),
          archivedAt: null,
          locked: false,
          workspaceName: 'Team One',
          ownerWorkgroupId: 'wg-1',
        },
      ]
    )

    const result = await listPublishedWorkflowsForWorkgroup({
      workgroupId: 'wg-1',
      userId: 'owner-1',
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'published-1',
      track: 'published',
      visibility: 'workspace',
      publishedAt: '2026-05-20T00:00:00.000Z',
      workspaceName: 'Team One',
    })
    expect(result[0]).not.toHaveProperty('sourceWorkflowId')
    expect(result[0]).not.toHaveProperty('workspaceId')
    expect(result[0]).not.toHaveProperty('folderId')
    expect(result[0]).not.toHaveProperty('sortOrder')
    expect(result[0]).not.toHaveProperty('locked')
    expect(result[0]).not.toHaveProperty('ownerWorkgroupId')
  })

  it('does not list organization-visible workflows from workspaces without a workgroup', async () => {
    mockResultsQueue.push([{ id: 'membership-1' }], [{ organizationId: 'org-1' }], [], [])

    const result = await listPublishedWorkflowsForWorkgroup({
      workgroupId: 'wg-1',
      userId: 'owner-1',
    })

    expect(result).toEqual([])
  })

  it('does not list published workflows from personal workspaces in a workgroup', async () => {
    mockResultsQueue.push([{ id: 'membership-1' }], [{ organizationId: 'org-1' }], [], [])

    const result = await listPublishedWorkflowsForWorkgroup({
      workgroupId: 'wg-1',
      userId: 'owner-1',
    })

    expect(result).toEqual([])
  })

  it('rejects workgroup browsing without an active membership row', async () => {
    mockResultsQueue.push([])

    await expect(
      listPublishedWorkflowsForWorkgroup({
        workgroupId: 'wg-foreign',
        userId: 'viewer-1',
      })
    ).rejects.toThrow('Access denied to workgroup')
  })

  it('redacts workspace-only publication metadata for cross-team readers', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      workflow: {
        id: 'published-1',
        track: 'published',
        visibility: 'organization',
        sourceWorkflowId: 'draft-1',
        publishedAt: new Date('2026-05-20T00:00:00Z'),
        publishedBy: 'owner-1',
      },
      accessSource: 'organization',
    })

    const result = await getWorkflowPublicationDetails({
      workflowId: 'published-1',
      userId: 'viewer-1',
    })

    expect(result).toMatchObject({
      workflowId: 'published-1',
      sourceWorkflowId: null,
      publishedBy: null,
      viewerScopes: [],
    })
  })

  it('rejects publishing from cross-team shared access', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      workflow: {
        id: 'draft-1',
        track: 'draft',
        name: 'Draft canvas',
        workspaceId: 'ws-1',
        folderId: null,
      },
      accessSource: 'selected_workgroups',
    })

    await expect(
      publishWorkflowToMainline({
        workflowId: 'draft-1',
        userId: 'viewer-1',
        visibility: 'workspace',
        viewerWorkgroupIds: [],
      })
    ).rejects.toThrow('Canvas access required')
  })

  it('rejects publication updates from cross-team shared access', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      workflow: {
        id: 'published-1',
        track: 'published',
        name: 'Team canvas',
        workspaceId: 'ws-1',
      },
      accessSource: 'organization',
    })

    await expect(
      updateWorkflowPublicationDetails({
        workflowId: 'published-1',
        userId: 'viewer-1',
        visibility: 'organization',
        viewerWorkgroupIds: [],
      })
    ).rejects.toThrow('Canvas access required')
  })
})
