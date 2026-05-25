import { describe, expect, it } from 'vitest'
import { batchWorkspaceInvitationBodySchema } from '@/lib/api/contracts/invitations'

describe('batchWorkspaceInvitationBodySchema', () => {
  it('uses canvas wording for empty invitation canvas IDs', () => {
    const result = batchWorkspaceInvitationBodySchema.safeParse({
      workspaceId: '',
      invitations: [{ email: 'teammate@example.com', permission: 'read' }],
    })

    expect(result.success).toBe(false)

    if (result.success) {
      throw new Error('Expected batch workspace invitation body to be invalid')
    }

    expect(result.error.issues[0]?.message).toBe('Canvas ID is required')
  })
})
