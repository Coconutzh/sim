/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockResultsQueue,
  memberTable,
  permissionsTable,
  workflowFolderTable,
  workflowPublicationScopeTable,
  workflowTable,
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
    ;(chain as any).limit = vi.fn(() => Promise.resolve(resolveNext()))
    ;(chain as any).then = (resolve: (value: unknown) => unknown) => resolve(resolveNext())

    return chain
  }

  return {
    mockResultsQueue: resultsQueue,
    workflowTable: { name: 'workflow' },
    workspaceTable: { name: 'workspace' },
    permissionsTable: { name: 'permissions' },
    memberTable: { name: 'member' },
    workgroupMemberTable: { name: 'workgroupMember' },
    workflowPublicationScopeTable: { name: 'workflowPublicationScope' },
    workflowFolderTable: { name: 'workflowFolder' },
    mockDb: {
      select: vi.fn(() => createChain()),
    },
  }
})

vi.mock('@sim/db', () => ({
  db: mockDb,
  workflow: workflowTable,
  workspace: workspaceTable,
  permissions: permissionsTable,
  member: memberTable,
  workflowPublicationScope: workflowPublicationScopeTable,
  workgroupMember: workgroupMemberTable,
  workflowFolder: workflowFolderTable,
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ kind: 'and', args })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({ kind: 'inArray', left, right })),
  isNull: vi.fn((value: unknown) => ({ kind: 'isNull', value })),
}))

import { authorizeWorkflowByWorkspacePermission, resolveCanvasScope } from './index'

