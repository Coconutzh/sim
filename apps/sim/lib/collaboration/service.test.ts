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

  function createInsertChain() {
    const chain: Record<string, unknown> = {}

    chain.values = vi.fn(() => chain)
    chain.onConflictDoUpdate = vi.fn(() => Promise.resolve([]))

    return chain
  }

  return {
    mockResultsQueue: resultsQueue,
    mockDb: {
      select: vi.fn(() => createChain()),
      insert: vi.fn(() => createInsertChain()),
      update: vi.fn(() => createWriteChain()),
      transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          insert: vi.fn(() => createInsertChain()),
        })
      ),
    },
    schemaMock: {
      workflowPublicationVersion: {
        id: 'workflowPublicationVersion.id',
        title: 'workflowPublicationVersion.title',
        description: 'workflowPublicationVersion.description',
        status: 'workflowPublicationVersion.status',
        visibility: 'workflowPublicationVersion.visibility',
        parentVersionId: 'workflowPublicationVersion.parentVersionId',
        versionNumber: 'workflowPublicationVersion.versionNumber',
        sourceWorkflowId: 'workflowPublicationVersion.sourceWorkflowId',
        sourceWorkgroupId: 'workflowPublicationVersion.sourceWorkgroupId',
        sourceDisciplineId: 'workflowPublicationVersion.sourceDisciplineId',
        publishedWorkflowId: 'workflowPublicationVersion.publishedWorkflowId',
        snapshotState: 'workflowPublicationVersion.snapshotState',
        snapshotMetadata: 'workflowPublicationVersion.snapshotMetadata',
        publishedAt: 'workflowPublicationVersion.publishedAt',
        archivedAt: 'workflowPublicationVersion.archivedAt',
        retractedAt: 'workflowPublicationVersion.retractedAt',
        lifecycleUpdatedBy: 'workflowPublicationVersion.lifecycleUpdatedBy',
        lifecycleUpdatedAt: 'workflowPublicationVersion.lifecycleUpdatedAt',
        updatedAt: 'workflowPublicationVersion.updatedAt',
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
      user: {
        id: 'user.id',
        name: 'user.name',
        email: 'user.email',
        image: 'user.image',
      },
      workgroup: {
        id: 'workgroup.id',
        name: 'workgroup.name',
        organizationId: 'workgroup.organizationId',
        teamWorkspaceId: 'workgroup.teamWorkspaceId',
      },
      workgroupMember: {
        id: 'workgroupMember.id',
        role: 'workgroupMember.role',
        userId: 'workgroupMember.userId',
        organizationId: 'workgroupMember.organizationId',
        workgroupId: 'workgroupMember.workgroupId',
      },
      permissions: {
        userId: 'permissions.userId',
        entityType: 'permissions.entityType',
        entityId: 'permissions.entityId',
      },
      personalCanvasWorkspace: {
        userId: 'personalCanvasWorkspace.userId',
        organizationId: 'personalCanvasWorkspace.organizationId',
        workgroupId: 'personalCanvasWorkspace.workgroupId',
        workspaceId: 'personalCanvasWorkspace.workspaceId',
      },
      workspace: {
        id: 'workspace.id',
        name: 'workspace.name',
        color: 'workspace.color',
        logoUrl: 'workspace.logoUrl',
        ownerId: 'workspace.ownerId',
        organizationId: 'workspace.organizationId',
        workgroupId: 'workspace.workgroupId',
        workspaceMode: 'workspace.workspaceMode',
        billedAccountUserId: 'workspace.billedAccountUserId',
        allowPersonalApiKeys: 'workspace.allowPersonalApiKeys',
        archivedAt: 'workspace.archivedAt',
        createdAt: 'workspace.createdAt',
        updatedAt: 'workspace.updatedAt',
      },
      workflow: {
        id: 'workflow.id',
      },
      skill: {
        id: 'skill.id',
        workspaceId: 'skill.workspaceId',
        name: 'skill.name',
        description: 'skill.description',
      },
      agentSkillBinding: {
        id: 'agentSkillBinding.id',
        organizationId: 'agentSkillBinding.organizationId',
        agentCode: 'agentSkillBinding.agentCode',
        workgroupId: 'agentSkillBinding.workgroupId',
        skillId: 'agentSkillBinding.skillId',
        enabled: 'agentSkillBinding.enabled',
        scope: 'agentSkillBinding.scope',
        createdAt: 'agentSkillBinding.createdAt',
        updatedAt: 'agentSkillBinding.updatedAt',
      },
      auditLog: {
        id: 'auditLog.id',
        workspaceId: 'auditLog.workspaceId',
        action: 'auditLog.action',
        resourceType: 'auditLog.resourceType',
        resourceId: 'auditLog.resourceId',
        resourceName: 'auditLog.resourceName',
        description: 'auditLog.description',
        actorName: 'auditLog.actorName',
        actorEmail: 'auditLog.actorEmail',
        metadata: 'auditLog.metadata',
        createdAt: 'auditLog.createdAt',
      },
    },
  }
})

