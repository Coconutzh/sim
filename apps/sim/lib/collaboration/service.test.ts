/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockEnqueuePublicationNotificationDelivery, mockResultsQueue, schemaMock } =
  vi.hoisted(() => {
    const resultsQueue: unknown[] = []

    function createChain() {
      const chain: Record<string, unknown> = {}
      const resolveNext = () => (resultsQueue.shift() as unknown) ?? []

      chain.from = vi.fn(() => chain)
      chain.innerJoin = vi.fn(() => chain)
      chain.leftJoin = vi.fn(() => chain)
      chain.orderBy = vi.fn(() => chain)
      chain.where = vi.fn(() => chain)
      chain.limit = vi.fn(() => chain)
      chain.offset = vi.fn(() => chain)
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(resolveNext()))

      return chain
    }

    function createWriteChain() {
      const chain: Record<string, unknown> = {}

      chain.set = vi.fn(() => chain)
      chain.where = vi.fn(() => Promise.resolve([]))

      return chain
    }

    function createDeleteChain() {
      const chain: Record<string, unknown> = {}

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
        delete: vi.fn(() => createDeleteChain()),
        transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
          callback({
            insert: vi.fn(() => createInsertChain()),
            update: vi.fn(() => createWriteChain()),
          })
        ),
      },
      mockEnqueuePublicationNotificationDelivery: vi.fn(async () => 'outbox-event-1'),
      schemaMock: {
        workflowPublicationVersion: {
          id: 'workflowPublicationVersion.id',
          organizationId: 'workflowPublicationVersion.organizationId',
          title: 'workflowPublicationVersion.title',
          description: 'workflowPublicationVersion.description',
          status: 'workflowPublicationVersion.status',
          visibility: 'workflowPublicationVersion.visibility',
          reviewState: 'workflowPublicationVersion.reviewState',
          riskLevel: 'workflowPublicationVersion.riskLevel',
          reviewerUserId: 'workflowPublicationVersion.reviewerUserId',
          reviewerAssignedBy: 'workflowPublicationVersion.reviewerAssignedBy',
          reviewerAssignedAt: 'workflowPublicationVersion.reviewerAssignedAt',
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
          id: 'member.id',
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
          disciplineId: 'workgroup.disciplineId',
          teamWorkspaceId: 'workgroup.teamWorkspaceId',
          archivedAt: 'workgroup.archivedAt',
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
        workflowPublicationScope: {
          id: 'workflowPublicationScope.id',
          workflowId: 'workflowPublicationScope.workflowId',
          viewerWorkgroupId: 'workflowPublicationScope.viewerWorkgroupId',
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
        organizationAgentTemplate: {
          id: 'organizationAgentTemplate.id',
          organizationId: 'organizationAgentTemplate.organizationId',
          agentCode: 'organizationAgentTemplate.agentCode',
          projectInstructions: 'organizationAgentTemplate.projectInstructions',
          updatedBy: 'organizationAgentTemplate.updatedBy',
          createdAt: 'organizationAgentTemplate.createdAt',
          updatedAt: 'organizationAgentTemplate.updatedAt',
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
    PUBLICATION_UPDATED: 'publication.updated',
    PUBLICATION_ARCHIVED: 'publication.archived',
    PUBLICATION_RETRACTED: 'publication.retracted',
    PUBLICATION_RESTORED: 'publication.restored',
    MEMBER_INVITED: 'member.invited',
    MEMBER_BATCH_ASSIGNED: 'member.batch_assigned',
    MEMBER_ROLE_CHANGED: 'member.role_changed',
    MEMBER_REMOVED: 'member.removed',
    WORKGROUP_ARCHIVED: 'workgroup.archived',
    AGENT_TEMPLATE_UPDATED: 'agent_template.updated',
    SKILL_UPDATED: 'skill.updated',
    WORKSPACE_CREATED: 'workspace.created',
    DATA_DRAIN_CREATED: 'data_drain.created',
    DATA_DRAIN_UPDATED: 'data_drain.updated',
    DATA_DRAIN_DELETED: 'data_drain.deleted',
    DATA_DRAIN_RAN: 'data_drain.ran',
    DATA_DRAIN_TESTED: 'data_drain.tested',
    ORGANIZATION_UPDATED: 'organization.updated',
    ORG_MEMBER_ADDED: 'org_member.added',
    ORG_MEMBER_REMOVED: 'org_member.removed',
    ORG_MEMBER_ROLE_CHANGED: 'org_member.role_changed',
    ORG_INVITATION_CREATED: 'org_invitation.created',
    ORG_INVITATION_UPDATED: 'org_invitation.updated',
    ORG_INVITATION_ACCEPTED: 'org_invitation.accepted',
    ORG_INVITATION_REJECTED: 'org_invitation.rejected',
    ORG_INVITATION_CANCELLED: 'org_invitation.cancelled',
    ORG_INVITATION_REVOKED: 'org_invitation.revoked',
    ORG_INVITATION_RESENT: 'org_invitation.resent',
    NOTIFICATION_CREATED: 'notification.created',
    PROJECT_ADMIN_FAILURE_RECORDED: 'project_admin_failure.recorded',
  },
  AuditResourceType: {
    ORGANIZATION: 'organization',
    PUBLICATION: 'publication',
    SKILL: 'skill',
    WORKSPACE: 'workspace',
    NOTIFICATION: 'notification',
  },
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
  gte: vi.fn((left: unknown, right: unknown) => ({ kind: 'gte', left, right })),
  ilike: vi.fn((left: unknown, right: unknown) => ({ kind: 'ilike', left, right })),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({ kind: 'inArray', left, right })),
  isNull: vi.fn((value: unknown) => ({ kind: 'isNull', value })),
  lte: vi.fn((left: unknown, right: unknown) => ({ kind: 'lte', left, right })),
  max: vi.fn((value: unknown) => ({ kind: 'max', value })),
  ne: vi.fn((left: unknown, right: unknown) => ({ kind: 'ne', left, right })),
  or: vi.fn((...args: unknown[]) => ({ kind: 'or', args })),
  sql: vi.fn(() => 'sql'),
}))
vi.mock('@/lib/collaboration/authz', () => ({
  canPublishTeamCanvas: vi.fn(),
  canReadPublication: vi.fn(),
}))
vi.mock('@/lib/collaboration/notification-outbox', () => ({
  enqueuePublicationNotificationDelivery: mockEnqueuePublicationNotificationDelivery,
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
  addWorkgroupMembersBatch,
  archiveWorkgroup,
  assertWorkgroupAdmin,
  createPersonalWorkspace,
  createTeamWorkspace,
  deliverOrganizationPublicationNotifications,
  getNextPublicationVersionNumber,
  getOrCreatePersonalWorkspace,
  getPublication,
  getPublicationTree,
  getTeamWorkspace,
  listOrganizationAgentSkillPolicies,
  listOrganizationAgentTemplates,
  listOrganizationProjectNotificationCenter,
  listOrganizationPublicationNotificationInbox,
  listOrganizationPublications,
  listOrganizationWorkgroupActivity,
  listVisiblePublications,
  listWorkgroupAgentSkills,
  markOrganizationProjectNotificationCenterRead,
  markOrganizationPublicationNotificationInboxRead,
  recordProjectAdminFailureAudit,
  resolveAgentForWorkspace,
  updateOrganizationAgentSkillPolicy,
  updateOrganizationAgentTemplate,
  updatePublicationDetails,
  updatePublicationLifecycleStatus,
  updatePublicationReview,
  updatePublicationVisibility,
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

  it('paginates organization workgroup activity with one extra row probe', async () => {
    mockResultsQueue.push(
      [{ role: 'admin' }],
      [
        {
          id: 'workgroup-1',
          name: 'Lighting',
          disciplineId: 'discipline-1',
          disciplineName: 'Lighting',
          teamWorkspaceId: 'team-workspace-1',
        },
      ],
      [
        {
          id: 'audit-1',
          workspaceId: 'team-workspace-1',
          action: 'publication.created',
          resourceType: 'publication',
          resourceId: 'publication-1',
          resourceName: 'Cue map',
          description: 'Published showcase',
          actorName: 'Admin',
          actorEmail: 'admin@example.com',
          metadata: { workgroupId: 'workgroup-1' },
          createdAt: new Date('2026-05-24T01:00:00.000Z'),
        },
        {
          id: 'audit-2',
          workspaceId: 'team-workspace-1',
          action: 'project_admin_failure.recorded',
          resourceType: 'organization',
          resourceId: 'org-1',
          resourceName: 'Stage',
          description: 'Archive team failed for Stage',
          actorName: 'Admin',
          actorEmail: 'admin@example.com',
          metadata: {
            organizationId: 'org-1',
            failureId: 'failure-1',
            scope: 'team',
            operation: 'Archive team',
            target: 'Stage',
            message: 'Archive failed',
            recordedAt: '2026-05-24T00:30:00.000Z',
          },
          createdAt: new Date('2026-05-24T00:30:00.000Z'),
        },
        {
          id: 'audit-3',
          workspaceId: 'team-workspace-1',
          action: 'workspace.created',
          resourceType: 'workspace',
          resourceId: 'team-workspace-1',
          resourceName: 'Lighting canvas',
          description: 'Initialized team canvas',
          actorName: 'Admin',
          actorEmail: 'admin@example.com',
          metadata: { workgroupId: 'workgroup-1' },
          createdAt: new Date('2026-05-24T00:00:00.000Z'),
        },
      ]
    )

    await expect(
      listOrganizationWorkgroupActivity({
        userId: 'org-admin-1',
        organizationId: 'org-1',
        action: 'project_admin_failure.recorded',
        failureScope: 'team',
        actor: 'admin@example.com',
        startDate: '2026-05-01',
        endDate: '2026-05-24',
        limit: 2,
        offset: 4,
      })
    ).resolves.toMatchObject({
      nextOffset: 6,
      activity: [
        {
          id: 'audit-1',
          workgroupName: 'Lighting',
          projectAdminFailure: null,
          createdAt: '2026-05-24T01:00:00.000Z',
        },
        {
          id: 'audit-2',
          workgroupName: 'Lighting',
          projectAdminFailure: {
            failureId: 'failure-1',
            scope: 'team',
            operation: 'Archive team',
            target: 'Stage',
            message: 'Archive failed',
            recordedAt: '2026-05-24T00:30:00.000Z',
          },
          createdAt: '2026-05-24T00:30:00.000Z',
        },
      ],
    })
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

  it('batch adds workgroup members in one transaction', async () => {
    mockResultsQueue.push(
      [
        {
          id: 'membership-1',
          role: 'admin',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
        },
      ],
      [{ id: 'workgroup-1', organizationId: 'org-1', name: 'Lighting', teamWorkspaceId: 'ws-1' }],
      [{ id: 'user-2' }]
    )

    await expect(
      addWorkgroupMembersBatch({
        actorUserId: 'admin-1',
        workgroupId: 'workgroup-1',
        role: 'member',
        targets: [{ userId: 'user-1' }, { email: 'user-2@example.com' }],
      })
    ).resolves.toEqual([
      { target: 'user-1', userId: 'user-1', role: 'member' },
      { target: 'user-2@example.com', userId: 'user-2', role: 'member' },
    ])
    expect(mockDb.transaction).toHaveBeenCalledTimes(1)
    expect(recordAudit).toHaveBeenCalledTimes(3)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'member.batch_assigned',
        description: 'Batch assigned 2 team members as member',
        metadata: expect.objectContaining({
          batchOperationId: 'short-id',
          targetCount: 2,
          targetUserIds: ['user-1', 'user-2'],
        }),
      })
    )
  })

  it('rejects a batch add before opening the transaction when a target is invalid', async () => {
    mockResultsQueue.push(
      [
        {
          id: 'membership-1',
          role: 'admin',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
        },
      ],
      [{ id: 'workgroup-1', organizationId: 'org-1', name: 'Lighting', teamWorkspaceId: 'ws-1' }],
      []
    )

    await expect(
      addWorkgroupMembersBatch({
        actorUserId: 'admin-1',
        workgroupId: 'workgroup-1',
        role: 'member',
        targets: [{ email: 'missing@example.com' }],
      })
    ).rejects.toThrow('User not found')
    expect(mockDb.transaction).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it('archives a workgroup and its team workspace for organization admins', async () => {
    mockResultsQueue.push(
      [
        {
          id: 'workgroup-1',
          name: 'Lighting',
          organizationId: 'org-1',
          teamWorkspaceId: 'team-workspace-1',
          archivedAt: null,
        },
      ],
      [{ role: 'admin' }]
    )

    await expect(
      archiveWorkgroup({ actorUserId: 'org-admin-1', workgroupId: 'workgroup-1' })
    ).resolves.toMatchObject({
      id: 'workgroup-1',
      name: 'Lighting',
    })
    expect(mockDb.transaction).toHaveBeenCalledTimes(1)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workgroup.archived',
        resourceId: 'workgroup-1',
        description: 'Archived team Lighting',
        metadata: expect.objectContaining({
          workgroupId: 'workgroup-1',
          teamWorkspaceId: 'team-workspace-1',
        }),
      })
    )
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

  it('restores a superseded publication as the current version and rewrites published workflow state', async () => {
    const publishedAt = new Date('2026-05-23T00:00:00Z')
    const snapshotState = {
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      lastSaved: 0,
    }
    mockResultsQueue.push(
      [
        {
          id: 'publication-1',
          title: 'Approved cue plan',
          description: 'Rollback target',
          organizationId: 'org-1',
          sourceWorkgroupId: 'workgroup-1',
          sourceWorkflowId: 'workflow-1',
          publishedWorkflowId: 'published-workflow-1',
          visibility: 'selected_workgroups',
          status: 'superseded',
          archivedAt: null,
          retractedAt: null,
          publishedAt,
          snapshotState,
        },
      ],
      [
        {
          id: 'membership-1',
          role: 'admin',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
        },
      ],
      [{ workflowId: 'published-workflow-1', viewerWorkgroupId: 'workgroup-2' }],
      [{ id: 'workgroup-2', name: 'Lighting', teamWorkspaceId: 'workspace-team-2' }]
    )

    await expect(
      updatePublicationLifecycleStatus({
        actorUserId: 'admin-1',
        publicationVersionId: 'publication-1',
        action: 'restore',
        reason: 'Rollback to approved cues',
      })
    ).resolves.toMatchObject({
      id: 'publication-1',
      title: 'Approved cue plan',
      status: 'published',
      archivedAt: null,
      retractedAt: null,
    })

    expect(saveWorkflowToNormalizedTables).toHaveBeenCalledWith(
      'published-workflow-1',
      snapshotState
    )
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'publication.restored',
        resourceType: 'publication',
        resourceId: 'publication-1',
        description: 'Rollback to approved cues',
        metadata: expect.objectContaining({
          previousStatus: 'superseded',
          status: 'published',
          sourceWorkflowId: 'workflow-1',
          publishedWorkflowId: 'published-workflow-1',
        }),
      })
    )
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-team-2',
        action: 'publication.restored',
        description: 'Showcase publication was restored as current',
        metadata: expect.objectContaining({
          workgroupId: 'workgroup-2',
          publicationEvent: 'restored',
          publicationBroadcast: true,
        }),
      })
    )
  })

  it('returns only visible publication dependency links in showcase summaries', async () => {
    const publishedAt = new Date('2026-05-24T00:00:00Z')
    mockResultsQueue.push(
      [
        {
          id: 'membership-1',
          role: 'member',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
        },
      ],
      [
        {
          id: 'membership-1',
          role: 'member',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
        },
      ],
      [],
      [
        {
          publication: {
            id: 'publication-v1',
            title: 'Visible root',
            description: null,
            sourceWorkgroupId: 'workgroup-1',
            sourceDisciplineId: 'discipline-1',
            agentCode: 'lighting_sound',
            versionNumber: 1,
            parentVersionId: null,
            publishedWorkflowId: 'published-workflow-1',
            status: 'superseded',
            visibility: 'organization',
            publishedAt,
          },
          sourceWorkgroupName: 'Lighting',
          sourceDisciplineCode: 'lighting_sound',
          sourceDisciplineName: 'Lighting & Sound',
          publisherId: 'admin-1',
          publisherName: 'Admin',
          publisherAvatarUrl: null,
        },
        {
          publication: {
            id: 'publication-v2',
            title: 'Visible child',
            description: null,
            sourceWorkgroupId: 'workgroup-1',
            sourceDisciplineId: 'discipline-1',
            agentCode: 'lighting_sound',
            versionNumber: 2,
            parentVersionId: 'publication-v1',
            publishedWorkflowId: 'published-workflow-2',
            status: 'published',
            visibility: 'selected_workgroups',
            publishedAt,
          },
          sourceWorkgroupName: 'Lighting',
          sourceDisciplineCode: 'lighting_sound',
          sourceDisciplineName: 'Lighting & Sound',
          publisherId: 'admin-1',
          publisherName: 'Admin',
          publisherAvatarUrl: null,
        },
        {
          publication: {
            id: 'publication-v4',
            title: 'Hidden parent child',
            description: null,
            sourceWorkgroupId: 'workgroup-1',
            sourceDisciplineId: 'discipline-1',
            agentCode: 'lighting_sound',
            versionNumber: 4,
            parentVersionId: 'publication-v3-hidden',
            publishedWorkflowId: 'published-workflow-4',
            status: 'published',
            visibility: 'organization',
            publishedAt,
          },
          sourceWorkgroupName: 'Lighting',
          sourceDisciplineCode: 'lighting_sound',
          sourceDisciplineName: 'Lighting & Sound',
          publisherId: 'admin-1',
          publisherName: 'Admin',
          publisherAvatarUrl: null,
        },
      ],
      [
        { workflowId: 'published-workflow-2', viewerWorkgroupId: 'workgroup-2' },
        { workflowId: 'published-workflow-2', viewerWorkgroupId: 'workgroup-3' },
      ]
    )

    await expect(
      listVisiblePublications({ userId: 'user-1', workgroupId: 'workgroup-1' })
    ).resolves.toMatchObject([
      {
        id: 'publication-v1',
        parentVersionId: null,
        dependsOnPublicationIds: [],
      },
      {
        id: 'publication-v2',
        parentVersionId: 'publication-v1',
        dependsOnPublicationIds: ['publication-v1'],
        targetWorkgroupIds: ['workgroup-2', 'workgroup-3'],
      },
      {
        id: 'publication-v4',
        parentVersionId: null,
        dependsOnPublicationIds: [],
      },
    ])
  })

  it('lists organization publication versions for project admins without viewer scope filtering', async () => {
    const publishedAt = new Date('2026-05-24T00:00:00Z')
    mockResultsQueue.push(
      [{ role: 'admin' }],
      [
        {
          publication: {
            id: 'publication-v1',
            title: 'Organization root',
            description: null,
            sourceWorkgroupId: 'workgroup-1',
            sourceDisciplineId: 'discipline-1',
            agentCode: 'lighting_sound',
            versionNumber: 1,
            parentVersionId: null,
            publishedWorkflowId: 'published-workflow-1',
            status: 'superseded',
            visibility: 'organization',
            reviewState: 'approved',
            riskLevel: 'low',
            publishedAt,
          },
          sourceWorkgroupName: 'Lighting',
          sourceDisciplineCode: 'lighting_sound',
          sourceDisciplineName: 'Lighting & Sound',
          publisherId: 'admin-1',
          publisherName: 'Admin',
          publisherAvatarUrl: null,
        },
        {
          publication: {
            id: 'publication-v2',
            title: 'Scoped child',
            description: null,
            sourceWorkgroupId: 'workgroup-2',
            sourceDisciplineId: 'discipline-2',
            agentCode: 'stage_design',
            versionNumber: 2,
            parentVersionId: 'publication-v1',
            publishedWorkflowId: 'published-workflow-2',
            status: 'published',
            visibility: 'selected_workgroups',
            reviewState: 'pending',
            riskLevel: 'critical',
            publishedAt,
          },
          sourceWorkgroupName: 'Stage',
          sourceDisciplineCode: 'stage_design',
          sourceDisciplineName: 'Stage design',
          publisherId: 'admin-1',
          publisherName: 'Admin',
          publisherAvatarUrl: null,
        },
      ],
      [{ workflowId: 'published-workflow-2', viewerWorkgroupId: 'workgroup-3' }]
    )

    await expect(
      listOrganizationPublications({ userId: 'org-admin-1', organizationId: 'org-1' })
    ).resolves.toMatchObject([
      {
        id: 'publication-v1',
        parentVersionId: null,
        dependsOnPublicationIds: [],
        reviewState: 'approved',
        riskLevel: 'low',
      },
      {
        id: 'publication-v2',
        parentVersionId: 'publication-v1',
        dependsOnPublicationIds: ['publication-v1'],
        targetWorkgroupIds: ['workgroup-3'],
        reviewState: 'pending',
        riskLevel: 'critical',
      },
    ])
  })

  it('records a server-side publication notification delivery audit', async () => {
    const publishedAt = new Date('2026-05-24T00:00:00Z')
    mockResultsQueue.push(
      [{ role: 'admin' }],
      [
        {
          publication: {
            id: 'publication-review-1',
            title: 'Lighting current',
            description: null,
            sourceWorkgroupId: 'workgroup-lighting',
            sourceDisciplineId: 'discipline-lighting',
            agentCode: 'lighting_sound',
            versionNumber: 3,
            parentVersionId: null,
            publishedWorkflowId: null,
            status: 'published',
            visibility: 'organization',
            reviewState: 'pending',
            riskLevel: 'critical',
            reviewerUserId: null,
            reviewerAssignedBy: null,
            reviewerAssignedAt: null,
            publishedAt,
          },
          sourceWorkgroupName: 'Lighting',
          sourceDisciplineCode: 'lighting_sound',
          sourceDisciplineName: 'Lighting & Sound',
          publisherId: 'admin-1',
          publisherName: 'Admin',
          publisherAvatarUrl: null,
        },
      ]
    )

    await expect(
      deliverOrganizationPublicationNotifications({
        userId: 'org-admin-1',
        organizationId: 'org-1',
        channel: 'email',
        projectName: 'Opening Night',
        emailRecipients: ['reviewer@example.com', 'producer@example.com', 'reviewer@example.com'],
      })
    ).resolves.toMatchObject({
      channel: 'email',
      status: 'queued',
      notificationCount: 2,
      dangerCount: 2,
      publicationIds: ['publication-review-1'],
      outboxEventId: 'outbox-event-1',
    })

    expect(mockEnqueuePublicationNotificationDelivery).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        id: 'publication-review-email-digest',
        organizationId: 'org-1',
        actorUserId: 'org-admin-1',
        channel: 'email',
        event: 'publication.review_notifications.digest',
        notificationCount: 2,
        publicationIds: ['publication-review-1'],
        emailRecipients: ['reviewer@example.com', 'producer@example.com'],
      })
    )
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'org-admin-1',
        action: 'notification.created',
        resourceType: 'notification',
        resourceId: 'outbox-event-1',
        metadata: expect.objectContaining({
          organizationId: 'org-1',
          channel: 'email',
          deliveryDraftId: 'publication-review-email-digest',
          outboxEventId: 'outbox-event-1',
          notificationEvent: 'publication.review_notifications.digest',
          notificationCount: 2,
          emailRecipientCount: 2,
        }),
      })
    )
  })

  it('requires recipients before queuing email publication notifications', async () => {
    const publishedAt = new Date('2026-05-24T00:00:00Z')
    mockResultsQueue.push(
      [{ role: 'admin' }],
      [
        {
          publication: {
            id: 'publication-review-1',
            title: 'Lighting current',
            description: null,
            sourceWorkgroupId: 'workgroup-lighting',
            sourceDisciplineId: 'discipline-lighting',
            agentCode: 'lighting_sound',
            versionNumber: 3,
            parentVersionId: null,
            publishedWorkflowId: null,
            status: 'published',
            visibility: 'organization',
            reviewState: 'pending',
            riskLevel: 'critical',
            reviewerUserId: null,
            reviewerAssignedBy: null,
            reviewerAssignedAt: null,
            publishedAt,
          },
          sourceWorkgroupName: 'Lighting',
          sourceDisciplineCode: 'lighting_sound',
          sourceDisciplineName: 'Lighting & Sound',
          publisherId: 'admin-1',
          publisherName: 'Admin',
          publisherAvatarUrl: null,
        },
      ]
    )

    await expect(
      deliverOrganizationPublicationNotifications({
        userId: 'org-admin-1',
        organizationId: 'org-1',
        channel: 'email',
        projectName: 'Opening Night',
      })
    ).rejects.toThrow('Email recipients are required for email delivery')

    expect(mockEnqueuePublicationNotificationDelivery).not.toHaveBeenCalled()
  })

  it('lists persistent publication notification inbox deliveries', async () => {
    const createdAt = new Date('2026-05-25T08:30:00Z')
    mockResultsQueue.push(
      [{ role: 'admin' }],
      [
        {
          id: 'audit-notification-1',
          resourceId: 'outbox-event-1',
          resourceName: 'In-app bell digest',
          description: 'Queued In-app bell digest for publication review notifications',
          actorName: 'Project Admin',
          actorEmail: 'admin@example.com',
          createdAt,
          metadata: {
            organizationId: 'org-1',
            channel: 'in_app',
            notificationEvent: 'publication.review_notifications.digest',
            title: 'In-app bell digest',
            detail: 'Queue a local in-app digest for the project admin session.',
            body: '2 publication review notifications need attention.',
            notificationCount: 2,
            dangerCount: 1,
            warningCount: 1,
            publicationIds: ['publication-1', 'publication-2'],
            outboxEventId: 'outbox-event-1',
            readAtByUserId: {
              'org-admin-1': '2026-05-25T09:00:00.000Z',
            },
          },
        },
      ]
    )

    await expect(
      listOrganizationPublicationNotificationInbox({
        userId: 'org-admin-1',
        organizationId: 'org-1',
        limit: 5,
      })
    ).resolves.toEqual({
      inbox: [
        {
          id: 'audit-notification-1',
          channel: 'in_app',
          title: 'In-app bell digest',
          detail: 'Queue a local in-app digest for the project admin session.',
          body: '2 publication review notifications need attention.',
          notificationCount: 2,
          dangerCount: 1,
          warningCount: 1,
          publicationIds: ['publication-1', 'publication-2'],
          outboxEventId: 'outbox-event-1',
          actorName: 'Project Admin',
          actorEmail: 'admin@example.com',
          createdAt: createdAt.toISOString(),
          readAt: '2026-05-25T09:00:00.000Z',
        },
      ],
      nextOffset: null,
    })
  })

  it('marks persistent publication notification inbox deliveries as read', async () => {
    mockResultsQueue.push([{ role: 'admin' }])

    await expect(
      markOrganizationPublicationNotificationInboxRead({
        userId: 'org-admin-1',
        organizationId: 'org-1',
        notificationId: 'audit-notification-1',
      })
    ).resolves.toEqual({
      readAt: expect.any(String),
    })

    expect(mockDb.update).toHaveBeenCalledWith(schemaMock.auditLog)
  })

  it('lists project notification center entries across publication and failure audits', async () => {
    const createdAt = new Date('2026-05-25T10:00:00Z')
    mockResultsQueue.push(
      [{ role: 'admin' }],
      [
        {
          id: 'audit-notification-1',
          action: 'notification.created',
          resourceName: 'In-app bell digest',
          description: 'Queued In-app bell digest for publication review notifications',
          actorName: 'Project Admin',
          actorEmail: 'admin@example.com',
          createdAt,
          metadata: {
            organizationId: 'org-1',
            channel: 'in_app',
            notificationEvent: 'publication.review_notifications.digest',
            title: 'In-app bell digest',
            detail: 'Queue a local in-app digest for the project admin session.',
            body: '2 publication review notifications need attention.',
            notificationCount: 2,
            dangerCount: 1,
            warningCount: 1,
            publicationIds: ['publication-1'],
            outboxEventId: 'outbox-event-1',
          },
        },
        {
          id: 'audit-failure-1',
          action: 'project_admin_failure.recorded',
          resourceName: 'Archive team',
          description: 'Archive team failed for Stage',
          actorName: 'Project Admin',
          actorEmail: 'admin@example.com',
          createdAt,
          metadata: {
            organizationId: 'org-1',
            failureId: 'failure-1',
            scope: 'team',
            operation: 'Archive team',
            target: 'Stage',
            message: 'Archive failed',
          },
        },
        {
          id: 'audit-publication-governance-1',
          action: 'publication.archived',
          resourceName: 'Lighting cues v3',
          description: 'Showcase publication was archived',
          actorName: 'Project Admin',
          actorEmail: 'admin@example.com',
          createdAt,
          metadata: {
            organizationId: 'org-1',
            sourceWorkflowId: 'workflow-1',
            sourceWorkgroupId: 'workgroup-1',
            publishedWorkflowId: 'published-workflow-1',
            status: 'archived',
          },
        },
        {
          id: 'audit-member-management-1',
          action: 'member.batch_assigned',
          resourceName: 'Stage',
          description: 'Batch assigned 3 team members as member',
          actorName: 'Project Admin',
          actorEmail: 'admin@example.com',
          createdAt,
          metadata: {
            organizationId: 'org-1',
            workgroupId: 'workgroup-1',
            role: 'member',
            targetCount: 3,
          },
        },
        {
          id: 'audit-team-management-1',
          action: 'workgroup.archived',
          resourceName: 'Props',
          description: 'Archived team Props',
          actorName: 'Project Admin',
          actorEmail: 'admin@example.com',
          createdAt,
          metadata: {
            organizationId: 'org-1',
            workgroupId: 'workgroup-2',
            archivedAt: '2026-05-25T10:00:00Z',
          },
        },
        {
          id: 'audit-agent-policy-1',
          action: 'agent_template.updated',
          resourceName: 'Chief Director',
          description: 'Updated project instructions for Chief Director',
          actorName: 'Project Admin',
          actorEmail: 'admin@example.com',
          createdAt,
          metadata: {
            organizationId: 'org-1',
            agentCode: 'chief_director',
            hasProjectInstructions: true,
          },
        },
        {
          id: 'audit-retention-policy-1',
          action: 'organization.updated',
          resourceName: 'Theater Project',
          description: 'Updated data retention settings',
          actorName: 'Project Admin',
          actorEmail: 'admin@example.com',
          createdAt,
          metadata: {
            organizationId: 'org-1',
            retentionEvent: 'data_retention.settings_updated',
            changes: { logRetentionHours: 720 },
          },
        },
        {
          id: 'audit-data-drain-1',
          action: 'data_drain.tested',
          resourceName: 'Archive drain',
          description: "Tested connection for data drain 'Archive drain' (failed)",
          actorName: 'Project Admin',
          actorEmail: 'admin@example.com',
          createdAt,
          metadata: {
            organizationId: 'org-1',
            destinationType: 'webhook',
            outcome: 'failed',
          },
        },
        {
          id: 'audit-organization-management-1',
          action: 'org_invitation.resent',
          resourceName: 'Theater Project',
          description: 'Resent organization invitation to guest@example.com',
          actorName: 'Project Admin',
          actorEmail: 'admin@example.com',
          createdAt,
          metadata: {
            organizationId: 'org-1',
            invitationId: 'invite-1',
            targetEmail: 'guest@example.com',
            targetRole: 'member',
          },
        },
        {
          id: 'audit-organization-settings-1',
          action: 'organization.updated',
          resourceName: 'Theater Project',
          description: 'Updated organization whitelabel settings',
          actorName: 'Project Admin',
          actorEmail: 'admin@example.com',
          createdAt,
          metadata: {
            organizationId: 'org-1',
            organizationEvent: 'organization.whitelabel_updated',
            changes: ['brandName', 'logoUrl'],
          },
        },
        {
          id: 'audit-billing-management-1',
          action: 'organization.updated',
          resourceName: 'Theater Project',
          description: 'Updated organization seats from 12 to 10',
          actorName: 'Project Admin',
          actorEmail: 'admin@example.com',
          createdAt,
          metadata: {
            organizationId: 'org-1',
            billingEvent: 'organization.seats_updated',
            previousSeats: 12,
            seats: 10,
          },
        },
        {
          id: 'audit-cleanup-execution-1',
          action: 'organization.updated',
          resourceName: 'Theater Project',
          description: 'cleanup-logs completed for 1 workspace(s): 42 row(s) and 3 file(s) deleted',
          actorName: 'System cleanup',
          actorEmail: null,
          createdAt,
          metadata: {
            organizationId: 'org-1',
            cleanupEvent: 'cleanup.execution_completed',
            jobType: 'cleanup-logs',
            rowsDeleted: 42,
            filesDeleted: 3,
            filesFailed: 1,
          },
        },
      ]
    )

    await expect(
      listOrganizationProjectNotificationCenter({
        userId: 'org-admin-1',
        organizationId: 'org-1',
        limit: 13,
      })
    ).resolves.toMatchObject({
      notifications: [
        { id: 'audit-notification-1', kind: 'publication_review', severity: 'danger' },
        { id: 'audit-failure-1', kind: 'project_admin_failure', severity: 'danger' },
        {
          id: 'audit-publication-governance-1',
          kind: 'publication_governance',
          severity: 'warning',
          title: 'Publication archived: Lighting cues v3',
        },
        {
          id: 'audit-member-management-1',
          kind: 'member_management',
          severity: 'info',
          title: 'Batch assigned members: Stage',
        },
        {
          id: 'audit-team-management-1',
          kind: 'team_management',
          severity: 'warning',
          title: 'Team archived: Props',
        },
        {
          id: 'audit-agent-policy-1',
          kind: 'agent_policy',
          severity: 'info',
          title: 'Agent template updated: Chief Director',
        },
        {
          id: 'audit-retention-policy-1',
          kind: 'retention_policy',
          severity: 'info',
          title: 'Retention policy updated: Theater Project',
        },
        {
          id: 'audit-data-drain-1',
          kind: 'data_drain',
          severity: 'warning',
          title: 'Data drain connection tested: Archive drain',
        },
        {
          id: 'audit-organization-management-1',
          kind: 'organization_management',
          severity: 'info',
          title: 'Organization invitation resent: Theater Project',
        },
        {
          id: 'audit-organization-settings-1',
          kind: 'organization_settings',
          severity: 'info',
          title: 'Organization branding updated: Theater Project',
        },
        {
          id: 'audit-billing-management-1',
          kind: 'billing_management',
          severity: 'warning',
          title: 'Organization seats updated: Theater Project',
        },
        {
          id: 'audit-cleanup-execution-1',
          kind: 'cleanup_execution',
          severity: 'warning',
          title: 'Cleanup completed: Theater Project (cleanup-logs)',
        },
      ],
      nextOffset: null,
    })
  })

  it('marks project notification center entries as read', async () => {
    mockResultsQueue.push([{ role: 'admin' }])

    await expect(
      markOrganizationProjectNotificationCenterRead({
        userId: 'org-admin-1',
        organizationId: 'org-1',
        markAll: true,
        kind: 'member_management',
      })
    ).resolves.toEqual({
      readAt: expect.any(String),
    })

    expect(mockDb.update).toHaveBeenCalledWith(schemaMock.auditLog)
  })

  it('records project admin failures as persistent organization audit entries', async () => {
    mockResultsQueue.push([{ role: 'admin' }])

    await expect(
      recordProjectAdminFailureAudit({
        userId: 'org-admin-1',
        organizationId: 'org-1',
        scope: 'team',
        operation: 'Archive team',
        target: 'Stage',
        message: 'Archive failed',
      })
    ).resolves.toMatchObject({
      id: 'short-id',
      scope: 'team',
      operation: 'Archive team',
      target: 'Stage',
      message: 'Archive failed',
    })

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'org-admin-1',
        action: 'project_admin_failure.recorded',
        resourceType: 'organization',
        resourceId: 'org-1',
        resourceName: 'Stage',
        description: 'Archive team failed for Stage',
        metadata: expect.objectContaining({
          organizationId: 'org-1',
          failureId: 'short-id',
          scope: 'team',
          operation: 'Archive team',
          target: 'Stage',
          message: 'Archive failed',
        }),
      })
    )
  })

  it('updates publication visibility and filters target workgroups to the same organization', async () => {
    mockResultsQueue.push(
      [
        {
          id: 'publication-1',
          title: 'Team plan',
          organizationId: 'org-1',
          sourceWorkgroupId: 'workgroup-1',
          sourceWorkflowId: 'workflow-1',
          publishedWorkflowId: 'published-workflow-1',
          visibility: 'organization',
        },
      ],
      [
        {
          id: 'membership-1',
          role: 'admin',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
        },
      ],
      [{ id: 'workgroup-2' }]
    )

    await expect(
      updatePublicationVisibility({
        actorUserId: 'admin-1',
        publicationVersionId: 'publication-1',
        visibility: 'selected_workgroups',
        targetWorkgroupIds: ['workgroup-2', 'workgroup-2', 'other-org-workgroup'],
        reason: 'Narrow review audience',
      })
    ).resolves.toMatchObject({
      id: 'publication-1',
      title: 'Team plan',
      visibility: 'selected_workgroups',
      targetWorkgroupIds: ['workgroup-2'],
    })

    expect(mockDb.delete).toHaveBeenCalledWith(schemaMock.workflowPublicationScope)
    expect(mockDb.insert).toHaveBeenCalledWith(schemaMock.workflowPublicationScope)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'publication.updated',
        resourceType: 'publication',
        resourceId: 'publication-1',
        description: 'Narrow review audience',
        metadata: expect.objectContaining({
          previousVisibility: 'organization',
          visibility: 'selected_workgroups',
          targetWorkgroupIds: ['workgroup-2'],
          sourceWorkgroupId: 'workgroup-1',
          publishedWorkflowId: 'published-workflow-1',
        }),
      })
    )
  })

  it('records publication visibility broadcast events for newly visible teams', async () => {
    mockResultsQueue.push(
      [
        {
          id: 'publication-1',
          title: 'Team plan',
          organizationId: 'org-1',
          sourceWorkgroupId: 'workgroup-1',
          sourceWorkflowId: 'workflow-1',
          publishedWorkflowId: 'published-workflow-1',
          visibility: 'organization',
        },
      ],
      [
        {
          id: 'membership-1',
          role: 'admin',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
        },
      ],
      [{ id: 'workgroup-2' }],
      [{ id: 'workgroup-2', name: 'Lighting', teamWorkspaceId: 'workspace-team-2' }]
    )

    await expect(
      updatePublicationVisibility({
        actorUserId: 'admin-1',
        publicationVersionId: 'publication-1',
        visibility: 'selected_workgroups',
        targetWorkgroupIds: ['workgroup-2'],
      })
    ).resolves.toMatchObject({
      targetWorkgroupIds: ['workgroup-2'],
    })

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-team-2',
        actorId: 'admin-1',
        action: 'publication.updated',
        resourceType: 'publication',
        resourceId: 'publication-1',
        description: 'Publication visibility changed for this team',
        metadata: expect.objectContaining({
          workgroupId: 'workgroup-2',
          sourceWorkgroupId: 'workgroup-1',
          publicationEvent: 'visibility_updated',
          publicationBroadcast: true,
          targetWorkgroupIds: ['workgroup-2'],
        }),
      })
    )
  })

  it('updates publication details and mirrors title to the published workflow', async () => {
    mockResultsQueue.push(
      [
        {
          id: 'publication-1',
          title: 'Team plan',
          description: 'Old description',
          organizationId: 'org-1',
          sourceWorkgroupId: 'workgroup-1',
          sourceWorkflowId: 'workflow-1',
          publishedWorkflowId: 'published-workflow-1',
          visibility: 'organization',
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
      updatePublicationDetails({
        actorUserId: 'admin-1',
        publicationVersionId: 'publication-1',
        title: 'Updated team plan',
        description: 'Ready for project review',
        reason: 'Clarified detail copy',
      })
    ).resolves.toMatchObject({
      id: 'publication-1',
      title: 'Updated team plan',
      description: 'Ready for project review',
    })

    expect(mockDb.update).toHaveBeenCalledWith(schemaMock.workflowPublicationVersion)
    expect(mockDb.update).toHaveBeenCalledWith(schemaMock.workflow)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'publication.updated',
        resourceType: 'publication',
        resourceId: 'publication-1',
        resourceName: 'Updated team plan',
        description: 'Clarified detail copy',
        metadata: expect.objectContaining({
          previousTitle: 'Team plan',
          title: 'Updated team plan',
          previousDescription: 'Old description',
          description: 'Ready for project review',
          sourceWorkgroupId: 'workgroup-1',
          publishedWorkflowId: 'published-workflow-1',
          publicationEvent: 'details_updated',
        }),
      })
    )
  })

  it('updates publication review governance fields for source team admins', async () => {
    mockResultsQueue.push(
      [
        {
          id: 'publication-1',
          title: 'Team plan',
          organizationId: 'org-1',
          sourceWorkgroupId: 'workgroup-1',
          sourceWorkflowId: 'workflow-1',
          publishedWorkflowId: 'published-workflow-1',
          reviewState: 'pending',
          riskLevel: 'high',
          reviewerUserId: null,
          reviewerAssignedBy: null,
          reviewerAssignedAt: null,
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
      updatePublicationReview({
        actorUserId: 'admin-1',
        publicationVersionId: 'publication-1',
        reviewState: 'approved',
        riskLevel: 'medium',
        reason: 'Approved for project tree',
      })
    ).resolves.toMatchObject({
      id: 'publication-1',
      title: 'Team plan',
      reviewState: 'approved',
      riskLevel: 'medium',
      reviewer: null,
    })

    expect(mockDb.update).toHaveBeenCalledWith(schemaMock.workflowPublicationVersion)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'publication.updated',
        resourceType: 'publication',
        resourceId: 'publication-1',
        description: 'Approved for project tree',
        metadata: expect.objectContaining({
          previousReviewState: 'pending',
          reviewState: 'approved',
          previousRiskLevel: 'high',
          riskLevel: 'medium',
          previousReviewerUserId: null,
          reviewerUserId: null,
          sourceWorkgroupId: 'workgroup-1',
          publishedWorkflowId: 'published-workflow-1',
          publicationEvent: 'review_updated',
        }),
      })
    )
  })

  it('assigns a publication reviewer from the same organization', async () => {
    mockResultsQueue.push(
      [
        {
          id: 'publication-1',
          title: 'Team plan',
          organizationId: 'org-1',
          sourceWorkgroupId: 'workgroup-1',
          sourceWorkflowId: 'workflow-1',
          publishedWorkflowId: 'published-workflow-1',
          reviewState: 'pending',
          riskLevel: 'high',
          reviewerUserId: null,
          reviewerAssignedBy: null,
          reviewerAssignedAt: null,
        },
      ],
      [
        {
          id: 'membership-1',
          role: 'admin',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
        },
      ],
      [{ id: 'org-member-1' }]
    )

    await expect(
      updatePublicationReview({
        actorUserId: 'admin-1',
        publicationVersionId: 'publication-1',
        reviewState: 'in_review',
        riskLevel: 'high',
        reviewerUserId: 'reviewer-1',
        reason: 'Assign reviewer before approval',
      })
    ).resolves.toMatchObject({
      id: 'publication-1',
      title: 'Team plan',
      reviewState: 'in_review',
      riskLevel: 'high',
      reviewer: {
        userId: 'reviewer-1',
        assignedBy: 'admin-1',
      },
    })

    expect(mockDb.update).toHaveBeenCalledWith(schemaMock.workflowPublicationVersion)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'publication.updated',
        resourceType: 'publication',
        resourceId: 'publication-1',
        description: 'Assign reviewer before approval',
        metadata: expect.objectContaining({
          previousReviewerUserId: null,
          reviewerUserId: 'reviewer-1',
          publicationEvent: 'review_updated',
        }),
      })
    )
  })

  it('clears scoped publication viewers when changing visibility back to organization', async () => {
    mockResultsQueue.push(
      [
        {
          id: 'publication-1',
          title: 'Team plan',
          organizationId: 'org-1',
          sourceWorkgroupId: 'workgroup-1',
          sourceWorkflowId: 'workflow-1',
          publishedWorkflowId: 'published-workflow-1',
          visibility: 'selected_workgroups',
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
      updatePublicationVisibility({
        actorUserId: 'admin-1',
        publicationVersionId: 'publication-1',
        visibility: 'organization',
        targetWorkgroupIds: ['workgroup-2'],
      })
    ).resolves.toMatchObject({
      visibility: 'organization',
      targetWorkgroupIds: [],
    })

    expect(mockDb.delete).toHaveBeenCalledWith(schemaMock.workflowPublicationScope)
    expect(mockDb.insert).not.toHaveBeenCalled()
  })

  it('records lifecycle broadcast events for scoped viewer teams before retraction', async () => {
    const publishedAt = new Date('2026-05-23T00:00:00Z')
    mockResultsQueue.push(
      [
        {
          id: 'publication-1',
          title: 'Team plan',
          organizationId: 'org-1',
          sourceWorkgroupId: 'workgroup-1',
          sourceWorkflowId: 'workflow-1',
          publishedWorkflowId: 'published-workflow-1',
          visibility: 'selected_workgroups',
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
      ],
      [{ workflowId: 'published-workflow-1', viewerWorkgroupId: 'workgroup-2' }],
      [{ id: 'workgroup-2', name: 'Lighting', teamWorkspaceId: 'workspace-team-2' }]
    )

    await expect(
      updatePublicationLifecycleStatus({
        actorUserId: 'admin-1',
        publicationVersionId: 'publication-1',
        action: 'retract',
      })
    ).resolves.toMatchObject({
      status: 'retracted',
    })

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-team-2',
        actorId: 'admin-1',
        action: 'publication.retracted',
        resourceType: 'publication',
        resourceId: 'publication-1',
        description: 'Showcase publication was retracted',
        metadata: expect.objectContaining({
          workgroupId: 'workgroup-2',
          sourceWorkgroupId: 'workgroup-1',
          publicationEvent: 'retracted',
          publicationBroadcast: true,
        }),
      })
    )
  })

  it('rejects publication visibility updates from non-admin team members', async () => {
    mockResultsQueue.push(
      [
        {
          id: 'publication-1',
          title: 'Team plan',
          organizationId: 'org-1',
          sourceWorkgroupId: 'workgroup-1',
          sourceWorkflowId: 'workflow-1',
          publishedWorkflowId: 'published-workflow-1',
          visibility: 'organization',
        },
      ],
      [],
      [{ organizationId: 'org-1' }],
      [{ role: 'member' }]
    )

    await expect(
      updatePublicationVisibility({
        actorUserId: 'member-1',
        publicationVersionId: 'publication-1',
        visibility: 'selected_workgroups',
        targetWorkgroupIds: ['workgroup-2'],
      })
    ).rejects.toThrow('Workgroup membership required')

    expect(mockDb.delete).not.toHaveBeenCalled()
    expect(mockDb.update).not.toHaveBeenCalled()
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

  it('lists project Agent templates with organization prompt overrides', async () => {
    mockResultsQueue.push(
      [{ role: 'admin' }],
      [
        {
          id: 'discipline-stage',
          code: 'stage_design',
          name: 'Stage design',
          description: 'Stage',
          agentCode: 'stage_design',
          sortOrder: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          agentCode: 'stage_design',
          projectInstructions: 'Prioritize constructability and cue safety.',
          updatedAt: new Date('2026-05-24T00:00:00.000Z'),
        },
      ]
    )

    await expect(
      listOrganizationAgentTemplates({ userId: 'org-admin-1', organizationId: 'org-1' })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'stage_design',
          disciplineCodes: ['stage_design'],
          projectInstructions: 'Prioritize constructability and cue safety.',
          updatedAt: '2026-05-24T00:00:00.000Z',
        }),
      ])
    )
  })

  it('updates a project Agent template and records an audit event', async () => {
    mockResultsQueue.push([{ role: 'owner' }], [])

    await expect(
      updateOrganizationAgentTemplate({
        actorUserId: 'org-admin-1',
        organizationId: 'org-1',
        agentCode: 'stage_design',
        projectInstructions: 'Require safety notes before approving stage changes.',
      })
    ).resolves.toMatchObject({
      code: 'stage_design',
      projectInstructions: 'Require safety notes before approving stage changes.',
    })

    expect(mockDb.insert).toHaveBeenCalledWith(schemaMock.organizationAgentTemplate)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agent_template.updated',
        resourceType: 'organization',
        resourceId: 'org-1',
        metadata: expect.objectContaining({
          organizationId: 'org-1',
          agentCode: 'stage_design',
          hasProjectInstructions: true,
        }),
      })
    )
  })

  it('injects project Agent template instructions into resolved workspace agents', async () => {
    mockResultsQueue.push(
      [],
      [{ workgroupId: 'workgroup-1', workspaceId: 'workspace-1' }],
      [
        {
          id: 'membership-1',
          role: 'member',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
        },
      ],
      [
        {
          workgroupId: 'workgroup-1',
          workgroupName: 'Stage',
          disciplineId: 'discipline-stage',
          disciplineCode: 'stage_design',
          disciplineName: 'Stage design',
          agentCode: 'stage_design',
          organizationId: 'org-1',
        },
      ],
      [{ projectInstructions: 'Use the project safety checklist before answering.' }],
      []
    )

    await expect(
      resolveAgentForWorkspace({ userId: 'member-1', workspaceId: 'workspace-1' })
    ).resolves.toMatchObject({
      agent: {
        code: 'stage_design',
        defaultSystemPrompt: expect.stringContaining(
          'Use the project safety checklist before answering.'
        ),
      },
    })
  })

  it('lists project Agent skill policies for organization admins', async () => {
    mockResultsQueue.push(
      [{ role: 'admin' }],
      [
        {
          workgroupId: 'workgroup-1',
          workgroupName: 'Stage team',
          teamWorkspaceId: 'workspace-team-1',
          disciplineAgentCode: 'stage_design',
          skillId: 'skill-1',
          name: 'Stage cue checker',
          description: 'Reviews cue timing',
        },
        {
          workgroupId: 'workgroup-2',
          workgroupName: 'Lighting team',
          teamWorkspaceId: 'workspace-team-2',
          disciplineAgentCode: 'lighting_sound',
          skillId: 'skill-2',
          name: 'Lighting risk scan',
          description: 'Reviews lighting risk',
        },
      ],
      [
        {
          id: 'binding-1',
          agentCode: 'stage_design',
          skillId: 'skill-1',
          enabled: false,
        },
      ]
    )

    await expect(
      listOrganizationAgentSkillPolicies({
        userId: 'org-admin-1',
        organizationId: 'org-1',
        agentCode: 'stage_design',
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'binding-1',
        agentCode: 'stage_design',
        skillId: 'skill-1',
        enabled: false,
        scope: 'agent_template',
        sourceWorkgroup: { id: 'workgroup-1', name: 'Stage team' },
      }),
    ])
  })

  it('updates a project Agent skill policy and records an audit event', async () => {
    mockResultsQueue.push(
      [{ role: 'owner' }],
      [
        {
          workgroupId: 'workgroup-1',
          workgroupName: 'Stage team',
          teamWorkspaceId: 'workspace-team-1',
          disciplineAgentCode: 'stage_design',
          skillId: 'skill-1',
          name: 'Stage cue checker',
          description: 'Reviews cue timing',
        },
      ],
      [{ id: 'binding-existing' }]
    )

    await expect(
      updateOrganizationAgentSkillPolicy({
        actorUserId: 'org-admin-1',
        organizationId: 'org-1',
        agentCode: 'stage_design',
        skillId: 'skill-1',
        enabled: false,
      })
    ).resolves.toMatchObject({
      id: 'binding-existing',
      agentCode: 'stage_design',
      skillId: 'skill-1',
      enabled: false,
      scope: 'agent_template',
    })

    expect(mockDb.update).toHaveBeenCalledWith(schemaMock.agentSkillBinding)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'org-admin-1',
        action: 'skill.updated',
        resourceType: 'skill',
        resourceId: 'skill-1',
        metadata: expect.objectContaining({
          organizationId: 'org-1',
          agentCode: 'stage_design',
          scope: 'agent_template',
          enabled: false,
        }),
      })
    )
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
