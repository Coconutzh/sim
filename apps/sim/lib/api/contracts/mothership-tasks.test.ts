import { describe, expect, it } from 'vitest'
import { mothershipExecuteBodySchema } from '@/lib/api/contracts/mothership-tasks'

describe('mothershipExecuteBodySchema', () => {
  it('uses canvas wording for empty execute canvas IDs', () => {
    const result = mothershipExecuteBodySchema.safeParse({
      messages: [{ role: 'user', content: 'Hello' }],
      workspaceId: '',
      userId: 'user-1',
    })

    expect(result.success).toBe(false)

    if (result.success) {
      throw new Error('Expected mothership execute body to be invalid')
    }

    expect(result.error.issues[0]?.message).toBe('Canvas ID is required')
  })
})
