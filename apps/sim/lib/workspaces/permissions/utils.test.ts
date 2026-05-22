import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkWorkspaceAccess,
  getManageableWorkspaces,
  getUserEntityPermissions,
  getUsersWithPermissions,
  getWorkspaceById,
  getWorkspaceMemberProfiles,
  getWorkspaceWithOwner,
  hasAdminPermission,
  hasWorkspaceAdminAccess,
  listAccessibleWorkspaceIds,
  workspaceExists,
} from '@/lib/workspaces/permissions/utils'

const mockDb = db as any
type PermissionType = 'admin' | 'write' | 'read'

function createMockChain(finalResult: any) {
  const chain: any = {}

  chain.then = vi.fn().mockImplementation((resolve: any) => resolve(finalResult))
  chain.select = vi.fn().mockReturnValue(chain)
  chain.from = vi.fn().mockReturnValue(chain)
  chain.where = vi.fn().mockReturnValue(chain)
  chain.limit = vi.fn().mockReturnValue(chain)
  chain.innerJoin = vi.fn().mockReturnValue(chain)
  chain.leftJoin = vi.fn().mockReturnValue(chain)
  chain.orderBy = vi.fn().mockReturnValue(chain)

  return chain
}

describe('Permission Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.select.mockReset()
  })

  describe('getUserEntityPermissions', () => {
    it('should treat the workspace owner as admin without a permission row', async () => {
      const workspaceChain = createMockChain([
        {
          id: 'workspace456',
          name: 'Owner Workspace',
          ownerId: 'user123',
          organizationId: null,
          workspaceMode: 'personal',
          billedAccountUserId: 'user123',
          archivedAt: null,
        },
      ])
      mockDb.select.mockReturnValueOnce(workspaceChain)

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

      expect(result).toBe('admin')
    })

    it('should return null when user has no permissions', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

      expect(result).toBeNull()
    })

    it('should return the highest permission when user has multiple permissions', async () => {
      const mockResults = [
        { permissionType: 'read' as PermissionType },
        { permissionType: 'admin' as PermissionType },
        { permissionType: 'write' as PermissionType },
      ]
      const chain = createMockChain(mockResults)
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

      expect(result).toBe('admin')
    })

    it('should return single permission when user has only one', async () => {
      const mockResults = [{ permissionType: 'read' as PermissionType }]
      const chain = createMockChain(mockResults)
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'workflow', 'workflow789')

      expect(result).toBe('read')
    })

    it('should prioritize admin over other permissions', async () => {
      const mockResults = [
        { permissionType: 'write' as PermissionType },
        { permissionType: 'admin' as PermissionType },
        { permissionType: 'read' as PermissionType },
      ]
      const chain = createMockChain(mockResults)
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user999', 'workspace', 'workspace999')

      expect(result).toBe('admin')
    })

    it('should return write permission when user only has write access', async () => {
      const mockResults = [{ permissionType: 'write' as PermissionType }]
      const chain = createMockChain(mockResults)
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

      expect(result).toBe('write')
    })

    it('should prioritize write over read permissions', async () => {
      const mockResults = [
        { permissionType: 'read' as PermissionType },
        { permissionType: 'write' as PermissionType },
      ]
      const chain = createMockChain(mockResults)
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

      expect(result).toBe('write')
    })

    it('should work with workflow entity type', async () => {
      const mockResults = [{ permissionType: 'admin' as PermissionType }]
      const chain = createMockChain(mockResults)
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'workflow', 'workflow789')

      expect(result).toBe('admin')
    })

    it('ignores direct permission rows for personal workspaces owned by another user', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              id: 'workspace456',
              name: 'Personal Workspace',
              ownerId: 'owner-1',
              organizationId: 'org-1',
              workspaceMode: 'personal',
              billedAccountUserId: 'owner-1',
              archivedAt: null,
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([{ permissionType: 'admin' as PermissionType }]))

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

      expect(result).toBeNull()
    })

    it('returns write for team workspace members through workgroup membership', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              id: 'workspace456',
              name: 'Team Workspace',
              ownerId: 'owner-1',
              organizationId: 'org-1',
              workgroupId: 'workgroup-1',
              workspaceMode: 'organization',
              billedAccountUserId: 'owner-1',
              archivedAt: null,
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([{ role: 'member' }]))

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

      expect(result).toBe('write')
    })

    it('ignores direct permission rows for team workspaces without workgroup membership', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              id: 'workspace456',
              name: 'Team Workspace',
              ownerId: 'owner-1',
              organizationId: 'org-1',
              workgroupId: 'workgroup-1',
              workspaceMode: 'organization',
              billedAccountUserId: 'owner-1',
              archivedAt: null,
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([{ permissionType: 'admin' as PermissionType }]))

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

      expect(result).toBeNull()
    })

    it('should work with organization entity type', async () => {
      const mockResults = [{ permissionType: 'read' as PermissionType }]
      const chain = createMockChain(mockResults)
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'organization', 'org456')

      expect(result).toBe('read')
    })

    it('should handle generic entity types', async () => {
      const mockResults = [{ permissionType: 'write' as PermissionType }]
      const chain = createMockChain(mockResults)
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'custom_entity', 'entity123')

      expect(result).toBe('write')
    })
  })

  describe('listAccessibleWorkspaceIds', () => {
    it('should include owned and permissioned workspaces without duplicates', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              id: 'workspace-owned',
              ownerId: 'user123',
              workspaceMode: 'personal',
              workgroupId: null,
              permissionId: null,
            },
            {
              id: 'workspace-shared',
              ownerId: 'other-user',
              workspaceMode: 'organization',
              workgroupId: null,
              permissionId: 'permission-1',
            },
            {
              id: 'workspace-owned',
              ownerId: 'user123',
              workspaceMode: 'personal',
              workgroupId: null,
              permissionId: null,
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([]))

      const result = await listAccessibleWorkspaceIds('user123')

      expect(result).toEqual(['workspace-owned', 'workspace-shared'])
    })

    it('filters out personal workspaces the user does not own even when a permission row exists', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              id: 'workspace-owned',
              ownerId: 'user123',
              workspaceMode: 'personal',
              workgroupId: null,
              permissionId: null,
            },
            {
              id: 'workspace-team',
              ownerId: 'other-user',
              workspaceMode: 'organization',
              workgroupId: null,
              permissionId: 'permission-1',
            },
            {
              id: 'workspace-foreign-personal',
              ownerId: 'other-user',
              workspaceMode: 'personal',
              workgroupId: null,
              permissionId: 'permission-2',
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([]))

      const result = await listAccessibleWorkspaceIds('user123')

      expect(result).toEqual(['workspace-owned', 'workspace-team'])
    })

    it('includes team workspaces through workgroup membership', async () => {
      mockDb.select
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([{ id: 'workspace-team' }]))

      const result = await listAccessibleWorkspaceIds('user123')

      expect(result).toEqual(['workspace-team'])
    })

    it('excludes team workspaces exposed only by stale permission rows', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              id: 'workspace-team',
              ownerId: 'other-user',
              workspaceMode: 'organization',
              workgroupId: 'workgroup-1',
              permissionId: 'permission-1',
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([]))

      const result = await listAccessibleWorkspaceIds('user123')

      expect(result).toEqual([])
    })

    it('excludes owned team workspaces when the user is not a workgroup member', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              id: 'workspace-team',
              ownerId: 'user123',
              workspaceMode: 'organization',
              workgroupId: 'workgroup-1',
              permissionId: null,
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([]))

      const result = await listAccessibleWorkspaceIds('user123')

      expect(result).toEqual([])
    })

    it('includes owned personal canvas workspaces even when they belong to a workgroup', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              id: 'personal-canvas',
              ownerId: 'user123',
              workspaceMode: 'personal',
              workgroupId: 'workgroup-1',
              permissionId: null,
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([]))

      const result = await listAccessibleWorkspaceIds('user123')

      expect(result).toEqual(['personal-canvas'])
    })

    it('does not include other members personal canvases through team membership', async () => {
      mockDb.select
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))

      const result = await listAccessibleWorkspaceIds('user123')

      expect(result).toEqual([])
      expect(eq).toHaveBeenCalledWith(workspace.workspaceMode, 'organization')
    })
  })

  describe('hasAdminPermission', () => {
    it('should return true when user has admin permission for workspace', async () => {
      const chain = createMockChain([{ id: 'perm1' }])
      mockDb.select.mockReturnValue(chain)

      const result = await hasAdminPermission('admin-user', 'workspace123')

      expect(result).toBe(true)
    })

    it('should return false when user has no admin permission for workspace', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasAdminPermission('regular-user', 'workspace123')

      expect(result).toBe(false)
    })

    it('should return false when user has write permission but not admin', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasAdminPermission('write-user', 'workspace123')

      expect(result).toBe(false)
    })

    it('should return false when user has read permission but not admin', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasAdminPermission('read-user', 'workspace123')

      expect(result).toBe(false)
    })

    it('should handle non-existent workspace', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasAdminPermission('user123', 'non-existent-workspace')

      expect(result).toBe(false)
    })

    it('should handle empty user ID', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasAdminPermission('', 'workspace123')

      expect(result).toBe(false)
    })

    it('returns false for stale non-owner admin rows on personal workspaces', async () => {
      const chain = createMockChain([
        {
          id: 'perm-1',
          workspaceMode: 'personal',
          workspaceOwnerId: 'owner-1',
        },
      ])
      mockDb.select.mockReturnValue(chain)

      const result = await hasAdminPermission('member-1', 'workspace123')

      expect(result).toBe(false)
    })
  })

  describe('getUsersWithPermissions', () => {
    it('should return empty array when no users have permissions for workspace', async () => {
      mockDb.select
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))

      const result = await getUsersWithPermissions('workspace123')

      expect(result).toEqual([])
    })

    it('should return users with their permissions for workspace', async () => {
      const mockUsersResults = [
        {
          userId: 'user1',
          email: 'alice@example.com',
          name: 'Alice Smith',
          image: 'https://example.com/alice.png',
          permissionType: 'admin' as PermissionType,
        },
      ]

      mockDb.select
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain(mockUsersResults))

      const result = await getUsersWithPermissions('workspace456')

      expect(result).toEqual([
        {
          userId: 'user1',
          email: 'alice@example.com',
          name: 'Alice Smith',
          image: 'https://example.com/alice.png',
          permissionType: 'admin',
          isExternal: false,
        },
      ])
    })

    it('marks users as external when they are not members of the workspace organization', async () => {
      const mockUsersResults = [
        {
          userId: 'internal-user',
          email: 'internal@example.com',
          name: 'Internal User',
          image: null,
          permissionType: 'admin' as PermissionType,
          workspaceOrganizationId: 'org-1',
          organizationMemberId: 'member-1',
        },
        {
          userId: 'external-user',
          email: 'external@example.com',
          name: 'External User',
          image: null,
          permissionType: 'write' as PermissionType,
          workspaceOrganizationId: 'org-1',
          organizationMemberId: null,
        },
      ]

      mockDb.select
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain(mockUsersResults))

      const result = await getUsersWithPermissions('workspace456')

      expect(
        Object.fromEntries(result.map((permission) => [permission.email, permission.isExternal]))
      ).toEqual({
        'external@example.com': true,
        'internal@example.com': false,
      })
    })

    it('should return multiple users with different permission levels', async () => {
      const mockUsersResults = [
        {
          userId: 'user1',
          email: 'admin@example.com',
          name: 'Admin User',
          permissionType: 'admin' as PermissionType,
        },
        {
          userId: 'user2',
          email: 'writer@example.com',
          name: 'Writer User',
          permissionType: 'write' as PermissionType,
        },
        {
          userId: 'user3',
          email: 'reader@example.com',
          name: 'Reader User',
          permissionType: 'read' as PermissionType,
        },
      ]

      mockDb.select
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain(mockUsersResults))

      const result = await getUsersWithPermissions('workspace456')

      expect(result).toHaveLength(3)
      expect(
        Object.fromEntries(
          result.map((permission) => [permission.email, permission.permissionType])
        )
      ).toEqual({
        'admin@example.com': 'admin',
        'reader@example.com': 'read',
        'writer@example.com': 'write',
      })
    })

    it('should handle users with empty names', async () => {
      const mockUsersResults = [
        {
          userId: 'user1',
          email: 'test@example.com',
          name: '',
          permissionType: 'read' as PermissionType,
        },
      ]

      mockDb.select
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain(mockUsersResults))

      const result = await getUsersWithPermissions('workspace123')

      expect(result[0].name).toBe('')
    })

    it('includes the workspace owner as an admin without a permission row', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              userId: 'owner-1',
              email: 'owner@example.com',
              name: 'Owner User',
              image: null,
              permissionType: 'admin' as PermissionType,
              workspaceOrganizationId: null,
              organizationMemberId: null,
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([]))

      const result = await getUsersWithPermissions('workspace123')

      expect(result).toEqual([
        {
          userId: 'owner-1',
          email: 'owner@example.com',
          name: 'Owner User',
          image: null,
          permissionType: 'admin',
          isExternal: false,
        },
      ])
    })

    it('deduplicates the owner when they also have a permission row', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              userId: 'owner-1',
              email: 'owner@example.com',
              name: 'Owner User',
              image: null,
              permissionType: 'admin' as PermissionType,
              workspaceOrganizationId: null,
              organizationMemberId: null,
            },
          ])
        )
        .mockReturnValueOnce(
          createMockChain([
            {
              userId: 'owner-1',
              email: 'owner@example.com',
              name: 'Owner User',
              image: null,
              permissionType: 'read' as PermissionType,
              workspaceOrganizationId: null,
              organizationMemberId: null,
            },
            {
              userId: 'member-1',
              email: 'member@example.com',
              name: 'Member User',
              image: null,
              permissionType: 'write' as PermissionType,
              workspaceOrganizationId: null,
              organizationMemberId: null,
            },
          ])
        )

      const result = await getUsersWithPermissions('workspace123')

      expect(result).toEqual([
        {
          userId: 'member-1',
          email: 'member@example.com',
          name: 'Member User',
          image: null,
          permissionType: 'write',
          isExternal: false,
        },
        {
          userId: 'owner-1',
          email: 'owner@example.com',
          name: 'Owner User',
          image: null,
          permissionType: 'admin',
          isExternal: false,
        },
      ])
    })

    it('hides stale non-owner permission rows on personal workspaces', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              userId: 'owner-1',
              email: 'owner@example.com',
              name: 'Owner User',
              image: null,
              permissionType: 'admin' as PermissionType,
              workspaceOrganizationId: 'org-1',
              organizationMemberId: 'member-owner',
            },
          ])
        )
        .mockReturnValueOnce(
          createMockChain([
            {
              userId: 'member-1',
              email: 'member@example.com',
              name: 'Member User',
              image: null,
              permissionType: 'write' as PermissionType,
              workspaceMode: 'personal',
              workspaceOrganizationId: 'org-1',
              workspaceOwnerId: 'owner-1',
              organizationMemberId: 'member-1',
            },
          ])
        )

      const result = await getUsersWithPermissions('workspace123')

      expect(result).toEqual([
        {
          userId: 'owner-1',
          email: 'owner@example.com',
          name: 'Owner User',
          image: null,
          permissionType: 'admin',
          isExternal: false,
        },
      ])
    })

    it('uses workgroup membership instead of stale permission rows for team workspaces', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              userId: 'owner-1',
              email: 'owner@example.com',
              name: 'Owner User',
              image: null,
              permissionType: 'admin' as PermissionType,
              source: 'owner',
              workspaceMode: 'organization',
              workspaceOrganizationId: 'org-1',
              workspaceOwnerId: 'owner-1',
              workspaceWorkgroupId: 'workgroup-1',
              organizationMemberId: 'member-owner',
            },
          ])
        )
        .mockReturnValueOnce(
          createMockChain([
            {
              userId: 'stale-user',
              email: 'stale@example.com',
              name: 'Stale User',
              image: null,
              permissionType: 'admin' as PermissionType,
              source: 'permission',
              workspaceMode: 'organization',
              workspaceOrganizationId: 'org-1',
              workspaceOwnerId: 'owner-1',
              workspaceWorkgroupId: 'workgroup-1',
              organizationMemberId: 'member-stale',
            },
          ])
        )
        .mockReturnValueOnce(
          createMockChain([
            {
              userId: 'team-user',
              email: 'team@example.com',
              name: 'Team User',
              image: null,
              permissionType: 'write' as PermissionType,
              source: 'workgroup',
              workspaceMode: 'organization',
              workspaceOrganizationId: 'org-1',
              workspaceOwnerId: 'owner-1',
              workspaceWorkgroupId: 'workgroup-1',
              organizationMemberId: 'member-team',
            },
          ])
        )

      const result = await getUsersWithPermissions('workspace123')

      expect(result).toEqual([
        {
          userId: 'team-user',
          email: 'team@example.com',
          name: 'Team User',
          image: null,
          permissionType: 'write',
          isExternal: false,
        },
      ])
    })
  })

  describe('getWorkspaceMemberProfiles', () => {
    it('includes the workspace owner even without an explicit permission row', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              userId: 'owner-1',
              name: 'Owner User',
              image: null,
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([]))

      const result = await getWorkspaceMemberProfiles('workspace123')

      expect(result).toEqual([
        {
          userId: 'owner-1',
          name: 'Owner User',
          image: null,
        },
      ])
    })

    it('deduplicates the owner when they also have a permission row', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              userId: 'owner-1',
              name: 'Owner User',
              image: null,
            },
          ])
        )
        .mockReturnValueOnce(
          createMockChain([
            {
              userId: 'owner-1',
              name: 'Owner User',
              image: null,
            },
            {
              userId: 'member-1',
              name: 'Member User',
              image: 'https://example.com/member.png',
            },
          ])
        )

      const result = await getWorkspaceMemberProfiles('workspace123')

      expect(result).toEqual([
        {
          userId: 'owner-1',
          name: 'Owner User',
          image: null,
        },
        {
          userId: 'member-1',
          name: 'Member User',
          image: 'https://example.com/member.png',
        },
      ])
    })

    it('hides stale non-owner profiles on personal workspaces', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              userId: 'owner-1',
              name: 'Owner User',
              image: null,
            },
          ])
        )
        .mockReturnValueOnce(
          createMockChain([
            {
              userId: 'member-1',
              name: 'Member User',
              image: 'https://example.com/member.png',
              workspaceMode: 'personal',
              workspaceOwnerId: 'owner-1',
            },
          ])
        )

      const result = await getWorkspaceMemberProfiles('workspace123')

      expect(result).toEqual([
        {
          userId: 'owner-1',
          name: 'Owner User',
          image: null,
        },
      ])
    })

    it('uses workgroup profiles instead of stale permission rows for team workspaces', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              userId: 'owner-1',
              name: 'Owner User',
              image: null,
              source: 'owner',
              workspaceMode: 'organization',
              workspaceOwnerId: 'owner-1',
              workspaceWorkgroupId: 'workgroup-1',
            },
          ])
        )
        .mockReturnValueOnce(
          createMockChain([
            {
              userId: 'stale-user',
              name: 'Stale User',
              image: null,
              source: 'permission',
              workspaceMode: 'organization',
              workspaceOwnerId: 'owner-1',
              workspaceWorkgroupId: 'workgroup-1',
            },
          ])
        )
        .mockReturnValueOnce(
          createMockChain([
            {
              userId: 'team-user',
              name: 'Team User',
              image: null,
              source: 'workgroup',
              workspaceMode: 'organization',
              workspaceOwnerId: 'owner-1',
              workspaceWorkgroupId: 'workgroup-1',
            },
          ])
        )

      const result = await getWorkspaceMemberProfiles('workspace123')

      expect(result).toEqual([
        {
          userId: 'team-user',
          name: 'Team User',
          image: null,
        },
      ])
    })
  })

  describe('hasWorkspaceAdminAccess', () => {
    it('should return true when user owns the workspace', async () => {
      const chain = createMockChain([{ ownerId: 'user123' }])
      mockDb.select.mockReturnValue(chain)

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(true)
    })

    it('should return true when user has direct admin permission', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ ownerId: 'other-user' }])
        }
        return createMockChain([{ id: 'perm1' }])
      })

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(true)
    })

    it('should return false when workspace does not exist', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(false)
    })

    it('should return false for non-owners on personal workspaces even with admin permission rows', async () => {
      const chain = createMockChain([
        {
          id: 'workspace456',
          name: 'Personal Workspace',
          ownerId: 'other-user',
          organizationId: 'org-1',
          workspaceMode: 'personal',
          billedAccountUserId: 'other-user',
          archivedAt: null,
        },
      ])
      mockDb.select.mockReturnValue(chain)

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(false)
    })

    it('should return true for workgroup admins on team workspaces', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              id: 'workspace456',
              name: 'Team Workspace',
              ownerId: 'other-user',
              organizationId: 'org-1',
              workgroupId: 'workgroup-1',
              workspaceMode: 'organization',
              billedAccountUserId: 'other-user',
              archivedAt: null,
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([{ role: 'admin' }]))

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(true)
    })

    it('should return false for organization admins who are not team admins', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              id: 'workspace456',
              name: 'Team Workspace',
              ownerId: 'other-user',
              organizationId: 'org-1',
              workgroupId: 'workgroup-1',
              workspaceMode: 'organization',
              billedAccountUserId: 'other-user',
              archivedAt: null,
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([{ role: 'admin' }]))

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(false)
    })

    it('should return false when user has no admin access', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ ownerId: 'other-user' }])
        }
        return createMockChain([])
      })

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(false)
    })

    it('should return false when user has write permission but not admin', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ ownerId: 'other-user' }])
        }
        return createMockChain([])
      })

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(false)
    })

    it('should return false when user has read permission but not admin', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ ownerId: 'other-user' }])
        }
        return createMockChain([])
      })

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(false)
    })

    it('should handle empty workspace ID', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasWorkspaceAdminAccess('user123', '')

      expect(result).toBe(false)
    })

    it('should handle empty user ID', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasWorkspaceAdminAccess('', 'workspace456')

      expect(result).toBe(false)
    })
  })

  describe('Edge Cases and Security Tests', () => {
    it('should handle SQL injection attempts in user IDs', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions(
        "'; DROP TABLE users; --",
        'workspace',
        'workspace123'
      )

      expect(result).toBeNull()
    })

    it('should handle very long entity IDs', async () => {
      const longEntityId = 'a'.repeat(1000)
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'workspace', longEntityId)

      expect(result).toBeNull()
    })

    it('should handle unicode characters in entity names', async () => {
      const chain = createMockChain([{ permissionType: 'read' as PermissionType }])
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', '📝workspace', '🏢org-id')

      expect(result).toBe('read')
    })

    it('should verify permission hierarchy ordering is consistent', () => {
      const permissionOrder: Record<PermissionType, number> = { admin: 3, write: 2, read: 1 }

      expect(permissionOrder.admin).toBeGreaterThan(permissionOrder.write)
      expect(permissionOrder.write).toBeGreaterThan(permissionOrder.read)
    })

    it('should handle workspace ownership checks with null owner IDs', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ ownerId: null }])
        }
        return createMockChain([])
      })

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(false)
    })

    it('should handle null user ID correctly when owner ID is different', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ ownerId: 'other-user' }])
        }
        return createMockChain([])
      })

      const result = await hasWorkspaceAdminAccess(null as any, 'workspace456')

      expect(result).toBe(false)
    })
  })

  describe('getManageableWorkspaces', () => {
    it('should return empty array when user has no manageable workspaces', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getManageableWorkspaces('user123')

      expect(result).toEqual([])
    })

    it('should return owned workspaces', async () => {
      const mockWorkspaces = [
        { id: 'ws1', name: 'My Workspace 1', ownerId: 'user123' },
        { id: 'ws2', name: 'My Workspace 2', ownerId: 'user123' },
      ]

      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain(mockWorkspaces) // Owned workspaces
        }
        return createMockChain([]) // No admin workspaces
      })

      const result = await getManageableWorkspaces('user123')

      expect(result).toEqual([
        { id: 'ws1', name: 'My Workspace 1', ownerId: 'user123', accessType: 'owner' },
        { id: 'ws2', name: 'My Workspace 2', ownerId: 'user123', accessType: 'owner' },
      ])
    })

    it('should return workspaces with direct admin permissions', async () => {
      const mockAdminWorkspaces = [
        {
          id: 'ws1',
          name: 'Shared Workspace',
          ownerId: 'other-user',
          workspaceMode: 'organization',
        },
      ]

      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([])
        }
        if (callCount === 2) {
          return createMockChain(mockAdminWorkspaces)
        }
        return createMockChain([])
      })

      const result = await getManageableWorkspaces('user123')

      expect(result).toEqual([
        { id: 'ws1', name: 'Shared Workspace', ownerId: 'other-user', accessType: 'direct' },
      ])
    })

    it('should exclude personal workspaces from direct admin management when not owned by the user', async () => {
      const mockAdminWorkspaces = [
        {
          id: 'ws1',
          name: 'Other Personal Workspace',
          ownerId: 'other-user',
          workspaceMode: 'personal',
        },
      ]

      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([])
        }
        if (callCount === 2) {
          return createMockChain(mockAdminWorkspaces)
        }
        return createMockChain([])
      })

      const result = await getManageableWorkspaces('user123')

      expect(result).toEqual([])
    })

    it('should include team workspaces only when the user is a workgroup admin', async () => {
      const mockTeamAdminWorkspaces = [
        {
          id: 'ws-team',
          name: 'Team Workspace',
          ownerId: 'other-user',
        },
      ]

      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 3) {
          return createMockChain(mockTeamAdminWorkspaces)
        }
        return createMockChain([])
      })

      const result = await getManageableWorkspaces('user123')

      expect(result).toEqual([
        { id: 'ws-team', name: 'Team Workspace', ownerId: 'other-user', accessType: 'direct' },
      ])
    })

    it('should exclude team workspaces from stale direct admin permission rows', async () => {
      const mockAdminWorkspaces = [
        {
          id: 'ws-team',
          name: 'Team Workspace',
          ownerId: 'other-user',
          workspaceMode: 'organization',
          workgroupId: 'workgroup-1',
        },
      ]

      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 2) {
          return createMockChain(mockAdminWorkspaces)
        }
        return createMockChain([])
      })

      const result = await getManageableWorkspaces('user123')

      expect(result).toEqual([])
    })

    it('should exclude owned team workspaces unless the user is a workgroup admin', async () => {
      const mockOwnedWorkspaces = [
        {
          id: 'ws-team',
          name: 'Team Workspace',
          ownerId: 'user123',
          workgroupId: 'workgroup-1',
        },
      ]

      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain(mockOwnedWorkspaces)
        }
        return createMockChain([])
      })

      const result = await getManageableWorkspaces('user123')

      expect(result).toEqual([])
    })

    it('should combine owned and admin workspaces without duplicates', async () => {
      const mockOwnedWorkspaces = [
        { id: 'ws1', name: 'My Workspace', ownerId: 'user123' },
        { id: 'ws2', name: 'Another Workspace', ownerId: 'user123' },
      ]
      const mockAdminWorkspaces = [
        { id: 'ws1', name: 'My Workspace', ownerId: 'user123' }, // Duplicate (should be filtered)
        { id: 'ws3', name: 'Shared Workspace', ownerId: 'other-user' },
      ]

      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain(mockOwnedWorkspaces)
        }
        if (callCount === 2) {
          return createMockChain(mockAdminWorkspaces)
        }
        return createMockChain([])
      })

      const result = await getManageableWorkspaces('user123')

      expect(result).toHaveLength(3)
      expect(result).toEqual([
        { id: 'ws1', name: 'My Workspace', ownerId: 'user123', accessType: 'owner' },
        { id: 'ws2', name: 'Another Workspace', ownerId: 'user123', accessType: 'owner' },
        { id: 'ws3', name: 'Shared Workspace', ownerId: 'other-user', accessType: 'direct' },
      ])
    })

    it('should handle empty workspace names', async () => {
      const mockWorkspaces = [{ id: 'ws1', name: '', ownerId: 'user123' }]

      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain(mockWorkspaces)
        }
        return createMockChain([])
      })

      const result = await getManageableWorkspaces('user123')

      expect(result[0].name).toBe('')
    })

    it('should handle multiple admin permissions for same workspace', async () => {
      const mockAdminWorkspaces = [
        { id: 'ws1', name: 'Shared Workspace', ownerId: 'other-user' },
        { id: 'ws1', name: 'Shared Workspace', ownerId: 'other-user' }, // Duplicate
      ]

      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([])
        }
        if (callCount === 2) {
          return createMockChain(mockAdminWorkspaces)
        }
        return createMockChain([])
      })

      const result = await getManageableWorkspaces('user123')

      expect(result).toHaveLength(2) // Should include duplicates from admin permissions
    })

    it('should handle empty user ID gracefully', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getManageableWorkspaces('')

      expect(result).toEqual([])
    })
  })

  describe('getWorkspaceById', () => {
    it.concurrent('should return workspace when it exists', async () => {
      const chain = createMockChain([{ id: 'workspace123' }])
      mockDb.select.mockReturnValue(chain)

      const result = await getWorkspaceById('workspace123')

      expect(result).toEqual({ id: 'workspace123' })
    })

    it.concurrent('should return null when workspace does not exist', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getWorkspaceById('non-existent')

      expect(result).toBeNull()
    })

    it.concurrent('should handle empty workspace ID', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getWorkspaceById('')

      expect(result).toBeNull()
    })
  })

  describe('getWorkspaceWithOwner', () => {
    it.concurrent('should return workspace with owner when it exists', async () => {
      const chain = createMockChain([{ id: 'workspace123', ownerId: 'owner456' }])
      mockDb.select.mockReturnValue(chain)

      const result = await getWorkspaceWithOwner('workspace123')

      expect(result).toEqual({ id: 'workspace123', ownerId: 'owner456' })
    })

    it.concurrent('should return null when workspace does not exist', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getWorkspaceWithOwner('non-existent')

      expect(result).toBeNull()
    })

    it.concurrent('should handle workspace with null owner ID', async () => {
      const chain = createMockChain([{ id: 'workspace123', ownerId: null }])
      mockDb.select.mockReturnValue(chain)

      const result = await getWorkspaceWithOwner('workspace123')

      expect(result).toEqual({ id: 'workspace123', ownerId: null })
    })
  })

  describe('workspaceExists', () => {
    it.concurrent('should return true when workspace exists', async () => {
      const chain = createMockChain([{ id: 'workspace123' }])
      mockDb.select.mockReturnValue(chain)

      const result = await workspaceExists('workspace123')

      expect(result).toBe(true)
    })

    it.concurrent('should return false when workspace does not exist', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await workspaceExists('non-existent')

      expect(result).toBe(false)
    })

    it.concurrent('should handle empty workspace ID', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await workspaceExists('')

      expect(result).toBe(false)
    })
  })

  describe('checkWorkspaceAccess', () => {
    it('should return exists=false when workspace does not exist', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await checkWorkspaceAccess('non-existent', 'user123')

      expect(result).toEqual({
        exists: false,
        hasAccess: false,
        canWrite: false,
        workspace: null,
      })
    })

    it('should return full access when user is workspace owner', async () => {
      const chain = createMockChain([{ id: 'workspace123', ownerId: 'user123' }])
      mockDb.select.mockReturnValue(chain)

      const result = await checkWorkspaceAccess('workspace123', 'user123')

      expect(result).toEqual({
        exists: true,
        hasAccess: true,
        canWrite: true,
        workspace: { id: 'workspace123', ownerId: 'user123' },
      })
    })

    it('should return hasAccess=false when user has no permissions', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ id: 'workspace123', ownerId: 'other-user' }])
        }
        return createMockChain([]) // No permissions
      })

      const result = await checkWorkspaceAccess('workspace123', 'user123')

      expect(result.exists).toBe(true)
      expect(result.hasAccess).toBe(false)
      expect(result.canWrite).toBe(false)
    })

    it('should return canWrite=true when user has admin permission', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ id: 'workspace123', ownerId: 'other-user' }])
        }
        return createMockChain([{ permissionType: 'admin' }])
      })

      const result = await checkWorkspaceAccess('workspace123', 'user123')

      expect(result.exists).toBe(true)
      expect(result.hasAccess).toBe(true)
      expect(result.canWrite).toBe(true)
    })

    it('denies access to personal workspaces owned by another user even with permission rows', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([
            {
              id: 'workspace123',
              name: 'Private Workspace',
              ownerId: 'other-user',
              organizationId: 'org-1',
              workspaceMode: 'personal',
              billedAccountUserId: 'other-user',
              archivedAt: null,
            },
          ])
        }
        return createMockChain([{ permissionType: 'admin' }])
      })

      const result = await checkWorkspaceAccess('workspace123', 'user123')

      expect(result).toEqual({
        exists: true,
        hasAccess: false,
        canWrite: false,
        workspace: {
          id: 'workspace123',
          name: 'Private Workspace',
          ownerId: 'other-user',
          organizationId: 'org-1',
          workspaceMode: 'personal',
          billedAccountUserId: 'other-user',
          archivedAt: null,
        },
      })
    })

    it('denies access to team workspaces without workgroup membership even with permission rows', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              id: 'workspace123',
              name: 'Team Workspace',
              ownerId: 'other-user',
              organizationId: 'org-1',
              workgroupId: 'workgroup-1',
              workspaceMode: 'organization',
              billedAccountUserId: 'other-user',
              archivedAt: null,
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([{ permissionType: 'admin' }]))

      const result = await checkWorkspaceAccess('workspace123', 'user123')

      expect(result).toEqual({
        exists: true,
        hasAccess: false,
        canWrite: false,
        workspace: {
          id: 'workspace123',
          name: 'Team Workspace',
          ownerId: 'other-user',
          organizationId: 'org-1',
          workgroupId: 'workgroup-1',
          workspaceMode: 'organization',
          billedAccountUserId: 'other-user',
          archivedAt: null,
        },
      })
    })

    it('grants write access to team workspaces for workgroup members', async () => {
      mockDb.select
        .mockReturnValueOnce(
          createMockChain([
            {
              id: 'workspace123',
              name: 'Team Workspace',
              ownerId: 'other-user',
              organizationId: 'org-1',
              workgroupId: 'workgroup-1',
              workspaceMode: 'organization',
              billedAccountUserId: 'other-user',
              archivedAt: null,
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([{ role: 'member' }]))

      const result = await checkWorkspaceAccess('workspace123', 'user123')

      expect(result.exists).toBe(true)
      expect(result.hasAccess).toBe(true)
      expect(result.canWrite).toBe(true)
    })

    it('should return canWrite=true when user has write permission', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ id: 'workspace123', ownerId: 'other-user' }])
        }
        return createMockChain([{ permissionType: 'write' }])
      })

      const result = await checkWorkspaceAccess('workspace123', 'user123')

      expect(result.exists).toBe(true)
      expect(result.hasAccess).toBe(true)
      expect(result.canWrite).toBe(true)
    })

    it('should return canWrite=false when user has read permission', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ id: 'workspace123', ownerId: 'other-user' }])
        }
        return createMockChain([{ permissionType: 'read' }])
      })

      const result = await checkWorkspaceAccess('workspace123', 'user123')

      expect(result.exists).toBe(true)
      expect(result.hasAccess).toBe(true)
      expect(result.canWrite).toBe(false)
    })

    it('should handle empty user ID', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await checkWorkspaceAccess('workspace123', '')

      expect(result.exists).toBe(false)
      expect(result.hasAccess).toBe(false)
    })

    it('should handle empty workspace ID', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await checkWorkspaceAccess('', 'user123')

      expect(result.exists).toBe(false)
      expect(result.hasAccess).toBe(false)
    })
  })
})
