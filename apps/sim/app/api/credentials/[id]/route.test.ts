/**
 * @vitest-environment node
 */
import { authMock, authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetCredentialActorContext, mockParseRequest } = vi.hoisted(() => ({
  mockGetCredentialActorContext: vi.fn(),
  mockParseRequest: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}))

vi.mock('@sim/db/schema', () => ({
  credential: { id: 'id', description: 'description', type: 'type' },
  credentialMember: {
    role: 'role',
    status: 'status',
    credentialId: 'credentialId',
    userId: 'userId',
  },
  environment: { variables: 'variables', userId: 'userId' },
  workspaceEnvironment: {
    id: 'id',
    createdAt: 'createdAt',
    variables: 'variables',
    workspaceId: 'workspaceId',
  },
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
  getValidationErrorMessage: vi.fn(() => 'Invalid request'),
}))
vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))
vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mockGetCredentialActorContext,
}))
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}))
vi.mock('@/lib/core/security/encryption', () => ({ encryptSecret: vi.fn() }))
vi.mock('@/lib/credentials/deletion', () => ({ deleteCredential: vi.fn() }))
vi.mock('@/lib/credentials/environment', () => ({
  deleteWorkspaceEnvCredentials: vi.fn(),
  syncPersonalEnvCredentialsForUser: vi.fn(),
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('@sim/audit', () => ({
  AuditAction: {
    CREDENTIAL_UPDATED: 'credential_updated',
    CREDENTIAL_DELETED: 'credential_deleted',
  },
  AuditResourceType: { CREDENTIAL: 'credential' },
  recordAudit: vi.fn(),
}))
vi.mock('@sim/utils/id', () => ({ generateId: vi.fn(() => 'generated-id') }))
vi.mock('@/lib/api/contracts/credentials', () => ({
  deleteWorkspaceCredentialContract: {},
  getWorkspaceCredentialContract: {},
  updateWorkspaceCredentialContract: {},
}))

import { DELETE, GET, PUT } from '@/app/api/credentials/[id]/route'

describe('/api/credentials/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com', name: 'User' },
    })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: {
        params: { id: 'cred-1' },
        body: { description: 'updated description' },
      },
    })
  })

  it('hides foreign personal workspace credential detail behind 404', async () => {
    mockGetCredentialActorContext.mockResolvedValueOnce({
      credential: { id: 'cred-1', workspaceId: 'ws-hidden', type: 'oauth' },
      member: { role: 'admin', status: 'active' },
      workspaceExists: true,
      hasWorkspaceAccess: false,
      canWriteWorkspace: false,
      isAdmin: true,
    })

    const response = await GET(createRequest('GET'), { params: Promise.resolve({ id: 'cred-1' }) })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Credential not found' })
  })

  it('authenticates credential detail before parsing route params', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const response = await GET(createRequest('GET'), {
      params: Promise.resolve({ id: 'cred-1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockGetCredentialActorContext).not.toHaveBeenCalled()
  })

  it('hides foreign personal workspace credential updates behind 404', async () => {
    mockGetCredentialActorContext.mockResolvedValueOnce({
      credential: { id: 'cred-1', workspaceId: 'ws-hidden', type: 'oauth' },
      member: { role: 'admin', status: 'active' },
      workspaceExists: true,
      hasWorkspaceAccess: false,
      canWriteWorkspace: false,
      isAdmin: true,
    })

    const response = await PUT(createRequest('PUT', { description: 'updated description' }), {
      params: Promise.resolve({ id: 'cred-1' }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Credential not found' })
  })

  it('hides foreign personal workspace credential deletes behind 404', async () => {
    mockGetCredentialActorContext.mockResolvedValueOnce({
      credential: { id: 'cred-1', workspaceId: 'ws-hidden', type: 'oauth' },
      member: { role: 'admin', status: 'active' },
      workspaceExists: true,
      hasWorkspaceAccess: false,
      canWriteWorkspace: false,
      isAdmin: true,
    })

    const response = await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'cred-1' }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Credential not found' })
  })

  it('keeps visible non-admin credential deletes at 403', async () => {
    mockGetCredentialActorContext.mockResolvedValueOnce({
      credential: { id: 'cred-1', workspaceId: 'ws-1', type: 'oauth' },
      member: { role: 'member', status: 'active' },
      workspaceExists: true,
      hasWorkspaceAccess: true,
      canWriteWorkspace: true,
      isAdmin: false,
    })

    const response = await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'cred-1' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Credential admin permission required',
    })
  })
})

function createRequest(method: string, body?: unknown) {
  return new NextRequest('http://localhost:3000/api/credentials/cred-1', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}
