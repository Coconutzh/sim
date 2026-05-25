/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateTeamWorkspace, mockGetSession, mockGetTeamWorkspace } = vi.hoisted(() => ({
  mockCreateTeamWorkspace: vi.fn(),
  mockGetSession: vi.fn(),
  mockGetTeamWorkspace: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/collaboration/service', () => ({
  createTeamWorkspace: mockCreateTeamWorkspace,
  getTeamWorkspace: mockGetTeamWorkspace,
}))

import { GET, POST } from '@/app/api/workgroups/[workgroupId]/team-workspace/route'

const workspace = {
  id: 'team-ws-1',
  name: 'Lighting team canvas',
  color: '#33C482',
  logoUrl: null,
  ownerId: 'admin-1',
  organizationId: 'org-1',
  workgroupId: 'wg-1',
  workspaceMode: 'organization',
  billedAccountUserId: 'admin-1',
  allowPersonalApiKeys: true,
  createdAt: '2026-05-23T00:00:00.000Z',
  updatedAt: '2026-05-23T00:00:00.000Z',
}

describe('/api/workgroups/[workgroupId]/team-workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mockGetTeamWorkspace.mockResolvedValue(workspace)
    mockCreateTeamWorkspace.mockResolvedValue({
      workspace,
      defaultWorkflowId: 'workflow-1',
    })
  })

  it('returns an existing team canvas for a workgroup member', async () => {
    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ workgroupId: 'wg-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ workspace })
    expect(mockGetTeamWorkspace).toHaveBeenCalledWith({
      userId: 'admin-1',
      workgroupId: 'wg-1',
    })
  })

  it('lets an admin initialize the team canvas and default workflow', async () => {
    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ workgroupId: 'wg-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ workspace, defaultWorkflowId: 'workflow-1' })
    expect(mockCreateTeamWorkspace).toHaveBeenCalledWith({
      userId: 'admin-1',
      workgroupId: 'wg-1',
    })
  })

  it('returns canvas wording when team canvas access is denied', async () => {
    mockGetTeamWorkspace.mockRejectedValueOnce(new Error('denied'))

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ workgroupId: 'wg-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Team canvas access denied' })
  })

  it('returns canvas wording when team canvas initialization is denied', async () => {
    mockCreateTeamWorkspace.mockRejectedValueOnce(new Error('denied'))

    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ workgroupId: 'wg-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Team canvas initialization denied' })
  })

  it('authenticates before initializing the team canvas', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ workgroupId: 'wg-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(mockCreateTeamWorkspace).not.toHaveBeenCalled()
  })
})
