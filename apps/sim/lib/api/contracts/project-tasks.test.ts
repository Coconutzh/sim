import { describe, expect, it } from 'vitest'
import {
  createProjectTaskMessageBodySchema,
  listProjectTasksQuerySchema,
  projectTaskDueReminderResponseSchema,
  reviewProjectTaskBodySchema,
  submitProjectTaskBodySchema,
} from '@/lib/api/contracts/project-tasks'

describe('listProjectTasksQuerySchema', () => {
  it('requires a workgroup for self timelines', () => {
    const result = listProjectTasksQuerySchema.safeParse({ scope: 'self' })

    expect(result.success).toBe(false)

    if (result.success) {
      throw new Error('Expected self task timeline query to require workgroupId')
    }

    expect(result.error.issues[0]?.message).toBe('Workgroup ID is required for self task views')
  })

  it('normalizes director timeline defaults', () => {
    const result = listProjectTasksQuerySchema.safeParse({ scope: 'director' })

    expect(result.success).toBe(true)

    if (!result.success) {
      throw new Error('Expected director task timeline query to be valid')
    }

    expect(result.data.includeArchived).toBe(false)
    expect(result.data.includeCompleted).toBe(false)
    expect(result.data.limit).toBe(100)
  })
})

describe('submitProjectTaskBodySchema', () => {
  it('uses canvas wording for missing result canvas IDs', () => {
    const result = submitProjectTaskBodySchema.safeParse({
      resultWorkspaceId: '',
      resultWorkflowId: 'workflow-1',
      resultNodeId: 'node-1',
    })

    expect(result.success).toBe(false)

    if (result.success) {
      throw new Error('Expected submit body to reject empty result canvas ID')
    }

    expect(result.error.issues[0]?.message).toBe('Canvas ID is required')
  })
})

describe('reviewProjectTaskBodySchema', () => {
  it('requires review notes for rejection', () => {
    const result = reviewProjectTaskBodySchema.safeParse({ action: 'reject' })

    expect(result.success).toBe(false)

    if (result.success) {
      throw new Error('Expected rejection review body to require a note')
    }

    expect(result.error.issues[0]?.message).toBe('Review note is required when rejecting a task')
  })
})

describe('createProjectTaskMessageBodySchema', () => {
  it('requires non-empty task messages', () => {
    const result = createProjectTaskMessageBodySchema.safeParse({ content: '   ' })

    expect(result.success).toBe(false)

    if (result.success) {
      throw new Error('Expected empty task messages to be rejected')
    }

    expect(result.error.issues[0]?.message).toBe('Message cannot be empty')
  })
})

describe('projectTaskDueReminderResponseSchema', () => {
  it('accepts reminder dispatch summaries', () => {
    const result = projectTaskDueReminderResponseSchema.safeParse({
      matchedCount: 1,
      notifiedCount: 1,
      taskIds: ['task-1'],
    })

    expect(result.success).toBe(true)
  })
})
