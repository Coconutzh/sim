/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  dbResultQueue,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockCheckSessionOrInternalAuth,
  mockCheckWorkspaceAccess,
  mockGetUserEntityPermissions,
} = vi.hoisted(() => {
  const dbResultQueue: unknown[][] = []

  return {
    dbResultQueue,
    mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
    mockCheckSessionOrInternalAuth: vi.fn(),
    mockCheckWorkspaceAccess: vi.fn(),
    mockGetUserEntityPermissions: vi.fn(),
  }
})

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(() => Promise.resolve(dbResultQueue.shift() ?? [])),
      }
      return chain
    }),
  },
}))

vi.mock('@sim/db/schema', () => ({
  account: { id: 'account.id', userId: 'account.userId' },
  credential: {
    id: 'credential.id',
    workspaceId: 'credential.workspaceId',
    type: 'credential.type',
    accountId: 'credential.accountId',
  },
  credentialMember: {
    id: 'credentialMember.id',
    credentialId: 'credentialMember.credentialId',
    userId: 'credentialMember.userId',
    status: 'credentialMember.status',
  },
  workflow: { workspaceId: 'workflow.workspaceId' },
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

vi.mock('@/lib/auth/hybrid', () => ({
  AuthType: {
    SESSION: 'session',
    INTERNAL_JWT: 'internal_jwt',
  },
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ args, type: 'and' })),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right, type: 'eq' })),
}))

import {
  authenticateCredentialSelectorRequest,
  authorizeCredentialUse,
  credentialAccessErrorResponse,
} from '@/lib/auth/credential-access'

describe('authenticateCredentialSelectorRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      authType: 'session',
      userId: 'user-1',
    })
  })

  it('returns null for authenticated selector requests', async () => {
    await expect(
      authenticateCredentialSelectorRequest(new NextRequest('http://localhost'))
    ).resolves.toBeNull()

    expect(mockCheckSessionOrInternalAuth).toHaveBeenCalledWith(expect.any(NextRequest), {
      requireWorkflowId: false,
    })
  })

  it('returns a 401 response before selector validation for unauthenticated requests', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
    })

    const response = await authenticateCredentialSelectorRequest(
      new NextRequest('http://localhost')
    )

    expect(response?.status).toBe(401)
    await expect(response?.json()).resolves.toEqual({ error: 'Unauthorized' })
  })
})

describe('authorizeCredentialUse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbResultQueue.length = 0
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      authType: 'session',
      userId: 'user-1',
    })
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { workspaceId: 'ws-1' },
      workspacePermission: 'write',
      accessSource: 'workspace',
    })
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'user-1', workspaceMode: 'organization' },
    })
    mockGetUserEntityPermissions.mockResolvedValue('write')
  })

  it('returns hidden 404 when the referenced workflow is not visible', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: { workspaceId: 'ws-hidden' },
      workspacePermission: null,
      accessSource: null,
    })

    const result = await authorizeCredentialUse(new NextRequest('http://localhost'), {
      credentialId: 'cred-1',
      workflowId: 'wf-hidden',
      requireWorkflowIdForInternal: false,
    })

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Workflow not found',
    })
    expect(dbResultQueue).toHaveLength(0)
  })

  it('returns hidden 404 when a credential belongs to a hidden personal workspace', async () => {
    dbResultQueue.push(
      [
        {
          id: 'cred-1',
          workspaceId: 'ws-hidden',
          type: 'oauth',
          accountId: 'acct-1',
        },
      ],
      [{ userId: 'owner-2' }],
      [{ id: 'member-1' }]
    )
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const result = await authorizeCredentialUse(new NextRequest('http://localhost'), {
      credentialId: 'cred-1',
      requireWorkflowIdForInternal: false,
    })

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Credential not found',
    })
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('creates an error response using the embedded status code', async () => {
    const response = credentialAccessErrorResponse({
      ok: false,
      status: 404,
      error: 'Credential not found',
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Credential not found' })
  })
})
