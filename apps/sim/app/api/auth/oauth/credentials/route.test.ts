/**
 * Tests for OAuth credentials API route
 *
 * @vitest-environment node
 */

import {
  hybridAuthMockFns,
  permissionsMock,
  permissionsMockFns,
  workflowAuthzMockFns,
  workflowsUtilsMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).leftJoin = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@/lib/credentials/oauth', () => ({
  syncWorkspaceOAuthCredentialsForUser: vi.fn(),
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  account: {
    id: 'account.id',
    providerId: 'account.providerId',
    scope: 'account.scope',
    updatedAt: 'account.updatedAt',
  },
  credential: {
    id: 'credential.id',
    workspaceId: 'credential.workspaceId',
    type: 'credential.type',
    displayName: 'credential.displayName',
    providerId: 'credential.providerId',
    accountId: 'credential.accountId',
    updatedAt: 'credential.updatedAt',
  },
  credentialMember: {
    id: 'credentialMember.id',
    credentialId: 'credentialMember.credentialId',
    userId: 'credentialMember.userId',
    status: 'credentialMember.status',
  },
}))

import { GET } from '@/app/api/auth/oauth/credentials/route'

describe('OAuth Credentials API Route', () => {
  function createMockRequestWithQuery(method = 'GET', queryParams = ''): NextRequest {
    const url = `http://localhost:3000/api/auth/oauth/credentials${queryParams}`
    return new NextRequest(new URL(url), { method })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      accessSource: 'workspace',
      workflow: { workspaceId: 'workspace-123' },
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: {
        id: 'workspace-123',
        name: 'Visible Workspace',
        ownerId: 'user-123',
        organizationId: 'org-1',
        workspaceMode: 'organization',
        billedAccountUserId: 'user-123',
      },
    })
  })

  it('should handle unauthenticated user', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Authentication required',
    })

    const req = createMockRequestWithQuery('GET', '?provider=google')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('User not authenticated')
  })

  it('authenticates before validating query parameters', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Authentication required',
    })

    const req = createMockRequestWithQuery('GET')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('User not authenticated')
  })

  it('should handle missing provider parameter', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })

    const req = createMockRequestWithQuery('GET')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Provider or credentialId is required')
  })

  it('should handle no credentials found', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })

    const req = createMockRequestWithQuery('GET', '?provider=github')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.credentials).toHaveLength(0)
  })

  it('should return empty credentials when no workspace context', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })

    const req = createMockRequestWithQuery('GET', '?provider=google-email')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.credentials).toHaveLength(0)
  })

  it('should reject published workflow readers requesting workspace credentials', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      accessSource: 'published',
      workflow: { workspaceId: 'workspace-123' },
    })

    const req = createMockRequestWithQuery(
      'GET',
      '?provider=google&workflowId=11111111-1111-4111-8111-111111111111'
    )

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Canvas access required')
  })

  it('hides foreign personal workspace OAuth credential listings behind 404', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Hidden Workspace',
        ownerId: 'owner-2',
        organizationId: null,
        workspaceMode: 'personal',
        billedAccountUserId: 'owner-2',
      },
    })

    const req = createMockRequestWithQuery(
      'GET',
      '?provider=google&workspaceId=11111111-1111-4111-8111-111111111111'
    )

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
  })

  it('hides direct credential lookup when the user lacks credential membership', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })
    mockDbSelect
      .mockReturnValueOnce(
        createSelectChain([
          {
            id: 'cred-1',
            workspaceId: 'workspace-123',
            type: 'oauth',
            displayName: 'Shared OAuth',
            providerId: 'google',
            accountId: 'acct-1',
            updatedAt: new Date('2026-05-21T00:00:00.000Z'),
            accountProviderId: 'google',
            accountScope: 'scope-a',
            accountUpdatedAt: new Date('2026-05-21T00:00:00.000Z'),
          },
        ])
      )
      .mockReturnValueOnce(createSelectChain([]))

    const req = createMockRequestWithQuery('GET', '?credentialId=cred-1')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Credential not found' })
  })

  it('hides direct credential lookup when the credential belongs to another workspace than the workflow', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      accessSource: 'workspace',
      workflow: { workspaceId: 'workspace-123' },
    })
    mockDbSelect.mockReturnValueOnce(
      createSelectChain([
        {
          id: 'cred-2',
          workspaceId: 'workspace-other',
          type: 'service_account',
          displayName: 'Other Workspace Credential',
          providerId: 'google-service-account',
          accountId: null,
          updatedAt: new Date('2026-05-21T00:00:00.000Z'),
          accountProviderId: null,
          accountScope: null,
          accountUpdatedAt: null,
        },
      ])
    )
    permissionsMockFns.mockCheckWorkspaceAccess
      .mockResolvedValueOnce({
        exists: true,
        hasAccess: true,
        canWrite: true,
        workspace: {
          id: 'workspace-123',
          name: 'Visible Workspace',
          ownerId: 'user-123',
          organizationId: 'org-1',
          workspaceMode: 'organization',
          billedAccountUserId: 'user-123',
        },
      })
      .mockResolvedValueOnce({
        exists: true,
        hasAccess: true,
        canWrite: true,
        workspace: {
          id: 'workspace-other',
          name: 'Other Visible Workspace',
          ownerId: 'owner-2',
          organizationId: 'org-2',
          workspaceMode: 'organization',
          billedAccountUserId: 'owner-2',
        },
      })

    const req = createMockRequestWithQuery(
      'GET',
      '?credentialId=cred-2&workflowId=11111111-1111-4111-8111-111111111111'
    )

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Credential not found' })
  })
})
