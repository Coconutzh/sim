/**
 * GET /api/v1/admin/organizations/[id]/members/[memberId]
 *
 * Get member details.
 *
 * Response: AdminSingleResponse<AdminMemberDetail>
 *
 * PATCH /api/v1/admin/organizations/[id]/members/[memberId]
 *
 * Update member role.
 *
 * Body:
 *   - role: string - New role ('admin' | 'member')
 *
 * Response: AdminSingleResponse<AdminMember>
 *
 * DELETE /api/v1/admin/organizations/[id]/members/[memberId]
 *
 * Remove member from organization with full billing logic.
 * Handles departed usage capture and Pro restoration like the regular flow.
 *
 * Query Parameters:
 *   - skipBillingLogic: boolean - Skip billing logic (default: false)
 *
 * Response: { success: true, memberId: string, billingActions: {...} }
 */

import { db } from '@sim/db'
import { member, organization, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import {
  adminV1GetOrganizationMemberContract,
  adminV1RemoveOrganizationMemberContract,
  adminV1UpdateOrganizationMemberContract,
} from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import {
  removeExternalUserFromOrganizationWorkspaces,
  removeUserFromOrganization,
} from '@/lib/billing/organizations/membership'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminValidationErrorResponse,
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import type { AdminMember, AdminMemberDetail } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminOrganizationMemberDetailAPI')

interface RouteParams {
  id: string
  memberId: string
}

function resolveOrganizationMemberUserId(memberId: string): string {
  return memberId.startsWith('external-') ? memberId.slice('external-'.length) : memberId
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1GetOrganizationMemberContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId, memberId } = parsed.data.params
    const targetUserId = resolveOrganizationMemberUserId(memberId)

    try {
      const [orgData] = await db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!orgData) {
        return notFoundResponse('Organization')
      }

      const [memberData] = await db
        .select({
          id: member.id,
          userId: member.userId,
          organizationId: member.organizationId,
          role: member.role,
          createdAt: member.createdAt,
          userName: user.name,
          userEmail: user.email,
          currentPeriodCost: userStats.currentPeriodCost,
          currentUsageLimit: userStats.currentUsageLimit,
          lastActive: userStats.lastActive,
          billingBlocked: userStats.billingBlocked,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .leftJoin(userStats, eq(member.userId, userStats.userId))
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, targetUserId)))
        .limit(1)

      if (!memberData && memberId.startsWith('external-')) {
        const [externalUser] = await db
          .select({
            id: user.id,
            createdAt: user.createdAt,
            userName: user.name,
            userEmail: user.email,
            currentPeriodCost: userStats.currentPeriodCost,
            currentUsageLimit: userStats.currentUsageLimit,
            lastActive: userStats.lastActive,
            billingBlocked: userStats.billingBlocked,
          })
          .from(user)
          .leftJoin(userStats, eq(user.id, userStats.userId))
          .where(eq(user.id, targetUserId))
          .limit(1)

        if (!externalUser) {
          return notFoundResponse('Member')
        }

        return singleResponse({
          id: memberId,
          userId: externalUser.id,
          organizationId,
          role: 'external',
          createdAt: externalUser.createdAt.toISOString(),
          userName: externalUser.userName,
          userEmail: externalUser.userEmail,
          currentPeriodCost: externalUser.currentPeriodCost ?? '0',
          currentUsageLimit: externalUser.currentUsageLimit,
          lastActive: externalUser.lastActive?.toISOString() ?? null,
          billingBlocked: externalUser.billingBlocked ?? false,
        } satisfies AdminMemberDetail)
      }

      if (!memberData) {
        return notFoundResponse('Member')
      }

      const data: AdminMemberDetail = {
        id: memberData.id,
        userId: memberData.userId,
        organizationId: memberData.organizationId,
        role: memberData.role,
        createdAt: memberData.createdAt.toISOString(),
        userName: memberData.userName,
        userEmail: memberData.userEmail,
        currentPeriodCost: memberData.currentPeriodCost ?? '0',
        currentUsageLimit: memberData.currentUsageLimit,
        lastActive: memberData.lastActive?.toISOString() ?? null,
        billingBlocked: memberData.billingBlocked ?? false,
      }

      logger.info(`Admin API: Retrieved member ${memberId} from organization ${organizationId}`)

      return singleResponse(data)
    } catch (error) {
      logger.error('Admin API: Failed to get member', { error, organizationId, memberId })
      return internalErrorResponse('Failed to get member')
    }
  })
)

