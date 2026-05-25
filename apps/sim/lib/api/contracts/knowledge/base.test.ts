import { describe, expect, it } from 'vitest'
import { createKnowledgeBaseBodySchema } from '@/lib/api/contracts/knowledge/base'

describe('createKnowledgeBaseBodySchema', () => {
  it('uses canvas wording for empty knowledge base canvas IDs', () => {
    const result = createKnowledgeBaseBodySchema.safeParse({
      name: 'Research KB',
      workspaceId: '',
    })

    expect(result.success).toBe(false)

    if (result.success) {
      throw new Error('Expected create knowledge base body to be invalid')
    }

    expect(result.error.issues[0]?.message).toBe('Canvas ID is required')
  })
})
