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

const { mockListSkills, mockUpsertSkills, mockDeleteSkill } = vi.hoisted(() => ({
  mockListSkills: vi.fn(),
  mockUpsertSkills: vi.fn(),
  mockDeleteSkill: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)

vi.mock('@/lib/workflows/skills/operations', () => ({
  listSkills: mockListSkills,
  upsertSkills: mockUpsertSkills,
  deleteSkill: mockDeleteSkill,
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    SKILL_CREATED: 'SKILL_CREATED',
    SKILL_DELETED: 'SKILL_DELETED',
  },
  AuditResourceType: {
    SKILL: 'SKILL',
  },
  recordAudit: vi.fn(),
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

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

import { DELETE, GET, POST } from '@/app/api/skills/route'

describe('SkillsAPI GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: {
        id: 'ws-1',
        name: 'Workspace One',
        ownerId: 'user-1',
        organizationId: 'org-1',
        workspaceMode: 'organization',
        billedAccountUserId: 'user-1',
      },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockListSkills.mockResolvedValue([{ id: 'skill-1', name: 'Skill One' }])
  })

  it('hides foreign personal workspace skills behind 404', async () => {
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

    const response = await GET(
      new NextRequest('http://localhost:3000/api/skills?workspaceId=ws-hidden')
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(mockListSkills).not.toHaveBeenCalled()
  })

  it('hides foreign personal workspace skill writes behind 404', async () => {
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

    const response = await POST(
      new NextRequest('http://localhost:3000/api/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'ws-hidden',
          source: 'settings',
          skills: [
            {
              name: 'hidden-skill',
              description: 'secret',
              content: '# hidden skill',
            },
          ],
        }),
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
    expect(mockUpsertSkills).not.toHaveBeenCalled()
  })

  it('hides foreign personal workspace skill deletes behind 404', async () => {
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

    const response = await DELETE(
      new NextRequest(
        'http://localhost:3000/api/skills?id=skill-hidden&workspaceId=ws-hidden&source=settings',
        {
          method: 'DELETE',
        }
      )
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Skill not found' })
    expect(mockDeleteSkill).not.toHaveBeenCalled()
  })
})
