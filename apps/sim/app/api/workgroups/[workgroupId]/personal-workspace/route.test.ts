/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreatePersonalWorkspace, mockGetOrCreatePersonalWorkspace, mockGetSession } =
  vi.hoisted(() => ({
    mockCreatePersonalWorkspace: vi.fn(),
    mockGetOrCreatePersonalWorkspace: vi.fn(),
    mockGetSession: vi.fn(),
  }))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/collaboration/service', () => ({
  createPersonalWorkspace: mockCreatePersonalWorkspace,
  getOrCreatePersonalWorkspace: mockGetOrCreatePersonalWorkspace,
}))

import { GET, POST } from '@/app/api/workgroups/[workgroupId]/personal-workspace/route'

const workspace = {
  id: 'personal-ws-1',
  name: 'Lighting draft',
  color: '#33C482',
  logoUrl: null,
  ownerId: 'user-1',
  organizationId: 'org-1',
  workgroupId: 'wg-1',
  workspaceMode: 'personal',
  billedAccountUserId: 'user-1',
  allowPersonalApiKeys: true,
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
}

describe('/api/workgroups/[workgroupId]/personal-workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetOrCreatePersonalWorkspace.mockResolvedValue(workspace)
    mockCreatePersonalWorkspace.mockResolvedValue({
      workspace,
      defaultWorkflowId: 'workflow-1',
    })
  })

  it('returns the current personal draft canvas for a workgroup member', async () => {
    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ workgroupId: 'wg-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ workspace })
    expect(mockGetOrCreatePersonalWorkspace).toHaveBeenCalledWith({
      userId: 'user-1',
      workgroupId: 'wg-1',
    })
  })

  it('creates a new personal draft canvas and default workflow', async () => {
    const response = await POST(createMockRequest('POST', { name: 'Lighting scratch 2' }), {
      params: Promise.resolve({ workgroupId: 'wg-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ workspace, defaultWorkflowId: 'workflow-1' })
    expect(mockCreatePersonalWorkspace).toHaveBeenCalledWith({
      userId: 'user-1',
      workgroupId: 'wg-1',
      name: 'Lighting scratch 2',
    })
  })

  it('authenticates before creating a personal draft canvas', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await POST(createMockRequest('POST', { name: '' }), {
      params: Promise.resolve({ workgroupId: 'wg-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(mockCreatePersonalWorkspace).not.toHaveBeenCalled()
  })

  it('validates the personal draft canvas name through the route contract', async () => {
    const response = await POST(createMockRequest('POST', { name: '' }), {
      params: Promise.resolve({ workgroupId: 'wg-1' }),
    })

    expect(response.status).toBe(400)
    expect(mockCreatePersonalWorkspace).not.toHaveBeenCalled()
  })
})
