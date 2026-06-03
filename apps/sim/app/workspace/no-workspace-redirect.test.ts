import { describe, expect, it } from 'vitest'
import { selectNoWorkspaceRedirect } from '@/app/workspace/no-workspace-redirect'

describe('selectNoWorkspaceRedirect', () => {
  it('routes blocked users to their first pending invitation when one exists', () => {
    expect(
      selectNoWorkspaceRedirect({
        creationPolicy: {
          canCreate: false,
          reason: 'Workspace creation is disabled',
          organizationId: 'org-1',
          workspaceMode: 'organization',
          billedAccountUserId: 'user-1',
          maxWorkspaces: 0,
        },
        invitations: [{ id: 'invite-1' }],
      })
    ).toBe('/invite/invite-1')
  })

  it('falls back to home when creation is blocked and no invitations exist', () => {
    expect(
      selectNoWorkspaceRedirect({
        creationPolicy: {
          canCreate: false,
          reason: 'Workspace creation is disabled',
          organizationId: 'org-1',
          workspaceMode: 'organization',
          billedAccountUserId: 'user-1',
          maxWorkspaces: 0,
        },
        invitations: [],
      })
    ).toBe('/')
  })

  it('does not override the normal create-workspace flow when creation is allowed', () => {
    expect(
      selectNoWorkspaceRedirect({
        creationPolicy: {
          canCreate: true,
          organizationId: null,
          workspaceMode: 'personal',
          billedAccountUserId: 'user-1',
          maxWorkspaces: 1,
        },
        invitations: [{ id: 'invite-1' }],
      })
    ).toBeNull()
  })
})
