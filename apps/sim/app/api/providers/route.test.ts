/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  hybridAuthMock,
  hybridAuthMockFns,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteProviderRequest, mockAssertPermissionsAllowed } = vi.hoisted(() => ({
  mockExecuteProviderRequest: vi.fn(),
  mockAssertPermissionsAllowed: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/providers', () => ({
  executeProviderRequest: (...args: unknown[]) => mockExecuteProviderRequest(...args),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => {
  class ProviderNotAllowedError extends Error {}
  class IntegrationNotAllowedError extends Error {}

  return {
    assertPermissionsAllowed: (...args: unknown[]) => mockAssertPermissionsAllowed(...args),
    ProviderNotAllowedError,
    IntegrationNotAllowedError,
  }
})

vi.mock('@/app/api/auth/oauth/utils', () => ({
  getServiceAccountToken: vi.fn(),
  refreshTokenIfNeeded: vi.fn(),
  resolveOAuthAccountId: vi.fn(),
}))

import { POST } from '@/app/api/providers/route'

describe('Providers API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: hybridAuthMock.AuthType.SESSION,
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      canWrite: true,
      exists: true,
      workspace: { id: 'ws-1', name: 'Test Workspace', ownerId: 'user-1' },
    })
    mockAssertPermissionsAllowed.mockResolvedValue(undefined)
    mockExecuteProviderRequest.mockResolvedValue({
      content: '测试成功',
      model: 'glm-4.7-flash',
    })
  })

  it('allows session-authenticated browser requests to execute providers', async () => {
    const request = createMockRequest(
      'POST',
      {
        provider: 'zhipu',
        model: 'glm-4.7-flash',
        workspaceId: 'ws-1',
        messages: [{ role: 'user', content: '你好' }],
      },
      {
        'content-type': 'application/json',
      },
      'http://localhost:3000/api/providers'
    )

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(hybridAuthMockFns.mockCheckSessionOrInternalAuth).toHaveBeenCalled()
    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      'zhipu',
      expect.objectContaining({
        model: 'glm-4.7-flash',
        workspaceId: 'ws-1',
      })
    )
  })
})