export const PATCH = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const routeParams = await context.params
    const { id: organizationId, memberId } = routeParams

    try {
      const parsed = await parseRequest(
        adminV1UpdateOrganizationMemberContract,
        request,
        { params: routeParams },
        {
          validationErrorResponse: adminValidationErrorResponse,
          invalidJson: 'throw',
        }
      )
      if (!parsed.success) return parsed.response

      const { role } = parsed.data.body

      if (memberId.startsWith('external-')) {
        return badRequestResponse('Cannot update external canvas member role')
      }

      const [orgData] = await db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!orgData) {
        return notFoundResponse('Organization')
      }

      const [existingMember] = await db
        .select({
          id: member.id,
          userId: member.userId,
          role: member.role,
        })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, memberId)))
        .limit(1)

      if (!existingMember) {
        return notFoundResponse('Member')
      }

      if (existingMember.role === 'owner') {
        return badRequestResponse('Cannot change owner role')
      }

      const [updated] = await db
        .update(member)
        .set({ role })
        .where(eq(member.id, memberId))
        .returning()

      const [userData] = await db
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, updated.userId))
        .limit(1)

      const data: AdminMember = {
        id: updated.id,
        userId: updated.userId,
        organizationId: updated.organizationId,
        role: updated.role,
        createdAt: updated.createdAt.toISOString(),
        userName: userData?.name ?? '',
        userEmail: userData?.email ?? '',
      }

      logger.info(`Admin API: Updated member ${memberId} role to ${role}`, {
        organizationId,
        previousRole: existingMember.role,
      })

      return singleResponse(data)
    } catch (error) {
      logger.error('Admin API: Failed to update member', { error, organizationId, memberId })
      return internalErrorResponse('Failed to update member')
    }
  })
)

export const DELETE = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1RemoveOrganizationMemberContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId, memberId } = parsed.data.params
    const targetUserId = resolveOrganizationMemberUserId(memberId)
    const skipBillingLogic = !isBillingEnabled || parsed.data.query.skipBillingLogic

    try {
      const [orgData] = await db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!orgData) {
        return notFoundResponse('Organization')
      }

      const [existingMember] = await db
        .select({
          id: member.id,
          userId: member.userId,
          role: member.role,
        })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, targetUserId)))
        .limit(1)

      if (!existingMember) {
        if (!memberId.startsWith('external-')) {
          return notFoundResponse('Member')
        }

        const [targetUser] = await db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, targetUserId))
          .limit(1)

        if (!targetUser) {
          return notFoundResponse('Member')
        }

        const result = await removeExternalUserFromOrganizationWorkspaces({
          userId: targetUserId,
          organizationId,
        })

        if (!result.success) {
          const error = result.error || 'External canvas member not found'
          if (error === 'External canvas member not found') {
            return notFoundResponse('Member')
          }
          if (error === 'User is an organization member') {
            return badRequestResponse(error)
          }
          return internalErrorResponse(error)
        }

        return singleResponse({
          success: true,
          memberId,
          userId: targetUserId,
          billingActions: {
            usageCaptured: false,
            proRestored: false,
            usageRestored: false,
            skipBillingLogic,
          },
          workspaceAccessRevoked: result.workspaceAccessRevoked,
          permissionGroupsRevoked: result.permissionGroupsRevoked,
          credentialMembershipsRevoked: result.credentialMembershipsRevoked,
          pendingInvitationsCancelled: result.pendingInvitationsCancelled,
        })
      }

      const userId = existingMember.userId

      const result = await removeUserFromOrganization({
        userId,
        organizationId,
        memberId,
        skipBillingLogic,
      })

      if (!result.success) {
        if (result.error === 'Cannot remove organization owner') {
          return badRequestResponse(result.error)
        }
        if (result.error === 'Member not found') {
          return notFoundResponse('Member')
        }
        return internalErrorResponse(result.error || 'Failed to remove member')
      }

      logger.info(`Admin API: Removed member ${memberId} from organization ${organizationId}`, {
        userId,
        billingActions: result.billingActions,
      })

      return singleResponse({
        success: true,
        memberId,
        userId,
        billingActions: {
          usageCaptured: result.billingActions.usageCaptured,
          proRestored: result.billingActions.proRestored,
          usageRestored: result.billingActions.usageRestored,
          skipBillingLogic,
        },
      })
    } catch (error) {
      logger.error('Admin API: Failed to remove member', { error, organizationId, memberId })
      return internalErrorResponse('Failed to remove member')
    }
  })
)
