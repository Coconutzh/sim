/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockVerifyCreatorPermission,
  mockLoadWorkflowFromNormalizedTables,
  mockDbSelect,
  mockDbUpdate,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockVerifyCreatorPermission: vi.fn(),
  mockLoadWorkflowFromNormalizedTables: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
}))

vi.mock('@/lib/templates/permissions', () => ({
  canAccessTemplate: vi.fn(),
  verifyCreatorPermission: mockVerifyCreatorPermission,
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mockLoadWorkflowFromNormalizedTables,
}))

vi.mock('@/lib/workflows/credentials/credential-extractor', () => ({
  extractRequiredCredentials: vi.fn(() => []),
  sanitizeCredentials: vi.fn((value: unknown) => value),
}))

import { PUT } from '@/app/api/templates/[id]/route'

describe('TemplateByIdAPI PUT', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'User One', email: 'user@example.com' },
    })

    mockVerifyCreatorPermission.mockResolvedValue({
      hasPermission: true,
      error: null,
    })

    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              id: 'template-1',
              creatorId: 'creator-1',
              workflowId: 'workflow-1',
              status: 'approved',
              name: 'Template One',
            },
          ]),
        }),
      }),
    })
  })

  it('rejects template state sync for cross-team published workflow access', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
      workspacePermission: 'read',
      accessSource: 'selected_workgroups',
    })

    const request = new NextRequest('http://localhost:3000/api/templates/template-1', {
      method: 'PUT',
      body: JSON.stringify({ updateState: true }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await PUT(request, {
      params: Promise.resolve({ id: 'template-1' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Cross-team published workflow access does not include template state sync',
    })
    expect(mockLoadWorkflowFromNormalizedTables).not.toHaveBeenCalled()
  })
})
