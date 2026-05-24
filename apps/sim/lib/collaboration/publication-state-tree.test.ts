/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { PublicationSummary, WorkgroupAdminSummary } from '@/lib/api/contracts/collaboration'
import {
  buildPublicationApprovalWorkflow,
  buildPublicationConflictRepairGuide,
  buildPublicationDependencyConflictAlerts,
  buildPublicationDependencyResolutionActions,
  buildPublicationReviewNotifications,
  buildPublicationStateGroups,
  buildPublicationTeamNudges,
} from '@/lib/collaboration/publication-state-tree'

function publication(overrides: Partial<PublicationSummary>): PublicationSummary {
  return {
    id: 'publication-1',
    title: 'Lighting plan',
    description: null,
    sourceWorkgroup: { id: 'workgroup-lighting', name: 'Lighting' },
    sourceDiscipline: { code: 'lighting_sound', name: 'Lighting & Sound' },
    agentCode: 'lighting_sound',
    versionNumber: 1,
    parentVersionId: null,
    status: 'published',
    visibility: 'organization',
    reviewState: 'approved',
    riskLevel: 'low',
    dependsOnPublicationIds: [],
    targetWorkgroupIds: [],
    publishedBy: { id: 'user-1', name: 'Admin', avatarUrl: null },
    reviewer: null,
    publishedAt: '2026-05-24T00:00:00.000Z',
    ...overrides,
  }
}

function team(overrides: Partial<WorkgroupAdminSummary>): WorkgroupAdminSummary {
  return {
    id: 'workgroup-lighting',
    name: 'Lighting',
    disciplineId: 'discipline-lighting',
    disciplineName: 'Lighting & Sound',
    agentCode: 'lighting_sound',
    teamWorkspaceId: 'team-workspace-lighting',
    memberCount: 3,
    currentUserRole: 'org_admin',
    ...overrides,
  }
}

