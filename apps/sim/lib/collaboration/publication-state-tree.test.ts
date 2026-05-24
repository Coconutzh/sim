/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { PublicationSummary } from '@/lib/api/contracts/collaboration'
import {
  buildPublicationConflictRepairGuide,
  buildPublicationStateGroups,
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
    publishedAt: '2026-05-24T00:00:00.000Z',
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
})
