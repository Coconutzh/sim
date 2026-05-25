import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  getOrganizationMemberContract,
  removeOrganizationMemberContract,
  updateOrganizationMemberRoleContract,
} from '@/lib/api/contracts/organization'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { setActiveOrganizationForCurrentSession } from '@/lib/auth/active-organization'
import { getUserUsageData } from '@/lib/billing/core/usage'
import {
  removeExternalUserFromOrganizationWorkspaces,
  removeUserFromOrganization,
} from '@/lib/billing/organizations/membership'
import { reduceOrganizationSeatsByOne } from '@/lib/billing/organizations/seats'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrganizationMemberAPI')

function resolveOrganizationMemberUserId(memberId: string): string {
  return memberId.startsWith('external-') ? memberId.slice('external-'.length) : memberId
}

/**
 * GET /api/organizations/[id]/members/[memberId]
 * Get individual organization member details
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; memberId: string }> }) => {
    let organizationIdForLog: string | undefined
    let memberIdForLog: string | undefined

    try {
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(getOrganizationMemberContract, request, context)
      if (!parsed.success) return parsed.response

      const { id: organizationId, memberId } = parsed.data.params
      organizationIdForLog = organizationId
      memberIdForLog = memberId
      const targetUserId = resolveOrganizationMemberUserId(memberId)
      const includeUsage = parsed.data.query.include === 'usage'

      const userMember = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (userMember.length === 0) {
        return NextResponse.json(
          { error: 'Forbidden - Not a member of this organization' },
          { status: 403 }
        )
      }

      const userRole = userMember[0].role
      const hasAdminAccess = ['owner', 'admin'].includes(userRole)

      const memberQuery = db
        .select({
          id: member.id,
          userId: member.userId,
          organizationId: member.organizationId,
          role: member.role,
          createdAt: member.createdAt,
          userName: user.name,
          userEmail: user.email,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, targetUserId)))
        .limit(1)

      const memberEntry = await memberQuery

      const canViewDetails = hasAdminAccess || session.user.id === targetUserId

      if (!canViewDetails) {
        return NextResponse.json({ error: 'Forbidden - Insufficient permissions' }, { status: 403 })
      }

      let memberData: Record<string, unknown> | null = memberEntry[0] ?? null

      if (!memberData && memberId.startsWith('external-')) {
        const [externalUser] = await db
          .select({
            id: user.id,
            createdAt: user.createdAt,
            userName: user.name,
            userEmail: user.email,
          })
          .from(user)
          .where(eq(user.id, targetUserId))
          .limit(1)

        if (!externalUser) {
          return NextResponse.json({ error: 'Member not found' }, { status: 404 })
        }

        memberData = {
          id: memberId,
          userId: externalUser.id,
          organizationId,
          role: 'external',
          createdAt: externalUser.createdAt,
          userName: externalUser.userName,
          userEmail: externalUser.userEmail,
        }
      }

      if (!memberData) {
        return NextResponse.json({ error: 'Member not found' }, { status: 404 })
      }

      if (includeUsage && hasAdminAccess) {
        const usageData = await db
          .select({
            currentPeriodCost: userStats.currentPeriodCost,
            currentUsageLimit: userStats.currentUsageLimit,
            usageLimitUpdatedAt: userStats.usageLimitUpdatedAt,
            lastPeriodCost: userStats.lastPeriodCost,
          })
          .from(userStats)
          .where(eq(userStats.userId, targetUserId))
          .limit(1)

        const computed = await getUserUsageData(targetUserId)

        if (usageData.length > 0) {
          memberData = {
            ...memberData,
            usage: {
              ...usageData[0],
              billingPeriodStart: computed.billingPeriodStart,
              billingPeriodEnd: computed.billingPeriodEnd,
            },
          } as typeof memberData & {
            usage: (typeof usageData)[0] & {
              billingPeriodStart: Date | null
              billingPeriodEnd: Date | null
            }
          }
        }
      }

      return NextResponse.json({
        success: true,
        data: memberData,
        userRole,
        hasAdminAccess,
      })
    } catch (error) {
      logger.error('Failed to get organization member', {
        organizationId: organizationIdForLog,
        memberId: memberIdForLog,
        error,
      })

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

/**
 * PUT /api/organizations/[id]/members/[memberId]
 * Update organization member role
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; memberId: string }> }) => {
    let organizationIdForLog: string | undefined
    let memberIdForLog: string | undefined

    try {
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(updateOrganizationMemberRoleContract, request, context)
      if (!parsed.success) return parsed.response

      const { id: organizationId, memberId } = parsed.data.params
      organizationIdForLog = organizationId
      memberIdForLog = memberId
      const { role } = parsed.data.body

      if (memberId.startsWith('external-')) {
        return NextResponse.json(
          { error: 'Cannot update external canvas member role' },
          { status: 400 }
        )
      }

      const userMember = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (userMember.length === 0) {
        return NextResponse.json(
          { error: 'Forbidden - Not a member of this organization' },
          { status: 403 }
        )
      }

      if (!['owner', 'admin'].includes(userMember[0].role)) {
        return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
      }

      const targetMember = await db
        .select({
          id: member.id,
          role: member.role,
          userId: member.userId,
          email: user.email,
          name: user.name,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, memberId)))
        .limit(1)

      if (targetMember.length === 0) {
        return NextResponse.json({ error: 'Member not found' }, { status: 404 })
      }

      if (targetMember[0].role === 'owner') {
        return NextResponse.json({ error: 'Cannot change owner role' }, { status: 400 })
      }

      if (role === 'owner') {
        return NextResponse.json(
          {
            error:
              'Ownership transfer is not supported via this endpoint. Use POST /organizations/[id]/transfer-ownership instead.',
          },
          { status: 400 }
        )
      }

      const updatedMember = await db
        .update(member)
        .set({ role })
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, memberId)))
        .returning()

      if (updatedMember.length === 0) {
        return NextResponse.json({ error: 'Failed to update member role' }, { status: 500 })
      }

      logger.info('Organization member role updated', {
        organizationId,
        memberId,
        newRole: role,
        updatedBy: session.user.id,
      })

      recordAudit({
        workspaceId: null,
        actorId: session.user.id,
        action: AuditAction.ORG_MEMBER_ROLE_CHANGED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        description: `Changed role for member ${memberId} to ${role}`,
        metadata: {
          organizationId,
          targetUserId: memberId,
          targetEmail: targetMember[0].email ?? undefined,
          targetName: targetMember[0].name ?? undefined,
          changes: [{ field: 'role', from: targetMember[0].role, to: role }],
        },
        request,
      })

      return NextResponse.json({
        success: true,
        message: 'Member role updated successfully',
        data: {
          id: updatedMember[0].id,
          userId: updatedMember[0].userId,
          role: updatedMember[0].role,
          updatedBy: session.user.id,
        },
      })
    } catch (error) {
      logger.error('Failed to update organization member role', {
        organizationId: organizationIdForLog,
        memberId: memberIdForLog,
        error,
      })

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

/**
 * DELETE /api/organizations/[id]/members/[memberId]
 * Remove member from organization
 */
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; memberId: string }> }) => {
    let organizationId = 'unknown'
    let memberId = 'unknown'

    try {
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(removeOrganizationMemberContract, request, context)
      if (!parsed.success) return parsed.response

      const parsedParams = parsed.data.params
      organizationId = parsedParams.id
      memberId = parsedParams.memberId
      const targetUserId = resolveOrganizationMemberUserId(memberId)
      const shouldReduceSeats = parsed.data.query.shouldReduceSeats === true

      const userMember = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (userMember.length === 0) {
        return NextResponse.json(
          { error: 'Forbidden - Not a member of this organization' },
          { status: 403 }
        )
      }

      const canRemoveMembers =
        ['owner', 'admin'].includes(userMember[0].role) || session.user.id === targetUserId

      if (!canRemoveMembers) {
        return NextResponse.json({ error: 'Forbidden - Insufficient permissions' }, { status: 403 })
      }

      const targetMember = await db
        .select({ id: member.id, role: member.role, email: user.email, name: user.name })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, targetUserId)))
        .limit(1)

      if (targetMember.length === 0) {
        const [targetUser] = await db
          .select({ id: user.id, email: user.email, name: user.name })
          .from(user)
          .where(eq(user.id, targetUserId))
          .limit(1)

        if (!targetUser) {
          return NextResponse.json({ error: 'Member not found' }, { status: 404 })
        }

        const externalResult = await removeExternalUserFromOrganizationWorkspaces({
          userId: targetUserId,
          organizationId,
        })

        if (!externalResult.success) {
          const error = externalResult.error || 'External canvas member not found'
          const status =
            error === 'External canvas member not found'
              ? 404
              : error === 'User is an organization member'
                ? 409
                : 500

          return NextResponse.json({ error }, { status })
        }

        logger.info('External workspace member removed from organization workspaces', {
          organizationId,
          removedMemberId: targetUserId,
          removedBy: session.user.id,
          workspaceAccessRevoked: externalResult.workspaceAccessRevoked,
          permissionGroupsRevoked: externalResult.permissionGroupsRevoked,
          credentialMembershipsRevoked: externalResult.credentialMembershipsRevoked,
          pendingInvitationsCancelled: externalResult.pendingInvitationsCancelled,
        })

        recordAudit({
          workspaceId: null,
          actorId: session.user.id,
          action: AuditAction.ORG_MEMBER_REMOVED,
          resourceType: AuditResourceType.ORGANIZATION,
          resourceId: organizationId,
          actorName: session.user.name ?? undefined,
          actorEmail: session.user.email ?? undefined,
          description: `Removed external workspace member ${targetUserId} from organization`,
          metadata: {
            organizationId,
            targetUserId,
            targetEmail: targetUser.email ?? undefined,
            targetName: targetUser.name ?? undefined,
            membershipType: 'external',
            workspaceAccessRevoked: externalResult.workspaceAccessRevoked,
            permissionGroupsRevoked: externalResult.permissionGroupsRevoked,
            credentialMembershipsRevoked: externalResult.credentialMembershipsRevoked,
            pendingInvitationsCancelled: externalResult.pendingInvitationsCancelled,
          },
          request,
        })

        return NextResponse.json({
          success: true,
          message: 'External member removed successfully',
          data: {
            removedMemberId: targetUserId,
            removedBy: session.user.id,
            removedAt: new Date().toISOString(),
            membershipType: 'external',
            workspaceAccessRevoked: externalResult.workspaceAccessRevoked,
            permissionGroupsRevoked: externalResult.permissionGroupsRevoked,
            credentialMembershipsRevoked: externalResult.credentialMembershipsRevoked,
            pendingInvitationsCancelled: externalResult.pendingInvitationsCancelled,
          },
        })
      }

      const result = await removeUserFromOrganization({
        userId: targetUserId,
        organizationId,
        memberId: targetMember[0].id,
      })

      if (!result.success) {
        if (result.error === 'Cannot remove organization owner') {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }
        if (result.error === 'Member not found') {
          return NextResponse.json({ error: result.error }, { status: 404 })
        }
        return NextResponse.json({ error: result.error }, { status: 500 })
      }

      let seatReduction: Awaited<ReturnType<typeof reduceOrganizationSeatsByOne>> | null = null
      if (shouldReduceSeats && session.user.id !== targetUserId) {
        try {
          seatReduction = await reduceOrganizationSeatsByOne({
            organizationId,
            actorUserId: session.user.id,
            removedUserId: targetUserId,
          })
        } catch (seatError) {
          logger.error('Failed to reduce seats after member removal', {
            organizationId,
            removedMemberId: targetUserId,
            removedBy: session.user.id,
            error: seatError,
          })
          seatReduction = {
            reduced: false,
            reason: 'Failed to reduce seats after member removal',
          }
        }
      }

      if (session.user.id === targetUserId) {
        try {
          await setActiveOrganizationForCurrentSession(null)
        } catch (clearError) {
          logger.warn('Failed to clear active organization after self-removal', {
            userId: session.user.id,
            organizationId,
            error: clearError,
          })
        }
      }

      logger.info('Organization member removed', {
        organizationId,
        removedMemberId: targetUserId,
        removedBy: session.user.id,
        wasSelfRemoval: session.user.id === targetUserId,
        billingActions: result.billingActions,
        seatReduction,
      })

      recordAudit({
        workspaceId: null,
        actorId: session.user.id,
        action: AuditAction.ORG_MEMBER_REMOVED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        description:
          session.user.id === targetUserId
            ? 'Left the organization'
            : `Removed member ${targetUserId} from organization`,
        metadata: {
          organizationId,
          targetUserId,
          targetEmail: targetMember[0].email ?? undefined,
          targetName: targetMember[0].name ?? undefined,
          wasSelfRemoval: session.user.id === targetUserId,
          seatReduction,
        },
        request,
      })

      return NextResponse.json({
        success: true,
        message:
          session.user.id === targetUserId
            ? 'You have left the organization'
            : 'Member removed successfully',
        data: {
          removedMemberId: targetUserId,
          removedBy: session.user.id,
          removedAt: new Date().toISOString(),
          seatReduction,
        },
      })
    } catch (error) {
      logger.error('Failed to remove organization member', {
        organizationId,
        memberId,
        error,
      })

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
