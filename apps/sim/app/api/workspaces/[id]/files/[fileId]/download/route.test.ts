/**
 * @vitest-environment node
 */
import { authMockFns, workflowsApiUtilsMock, workflowsApiUtilsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkspaceFile } = vi.hoisted(() => ({
  mockGetWorkspaceFile: vi.fn(),
}))

vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  getWorkspaceFile: mockGetWorkspaceFile,
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => 'http://localhost:3000',
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

import { POST } from '@/app/api/workspaces/[id]/files/[fileId]/download/route'

describe('Workspace file download route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    workflowsApiUtilsMockFns.mockGetWorkspaceMembershipAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      permission: 'read',
      canWrite: false,
    })
  })

  it('hides foreign personal workspace download access behind 404', async () => {
    workflowsApiUtilsMockFns.mockGetWorkspaceMembershipAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      permission: null,
      canWrite: false,
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/workspaces/ws-hidden/files/file-1/download', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'ws-hidden', fileId: 'file-1' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
    expect(mockGetWorkspaceFile).not.toHaveBeenCalled()
  })
})
