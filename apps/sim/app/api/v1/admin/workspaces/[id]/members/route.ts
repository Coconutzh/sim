/**
 * GET /api/v1/admin/workspaces/[id]/members
 *
 * List all members of a workspace with their permission details.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *
 * Response: AdminListResponse<AdminWorkspaceMember>
 *
 * POST /api/v1/admin/workspaces/[id]/members
 *
 * Add a user to a workspace with a specific permission level.
 * If the user already has permissions, updates their permission level.
 *
 * Body:
 *   - userId: string - User ID to add
 *   - permissions: 'admin' | 'write' | 'read' - Permission level
 *
 * Response: AdminSingleResponse<AdminWorkspaceMember & { action: 'created' | 'updated' }>
 *
 * DELETE /api/v1/admin/workspaces/[id]/members
 *
 * Remove a user from a workspace.
 *
 * Query Parameters:
 *   - userId: string - User ID to remove
 *
 * Response: AdminSingleResponse<{ removed: true }>
 */

import { db } from '@sim/db'
import { permissions, user, workspaceEnvironment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import {
  adminV1CreateWorkspaceMemberContract,
  adminV1DeleteWorkspaceMemberContract,
  adminV1ListWorkspaceMembersContract,
} from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { syncWorkspaceEnvCredentials } from '@/lib/credentials/environment'
import { applyWorkspaceAutoAddGroup } from '@/lib/permission-groups/auto-add'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  forbiddenResponse,
  internalErrorResponse,
  listResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import { type AdminWorkspaceMember, createPaginationMeta } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkspaceMembersAPI')

interface RouteParams {
  id: string
}

function ownerMemberId(workspaceId: string, ownerId: string): string {
  return `owner:${workspaceId}:${ownerId}`
}

function isPersonalWorkspace(workspaceMode: string | null | undefined): boolean {
  return workspaceMode === 'personal'
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1ListWorkspaceMembersContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: workspaceId } = parsed.data.params
    const { limit, offset } = parsed.data.query

    try {
      const workspaceData = await getWorkspaceWithOwner(workspaceId)

      if (!workspaceData) {
        return notFoundResponse('Canvas')
      }

      const [ownerData, membersData] = await Promise.all([
        db
          .select({
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            userImage: user.image,
            userCreatedAt: user.createdAt,
            userUpdatedAt: user.updatedAt,
          })
          .from(user)
          .where(eq(user.id, workspaceData.ownerId))
          .limit(1),
        isPersonalWorkspace(workspaceData.workspaceMode)
          ? Promise.resolve([])
          : db
              .select({
                id: permissions.id,
                userId: permissions.userId,
                permissionType: permissions.permissionType,
                createdAt: permissions.createdAt,
                updatedAt: permissions.updatedAt,
                userName: user.name,
                userEmail: user.email,
                userImage: user.image,
              })
              .from(permissions)
              .innerJoin(user, eq(permissions.userId, user.id))
              .where(
                and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId))
              )
              .orderBy(permissions.createdAt),
      ])

      const membersByUserId = new Map<string, AdminWorkspaceMember>(
        membersData.map((member) => [
          member.userId,
          {
            id: member.id,
            workspaceId,
            userId: member.userId,
            permissions: member.permissionType,
            createdAt: member.createdAt.toISOString(),
            updatedAt: member.updatedAt.toISOString(),
            userName: member.userName,
            userEmail: member.userEmail,
            userImage: member.userImage,
          },
        ])
      )

      const owner = ownerData[0]
      if (owner) {
        membersByUserId.set(workspaceData.ownerId, {
          id: ownerMemberId(workspaceId, workspaceData.ownerId),
          workspaceId,
          userId: workspaceData.ownerId,
          permissions: 'admin',
          createdAt:
            membersByUserId.get(workspaceData.ownerId)?.createdAt ??
            owner.userCreatedAt.toISOString(),
          updatedAt:
            membersByUserId.get(workspaceData.ownerId)?.updatedAt ??
            owner.userUpdatedAt.toISOString(),
          userName: owner.userName,
          userEmail: owner.userEmail,
          userImage: owner.userImage,
        })
      }

      const allMembers = [...membersByUserId.values()]
      const total = allMembers.length
      const data = allMembers.slice(offset, offset + limit)

      const pagination = createPaginationMeta(total, limit, offset)

      logger.info(`Admin API: Listed ${data.length} members for workspace ${workspaceId}`)

      return listResponse(data, pagination)
    } catch (error) {
      logger.error('Admin API: Failed to list workspace members', { error, workspaceId })
      return internalErrorResponse('Failed to list canvas members')
    }
  })
)

