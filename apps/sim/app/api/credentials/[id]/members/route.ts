import { db } from '@sim/db'
import { credential, credentialMember, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  removeWorkspaceCredentialMemberContract,
  upsertWorkspaceCredentialMemberContract,
} from '@/lib/api/contracts/credentials'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkWorkspaceAccess, getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CredentialMembersAPI')

interface RouteContext {
  params: Promise<{ id: string }>
}

async function loadCredentialAccess(credentialId: string, userId: string) {
  const [cred] = await db
    .select({ id: credential.id, workspaceId: credential.workspaceId })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)

  if (!cred) {
    return { credential: null, access: null, permission: null }
  }

  const access = await checkWorkspaceAccess(cred.workspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    return { credential: cred, access, permission: null }
  }

  const perm = await getUserEntityPermissions(userId, 'workspace', cred.workspaceId)
  return { credential: cred, access, permission: perm }
}

async function requireWorkspaceAdminMembership(credentialId: string, userId: string) {
  const loaded = await loadCredentialAccess(credentialId, userId)
  if (!loaded.credential || !loaded.access?.hasAccess || loaded.permission === null) {
    return { ok: false as const, hidden: Boolean(loaded.credential && !loaded.access?.hasAccess) }
  }

  const [membership] = await db
    .select({ role: credentialMember.role, status: credentialMember.status })
    .from(credentialMember)
    .where(
      and(eq(credentialMember.credentialId, credentialId), eq(credentialMember.userId, userId))
    )
    .limit(1)

  if (!membership || membership.status !== 'active' || membership.role !== 'admin') {
    return { ok: false as const, hidden: false }
  }
  return { ok: true as const, membership }
}

export const GET = withRouteHandler(async (_request: NextRequest, context: RouteContext) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: credentialId } = await context.params

    const loaded = await loadCredentialAccess(credentialId, session.user.id)
    const cred = loaded.credential

    if (!cred) {
      return NextResponse.json({ members: [] }, { status: 200 })
    }

    if (!loaded.access?.hasAccess || loaded.permission === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const [membership] = await db
      .select({ role: credentialMember.role, status: credentialMember.status })
      .from(credentialMember)
      .where(
        and(
          eq(credentialMember.credentialId, credentialId),
          eq(credentialMember.userId, session.user.id)
        )
      )
      .limit(1)

    if (!membership || membership.status !== 'active' || membership.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const members = await db
      .select({
        id: credentialMember.id,
        userId: credentialMember.userId,
        role: credentialMember.role,
        status: credentialMember.status,
        joinedAt: credentialMember.joinedAt,
        userName: user.name,
        userEmail: user.email,
      })
      .from(credentialMember)
      .innerJoin(user, eq(credentialMember.userId, user.id))
      .where(eq(credentialMember.credentialId, credentialId))

    return NextResponse.json({ members })
  } catch (error) {
    logger.error('Failed to fetch credential members', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: credentialId } = await context.params

    const admin = await requireWorkspaceAdminMembership(credentialId, session.user.id)
    if (!admin.ok) {
      if (admin.hidden) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const parsed = await parseRequest(upsertWorkspaceCredentialMemberContract, request, context)
    if (!parsed.success) return parsed.response

    const { userId, role } = parsed.data.body
    const now = new Date()

    const [existing] = await db
      .select({ id: credentialMember.id, status: credentialMember.status })
      .from(credentialMember)
      .where(
        and(eq(credentialMember.credentialId, credentialId), eq(credentialMember.userId, userId))
      )
      .limit(1)

    if (existing) {
      await db
        .update(credentialMember)
        .set({ role, status: 'active', updatedAt: now })
        .where(eq(credentialMember.id, existing.id))
      return NextResponse.json({ success: true })
    }

    await db.insert(credentialMember).values({
      id: generateId(),
      credentialId,
      userId,
      role,
      status: 'active',
      joinedAt: now,
      invitedBy: session.user.id,
      createdAt: now,
      updatedAt: now,
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    logger.error('Failed to add credential member', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(removeWorkspaceCredentialMemberContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: credentialId } = parsed.data.params
    const { userId: targetUserId } = parsed.data.query

    const admin = await requireWorkspaceAdminMembership(credentialId, session.user.id)
    if (!admin.ok) {
      if (admin.hidden) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const [target] = await db
      .select({
        id: credentialMember.id,
        role: credentialMember.role,
      })
      .from(credentialMember)
      .where(
        and(
          eq(credentialMember.credentialId, credentialId),
          eq(credentialMember.userId, targetUserId),
          eq(credentialMember.status, 'active')
        )
      )
      .limit(1)

    if (!target) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const revoked = await db.transaction(async (tx) => {
      if (target.role === 'admin') {
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
        .set({ status: 'revoked', updatedAt: new Date() })
        .where(eq(credentialMember.id, target.id))

      return true
    })

    if (!revoked) {
      return NextResponse.json({ error: 'Cannot remove the last admin' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to remove credential member', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
