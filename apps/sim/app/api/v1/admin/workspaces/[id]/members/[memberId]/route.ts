/**
 * GET /api/v1/admin/workspaces/[id]/members/[memberId]
 *
 * Get workspace member details.
 *
 * Response: AdminSingleResponse<AdminWorkspaceMember>
 *
 * PATCH /api/v1/admin/workspaces/[id]/members/[memberId]
 *
 * Update member permissions.
 *
 * Body:
 *   - permissions: 'admin' | 'write' | 'read' - New permission level
 *
 * Response: AdminSingleResponse<AdminWorkspaceMember>
 *
 * DELETE /api/v1/admin/workspaces/[id]/members/[memberId]
 *
 * Remove member from workspace.
 *
 * Response: AdminSingleResponse<{ removed: true, memberId: string, userId: string }>
 */

import { db } from '@sim/db'
import { permissions, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import {
  adminV1GetWorkspaceMemberContract,
  adminV1RemoveWorkspaceMemberContract,
  adminV1UpdateWorkspaceMemberContract,
} from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { revokeWorkspaceCredentialMemberships } from '@/lib/credentials/access'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import type { AdminWorkspaceMember } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkspaceMemberDetailAPI')

interface RouteParams {
  id: string
  memberId: string
}

function ownerMemberId(workspaceId: string, ownerId: string): string {
  return `owner:${workspaceId}:${ownerId}`
}

function isPersonalWorkspace(workspaceMode: string | null | undefined): boolean {
  return workspaceMode === 'personal'
}

function ownerMemberResponse({
  workspaceId,
  ownerId,
  createdAt,
  updatedAt,
  userName,
  userEmail,
  userImage,
}: {
  workspaceId: string
  ownerId: string
  createdAt: Date
  updatedAt: Date
  userName: string | null
  userEmail: string | null
  userImage: string | null
}): AdminWorkspaceMember {
  return {
    id: ownerMemberId(workspaceId, ownerId),
    workspaceId,
    userId: ownerId,
    permissions: 'admin',
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    userName,
    userEmail,
    userImage,
  }
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1GetWorkspaceMemberContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: workspaceId, memberId } = parsed.data.params

    try {
      const workspaceData = await getWorkspaceWithOwner(workspaceId)

      if (!workspaceData) {
        return notFoundResponse('Canvas')
      }

      if (memberId === ownerMemberId(workspaceId, workspaceData.ownerId)) {
        const [ownerData] = await db
          .select({
            id: user.id,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            userName: user.name,
            userEmail: user.email,
            userImage: user.image,
          })
          .from(user)
          .where(eq(user.id, workspaceData.ownerId))
          .limit(1)

        if (!ownerData) {
          return notFoundResponse('Canvas member')
        }

        return singleResponse(
          ownerMemberResponse({
            workspaceId,
            ownerId: ownerData.id,
            createdAt: ownerData.createdAt,
            updatedAt: ownerData.updatedAt,
            userName: ownerData.userName,
            userEmail: ownerData.userEmail,
            userImage: ownerData.userImage,
          })
        )
      }

      const [memberData] = await db
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
          and(
            eq(permissions.id, memberId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workspaceId)
          )
        )
        .limit(1)

      if (!memberData) {
        return notFoundResponse('Canvas member')
      }

      if (
        isPersonalWorkspace(workspaceData.workspaceMode) &&
        memberData.userId !== workspaceData.ownerId
      ) {
        return notFoundResponse('Canvas member')
      }

      if (memberData.userId === workspaceData.ownerId) {
        return singleResponse(
          ownerMemberResponse({
            workspaceId,
            ownerId: memberData.userId,
            createdAt: memberData.createdAt,
            updatedAt: memberData.updatedAt,
            userName: memberData.userName,
            userEmail: memberData.userEmail,
            userImage: memberData.userImage,
          })
        )
      }

      const data: AdminWorkspaceMember = {
        id: memberData.id,
        workspaceId,
        userId: memberData.userId,
        permissions: memberData.permissionType,
        createdAt: memberData.createdAt.toISOString(),
        updatedAt: memberData.updatedAt.toISOString(),
        userName: memberData.userName,
        userEmail: memberData.userEmail,
        userImage: memberData.userImage,
      }

      logger.info(`Admin API: Retrieved member ${memberId} from workspace ${workspaceId}`)

      return singleResponse(data)
    } catch (error) {
      logger.error('Admin API: Failed to get workspace member', { error, workspaceId, memberId })
      return internalErrorResponse('Failed to get canvas member')
    }
  })
)

