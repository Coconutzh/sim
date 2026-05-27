/**
 * GET /api/v1/admin/organizations/[id]/members
 *
 * List all members of an organization with their billing info.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *
 * Response: AdminListResponse<AdminMemberDetail>
 *
 * POST /api/v1/admin/organizations/[id]/members
 *
 * Add a user to an organization with full billing logic.
 * Validates seat availability before adding (uses same logic as invitation flow):
 *   - Team plans: checks seats column
 *   - Enterprise plans: checks metadata.seats
 * Handles Pro usage snapshot and subscription cancellation like the invitation flow.
 * If user is already a member, updates their role if different.
 *
 * Body:
 *   - userId: string - User ID to add
 *   - role: string - Role ('admin' | 'member')
 *
 * Response: AdminSingleResponse<AdminMember & {
 *   action: 'created' | 'updated' | 'already_member',
 *   billingActions: { proUsageSnapshotted, proCancelledAtPeriodEnd }
 * }>
 */

import { db } from '@sim/db'
import { member, organization, permissions, user, userStats, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  adminV1AddOrganizationMemberContract,
  adminV1ListOrganizationMembersContract,
} from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { addUserToOrganization } from '@/lib/billing/organizations/membership'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  badRequestResponse,
  internalErrorResponse,
  listResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import {
  type AdminMember,
  type AdminMemberDetail,
  createPaginationMeta,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminOrganizationMembersAPI')

interface RouteParams {
  id: string
}

function toOrganizationMemberId(userId: string, role: string): string {
  return role === 'external' ? `external-${userId}` : userId
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1ListOrganizationMembersContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params
    const { limit, offset } = parsed.data.query

    try {
      const [orgData] = await db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!orgData) {
        return notFoundResponse('Organization')
      }

      const orgWorkspaces = await db
        .select({
          id: workspace.id,
          ownerId: workspace.ownerId,
          createdAt: workspace.createdAt,
        })
        .from(workspace)
        .where(
          and(
            eq(workspace.organizationId, organizationId),
            eq(workspace.workspaceMode, 'organization'),
            isNull(workspace.archivedAt)
          )
        )

      const orgWorkspaceIds = orgWorkspaces.map((row) => row.id)

      const membersData = await db
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
        .where(eq(member.organizationId, organizationId))
        .orderBy(member.createdAt)

      const memberUserIds = membersData.map((row) => row.userId)
      const externalMembers =
        orgWorkspaceIds.length > 0
          ? await db
              .select({
                id: user.id,
                userId: user.id,
                organizationId: sql<string>`${organizationId}`,
                role: sql<'external'>`'external'`,
                createdAt: permissions.createdAt,
                userName: user.name,
                userEmail: user.email,
                currentPeriodCost: userStats.currentPeriodCost,
                currentUsageLimit: userStats.currentUsageLimit,
                lastActive: userStats.lastActive,
                billingBlocked: userStats.billingBlocked,
              })
              .from(permissions)
              .innerJoin(user, eq(permissions.userId, user.id))
              .leftJoin(userStats, eq(user.id, userStats.userId))
              .leftJoin(
                member,
                and(eq(member.userId, user.id), eq(member.organizationId, organizationId))
              )
              .where(
                and(
                  eq(permissions.entityType, 'workspace'),
                  inArray(permissions.entityId, orgWorkspaceIds),
                  isNull(member.id)
                )
              )
          : []
      const externalOwnerIds = [...new Set(orgWorkspaces.map((row) => row.ownerId))].filter(
        (ownerId) => !memberUserIds.includes(ownerId)
      )
      const externalOwnerRows =
        externalOwnerIds.length > 0
          ? await db
              .select({
                userId: user.id,
                userName: user.name,
                userEmail: user.email,
                currentPeriodCost: userStats.currentPeriodCost,
                currentUsageLimit: userStats.currentUsageLimit,
                lastActive: userStats.lastActive,
                billingBlocked: userStats.billingBlocked,
              })
              .from(user)
              .leftJoin(userStats, eq(user.id, userStats.userId))
              .where(inArray(user.id, externalOwnerIds))
          : []

      const externalByUserId = new Map<string, (typeof externalMembers)[number]>()
      for (const row of externalMembers) {
        const existing = externalByUserId.get(row.userId)
        if (!existing || row.createdAt < existing.createdAt) {
          externalByUserId.set(row.userId, row)
        }
      }
      const externalOwnerById = new Map(externalOwnerRows.map((row) => [row.userId, row]))
      for (const orgWorkspace of orgWorkspaces) {
        if (memberUserIds.includes(orgWorkspace.ownerId)) {
          continue
        }

        const ownerRow = externalOwnerById.get(orgWorkspace.ownerId)
        if (!ownerRow) {
          continue
        }

        const externalOwner = {
          userId: ownerRow.userId,
          organizationId,
          role: 'external' as const,
          createdAt: orgWorkspace.createdAt,
          userName: ownerRow.userName,
          userEmail: ownerRow.userEmail,
          currentPeriodCost: ownerRow.currentPeriodCost,
          currentUsageLimit: ownerRow.currentUsageLimit,
          lastActive: ownerRow.lastActive,
          billingBlocked: ownerRow.billingBlocked,
        }
        const existing = externalByUserId.get(ownerRow.userId)
        if (!existing || externalOwner.createdAt < existing.createdAt) {
          externalByUserId.set(ownerRow.userId, externalOwner as (typeof externalMembers)[number])
        }
      }

      const allMembers = [...membersData, ...externalByUserId.values()]
        .map((m) => ({
          id: toOrganizationMemberId(m.userId, m.role),
          userId: m.userId,
          organizationId: m.organizationId ?? organizationId,
          role: m.role,
          createdAt: m.createdAt.toISOString(),
          userName: m.userName,
          userEmail: m.userEmail,
          currentPeriodCost: m.currentPeriodCost ?? '0',
          currentUsageLimit: m.currentUsageLimit,
          lastActive: m.lastActive?.toISOString() ?? null,
          billingBlocked: m.billingBlocked ?? false,
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

      const total = allMembers.length
      const data: AdminMemberDetail[] = allMembers.slice(offset, offset + limit)

      const pagination = createPaginationMeta(total, limit, offset)

      logger.info(`Admin API: Listed ${data.length} members for organization ${organizationId}`)

      return listResponse(data, pagination)
    } catch (error) {
      logger.error('Admin API: Failed to list organization members', { error, organizationId })
      return internalErrorResponse('Failed to list organization members')
    }
  })
)

export const POST = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1AddOrganizationMemberContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
      invalidJsonResponse: adminInvalidJsonResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params

    try {
      const { userId, role } = parsed.data.body

      const [orgData] = await db
        .select({ id: organization.id, name: organization.name })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!orgData) {
        return notFoundResponse('Organization')
      }

      const [userData] = await db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)

      if (!userData) {
        return notFoundResponse('User')
      }

      const [existingMember] = await db
        .select({
          id: member.id,
          role: member.role,
          createdAt: member.createdAt,
          organizationId: member.organizationId,
        })
        .from(member)
        .where(eq(member.userId, userId))
        .limit(1)

      if (existingMember) {
        if (existingMember.organizationId === organizationId) {
          if (existingMember.role === 'owner') {
            return badRequestResponse(
              'Cannot change the owner role via this endpoint. Use POST /api/v1/admin/organizations/[id]/transfer-ownership instead.'
            )
          }

          if (existingMember.role !== role) {
            await db.update(member).set({ role }).where(eq(member.id, existingMember.id))

            logger.info(
              `Admin API: Updated user ${userId} role in organization ${organizationId}`,
              {
                previousRole: existingMember.role,
                newRole: role,
              }
            )

            return singleResponse({
              id: existingMember.id,
              userId,
              organizationId,
              role,
              createdAt: existingMember.createdAt.toISOString(),
              userName: userData.name,
              userEmail: userData.email,
              action: 'updated' as const,
              billingActions: {
                proUsageSnapshotted: false,
                proCancelledAtPeriodEnd: false,
              },
            })
          }

          return singleResponse({
            id: existingMember.id,
            userId,
            organizationId,
            role: existingMember.role,
            createdAt: existingMember.createdAt.toISOString(),
            userName: userData.name,
            userEmail: userData.email,
            action: 'already_member' as const,
            billingActions: {
              proUsageSnapshotted: false,
              proCancelledAtPeriodEnd: false,
            },
          })
        }

        return badRequestResponse(
          `User is already a member of another organization. Users can only belong to one organization at a time.`
        )
      }

      const result = await addUserToOrganization({
        userId,
        organizationId,
        role,
        skipBillingLogic: !isBillingEnabled,
      })

      if (!result.success) {
        return badRequestResponse(result.error || 'Failed to add member')
      }

      const data: AdminMember = {
        id: result.memberId!,
        userId,
        organizationId,
        role,
        createdAt: new Date().toISOString(),
        userName: userData.name,
        userEmail: userData.email,
      }

      logger.info(`Admin API: Added user ${userId} to organization ${organizationId}`, {
        role,
        memberId: result.memberId,
        billingActions: result.billingActions,
      })

      return singleResponse({
        ...data,
        action: 'created' as const,
        billingActions: {
          proUsageSnapshotted: result.billingActions.proUsageSnapshotted,
          proCancelledAtPeriodEnd: result.billingActions.proCancelledAtPeriodEnd,
        },
      })
    } catch (error) {
      logger.error('Admin API: Failed to add organization member', { error, organizationId })
      return internalErrorResponse('Failed to add organization member')
    }
  })
)
