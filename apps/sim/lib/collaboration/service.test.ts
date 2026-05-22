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
    chain.leftJoin = vi.fn(() => chain)
    chain.orderBy = vi.fn(() => chain)
    chain.where = vi.fn(() => chain)
    chain.limit = vi.fn(() => Promise.resolve(resolveNext()))
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(resolveNext()))

    return chain
  }

  function createWriteChain() {
    const chain: Record<string, unknown> = {}

    chain.set = vi.fn(() => chain)
    chain.where = vi.fn(() => Promise.resolve([]))

    return chain
  }

  return {
    mockResultsQueue: resultsQueue,
    mockDb: {
      select: vi.fn(() => createChain()),
      update: vi.fn(() => createWriteChain()),
    },
    schemaMock: {
      workflowPublicationVersion: {
        id: 'workflowPublicationVersion.id',
        title: 'workflowPublicationVersion.title',
        description: 'workflowPublicationVersion.description',
        parentVersionId: 'workflowPublicationVersion.parentVersionId',
        versionNumber: 'workflowPublicationVersion.versionNumber',
        sourceWorkflowId: 'workflowPublicationVersion.sourceWorkflowId',
        sourceWorkgroupId: 'workflowPublicationVersion.sourceWorkgroupId',
        sourceDisciplineId: 'workflowPublicationVersion.sourceDisciplineId',
        snapshotState: 'workflowPublicationVersion.snapshotState',
        snapshotMetadata: 'workflowPublicationVersion.snapshotMetadata',
        publishedAt: 'workflowPublicationVersion.publishedAt',
      },
      discipline: {
        id: 'discipline.id',
        code: 'discipline.code',
        name: 'discipline.name',
      },
      member: {
        role: 'member.role',
        userId: 'member.userId',
        organizationId: 'member.organizationId',
      },
      workgroup: {
        id: 'workgroup.id',
        organizationId: 'workgroup.organizationId',
      },
      workgroupMember: {
        id: 'workgroupMember.id',
        role: 'workgroupMember.role',
        userId: 'workgroupMember.userId',
        organizationId: 'workgroupMember.organizationId',
        workgroupId: 'workgroupMember.workgroupId',
      },
    },
  }
})

vi.mock('@sim/db', () => ({ db: mockDb }))
vi.mock('@sim/db/schema', () => schemaMock)
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'generated-id'),
  generateShortId: vi.fn(() => 'short-id'),
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ kind: 'and', args })),
  asc: vi.fn((value: unknown) => ({ kind: 'asc', value })),
  desc: vi.fn((value: unknown) => ({ kind: 'desc', value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({ kind: 'inArray', left, right })),
  isNull: vi.fn((value: unknown) => ({ kind: 'isNull', value })),
  max: vi.fn((value: unknown) => ({ kind: 'max', value })),
  or: vi.fn((...args: unknown[]) => ({ kind: 'or', args })),
  sql: vi.fn(() => 'sql'),
}))
vi.mock('@/lib/collaboration/authz', () => ({
  canPublishTeamCanvas: vi.fn(),
  canReadPublication: vi.fn(),
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: vi.fn(),
}))

import { canReadPublication } from '@/lib/collaboration/authz'
import {
  assertWorkgroupAdmin,
  getNextPublicationVersionNumber,
  getPublication,
  getPublicationTree,
  updateWorkgroupMemberRole,
} from '@/lib/collaboration/service'