describe('publication state tree grouping', () => {
  it('groups publications by discipline, source team, and agent', () => {
    const groups = buildPublicationStateGroups([
      publication({ id: 'lighting-v1', versionNumber: 1, status: 'superseded' }),
      publication({
        id: 'lighting-v2',
        versionNumber: 2,
        parentVersionId: 'lighting-v1',
        dependsOnPublicationIds: ['lighting-v1'],
        status: 'published',
      }),
      publication({
        id: 'visual-v1',
        sourceWorkgroup: { id: 'workgroup-visual', name: 'Visual' },
        sourceDiscipline: { code: 'visual', name: 'Visual' },
        agentCode: 'visual',
      }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.id)).toEqual([
      'lighting_sound:workgroup-lighting:lighting_sound',
      'visual:workgroup-visual:visual',
    ])
    expect(groups[0]).toMatchObject({
      current: {
        id: 'lighting-v2',
        versionNumber: 2,
        parentVersionId: 'lighting-v1',
        dependencyVersionNumbers: [1],
        status: 'published',
      },
      history: [{ id: 'lighting-v1', versionNumber: 1, status: 'superseded' }],
      statusCounts: expect.objectContaining({ published: 1, superseded: 1 }),
    })
  })

  it('falls back to the latest visible version when no published version is present', () => {
    const groups = buildPublicationStateGroups([
      publication({
        id: 'archived-v3',
        versionNumber: 3,
        status: 'archived',
        targetWorkgroupIds: ['workgroup-a', 'workgroup-b'],
      }),
      publication({ id: 'superseded-v2', versionNumber: 2, status: 'superseded' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].current).toMatchObject({
      id: 'archived-v3',
      status: 'archived',
      targetWorkgroupCount: 2,
    })
    expect(groups[0].history).toEqual([
      expect.objectContaining({ id: 'superseded-v2', status: 'superseded' }),
    ])
  })

  it('drops dependency version labels that are not visible in the current state tree', () => {
    const groups = buildPublicationStateGroups([
      publication({
        id: 'published-v4',
        versionNumber: 4,
        parentVersionId: null,
        dependsOnPublicationIds: ['hidden-v3'],
      }),
    ])

    expect(groups[0].current).toMatchObject({
      id: 'published-v4',
      dependsOnPublicationIds: ['hidden-v3'],
      dependencyVersionNumbers: [],
    })
  })

  it('flags groups that have multiple current versions or stale current versions', () => {
    const groups = buildPublicationStateGroups(
      [
        publication({
          id: 'current-v1',
          versionNumber: 1,
          publishedAt: '2026-05-01T00:00:00.000Z',
        }),
        publication({
          id: 'current-v2',
          versionNumber: 2,
          publishedAt: '2026-05-03T00:00:00.000Z',
        }),
      ],
      { now: new Date('2026-05-24T00:00:00.000Z'), staleDays: 14 }
    )

    expect(groups[0].governanceAlerts).toEqual([
      expect.objectContaining({
        code: 'multiple_current_versions',
        severity: 'danger',
      }),
      expect.objectContaining({
        code: 'stale_current_version',
        severity: 'warning',
        message: 'Current version is 21 days old',
      }),
    ])
  })

  it('flags groups without any current published version', () => {
    const groups = buildPublicationStateGroups([
      publication({ id: 'archived-v1', status: 'archived' }),
      publication({ id: 'superseded-v2', status: 'superseded', versionNumber: 2 }),
    ])

    expect(groups[0].governanceAlerts).toEqual([
      expect.objectContaining({
        code: 'no_current_version',
        severity: 'warning',
      }),
    ])
  })

  it('flags current versions that are not approved or are critical risk', () => {
    const groups = buildPublicationStateGroups([
      publication({
        id: 'published-v1',
        reviewState: 'changes_requested',
        riskLevel: 'critical',
      }),
    ])

    expect(groups[0].current).toMatchObject({
      reviewState: 'changes_requested',
      riskLevel: 'critical',
    })
    expect(groups[0].governanceAlerts).toEqual([
      expect.objectContaining({
        code: 'unapproved_current_version',
        severity: 'warning',
        message: 'Current version is changes requested',
      }),
      expect.objectContaining({
        code: 'critical_risk_current_version',
        severity: 'danger',
      }),
    ])
  })

  it('builds an ordered repair guide from publication governance alerts', () => {
    const [group] = buildPublicationStateGroups(
      [
        publication({
          id: 'current-v1',
          versionNumber: 1,
          publishedAt: '2026-05-01T00:00:00.000Z',
          reviewState: 'pending',
          riskLevel: 'critical',
        }),
        publication({
          id: 'current-v2',
          versionNumber: 2,
          publishedAt: '2026-05-03T00:00:00.000Z',
        }),
      ],
      { now: new Date('2026-05-24T00:00:00.000Z'), staleDays: 14 }
    )

    expect(buildPublicationConflictRepairGuide(group).map((step) => step.alertCode)).toEqual([
      'multiple_current_versions',
      'stale_current_version',
    ])
    expect(buildPublicationConflictRepairGuide(group)[0]).toMatchObject({
      title: 'Resolve duplicate current versions first',
      actionLabel: 'Archive duplicate current',
    })
  })

  it('builds restore, approval, and risk repair steps for single-current groups', () => {
    const [noCurrentGroup] = buildPublicationStateGroups([
      publication({ id: 'archived-v1', status: 'archived' }),
    ])
    expect(buildPublicationConflictRepairGuide(noCurrentGroup)).toEqual([
      expect.objectContaining({
        alertCode: 'no_current_version',
        actionLabel: 'Restore latest visible',
      }),
    ])

    const [reviewGroup] = buildPublicationStateGroups([
      publication({
        id: 'published-v1',
        reviewState: 'changes_requested',
        riskLevel: 'critical',
      }),
    ])

    expect(buildPublicationConflictRepairGuide(reviewGroup).map((step) => step.alertCode)).toEqual([
      'unapproved_current_version',
      'critical_risk_current_version',
    ])
  })

  it('builds approval workflow gates from reviewer, review, and risk state', () => {
    expect(
      buildPublicationApprovalWorkflow(
        publication({ reviewState: 'pending', riskLevel: 'critical', reviewer: null })
      ).map((step) => [step.id, step.status])
    ).toEqual([
      ['assign_reviewer', 'ready'],
      ['start_review', 'blocked'],
      ['resolve_critical_risk', 'blocked'],
      ['record_decision', 'blocked'],
    ])

    expect(
      buildPublicationApprovalWorkflow(
        publication({
          reviewState: 'in_review',
          riskLevel: 'high',
          reviewer: {
            userId: 'reviewer-1',
            assignedBy: 'admin-1',
            assignedAt: '2026-05-24T00:00:00.000Z',
          },
        })
      ).map((step) => [step.id, step.status])
    ).toEqual([
      ['assign_reviewer', 'complete'],
      ['start_review', 'complete'],
      ['resolve_critical_risk', 'complete'],
      ['record_decision', 'ready'],
    ])

    expect(
      buildPublicationApprovalWorkflow(
        publication({
          reviewState: 'approved',
          reviewer: {
            userId: 'reviewer-1',
            assignedBy: 'admin-1',
            assignedAt: '2026-05-24T00:00:00.000Z',
          },
        })
      ).at(-1)
    ).toMatchObject({ id: 'approved', status: 'complete' })
  })

  it('builds cross-team dependency conflict alerts for current publications', () => {
    const publications = [
      publication({
        id: 'stage-v2',
        title: 'Stage current',
        versionNumber: 2,
        sourceWorkgroup: { id: 'workgroup-stage', name: 'Stage' },
        sourceDiscipline: { code: 'stage', name: 'Stage' },
        agentCode: 'stage',
        dependsOnPublicationIds: ['lighting-v1', 'missing-v1'],
      }),
      publication({
        id: 'lighting-v1',
        title: 'Lighting old',
        versionNumber: 1,
        sourceWorkgroup: { id: 'workgroup-lighting', name: 'Lighting' },
        reviewState: 'changes_requested',
        riskLevel: 'critical',
        status: 'superseded',
      }),
      publication({
        id: 'lighting-v2',
        title: 'Lighting current',
        versionNumber: 2,
        sourceWorkgroup: { id: 'workgroup-lighting', name: 'Lighting' },
      }),
    ]

    const alerts = buildPublicationDependencyConflictAlerts(publications)

    expect(alerts.map((alert) => alert.code)).toEqual([
      'critical_dependency',
      'missing_dependency',
      'non_current_dependency',
      'unapproved_dependency',
    ])
    expect(alerts.find((alert) => alert.code === 'missing_dependency')).toMatchObject({
      severity: 'danger',
      publicationId: 'stage-v2',
      dependencyPublicationId: null,
      actionLabel: 'Resolve missing dependency',
    })
    expect(alerts.find((alert) => alert.code === 'non_current_dependency')).toMatchObject({
      dependencyPublicationId: 'lighting-v1',
      currentDependencyPublicationId: 'lighting-v2',
      currentDependencyVersionNumber: 2,
      detail: 'Depends on v1, but v2 is the current Lighting baseline.',
    })
  })

  it('ignores same-team dependency conflicts in the cross-team alert list', () => {
    const alerts = buildPublicationDependencyConflictAlerts([
      publication({
        id: 'lighting-v2',
        versionNumber: 2,
        dependsOnPublicationIds: ['lighting-v1'],
      }),
      publication({
        id: 'lighting-v1',
        versionNumber: 1,
        reviewState: 'changes_requested',
        riskLevel: 'critical',
        status: 'superseded',
      }),
    ])

    expect(alerts).toEqual([])
  })

  it('builds dependency conflict resolution actions for source and dependency fixes', () => {
    const publications = [
      publication({
        id: 'stage-v2',
        title: 'Stage current',
        versionNumber: 2,
        sourceWorkgroup: { id: 'workgroup-stage', name: 'Stage' },
        sourceDiscipline: { code: 'stage', name: 'Stage' },
        agentCode: 'stage',
        dependsOnPublicationIds: ['lighting-v1', 'missing-v1'],
      }),
      publication({
        id: 'lighting-v1',
        title: 'Lighting old',
        versionNumber: 1,
        sourceWorkgroup: { id: 'workgroup-lighting', name: 'Lighting' },
        reviewState: 'changes_requested',
        riskLevel: 'critical',
        status: 'superseded',
      }),
      publication({
        id: 'lighting-v2',
        title: 'Lighting current',
        versionNumber: 2,
        sourceWorkgroup: { id: 'workgroup-lighting', name: 'Lighting' },
      }),
    ]
    const alerts = buildPublicationDependencyConflictAlerts(publications)

    const actions = buildPublicationDependencyResolutionActions(alerts, publications)

    expect(actions.map((action) => action.type)).toEqual([
      'triage_dependency_risk',
      'request_source_update',
      'approve_dependency',
      'open_current_dependency',
    ])
    expect(actions.find((action) => action.type === 'request_source_update')).toMatchObject({
      targetRole: 'source',
      targetPublicationId: 'stage-v2',
      reviewState: 'changes_requested',
    })
    expect(actions.find((action) => action.type === 'approve_dependency')).toMatchObject({
      targetRole: 'dependency',
      targetPublicationId: 'lighting-v1',
      reviewState: 'approved',
    })
    expect(actions.find((action) => action.type === 'triage_dependency_risk')).toMatchObject({
      targetPublicationId: 'lighting-v1',
      riskLevel: 'high',
    })
    expect(actions.find((action) => action.type === 'open_current_dependency')).toMatchObject({
      operation: 'open',
      targetPublicationId: 'lighting-v2',
    })
  })

  it('builds a restore action when a dependency has no current replacement', () => {
    const publications = [
      publication({
        id: 'stage-v2',
        title: 'Stage current',
        sourceWorkgroup: { id: 'workgroup-stage', name: 'Stage' },
        sourceDiscipline: { code: 'stage', name: 'Stage' },
        agentCode: 'stage',
        dependsOnPublicationIds: ['lighting-v1'],
      }),
      publication({
        id: 'lighting-v1',
        title: 'Lighting archived',
        sourceWorkgroup: { id: 'workgroup-lighting', name: 'Lighting' },
        status: 'archived',
      }),
    ]

    const actions = buildPublicationDependencyResolutionActions(
      buildPublicationDependencyConflictAlerts(publications),
      publications
    )

    expect(actions).toEqual([
      expect.objectContaining({ type: 'restore_dependency', lifecycleAction: 'restore' }),
      expect.objectContaining({ type: 'request_source_update' }),
    ])
  })

  it('builds a review notification queue from reviewer, risk, and dependency signals', () => {
    const publications = [
      publication({
        id: 'stage-v2',
        title: 'Stage current',
        versionNumber: 2,
        sourceWorkgroup: { id: 'workgroup-stage', name: 'Stage' },
        sourceDiscipline: { code: 'stage', name: 'Stage' },
        agentCode: 'stage',
        reviewState: 'pending',
        dependsOnPublicationIds: ['lighting-v1'],
      }),
      publication({
        id: 'lighting-v1',
        title: 'Lighting old',
        versionNumber: 1,
        sourceWorkgroup: { id: 'workgroup-lighting', name: 'Lighting' },
        reviewState: 'changes_requested',
        riskLevel: 'critical',
        status: 'superseded',
      }),
      publication({
        id: 'lighting-v2',
        title: 'Lighting current',
        versionNumber: 2,
        sourceWorkgroup: { id: 'workgroup-lighting', name: 'Lighting' },
      }),
      publication({
        id: 'sound-v1',
        title: 'Sound mix',
        sourceWorkgroup: { id: 'workgroup-sound', name: 'Sound' },
        reviewState: 'in_review',
        reviewer: {
          userId: 'reviewer-1',
          assignedBy: 'admin-1',
          assignedAt: '2026-05-24T00:00:00.000Z',
        },
      }),
      publication({
        id: 'visual-v1',
        title: 'Visual plan',
        sourceWorkgroup: { id: 'workgroup-visual', name: 'Visual' },
        reviewState: 'changes_requested',
        reviewer: {
          userId: 'reviewer-2',
          assignedBy: 'admin-1',
          assignedAt: '2026-05-24T00:00:00.000Z',
        },
      }),
      publication({
        id: 'safety-v1',
        title: 'Safety plan',
        sourceWorkgroup: { id: 'workgroup-safety', name: 'Safety' },
        riskLevel: 'critical',
        reviewer: {
          userId: 'reviewer-3',
          assignedBy: 'admin-1',
          assignedAt: '2026-05-24T00:00:00.000Z',
        },
      }),
    ]

    const notifications = buildPublicationReviewNotifications(publications)

    expect(notifications.map((notification) => notification.type)).toEqual([
      'critical_risk',
      'dependency_conflict',
      'reviewer_unassigned',
      'reviewer_action_required',
      'changes_requested',
    ])
    expect(
      notifications.find((notification) => notification.type === 'dependency_conflict')
    ).toMatchObject({
      publicationId: 'stage-v2',
      severity: 'danger',
      actionLabel: 'Review dependencies',
    })
    expect(
      notifications.find((notification) => notification.type === 'reviewer_action_required')
    ).toMatchObject({
      publicationId: 'sound-v1',
      reviewerUserId: 'reviewer-1',
      actionLabel: 'Record decision',
    })
  })

  it('does not notify on approved low-risk current publications without dependency conflicts', () => {
    expect(buildPublicationReviewNotifications([publication({ id: 'clean-v1' })])).toEqual([])
  })

  it('builds team publication nudges for stale, missing, and never-published teams', () => {
    const groups = buildPublicationStateGroups(
      [
        publication({
          id: 'stale-v1',
          sourceWorkgroup: { id: 'workgroup-lighting', name: 'Lighting' },
          publishedAt: '2026-05-01T00:00:00.000Z',
        }),
        publication({
          id: 'archived-v1',
          sourceWorkgroup: { id: 'workgroup-stage', name: 'Stage' },
          sourceDiscipline: { code: 'stage', name: 'Stage' },
          agentCode: 'stage',
          status: 'archived',
        }),
      ],
      { now: new Date('2026-05-24T00:00:00.000Z'), staleDays: 14 }
    )

    const nudges = buildPublicationTeamNudges({
      groups,
      teams: [
        team({ id: 'workgroup-lighting', name: 'Lighting' }),
        team({
          id: 'workgroup-stage',
          name: 'Stage',
          disciplineName: 'Stage',
          agentCode: 'stage',
        }),
        team({
          id: 'workgroup-visual',
          name: 'Visual',
          disciplineName: 'Visual',
          agentCode: 'visual',
        }),
      ],
    })

    expect(nudges.map((nudge) => nudge.type)).toEqual([
      'stale_current',
      'missing_current',
      'never_published',
    ])
    expect(nudges[0]).toMatchObject({
      teamName: 'Lighting',
      publicationId: 'stale-v1',
      actionLabel: 'Start refresh review',
    })
    expect(nudges[1]).toMatchObject({
      teamName: 'Stage',
      publicationId: 'archived-v1',
      actionLabel: 'Restore latest visible',
    })
    expect(nudges[2]).toMatchObject({
      teamName: 'Visual',
      publicationId: null,
      actionLabel: 'Open team management',
    })
  })
})