export const POST = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1CreateWorkspaceMemberContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: workspaceId } = parsed.data.params
    const { userId, permissions: permissionLevel } = parsed.data.body

    try {
      const workspaceData = await getWorkspaceWithOwner(workspaceId)

      if (!workspaceData) {
        return notFoundResponse('Canvas')
      }

      if (isPersonalWorkspace(workspaceData.workspaceMode) && workspaceData.ownerId !== userId) {
        return forbiddenResponse('Personal workspaces do not support shared members')
      }

      if (workspaceData.ownerId === userId) {
        const [ownerData] = await db
          .select({
            name: user.name,
            email: user.email,
            image: user.image,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          })
          .from(user)
          .where(eq(user.id, userId))
          .limit(1)

        if (!ownerData) {
          return notFoundResponse('User')
        }

        return singleResponse({
          id: ownerMemberId(workspaceId, userId),
          workspaceId,
          userId,
          permissions: 'admin' as const,
          createdAt: ownerData.createdAt.toISOString(),
          updatedAt: ownerData.updatedAt.toISOString(),
          userName: ownerData.name,
          userEmail: ownerData.email,
          userImage: ownerData.image,
          action: 'already_member' as const,
        })
      }

      const [userData] = await db
        .select({ id: user.id, name: user.name, email: user.email, image: user.image })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)

      if (!userData) {
        return notFoundResponse('User')
      }

      const [existingPermission] = await db
        .select({
          id: permissions.id,
          permissionType: permissions.permissionType,
          createdAt: permissions.createdAt,
          updatedAt: permissions.updatedAt,
        })
        .from(permissions)
        .where(
          and(
            eq(permissions.userId, userId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workspaceId)
          )
        )
        .limit(1)

      if (existingPermission) {
        if (existingPermission.permissionType !== permissionLevel) {
          const now = new Date()
          await db
            .update(permissions)
            .set({ permissionType: permissionLevel, updatedAt: now })
            .where(eq(permissions.id, existingPermission.id))

          logger.info(`Admin API: Updated user ${userId} permissions in workspace ${workspaceId}`, {
            previousPermissions: existingPermission.permissionType,
            newPermissions: permissionLevel,
          })

          return singleResponse({
            id: existingPermission.id,
            workspaceId,
            userId,
            permissions: permissionLevel,
            createdAt: existingPermission.createdAt.toISOString(),
            updatedAt: now.toISOString(),
            userName: userData.name,
            userEmail: userData.email,
            userImage: userData.image,
            action: 'updated' as const,
          })
        }

        return singleResponse({
          id: existingPermission.id,
          workspaceId,
          userId,
          permissions: existingPermission.permissionType,
          createdAt: existingPermission.createdAt.toISOString(),
          updatedAt: existingPermission.updatedAt.toISOString(),
          userName: userData.name,
          userEmail: userData.email,
          userImage: userData.image,
          action: 'already_member' as const,
        })
      }

      const now = new Date()
      const permissionId = generateId()

      await db.insert(permissions).values({
        id: permissionId,
        userId,
        entityType: 'workspace',
        entityId: workspaceId,
        permissionType: permissionLevel,
        createdAt: now,
        updatedAt: now,
      })

      await applyWorkspaceAutoAddGroup(db, workspaceId, userId)

      logger.info(`Admin API: Added user ${userId} to workspace ${workspaceId}`, {
        permissions: permissionLevel,
        permissionId,
      })

      const [wsEnvRow] = await db
        .select({ variables: workspaceEnvironment.variables })
        .from(workspaceEnvironment)
        .where(eq(workspaceEnvironment.workspaceId, workspaceId))
        .limit(1)
      const wsEnvKeys = Object.keys((wsEnvRow?.variables as Record<string, string>) || {})
      if (wsEnvKeys.length > 0) {
        await syncWorkspaceEnvCredentials({
          workspaceId,
          envKeys: wsEnvKeys,
          actingUserId: userId,
        })
      }

      return singleResponse({
        id: permissionId,
        workspaceId,
        userId,
        permissions: permissionLevel,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        userName: userData.name,
        userEmail: userData.email,
        userImage: userData.image,
        action: 'created' as const,
      })
    } catch (error) {
      logger.error('Admin API: Failed to add workspace member', { error, workspaceId })
      return internalErrorResponse('Failed to add canvas member')
    }
  })
)

export const DELETE = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1DeleteWorkspaceMemberContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: workspaceId } = parsed.data.params
    const { userId } = parsed.data.query
    let targetUserId: string | undefined

    try {
      targetUserId = userId

      const workspaceData = await getWorkspaceWithOwner(workspaceId)

      if (!workspaceData) {
        return notFoundResponse('Canvas')
      }

      if (workspaceData.ownerId === userId) {
        return badRequestResponse('Cannot remove the workspace owner from this endpoint')
      }

      const [existingPermission] = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(
          and(
            eq(permissions.userId, userId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workspaceId)
          )
        )
        .limit(1)

      if (!existingPermission) {
        return notFoundResponse('Canvas member')
      }

      if (isPersonalWorkspace(workspaceData.workspaceMode) && workspaceData.ownerId !== userId) {
        return notFoundResponse('Canvas member')
      }

      await db.delete(permissions).where(eq(permissions.id, existingPermission.id))

      logger.info(`Admin API: Removed user ${userId} from workspace ${workspaceId}`)

      return singleResponse({ removed: true, userId, workspaceId })
    } catch (error) {
      logger.error('Admin API: Failed to remove workspace member', {
        error,
        workspaceId,
        userId: targetUserId,
      })
      return internalErrorResponse('Failed to remove canvas member')
    }
  })
)