describe('collaboration service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResultsQueue.length = 0
  })

  it('starts publication versioning at one', async () => {
    mockResultsQueue.push([{ value: null }])

    await expect(getNextPublicationVersionNumber('workflow-1')).resolves.toBe(1)
  })

  it('increments from the current max publication version', async () => {
    mockResultsQueue.push([{ value: 4 }])

    await expect(getNextPublicationVersionNumber('workflow-1')).resolves.toBe(5)
  })

  it('allows a team admin to manage their own workgroup', async () => {
    mockResultsQueue.push([
      {
        id: 'membership-1',
        role: 'admin',
        organizationId: 'org-1',
        workgroupId: 'workgroup-1',
      },
    ])

    await expect(assertWorkgroupAdmin('team-admin-1', 'workgroup-1')).resolves.toMatchObject({
      role: 'admin',
      workgroupId: 'workgroup-1',
    })
  })

  it('allows an organization admin to manage a team without workgroup membership', async () => {
    mockResultsQueue.push([], [{ organizationId: 'org-1' }], [{ role: 'admin' }])

    await expect(assertWorkgroupAdmin('org-admin-1', 'workgroup-1')).resolves.toBeNull()
  })

  it('denies admins of another team when they are not organization admins', async () => {
    mockResultsQueue.push([], [{ organizationId: 'org-1' }], [{ role: 'member' }])

    await expect(assertWorkgroupAdmin('other-team-admin-1', 'workgroup-1')).rejects.toThrow(
      'Workgroup membership required'
    )
  })

  it('prevents demoting the last workgroup admin', async () => {
    mockResultsQueue.push(
      [
        {
          id: 'membership-1',
          role: 'admin',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
        },
      ],
      [
        {
          id: 'workgroup-1',
          organizationId: 'org-1',
          teamWorkspaceId: null,
        },
      ],
      [{ userId: 'team-admin-1' }]
    )

    await expect(
      updateWorkgroupMemberRole({
        actorUserId: 'team-admin-1',
        workgroupId: 'workgroup-1',
        userId: 'team-admin-1',
        role: 'member',
      })
    ).rejects.toThrow('Cannot demote the last workgroup admin')

    expect(mockDb.update).not.toHaveBeenCalled()
  })

  it('hides an unreadable publication parent link from publication details', async () => {
    vi.mocked(canReadPublication).mockImplementation(
      async (_userId, publicationVersionId) => publicationVersionId === 'publication-visible'
    )
    mockResultsQueue.push([
      {
        publication: {
          id: 'publication-visible',
          title: 'Visible version',
          description: null,
          versionNumber: 2,
          parentVersionId: 'publication-hidden',
          sourceWorkgroupId: 'workgroup-1',
          agentCode: 'chief_director',
          snapshotState: {},
          snapshotMetadata: {},
          publishedAt: new Date('2026-05-22T00:00:00Z'),
        },
        sourceWorkgroupName: 'Team A',
        sourceDisciplineCode: 'stage_design',
        sourceDisciplineName: 'Stage Design',
      },
    ])

    await expect(
      getPublication({ userId: 'viewer-1', publicationVersionId: 'publication-visible' })
    ).resolves.toMatchObject({
      id: 'publication-visible',
      parentVersionId: null,
    })
    expect(canReadPublication).toHaveBeenCalledWith('viewer-1', 'publication-hidden')
  })

  it('filters publication tree versions by per-version visibility', async () => {
    vi.mocked(canReadPublication).mockImplementation(async (_userId, publicationVersionId) =>
      ['publication-root', 'publication-visible'].includes(publicationVersionId)
    )
    mockResultsQueue.push(
      [
        {
          publication: {
            id: 'publication-root',
            title: 'Root visible version',
            description: null,
            versionNumber: 2,
            parentVersionId: null,
            sourceWorkflowId: 'workflow-1',
            sourceWorkgroupId: 'workgroup-1',
            agentCode: 'chief_director',
            snapshotState: {},
            snapshotMetadata: {},
            publishedAt: new Date('2026-05-22T00:00:00Z'),
          },
          sourceWorkgroupName: 'Team A',
          sourceDisciplineCode: 'stage_design',
          sourceDisciplineName: 'Stage Design',
        },
      ],
      [{ sourceWorkflowId: 'workflow-1' }],
      [
        {
          publication: {
            id: 'publication-hidden',
            title: 'Hidden version',
            versionNumber: 1,
            parentVersionId: null,
            publishedAt: new Date('2026-05-21T00:00:00Z'),
          },
          sourceWorkgroupName: 'Team A',
          sourceDisciplineName: 'Stage Design',
        },
        {
          publication: {
            id: 'publication-root',
            title: 'Root visible version',
            versionNumber: 2,
            parentVersionId: 'publication-hidden',
            publishedAt: new Date('2026-05-22T00:00:00Z'),
          },
          sourceWorkgroupName: 'Team A',
          sourceDisciplineName: 'Stage Design',
        },
        {
          publication: {
            id: 'publication-visible',
            title: 'Visible version',
            versionNumber: 3,
            parentVersionId: 'publication-root',
            publishedAt: new Date('2026-05-23T00:00:00Z'),
          },
          sourceWorkgroupName: 'Team A',
          sourceDisciplineName: 'Stage Design',
        },
      ]
    )

    await expect(
      getPublicationTree({ userId: 'viewer-1', publicationVersionId: 'publication-root' })
    ).resolves.toMatchObject({
      rootVersionId: 'publication-root',
      versions: [
        { id: 'publication-root', parentVersionId: null, versionNumber: 2 },
        { id: 'publication-visible', parentVersionId: 'publication-root', versionNumber: 3 },
      ],
    })
    expect(canReadPublication).toHaveBeenCalledWith('viewer-1', 'publication-hidden')
  })
})
