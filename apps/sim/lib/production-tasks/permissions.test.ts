import { describe, expect, it } from 'vitest'
import { canCreateProductionTask } from '@/lib/production-tasks/permissions'
import { computeMobileProjectMetrics } from '@/lib/production-tasks/service'

describe('canCreateProductionTask', () => {
  it.each(['chief_director', 'show_director'])('allows %s agent memberships', (agentCode) => {
    expect(canCreateProductionTask([{ agentCode, disciplineCode: 'other' }])).toBe(true)
  })

  it('allows PMO discipline memberships', () => {
    expect(canCreateProductionTask([{ agentCode: 'production', disciplineCode: 'pmo' }])).toBe(true)
  })

  it('does not grant task creation to ordinary memberships', () => {
    expect(
      canCreateProductionTask([{ agentCode: 'lighting_sound', disciplineCode: 'lighting' }])
    ).toBe(false)
  })
})

describe('computeMobileProjectMetrics', () => {
  it('counts overdue, due soon, review, completion, unread and adopted tasks', () => {
    const now = new Date('2026-09-01T00:00:00.000Z')
    expect(
      computeMobileProjectMetrics(
        [
          {
            status: 'todo',
            dueAt: new Date('2026-08-31T23:00:00.000Z'),
            unreadMessageCount: 2,
            adopted: false,
          },
          {
            status: 'submitted',
            dueAt: new Date('2026-09-01T12:00:00.000Z'),
            unreadMessageCount: 1,
            adopted: true,
          },
          { status: 'approved', dueAt: null, unreadMessageCount: 0, adopted: true },
        ],
        now
      )
    ).toEqual({
      total: 3,
      completed: 1,
      overdue: 1,
      dueSoon: 1,
      pendingReview: 1,
      unreadMessages: 3,
      adoptedResults: 2,
    })
  })
})
