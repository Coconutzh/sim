/**
 * @vitest-environment node
 */
import {
  hybridAuthMock,
  hybridAuthMockFns,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAssertPermissionsAllowed,
  mockExecuteProviderRequest,
  mockResolveAccessibleWorkflowWorkspace,
  mockResolveOAuthAccountId,
} = vi.hoisted(() => ({
  mockAssertPermissionsAllowed: vi.fn(),
  mockExecuteProviderRequest: vi.fn(),
  mockResolveAccessibleWorkflowWorkspace: vi.fn(),
  mockResolveOAuthAccountId: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/workspaces/permissions/execution-context', () => ({
  resolveAccessibleWorkflowWorkspace: mockResolveAccessibleWorkflowWorkspace,
}))

vi.mock('@/app/api/auth/oauth/utils', () => ({
  resolveOAuthAccountId: mockResolveOAuthAccountId,
  getServiceAccountToken: vi.fn(),
  refreshTokenIfNeeded: vi.fn(),
}))

vi.mock('@/providers', () => ({
  executeProviderRequest: (...args: unknown[]) => mockExecuteProviderRequest(...args),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => {
  class ProviderNotAllowedError extends Error {}
  class IntegrationNotAllowedError extends Error {}

  return {
    assertPermissionsAllowed: (...args: unknown[]) => mockAssertPermissionsAllowed(...args),
    IntegrationNotAllowedError,
    ProviderNotAllowedError,
  }
})

import { POST } from '@/app/api/providers/route'

function createProviderRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/providers', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('ProvidersAPI POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: hybridAuthMock.AuthType.SESSION,
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: {
        id: 'ws-visible',
        name: 'Visible Workspace',
        ownerId: 'user-1',
        organizationId: 'org-1',
        workspaceMode: 'organization',
        billedAccountUserId: 'user-1',
      },
    })
    mockAssertPermissionsAllowed.mockResolvedValue(undefined)
    mockResolveAccessibleWorkflowWorkspace.mockResolvedValue({
      workspaceId: 'ws-visible',
    })
    mockResolveOAuthAccountId.mockResolvedValue({
      accountId: 'acct-1',
      workspaceId: 'ws-hidden',
      credentialType: 'oauth',
    })
    mockExecuteProviderRequest.mockResolvedValue({
      output: {
        content: 'hello',
      },
    })
  })

  it('allows session-authenticated browser requests to execute providers', async () => {
    const request = createProviderRequest({
      provider: 'zhipu',
      model: 'glm-4.7-flash',
      workspaceId: 'ws-visible',
      messages: [{ role: 'user', content: 'hello' }],
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(hybridAuthMockFns.mockCheckSessionOrInternalAuth).toHaveBeenCalled()
    expect(mockAssertPermissionsAllowed).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'ws-visible',
      model: 'glm-4.7-flash',
    })
    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      'zhipu',
      expect.objectContaining({
        model: 'glm-4.7-flash',
        workspaceId: 'ws-visible',
      })
    )
  })

  it('hides foreign personal workspace vertex credential access', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess
      .mockResolvedValueOnce({
        exists: true,
        hasAccess: true,
        canWrite: true,
        workspace: {
          id: 'ws-visible',
          name: 'Visible Workspace',
          ownerId: 'user-1',
          organizationId: 'org-1',
          workspaceMode: 'organization',
          billedAccountUserId: 'user-1',
        },
      })
      .mockResolvedValueOnce({
        exists: true,
        hasAccess: false,
        canWrite: false,
        workspace: {
          id: 'ws-hidden',
          name: 'Hidden Workspace',
          ownerId: 'owner-2',
          organizationId: null,
          workspaceMode: 'personal',
          billedAccountUserId: 'owner-2',
        },
      })

    const request = createProviderRequest({
      provider: 'vertex',
      model: 'gemini-1.5-pro',
      workspaceId: 'ws-visible',
      vertexCredential: 'cred-hidden',
      messages: [{ role: 'user', content: 'hello' }],
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Vertex AI credential not found: cred-hidden',
    })
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('hides foreign personal workspace provider execution behind 404', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: {
        id: 'ws-hidden',
        name: 'Hidden Workspace',
        ownerId: 'owner-2',
        organizationId: null,
        workspaceMode: 'personal',
        billedAccountUserId: 'owner-2',
      },
    })

    const request = createProviderRequest({
      provider: 'openai',
      model: 'gpt-4.1',
      workspaceId: 'ws-hidden',
      messages: [{ role: 'user', content: 'hello' }],
    })

    const response = await POST(request)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Canvas not found',
    })
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('hides foreign personal workflow execution behind 404 even with a spoofed visible workspace', async () => {
    mockResolveAccessibleWorkflowWorkspace.mockResolvedValueOnce({
      response: Response.json({ error: 'Canvas not found' }, { status: 404 }),
    })

    const request = createProviderRequest({
      provider: 'openai',
      model: 'gpt-4.1',
      workspaceId: 'ws-visible',
      workflowId: 'wf-hidden',
      messages: [{ role: 'user', content: 'hello' }],
    })

    const response = await POST(request)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Canvas not found',
    })
    expect(mockResolveAccessibleWorkflowWorkspace).toHaveBeenCalledWith({
      userId: 'user-1',
      workflowId: 'wf-hidden',
      workspaceId: 'ws-visible',
    })
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('normalizes provider execution to the workflow workspace', async () => {
    mockResolveAccessibleWorkflowWorkspace.mockResolvedValueOnce({
      workspaceId: 'ws-actual',
    })

    const request = createProviderRequest({
      provider: 'openai',
      model: 'gpt-4.1',
      workspaceId: 'ws-spoofed',
      workflowId: 'wf-1',
      messages: [{ role: 'user', content: 'hello' }],
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({
        workflowId: 'wf-1',
        workspaceId: 'ws-actual',
      })
    )
  })
})
