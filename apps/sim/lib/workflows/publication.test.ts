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
    workspaceTable: {
      id: 'workspace.id',
      name: 'workspace.name',
      ownerId: 'workspace.ownerId',
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

  it('lets a workspace owner browse published workflows for their workgroup', async () => {
    mockResultsQueue.push(
      [{ id: 'ws-in-wg' }],
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
      workspaceName: 'Team One',
      ownerWorkgroupId: 'wg-1',
    })
  })

  it('does not list organization-visible workflows from workspaces without a workgroup', async () => {
    mockResultsQueue.push([{ id: 'ws-in-wg' }], [{ organizationId: 'org-1' }], [], [])

    const result = await listPublishedWorkflowsForWorkgroup({
      workgroupId: 'wg-1',
      userId: 'owner-1',
    })

    expect(result).toEqual([])
  })

  it('does not list published workflows from personal workspaces in a workgroup', async () => {
    mockResultsQueue.push([{ id: 'ws-in-wg' }], [{ organizationId: 'org-1' }], [], [])

    const result = await listPublishedWorkflowsForWorkgroup({
      workgroupId: 'wg-1',
      userId: 'owner-1',
    })

    expect(result).toEqual([])
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
})