vi.mock('@sim/db', () => ({ db: mockDb }))
vi.mock('@sim/db/schema', () => schemaMock)
vi.mock('@sim/audit', () => ({
  AuditAction: {
    PUBLICATION_CREATED: 'publication.created',
    PUBLICATION_ARCHIVED: 'publication.archived',
    PUBLICATION_RETRACTED: 'publication.retracted',
    MEMBER_INVITED: 'member.invited',
    MEMBER_ROLE_CHANGED: 'member.role_changed',
    MEMBER_REMOVED: 'member.removed',
    SKILL_UPDATED: 'skill.updated',
    WORKSPACE_CREATED: 'workspace.created',
  },
  AuditResourceType: { PUBLICATION: 'publication', SKILL: 'skill', WORKSPACE: 'workspace' },
  recordAudit: vi.fn(),
}))
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
  ne: vi.fn((left: unknown, right: unknown) => ({ kind: 'ne', left, right })),
  or: vi.fn((...args: unknown[]) => ({ kind: 'or', args })),
  sql: vi.fn(() => 'sql'),
}))
vi.mock('@/lib/collaboration/authz', () => ({
  canPublishTeamCanvas: vi.fn(),
  canReadPublication: vi.fn(),
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: vi.fn(),
  saveWorkflowToNormalizedTables: vi.fn(),
}))
vi.mock('@/lib/workflows/defaults', () => ({
  buildDefaultWorkflowArtifacts: vi.fn(() => ({ workflowState: { blocks: {}, edges: [] } })),
}))

