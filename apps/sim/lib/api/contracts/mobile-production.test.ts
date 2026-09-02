import { describe, expect, it } from 'vitest'
import {
  mobileProjectDetailQuerySchema,
  mobileTaskFilterSchema,
} from '@/lib/api/contracts/mobile-production'

describe('mobile production contracts', () => {
  it('accepts bounded task filters and pagination', () => {
    expect(mobileProjectDetailQuerySchema.parse({ taskFilter: 'pending_review', limit: '20', offset: '10' })).toEqual({
      taskFilter: 'pending_review',
      limit: 20,
      offset: 10,
    })
  })

  it('rejects unsupported filters and unsafe pagination', () => {
    expect(mobileTaskFilterSchema.safeParse('review').success).toBe(false)
    expect(mobileProjectDetailQuerySchema.safeParse({ limit: 0 }).success).toBe(false)
  })
})
