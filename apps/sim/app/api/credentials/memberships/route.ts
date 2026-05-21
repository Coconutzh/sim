import { db } from '@sim/db'
import { credential, credentialMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { leaveCredentialMembershipContract } from '@/lib/api/contracts/credentials'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CredentialMembershipsAPI')

export const GET = withRouteHandler(async () => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const memberships = await db
      .select({
        membershipId: credentialMember.id,
        credentialId: credential.id,
        workspaceId: credential.workspaceId,
        type: credential.type,
        displayName: credential.displayName,
        providerId: credential.providerId,
        role: credentialMember.role,
        status: credentialMember.status,
        joinedAt: credentialMember.joinedAt,
      })
      .from(credentialMember)
      .innerJoin(credential, eq(credentialMember.credentialId, credential.id))
      .where(eq(credentialMember.userId, session.user.id))

    const visibleMemberships = (
      await Promise.all(
        memberships.map(async (membership) => {
          const access = await checkWorkspaceAccess(membership.workspaceId, session.user.id)
          if (!access.exists || !access.hasAccess) {
            return null
          }
          return membership
        })
      )
    ).filter((membership): membership is (typeof memberships)[number] => membership !== null)

    return NextResponse.json({ memberships: visibleMemberships }, { status: 200 })
  } catch (error) {
    logger.error('Failed to list credential memberships', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(leaveCredentialMembershipContract, request, {}, {
      validationErrorResponse: (error) =>
        NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
    })
    if (!parsed.success) return parsed.response

    const { credentialId } = parsed.data.query
    const [membership] = await db
      .select({
        id: credentialMember.id,
        role: credentialMember.role,
        status: credentialMember.status,
        workspaceId: credential.workspaceId,
      })
      .from(credentialMember)
      .innerJoin(credential, eq(credentialMember.credentialId, credential.id))
      .where(
        and(
          eq(credentialMember.credentialId, credentialId),
          eq(credentialMember.userId, session.user.id)
        )
      )
      .limit(1)

    if (!membership) {
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
    }

    const workspaceAccess = await checkWorkspaceAccess(membership.workspaceId, session.user.id)
    if (!workspaceAccess.exists || !workspaceAccess.hasAccess) {
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
    }

    if (membership.status !== 'active') {
      return NextResponse.json({ success: true }, { status: 200 })
    }

    const revoked = await db.transaction(async (tx) => {
      if (membership.role === 'admin') {
        const activeAdmins = await tx
          .select({ id: credentialMember.id })
          .from(credentialMember)
          .where(
            and(
              eq(credentialMember.credentialId, credentialId),
              eq(credentialMember.role, 'admin'),
              eq(credentialMember.status, 'active')
            )
          )

        if (activeAdmins.length <= 1) {
          return false
        }
      }

      await tx
        .update(credentialMember)
        .set({
          status: 'revoked',
          updatedAt: new Date(),
        })
        .where(eq(credentialMember.id, membership.id))

      return true
    })

    if (!revoked) {
      return NextResponse.json(
        { error: 'Cannot leave credential as the last active admin' },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error('Failed to leave credential', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
