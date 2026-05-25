import { db, mothershipInboxAllowedSender } from '@sim/db'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  addInboxSenderContract,
  listInboxSendersContract,
  removeInboxSenderContract,
} from '@/lib/api/contracts/inbox'
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
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(listInboxSendersContract, req, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params

    const [access, hasAccess, permission] = await Promise.all([
      checkWorkspaceAccess(workspaceId, session.user.id),
      hasInboxAccess(session.user.id),
      getUserEntityPermissions(session.user.id, 'workspace', workspaceId),
    ])
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }
    if (!permission) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }
    if (!hasAccess) {
      return NextResponse.json({ error: 'Sim Mailer requires a Max plan' }, { status: 403 })
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
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(addInboxSenderContract, req, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params
    const { email, label } = parsed.data.body

    const [access, hasAccess, isAdmin] = await Promise.all([
      checkWorkspaceAccess(workspaceId, session.user.id),
      hasInboxAccess(session.user.id),
      hasWorkspaceAdminAccess(session.user.id, workspaceId),
    ])
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }
    if (!hasAccess) {
      return NextResponse.json({ error: 'Sim Mailer requires a Max plan' }, { status: 403 })
    }
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    try {
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
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(removeInboxSenderContract, req, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params
    const { senderId } = parsed.data.body

    const [access, hasAccess, isAdmin] = await Promise.all([
      checkWorkspaceAccess(workspaceId, session.user.id),
      hasInboxAccess(session.user.id),
      hasWorkspaceAdminAccess(session.user.id, workspaceId),
    ])
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }
    if (!hasAccess) {
      return NextResponse.json({ error: 'Sim Mailer requires a Max plan' }, { status: 403 })
    }
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    try {
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