describe('authorizeWorkflowByWorkspacePermission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResultsQueue.length = 0
  })

  it('treats a team admin member as admin for team canvas workflows', async () => {
    mockResultsQueue.push(
      [
        {
          workflow: {
            id: 'wf-1',
            workspaceId: 'ws-1',
            track: 'draft',
            visibility: 'workspace',
          },
          workspaceId: 'ws-1',
          workspaceOrganizationId: null,
          workspaceWorkgroupId: 'wg-1',
          workspaceMode: 'organization',
        },
      ],
      [{ ownerId: 'owner-1', workspaceMode: 'organization', workgroupId: 'wg-1' }],
      [{ role: 'admin' }]
    )

    const result = await authorizeWorkflowByWorkspacePermission({
      workflowId: 'wf-1',
      userId: 'owner-1',
      action: 'admin',
    })

    expect(result).toMatchObject({
      allowed: true,
      workspacePermission: 'admin',
      accessSource: 'workspace',
    })
  })

  it('includes team memberships when evaluating selected workgroup visibility', async () => {
    mockResultsQueue.push(
      [
        {
          workflow: {
            id: 'wf-2',
            workspaceId: 'ws-published',
            track: 'published',
            visibility: 'selected_workgroups',
          },
          workspaceId: 'ws-published',
          workspaceOrganizationId: 'org-1',
          workspaceWorkgroupId: 'publisher-wg',
          workspaceMode: 'organization',
        },
      ],
      [{ ownerId: 'other-user', workspaceMode: 'organization', workgroupId: 'publisher-wg' }],
      [],
      [{ workgroupId: 'viewer-wg' }],
      [{ id: 'scope-1' }]
    )

    const result = await authorizeWorkflowByWorkspacePermission({
      workflowId: 'wf-2',
      userId: 'viewer-owner',
      action: 'read',
    })

    expect(result).toMatchObject({
      allowed: true,
      workspacePermission: 'read',
      accessSource: 'selected_workgroups',
    })
  })

  it('does not expose non-workgroup published workflows through organization visibility', async () => {
    mockResultsQueue.push(
      [
        {
          workflow: {
            id: 'wf-3',
            workspaceId: 'ws-personal',
            track: 'published',
            visibility: 'organization',
          },
          workspaceId: 'ws-personal',
          workspaceOrganizationId: 'org-1',
          workspaceWorkgroupId: null,
        },
      ],
      [{ ownerId: 'other-user', workspaceMode: 'organization', workgroupId: null }],
      []
    )

    const result = await authorizeWorkflowByWorkspacePermission({
      workflowId: 'wf-3',
      userId: 'org-member',
      action: 'read',
    })

    expect(result).toMatchObject({
      allowed: false,
      accessSource: null,
    })
  })

  it('does not expose personal published workflows across teams even if they have a workgroup id', async () => {
    mockResultsQueue.push(
      [
        {
          workflow: {
            id: 'wf-4',
            workspaceId: 'ws-personal',
            track: 'published',
            visibility: 'selected_workgroups',
          },
          workspaceId: 'ws-personal',
          workspaceOrganizationId: 'org-1',
          workspaceWorkgroupId: 'personal-wg',
          workspaceMode: 'personal',
        },
      ],
      [{ ownerId: 'other-user', workspaceMode: 'personal', workgroupId: 'personal-wg' }],
      []
    )

    const result = await authorizeWorkflowByWorkspacePermission({
      workflowId: 'wf-4',
      userId: 'viewer-owner',
      action: 'read',
    })

    expect(result).toMatchObject({
      allowed: false,
      accessSource: null,
      workspaceMode: 'personal',
    })
  })

  it('ignores direct permission rows for personal workspaces owned by another user', async () => {
    mockResultsQueue.push(
      [
        {
          workflow: {
            id: 'wf-5',
            workspaceId: 'ws-foreign-personal',
            track: 'draft',
            visibility: 'workspace',
          },
          workspaceId: 'ws-foreign-personal',
          workspaceOrganizationId: null,
          workspaceWorkgroupId: 'wg-foreign',
          workspaceMode: 'personal',
        },
      ],
      [{ ownerId: 'other-user', workspaceMode: 'personal', workgroupId: 'wg-foreign' }]
    )

    const result = await authorizeWorkflowByWorkspacePermission({
      workflowId: 'wf-5',
      userId: 'viewer-user',
      action: 'read',
    })

    expect(result).toMatchObject({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      accessSource: null,
      workspacePermission: null,
      workspaceMode: 'personal',
    })
  })

  it('does not derive selected-workgroup visibility from foreign personal workspaces', async () => {
    mockResultsQueue.push(
      [
        {
          workflow: {
            id: 'wf-6',
            workspaceId: 'ws-published',
            track: 'published',
            visibility: 'selected_workgroups',
          },
          workspaceId: 'ws-published',
          workspaceOrganizationId: 'org-1',
          workspaceWorkgroupId: 'publisher-wg',
          workspaceMode: 'organization',
        },
      ],
      [{ ownerId: 'other-user', workspaceMode: 'organization', workgroupId: 'publisher-wg' }],
      [],
      [],
      []
    )

    const result = await authorizeWorkflowByWorkspacePermission({
      workflowId: 'wf-6',
      userId: 'viewer-user',
      action: 'read',
    })

    expect(result).toMatchObject({
      allowed: false,
      accessSource: null,
      workspacePermission: null,
      workspaceMode: 'organization',
    })
  })

  it('ignores stale workspace permission rows when the user is not a team member', async () => {
    mockResultsQueue.push(
      [
        {
          workflow: {
            id: 'wf-7',
            workspaceId: 'ws-team',
            track: 'draft',
            visibility: 'workspace',
          },
          workspaceId: 'ws-team',
          workspaceOrganizationId: 'org-1',
          workspaceWorkgroupId: 'team-wg',
          workspaceMode: 'organization',
        },
      ],
      [{ ownerId: 'creator-1', workspaceMode: 'organization', workgroupId: 'team-wg' }],
      []
    )

    const result = await authorizeWorkflowByWorkspacePermission({
      workflowId: 'wf-7',
      userId: 'removed-user',
      action: 'read',
    })

    expect(result).toMatchObject({
      allowed: false,
      status: 403,
      workspacePermission: null,
      accessSource: null,
      workspaceMode: 'organization',
    })
  })
})

describe('resolveCanvasScope', () => {
  it('resolves personal workspaces to personal scope', () => {
    expect(resolveCanvasScope({ workspaceMode: 'personal', accessSource: 'workspace' })).toBe(
      'personal'
    )
  })

  it('resolves organization workgroup workspaces to team scope', () => {
    expect(
      resolveCanvasScope({
        workspaceMode: 'organization',
        workspaceWorkgroupId: 'workgroup-1',
        accessSource: 'workspace',
      })
    ).toBe('team')
  })

  it('resolves cross-team publication access to showcase scope', () => {
    expect(
      resolveCanvasScope({
        workspaceMode: 'organization',
        workspaceWorkgroupId: 'workgroup-1',
        accessSource: 'selected_workgroups',
      })
    ).toBe('showcase')
  })
})
