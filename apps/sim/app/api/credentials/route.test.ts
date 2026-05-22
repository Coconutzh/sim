/**
 * @vitest-environment node
 */
import { authMock, authMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseRequest, mockSyncWorkspaceOAuthCredentialsForUser } = vi.hoisted(() => ({
  mockParseRequest: vi.fn(),
  mockSyncWorkspaceOAuthCredentialsForUser: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

function createWhereResultChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock('@sim/db/schema', () => ({
  account: { id: 'id', userId: 'userId', providerId: 'providerId', accountId: 'accountId' },
  credential: {
    id: 'id',
    workspaceId: 'workspaceId',
    type: 'type',
    displayName: 'displayName',
    description: 'description',
    providerId: 'providerId',
    accountId: 'accountId',
    envKey: 'envKey',
    envOwnerUserId: 'envOwnerUserId',
    createdBy: 'createdBy',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  credentialMember: {
    role: 'role',
    status: 'status',
    id: 'id',
    credentialId: 'credentialId',
    userId: 'userId',
  },
  workspace: { ownerId: 'ownerId', id: 'id' },
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
  getValidationErrorMessage: vi.fn(() => 'Invalid request'),
}))
vi.mock('@/lib/api/contracts/credentials', () => ({
  createWorkspaceCredentialContract: {},
  listWorkspaceCredentialsGetContract: {},
  normalizeCredentialEnvKey: vi.fn((value: string) => value),
  serviceAccountJsonSchema: { safeParse: vi.fn() },
}))
vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}))
vi.mock('@/lib/core/security/encryption', () => ({ encryptSecret: vi.fn() }))
vi.mock('@/lib/core/utils/request', () => ({ generateRequestId: vi.fn(() => 'request-1') }))
vi.mock('@/lib/credentials/environment', () => ({
  getWorkspaceMemberUserIds: vi.fn(),
  syncWorkspaceOAuthCredentialsForUser: vi.fn(),
}))
vi.mock('@/lib/credentials/oauth', () => ({
  syncWorkspaceOAuthCredentialsForUser: mockSyncWorkspaceOAuthCredentialsForUser,
}))
vi.mock('@/lib/oauth', () => ({ getServiceConfigByProviderId: vi.fn() }))
vi.mock('@/lib/oauth/types', () => ({
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID: 'atlassian-service-account',
  ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE: 'atlassian-secret',
}))
vi.mock('@/lib/credentials/atlassian-service-account', () => ({
  AtlassianValidationError: class extends Error {},
  normalizeAtlassianDomain: vi.fn(),
  validateAtlassianServiceAccount: vi.fn(),
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('@sim/audit', () => ({
  AuditAction: { CREDENTIAL_CREATED: 'credential_created' },
  AuditResourceType: { CREDENTIAL: 'credential' },
  recordAudit: vi.fn(),
}))
vi.mock('@sim/utils/errors', () => ({ getPostgresErrorCode: vi.fn() }))
vi.mock('@sim/utils/id', () => ({ generateId: vi.fn(() => 'generated-id') }))

import { db } from '@sim/db'
import { GET, POST } from '@/app/api/credentials/route'

describe('/api/credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com', name: 'User' },
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'user-1', workspaceMode: 'organization' },
    })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: {
        query: {
          workspaceId: 'ws-1',
          type: undefined,
          providerId: undefined,
          credentialId: undefined,
        },
        body: {
          workspaceId: 'ws-1',
          type: 'env_workspace',
          displayName: 'API_KEY',
          description: null,
          providerId: null,
          accountId: null,
          envKey: 'API_KEY',
          envOwnerUserId: null,
          serviceAccountJson: undefined,
          apiToken: undefined,
          domain: undefined,
        },
      },
    })
  })

  it('hides foreign personal workspace credential listings behind 404', async () => {
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        query: {
          workspaceId: 'ws-hidden',
          type: undefined,
          providerId: undefined,
          credentialId: undefined,
        },
      },
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/credentials?workspaceId=ws-hidden')
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Workspace not found' })
  })

  it('does not sync OAuth credentials for visible read-only workspaces', async () => {
    vi.mocked(db.select).mockReturnValueOnce(createWhereResultChain([]) as never)
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        query: {
          workspaceId: 'ws-readonly',
          type: undefined,
          providerId: undefined,
          credentialId: undefined,
        },
      },
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: false,
      workspace: { id: 'ws-readonly', ownerId: 'owner-2', workspaceMode: 'organization' },
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/credentials?workspaceId=ws-readonly')
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ credentials: [] })
    expect(mockSyncWorkspaceOAuthCredentialsForUser).not.toHaveBeenCalled()
  })

  it('does not expose credential lookup results without active credential membership', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createSelectChain([]) as never)
      .mockReturnValueOnce(createSelectChain([]) as never)
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        query: {
          workspaceId: 'ws-1',
          type: undefined,
          providerId: undefined,
          credentialId: 'cred-secret',
        },
      },
    })

    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/credentials?workspaceId=ws-1&credentialId=cred-secret'
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ credential: null })
    expect(mockSyncWorkspaceOAuthCredentialsForUser).not.toHaveBeenCalled()
  })

  it('hides foreign personal workspace credential creation behind 404', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'ws-hidden',
          type: 'env_workspace',
          envKey: 'API_KEY',
        }),
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Workspace not found' })
  })

  it('keeps visible read-only workspace credential creation at 403', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: false,
      workspace: { id: 'ws-readonly', ownerId: 'owner-2', workspaceMode: 'organization' },
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'ws-readonly',
          type: 'env_workspace',
          envKey: 'API_KEY',
        }),
      })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Write permission required' })
  })
})
