/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockResultsQueue, schemaMock } = vi.hoisted(() => {
  const resultsQueue: unknown[] = []

  function createChain() {
    const chain: Record<string, unknown> = {}
    const resolveNext = () => (resultsQueue.shift() as unknown) ?? []

    chain.from = vi.fn(() => chain)
    chain.innerJoin = vi.fn(() => chain)
    chain.where = vi.fn(() => chain)
    chain.limit = vi.fn(() => Promise.resolve(resolveNext()))
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(resolveNext()))

    return chain
  }

  return {
    mockResultsQueue: resultsQueue,
    mockDb: {
      select: vi.fn(() => createChain()),
    },
    schemaMock: {
      member: {
        id: 'member.id',
        userId: 'member.userId',
        organizationId: 'member.organizationId',
        role: 'member.role',
      },
      personalCanvasWorkspace: {
        id: 'personalCanvasWorkspace.id',
        userId: 'personalCanvasWorkspace.userId',
        workspaceId: 'personalCanvasWorkspace.workspaceId',
      },
      workflowPublicationScope: {
        id: 'workflowPublicationScope.id',
        workflowId: 'workflowPublicationScope.workflowId',
        viewerWorkgroupId: 'workflowPublicationScope.viewerWorkgroupId',
      },
      workflowPublicationVersion: {
        id: 'workflowPublicationVersion.id',
        organizationId: 'workflowPublicationVersion.organizationId',
        sourceWorkgroupId: 'workflowPublicationVersion.sourceWorkgroupId',
        visibility: 'workflowPublicationVersion.visibility',
        publishedWorkflowId: 'workflowPublicationVersion.publishedWorkflowId',
        status: 'workflowPublicationVersion.status',
      },
      workgroup: { id: 'workgroup.id', organizationId: 'workgroup.organizationId' },
      workgroupMember: {
        id: 'workgroupMember.id',
        userId: 'workgroupMember.userId',
        workgroupId: 'workgroupMember.workgroupId',
        role: 'workgroupMember.role',
      },
    },
  }
})

vi.mock('@sim/db', () => ({ db: mockDb }))
vi.mock('@sim/db/schema', () => schemaMock)
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ kind: 'and', args })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
}))

import {
  canPublishTeamCanvas,
  canReadPersonalCanvas,
  canReadPublication,
  canReadTeamCanvas,
  canWritePersonalCanvas,
  canWriteTeamCanvas,
} from '@/lib/collaboration/authz'

describe('collaboration authz helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResultsQueue.length = 0
  })

  it('allows only the owner mapping to read and write a personal canvas', async () => {
    mockResultsQueue.push([{ id: 'personal-canvas-1' }], [])

    await expect(canReadPersonalCanvas('owner-1', 'workspace-1')).resolves.toBe(true)
    await expect(canWritePersonalCanvas('other-user', 'workspace-1')).resolves.toBe(false)
  })

  it('allows only workgroup members to read and write a team canvas', async () => {
    mockResultsQueue.push([{ id: 'membership-1' }], [])

    await expect(canReadTeamCanvas('member-1', 'workgroup-1')).resolves.toBe(true)
    await expect(canWriteTeamCanvas('outsider-1', 'workgroup-1')).resolves.toBe(false)
  })

  it('allows team admins and organization admins to publish team canvases', async () => {
    mockResultsQueue.push(
      [{ organizationId: 'org-1' }],
      [{ role: 'admin' }],
      [{ organizationId: 'org-1' }],
      [],
      [{ role: 'owner' }]
    )

    await expect(canPublishTeamCanvas('team-admin-1', 'workgroup-1')).resolves.toBe(true)
    await expect(canPublishTeamCanvas('org-owner-1', 'workgroup-1')).resolves.toBe(true)
  })

  it('denies publication for non-admin team members', async () => {
    mockResultsQueue.push([{ organizationId: 'org-1' }], [{ role: 'member' }], [{ role: 'member' }])

    await expect(canPublishTeamCanvas('member-1', 'workgroup-1')).resolves.toBe(false)
  })

  it('denies publication for admins of a different team', async () => {
    mockResultsQueue.push([{ organizationId: 'org-1' }], [], [{ role: 'member' }])

    await expect(canPublishTeamCanvas('other-team-admin-1', 'workgroup-1')).resolves.toBe(false)
  })

  it('does not let project admins read personal canvases without owner mapping', async () => {
    mockResultsQueue.push([])

    await expect(canReadPersonalCanvas('project-admin-1', 'personal-workspace-1')).resolves.toBe(
      false
    )
  })

  it('allows publication reads for source team members', async () => {
    mockResultsQueue.push(
      [
        {
          organizationId: 'org-1',
          sourceWorkgroupId: 'source-workgroup',
          visibility: 'selected_workgroups',
          publishedWorkflowId: 'published-workflow-1',
        },
      ],
      [{ id: 'source-membership-1' }]
    )

    await expect(canReadPublication('publisher-1', 'publication-1')).resolves.toBe(true)
  })

  it('allows organization-visible publication reads for organization members', async () => {
    mockResultsQueue.push(
      [
        {
          organizationId: 'org-1',
          sourceWorkgroupId: 'source-workgroup',
          visibility: 'organization',
          publishedWorkflowId: 'published-workflow-1',
        },
      ],
      [],
      [{ id: 'org-member-1' }]
    )

    await expect(canReadPublication('viewer-1', 'publication-1')).resolves.toBe(true)
  })

  it('allows selected publication reads for explicitly scoped workgroups', async () => {
    mockResultsQueue.push(
      [
        {
          organizationId: 'org-1',
          sourceWorkgroupId: 'source-workgroup',
          visibility: 'selected_workgroups',
          publishedWorkflowId: 'published-workflow-1',
        },
      ],
      [],
      [{ id: 'scope-1' }]
    )

    await expect(canReadPublication('viewer-1', 'publication-1')).resolves.toBe(true)
  })

  it('denies selected publication reads outside source team and visibility scope', async () => {
    mockResultsQueue.push(
      [
        {
          organizationId: 'org-1',
          sourceWorkgroupId: 'source-workgroup',
          visibility: 'selected_workgroups',
          publishedWorkflowId: 'published-workflow-1',
        },
      ],
      [],
      []
    )

    await expect(canReadPublication('outsider-1', 'publication-1')).resolves.toBe(false)
  })

  it('denies reads for retracted publication versions', async () => {
    mockResultsQueue.push([
      {
        organizationId: 'org-1',
        sourceWorkgroupId: 'source-workgroup',
        visibility: 'organization',
        publishedWorkflowId: 'published-workflow-1',
        status: 'retracted',
      },
    ])

    await expect(canReadPublication('viewer-1', 'publication-1')).resolves.toBe(false)
  })
})
