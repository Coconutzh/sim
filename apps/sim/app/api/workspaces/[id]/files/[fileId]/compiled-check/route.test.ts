/**
 * @vitest-environment node
 */
import { authMockFns, workflowsApiUtilsMock, workflowsApiUtilsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkspaceFile, mockFetchWorkspaceFileBuffer } = vi.hoisted(() => ({
  mockGetWorkspaceFile: vi.fn(),
  mockFetchWorkspaceFileBuffer: vi.fn(),
}))

vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  getWorkspaceFile: mockGetWorkspaceFile,
  fetchWorkspaceFileBuffer: mockFetchWorkspaceFileBuffer,
}))

vi.mock('@/lib/execution/sandbox/run-task', () => ({
  runSandboxTask: vi.fn(),
  SandboxUserCodeError: class SandboxUserCodeError extends Error {},
}))

vi.mock('@/lib/mermaid/validate', () => ({
  validateMermaidSource: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

import { GET } from '@/app/api/workspaces/[id]/files/[fileId]/compiled-check/route'

describe('Workspace file compiled check route', () => {
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

  it('hides foreign personal workspace compiled check behind 404', async () => {
    workflowsApiUtilsMockFns.mockGetWorkspaceMembershipAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      permission: null,
      canWrite: false,
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/workspaces/ws-hidden/files/file-1/compiled-check'),
      { params: Promise.resolve({ id: 'ws-hidden', fileId: 'file-1' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
    expect(mockGetWorkspaceFile).not.toHaveBeenCalled()
    expect(mockFetchWorkspaceFileBuffer).not.toHaveBeenCalled()
  })
})
