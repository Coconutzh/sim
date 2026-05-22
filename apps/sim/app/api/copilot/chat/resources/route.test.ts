/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorizeWorkflow, mockGetSession, mockSelectLimit, mockUpdateWhere } = vi.hoisted(
  () => ({
    mockAuthorizeWorkflow: vi.fn(),
    mockGetSession: vi.fn(),
    mockSelectLimit: vi.fn(),
    mockUpdateWhere: vi.fn(),
  })
)

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflow,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockSelectLimit,
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: mockUpdateWhere,
      })),
    })),
  },
}))

vi.mock('@sim/db/schema', () => ({
  copilotChats: {
    id: 'copilotChats.id',
    resources: 'copilotChats.resources',
    updatedAt: 'copilotChats.updatedAt',
    userId: 'copilotChats.userId',
  },
}))

import { POST } from './route'

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/copilot/chat/resources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Copilot chat resources route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'viewer-1' } })
    mockAuthorizeWorkflow.mockResolvedValue({ allowed: true })
    mockSelectLimit.mockResolvedValue([{ resources: [] }])
    mockUpdateWhere.mockResolvedValue(undefined)
  })

  it('requires workflow read access before adding a workflow resource', async () => {
    const response = await POST(
      createRequest({
        chatId: 'chat-1',
        resource: { id: 'workflow-1', type: 'workflow', title: 'Team Canvas' },
      })
    )

    expect(response.status).toBe(200)
    expect(mockAuthorizeWorkflow).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      userId: 'viewer-1',
      action: 'read',
    })
    expect(mockUpdateWhere).toHaveBeenCalled()
  })

  it('does not add unauthorized workflow resources to the chat', async () => {
    mockAuthorizeWorkflow.mockResolvedValueOnce({ allowed: false })

    const response = await POST(
      createRequest({
        chatId: 'chat-1',
        resource: { id: 'private-workflow', type: 'workflow', title: 'Private Draft' },
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Resource not found or unauthorized',
    })
    expect(mockUpdateWhere).not.toHaveBeenCalled()
  })

  it('keeps non-workflow resources on the existing chat ownership gate', async () => {
    const response = await POST(
      createRequest({
        chatId: 'chat-1',
        resource: { id: 'file-1', type: 'file', title: 'Spec.pdf' },
      })
    )

    expect(response.status).toBe(200)
    expect(mockAuthorizeWorkflow).not.toHaveBeenCalled()
    expect(mockUpdateWhere).toHaveBeenCalled()
  })
})
