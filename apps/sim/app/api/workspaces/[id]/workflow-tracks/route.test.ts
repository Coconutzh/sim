/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckSessionOrInternalAuth, mockParseRequest, mockListWorkflowTracksForWorkspace } =
  vi.hoisted(() => ({
    mockCheckSessionOrInternalAuth: vi.fn(),
    mockParseRequest: vi.fn(),
    mockListWorkflowTracksForWorkspace: vi.fn(),
  }))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@/lib/api/contracts/workflows', () => ({
  listWorkflowTracksContract: {},
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))

vi.mock('@/lib/workflows/publication', () => ({
  listWorkflowTracksForWorkspace: mockListWorkflowTracksForWorkspace,
}))

import { GET } from './route'

describe('workspace workflow tracks route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: true, userId: 'viewer-1' })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: { params: { id: 'ws-1' } },
    })
  })

  it('hides foreign personal workspaces behind 404', async () => {
    mockListWorkflowTracksForWorkspace.mockRejectedValueOnce(
      new Error('Access denied to workspace')
    )

    const response = await GET(
      new NextRequest('http://localhost/api/workspaces/ws-1/workflow-tracks'),
      {
        params: Promise.resolve({ id: 'ws-hidden' }),
      }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
  })
})
