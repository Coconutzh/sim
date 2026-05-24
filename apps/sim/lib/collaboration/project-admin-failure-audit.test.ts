/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildProjectAdminFailureAuditEntry,
  buildProjectAdminFailureAuditSummary,
} from '@/lib/collaboration/project-admin-failure-audit'

describe('project admin failure audit', () => {
  it('normalizes empty failure fields and preserves deterministic metadata', () => {
    expect(
      buildProjectAdminFailureAuditEntry({
        id: 'failure-1',
        scope: 'publication',
        operation: ' ',
        target: '',
        message: '',
        occurredAt: '2026-05-24T00:00:00.000Z',
      })
    ).toEqual({
      id: 'failure-1',
      scope: 'publication',
      operation: 'Unknown operation',
      target: 'Unknown target',
      message: 'Unknown error',
      occurredAt: '2026-05-24T00:00:00.000Z',
    })
  })

  it('summarizes failure counts by scope and keeps the newest entry as latest', () => {
    const entries = [
      buildProjectAdminFailureAuditEntry({
        id: 'failure-2',
        scope: 'team',
        operation: 'Archive team',
        target: 'Stage',
        message: 'Archive failed',
        occurredAt: '2026-05-24T01:00:00.000Z',
      }),
      buildProjectAdminFailureAuditEntry({
        id: 'failure-1',
        scope: 'publication',
        operation: 'Approve current',
        target: 'Lighting v2',
        message: 'Review failed',
        occurredAt: '2026-05-24T00:00:00.000Z',
      }),
    ]

    expect(buildProjectAdminFailureAuditSummary(entries)).toEqual({
      total: 2,
      latest: entries[0],
      scopeCounts: {
        team: 1,
        agent: 0,
        publication: 1,
        member: 0,
        activity: 0,
        notification: 0,
      },
    })
  })
})
