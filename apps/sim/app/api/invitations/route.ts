import { db } from '@sim/db'
import { invitation, invitationWorkspaceGrant, organization, user, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, gt, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { listMyPendingInvitationsContract } from '@/lib/api/contracts/invitations'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { normalizeEmail } from '@/lib/invitations/core'

const logger = createLogger('MyInvitationsAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(listMyPendingInvitationsContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    const normalizedEmail = normalizeEmail(session.user.email)
    const now = new Date()
    const invitationRows = await db
      .select({
        id: invitation.id,
        kind: invitation.kind,
        email: invitation.email,
        organizationId: invitation.organizationId,
        organizationName: organization.name,
        membershipIntent: invitation.membershipIntent,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
        inviterName: user.name,
        inviterEmail: user.email,
      })
      .from(invitation)
      .leftJoin(organization, eq(invitation.organizationId, organization.id))
      .leftJoin(user, eq(invitation.inviterId, user.id))
      .where(
        and(
          eq(invitation.email, normalizedEmail),
          eq(invitation.status, 'pending'),
          gt(invitation.expiresAt, now)
        )
      )
      .orderBy(desc(invitation.createdAt))

    const invitationIds = invitationRows.map((row) => row.id)
    const grantRows =
      invitationIds.length > 0
        ? await db
            .select({
              invitationId: invitationWorkspaceGrant.invitationId,
              workspaceId: invitationWorkspaceGrant.workspaceId,
              workspaceName: workspace.name,
              permission: invitationWorkspaceGrant.permission,
            })
            .from(invitationWorkspaceGrant)
            .leftJoin(workspace, eq(invitationWorkspaceGrant.workspaceId, workspace.id))
            .where(inArray(invitationWorkspaceGrant.invitationId, invitationIds))
        : []

    const grantsByInvitationId = new Map<
      string,
      Array<{
        workspaceId: string
        workspaceName: string | null
        permission: 'admin' | 'write' | 'read'
      }>
    >()

    for (const grant of grantRows) {
      const grants = grantsByInvitationId.get(grant.invitationId) ?? []
      grants.push({
        workspaceId: grant.workspaceId,
        workspaceName: grant.workspaceName,
        permission: grant.permission,
      })
      grantsByInvitationId.set(grant.invitationId, grants)
    }

    return NextResponse.json({
      invitations: invitationRows.map((row) => ({
        id: row.id,
        kind: row.kind,
        email: row.email,
        organizationId: row.organizationId,
        organizationName: row.organizationName,
        membershipIntent: row.membershipIntent,
        role: row.role,
        status: row.status,
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        inviterName: row.inviterName,
        inviterEmail: row.inviterEmail,
        grants: grantsByInvitationId.get(row.id) ?? [],
      })),
    })
  } catch (error) {
    logger.error('Failed to list user invitations', { userId: session.user.id, error })
    return NextResponse.json({ error: 'Failed to list invitations' }, { status: 500 })
  }
})