export const PATCH = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1UpdateWorkspaceMemberContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: workspaceId, memberId } = parsed.data.params
    const { permissions: permissionLevel } = parsed.data.body

    try {
      const workspaceData = await getWorkspaceWithOwner(workspaceId)

      if (!workspaceData) {
        return notFoundResponse('Canvas')
      }

      if (memberId === ownerMemberId(workspaceId, workspaceData.ownerId)) {
        return badRequestResponse('Cannot modify the workspace owner from this endpoint')
      }

      const [existingMember] = await db
        .select({
          id: permissions.id,
          userId: permissions.userId,
          permissionType: permissions.permissionType,
          createdAt: permissions.createdAt,
        })
        .from(permissions)
        .where(
          and(
            eq(permissions.id, memberId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workspaceId)
          )
        )
        .limit(1)

      if (!existingMember) {
        return notFoundResponse('Canvas member')
      }

      if (existingMember.userId === workspaceData.ownerId) {
        return badRequestResponse('Cannot modify the workspace owner from this endpoint')
      }

      if (isPersonalWorkspace(workspaceData.workspaceMode)) {
        return notFoundResponse('Canvas member')
      }

      const now = new Date()

      await db
        .update(permissions)
        .set({ permissionType: permissionLevel, updatedAt: now })
        .where(eq(permissions.id, memberId))

      const [userData] = await db
        .select({ name: user.name, email: user.email, image: user.image })
        .from(user)
        .where(eq(user.id, existingMember.userId))
        .limit(1)

      const data: AdminWorkspaceMember = {
        id: existingMember.id,
        workspaceId,
        userId: existingMember.userId,
        permissions: permissionLevel,
        createdAt: existingMember.createdAt.toISOString(),
        updatedAt: now.toISOString(),
        userName: userData?.name ?? '',
        userEmail: userData?.email ?? '',
        userImage: userData?.image ?? null,
      }

      logger.info(`Admin API: Updated member ${memberId} permissions to ${permissionLevel}`, {
        workspaceId,
        previousPermissions: existingMember.permissionType,
      })

      return singleResponse(data)
    } catch (error) {
      logger.error('Admin API: Failed to update workspace member', { error, workspaceId, memberId })
      return internalErrorResponse('Failed to update canvas member')
    }
  })
)

export const DELETE = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1RemoveWorkspaceMemberContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: workspaceId, memberId } = parsed.data.params

    try {
      const workspaceData = await getWorkspaceWithOwner(workspaceId)

      if (!workspaceData) {
        return notFoundResponse('Canvas')
      }

      if (memberId === ownerMemberId(workspaceId, workspaceData.ownerId)) {
        return badRequestResponse('Cannot remove the workspace owner from this endpoint')
      }

      const [existingMember] = await db
        .select({
          id: permissions.id,
          userId: permissions.userId,
        })
        .from(permissions)
        .where(
          and(
            eq(permissions.id, memberId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workspaceId)
          )
        )
        .limit(1)

      if (!existingMember) {
        return notFoundResponse('Canvas member')
      }

      if (existingMember.userId === workspaceData.ownerId) {
        return badRequestResponse('Cannot remove the workspace owner from this endpoint')
      }

      if (isPersonalWorkspace(workspaceData.workspaceMode)) {
        return notFoundResponse('Canvas member')
      }

      await db.delete(permissions).where(eq(permissions.id, memberId))

      await revokeWorkspaceCredentialMemberships(workspaceId, existingMember.userId)

      logger.info(`Admin API: Removed member ${memberId} from workspace ${workspaceId}`, {
        userId: existingMember.userId,
      })

      return singleResponse({
        removed: true,
        memberId,
        userId: existingMember.userId,
        workspaceId,
      })
    } catch (error) {
      logger.error('Admin API: Failed to remove workspace member', { error, workspaceId, memberId })
      return internalErrorResponse('Failed to remove canvas member')
    }
  })
)