import { recordAudit } from '@sim/audit'
import { canReadPublication } from '@/lib/collaboration/authz'
import {
  addWorkgroupMember,
  assertWorkgroupAdmin,
  createPersonalWorkspace,
  createTeamWorkspace,
  getNextPublicationVersionNumber,
  getOrCreatePersonalWorkspace,
  getPublication,
  getPublicationTree,
  getTeamWorkspace,
  listWorkgroupAgentSkills,
  updatePublicationLifecycleStatus,
  updateWorkgroupAgentSkill,
  updateWorkgroupMemberRole,
} from '@/lib/collaboration/service'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'

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

  it('resolves an invited workgroup member by email', async () => {
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
      [{ id: 'member-1' }]
    )

    await expect(
      addWorkgroupMember({
        actorUserId: 'admin-1',
        workgroupId: 'workgroup-1',
        email: 'Member@Example.com',
        role: 'member',
      })
    ).resolves.toBeUndefined()

    expect(mockDb.insert).toHaveBeenCalled()
  })

  it('creates additional personal draft canvases with a default workflow', async () => {
    const now = new Date('2026-05-22T00:00:00Z')
    mockResultsQueue.push(
      [
        {
          id: 'membership-1',
          role: 'member',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
        },
      ],
      [{ id: 'workgroup-1', organizationId: 'org-1', name: 'Lighting' }],
      [
        {
          id: 'generated-id',
          name: 'Lighting scratch 2',
          color: '#33C482',
          logoUrl: null,
          ownerId: 'user-1',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
          workspaceMode: 'personal',
          billedAccountUserId: 'user-1',
          allowPersonalApiKeys: true,
          createdAt: now,
          updatedAt: now,
        },
      ]
    )

    await expect(
      createPersonalWorkspace({
        userId: 'user-1',
        workgroupId: 'workgroup-1',
        name: 'Lighting scratch 2',
      })
    ).resolves.toMatchObject({
      workspace: {
        id: 'generated-id',
        name: 'Lighting scratch 2',
        workspaceMode: 'personal',
      },
      defaultWorkflowId: 'generated-id',
    })

    expect(mockDb.insert).toHaveBeenCalled()
    expect(mockDb.transaction).toHaveBeenCalled()
    expect(saveWorkflowToNormalizedTables).toHaveBeenCalledWith(
      'generated-id',
      { blocks: {}, edges: [] },
      expect.anything()
    )
  })

  it('creates a default workflow when lazily creating the first personal draft canvas', async () => {
    const now = new Date('2026-05-22T00:00:00Z')
    mockResultsQueue.push(
      [
        {
          id: 'membership-1',
          role: 'member',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
        },
      ],
      [],
      [{ id: 'workgroup-1', organizationId: 'org-1', name: 'Lighting' }],
      [
        {
          id: 'generated-id',
          name: '个人草稿 - Lighting',
          color: '#33C482',
          logoUrl: null,
          ownerId: 'user-1',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
          workspaceMode: 'personal',
          billedAccountUserId: 'user-1',
          allowPersonalApiKeys: true,
          createdAt: now,
          updatedAt: now,
        },
      ]
    )

    await expect(
      getOrCreatePersonalWorkspace({
        userId: 'user-1',
        workgroupId: 'workgroup-1',
      })
    ).resolves.toMatchObject({
      id: 'generated-id',
      name: '个人草稿 - Lighting',
      workspaceMode: 'personal',
    })

    expect(mockDb.transaction).toHaveBeenCalled()
    expect(saveWorkflowToNormalizedTables).toHaveBeenCalledWith(
      'generated-id',
      { blocks: {}, edges: [] },
      expect.anything()
    )
  })

  it('does not let ordinary members lazily create a missing team canvas', async () => {
    mockResultsQueue.push(
      [
        {
          id: 'membership-1',
          role: 'member',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
        },
      ],
      [{ id: 'workgroup-1', organizationId: 'org-1', name: 'Lighting', teamWorkspaceId: null }]
    )

    await expect(
      getTeamWorkspace({ userId: 'member-1', workgroupId: 'workgroup-1' })
    ).rejects.toThrow('Team workspace not initialized')

    expect(mockDb.insert).not.toHaveBeenCalled()
  })

  it('lets a workgroup admin initialize a team canvas with a default workflow', async () => {
    const now = new Date('2026-05-23T00:00:00Z')
    mockResultsQueue.push(
      [
        {
          id: 'membership-1',
          role: 'admin',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
        },
      ],
      [{ id: 'workgroup-1', organizationId: 'org-1', name: 'Lighting', teamWorkspaceId: null }],
      [
        {
          id: 'generated-id',
          name: 'Lighting 团队画布',
          color: '#33C482',
          logoUrl: null,
          ownerId: 'admin-1',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
          workspaceMode: 'organization',
          billedAccountUserId: 'admin-1',
          allowPersonalApiKeys: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
      [
        {
          id: 'membership-1',
          role: 'admin',
          userId: 'admin-1',
          workgroupId: 'workgroup-1',
        },
      ]
    )

    await expect(
      createTeamWorkspace({ userId: 'admin-1', workgroupId: 'workgroup-1' })
    ).resolves.toMatchObject({
      workspace: {
        id: 'generated-id',
        name: 'Lighting 团队画布',
        workspaceMode: 'organization',
      },
      defaultWorkflowId: 'generated-id',
    })

    expect(mockDb.update).toHaveBeenCalled()
    expect(mockDb.transaction).toHaveBeenCalled()
    expect(saveWorkflowToNormalizedTables).toHaveBeenCalledWith(
      'generated-id',
      { blocks: {}, edges: [] },
      expect.anything()
    )
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
            status: 'published',
            visibility: 'organization',
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
            status: 'published',
            visibility: 'organization',
            publishedAt: new Date('2026-05-22T00:00:00Z'),
          },
          sourceWorkgroupName: 'Team A',
          sourceDisciplineName: 'Stage Design',
        },
        {
          publication: {
            id: 'publication-visible',
            title: 'Visible version',
            description: 'Visible summary',
            versionNumber: 3,
            parentVersionId: 'publication-root',
            sourceWorkgroupId: 'workgroup-1',
            agentCode: 'chief_director',
            status: 'published',
            visibility: 'organization',
            publishedAt: new Date('2026-05-23T00:00:00Z'),
          },
          sourceWorkgroupName: 'Team A',
          sourceDisciplineCode: 'stage_design',
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
        {
          id: 'publication-visible',
          parentVersionId: 'publication-root',
          description: 'Visible summary',
          versionNumber: 3,
          status: 'published',
          visibility: 'organization',
          sourceWorkgroup: { id: 'workgroup-1', name: 'Team A' },
          sourceDiscipline: { code: 'stage_design', name: 'Stage Design' },
          agentCode: 'chief_director',
          dependsOnPublicationIds: ['publication-root'],
        },
      ],
    })
    expect(canReadPublication).toHaveBeenCalledWith('viewer-1', 'publication-hidden')
  })

  it('archives publication versions through workgroup admin lifecycle control', async () => {
    const publishedAt = new Date('2026-05-23T00:00:00Z')
    mockResultsQueue.push(
      [
        {
          id: 'publication-1',
          title: 'Team plan',
          sourceWorkgroupId: 'workgroup-1',
          sourceWorkflowId: 'workflow-1',
          publishedWorkflowId: 'published-workflow-1',
          status: 'published',
          archivedAt: null,
          retractedAt: null,
          publishedAt,
        },
      ],
      [
        {
          id: 'membership-1',
          role: 'admin',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
        },
      ]
    )

    await expect(
      updatePublicationLifecycleStatus({
        actorUserId: 'admin-1',
        publicationVersionId: 'publication-1',
        action: 'archive',
        reason: 'Superseded by approved version',
      })
    ).resolves.toMatchObject({
      id: 'publication-1',
      title: 'Team plan',
      status: 'archived',
      retractedAt: null,
      publishedAt: publishedAt.toISOString(),
    })

    expect(mockDb.update).toHaveBeenCalledWith(schemaMock.workflowPublicationVersion)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'publication.archived',
        resourceType: 'publication',
        resourceId: 'publication-1',
        description: 'Superseded by approved version',
      })
    )
  })

  it('lists team workspace skills with agent binding state for workgroup admins', async () => {
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
          workgroupId: 'workgroup-1',
          organizationId: 'org-1',
          teamWorkspaceId: 'workspace-team-1',
          disciplineAgentCode: 'stage_design',
        },
      ],
      [
        {
          bindingId: 'binding-1',
          skillId: 'skill-1',
          name: 'Stage cue checker',
          description: 'Reviews cue timing',
          enabled: false,
        },
        {
          bindingId: null,
          skillId: 'skill-2',
          name: 'Spatial plan reviewer',
          description: 'Reviews stage layout',
          enabled: null,
        },
      ]
    )

    await expect(
      listWorkgroupAgentSkills({ userId: 'admin-1', workgroupId: 'workgroup-1' })
    ).resolves.toMatchObject({
      agent: { code: 'stage_design' },
      skills: [
        {
          id: 'binding-1',
          skillId: 'skill-1',
          enabled: false,
          scope: 'team_override',
        },
        {
          id: null,
          skillId: 'skill-2',
          enabled: true,
          scope: 'team_override',
        },
      ],
    })
  })

  it('upserts team agent skill overrides and records an audit event', async () => {
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
          workgroupId: 'workgroup-1',
          organizationId: 'org-1',
          teamWorkspaceId: 'workspace-team-1',
          disciplineAgentCode: 'stage_design',
        },
      ],
      [
        {
          id: 'skill-1',
          name: 'Stage cue checker',
          description: 'Reviews cue timing',
        },
      ],
      [{ id: 'binding-existing' }]
    )

    await expect(
      updateWorkgroupAgentSkill({
        actorUserId: 'admin-1',
        workgroupId: 'workgroup-1',
        skillId: 'skill-1',
        enabled: false,
      })
    ).resolves.toMatchObject({
      id: 'binding-existing',
      skillId: 'skill-1',
      enabled: false,
      scope: 'team_override',
    })

    expect(mockDb.insert).toHaveBeenCalledWith(schemaMock.agentSkillBinding)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'skill.updated',
        resourceType: 'skill',
        resourceId: 'skill-1',
        metadata: expect.objectContaining({
          workgroupId: 'workgroup-1',
          agentCode: 'stage_design',
          enabled: false,
        }),
      })
    )
  })
})
