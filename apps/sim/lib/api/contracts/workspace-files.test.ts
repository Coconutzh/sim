import { describe, expect, it } from 'vitest'
import { workspaceFilesParamsSchema } from '@/lib/api/contracts/workspace-files'

describe('workspaceFilesParamsSchema', () => {
  it('uses canvas wording for missing or empty route IDs', () => {
    const missingResult = workspaceFilesParamsSchema.safeParse({})
    const emptyResult = workspaceFilesParamsSchema.safeParse({ id: '' })

    expect(missingResult.success).toBe(false)
    expect(emptyResult.success).toBe(false)

    if (missingResult.success || emptyResult.success) {
      throw new Error('Expected workspace file route params to be invalid')
    }

    expect(missingResult.error.issues[0]?.message).toBe('Canvas ID is required')
    expect(emptyResult.error.issues[0]?.message).toBe('Canvas ID is required')
  })
})
