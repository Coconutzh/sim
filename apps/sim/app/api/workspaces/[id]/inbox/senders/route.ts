import { db, mothershipInboxAllowedSender } from '@sim/db'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { addInboxSenderContract, removeInboxSenderContract } from '@/lib/api/contracts/inbox'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { hasInboxAccess } from '@/lib/billing/core/subscription'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  checkWorkspaceAccess,
  getUserEntityPermissions,
  getUsersWithPermissions,
  hasWorkspaceAdminAccess,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('InboxSendersAPI')

export const GET = withRouteHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id: workspaceId } = await params
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [hasAccess, access, permission] = await Promise.all([
      hasInboxAccess(session.user.id),
      checkWorkspaceAccess(workspaceId, session.user.id),
      getUserEntityPermissions(session.user.id, 'workspace', workspaceId),
    ])
    if (!hasAccess) {
      return NextResponse.json({ error: 'Sim Mailer requires a Max plan' }, { status: 403 })
    }
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (!permission) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const [senders, members] = await Promise.all([
      db
        .select({
          id: mothershipInboxAllowedSender.id,
          email: mothershipInboxAllowedSender.email,
          label: mothershipInboxAllowedSender.label,
          createdAt: mothershipInboxAllowedSender.createdAt,
        })
        .from(mothershipInboxAllowedSender)
        .where(eq(mothershipInboxAllowedSender.workspaceId, workspaceId))
        .orderBy(mothershipInboxAllowedSender.createdAt),
      getUsersWithPermissions(workspaceId),
    ])

    return NextResponse.json({
      senders: senders.map((s) => ({
        id: s.id,
        email: s.email,
        label: s.label,
        createdAt: s.createdAt,
      })),
      workspaceMembers: members.map((m) => ({
        email: m.email,
        name: m.name,
        isAutoAllowed: true,
      })),
    })
  }
)

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id: workspaceId } = await context.params
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [hasAccess, access, isAdmin] = await Promise.all([
      hasInboxAccess(session.user.id),
      checkWorkspaceAccess(workspaceId, session.user.id),
      hasWorkspaceAdminAccess(session.user.id, workspaceId),
    ])
    if (!hasAccess) {
      return NextResponse.json({ error: 'Sim Mailer requires a Max plan' }, { status: 403 })
    }
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    try {
      const parsed = await parseRequest(addInboxSenderContract, req, context)
      if (!parsed.success) return parsed.response
      const { email, label } = parsed.data.body
      const normalizedEmail = email.toLowerCase()

      const [existing] = await db
        .select({ id: mothershipInboxAllowedSender.id })
        .from(mothershipInboxAllowedSender)
        .where(
          and(
            eq(mothershipInboxAllowedSender.workspaceId, workspaceId),
            eq(mothershipInboxAllowedSender.email, normalizedEmail)
          )
        )
        .limit(1)

      if (existing) {
        return NextResponse.json({ error: 'Sender already exists' }, { status: 409 })
      }

      const [sender] = await db
        .insert(mothershipInboxAllowedSender)
        .values({
          id: generateId(),
          workspaceId,
          email: normalizedEmail,
          label: label || null,
          addedBy: session.user.id,
        })
        .returning()

      return NextResponse.json({ sender })
    } catch (error) {
      logger.error('Failed to add sender', { workspaceId, error })
      return NextResponse.json({ error: 'Failed to add sender' }, { status: 500 })
    }
  }
)

export const DELETE = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id: workspaceId } = await context.params
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [hasAccess, access, isAdmin] = await Promise.all([
      hasInboxAccess(session.user.id),
      checkWorkspaceAccess(workspaceId, session.user.id),
      hasWorkspaceAdminAccess(session.user.id, workspaceId),
    ])
    if (!hasAccess) {
      return NextResponse.json({ error: 'Sim Mailer requires a Max plan' }, { status: 403 })
    }
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    try {
      const parsed = await parseRequest(removeInboxSenderContract, req, context)
      if (!parsed.success) return parsed.response
      const { senderId } = parsed.data.body

      await db
        .delete(mothershipInboxAllowedSender)
        .where(
          and(
            eq(mothershipInboxAllowedSender.id, senderId),
            eq(mothershipInboxAllowedSender.workspaceId, workspaceId)
          )
        )

      return NextResponse.json({ ok: true })
    } catch (error) {
      logger.error('Failed to delete sender', { workspaceId, error })
      return NextResponse.json({ error: 'Failed to delete sender' }, { status: 500 })
    }
  }
)
