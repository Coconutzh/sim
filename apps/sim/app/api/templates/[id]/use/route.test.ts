/**
 * @vitest-environment node
 */
import { permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockParseRequest, mockCanAccessTemplate } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockParseRequest: vi.fn(),
  mockCanAccessTemplate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/templates/permissions', () => ({
  canAccessTemplate: mockCanAccessTemplate,
  verifyTemplateOwnership: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  regenerateWorkflowStateIds: vi.fn((state: unknown) => state),
}))

vi.mock('@/lib/workflows/utils', () => ({
  deduplicateWorkflowName: vi.fn(),
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getInternalApiBaseUrl: vi.fn(() => 'http://localhost:3000'),
}))

import { POST } from '@/app/api/templates/[id]/use/route'

describe('TemplateUseAPI POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: {
        params: { id: 'template-1' },
        body: { workspaceId: 'ws-hidden', connectToTemplate: false },
      },
    })
  })

  it('hides foreign personal workspace template use behind 404', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: {
        id: 'ws-hidden',
        ownerId: 'owner-2',
        workspaceMode: 'personal',
      },
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/templates/template-1/use', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: 'ws-hidden' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'template-1' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(mockCanAccessTemplate).not.toHaveBeenCalled()
  })
})
