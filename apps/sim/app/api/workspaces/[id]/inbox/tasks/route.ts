import { db, mothershipInboxTask } from '@sim/db'
import { and, desc, eq, lt } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { listInboxTasksContract } from '@/lib/api/contracts/inbox'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { hasInboxAccess } from '@/lib/billing/core/subscription'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkWorkspaceAccess, getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export const GET = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(listInboxTasksContract, req, context)
    if (!parsed.success) return parsed.response

    const { id: workspaceId } = parsed.data.params
    const [access, permission] = await Promise.all([
      checkWorkspaceAccess(workspaceId, session.user.id),
      getUserEntityPermissions(session.user.id, 'workspace', workspaceId),
    ])
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }
    if (!permission) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }

    const hasAccess = await hasInboxAccess(session.user.id)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Sim Mailer requires a Max plan' }, { status: 403 })
    }

    const { cursor } = parsed.data.query
    const status = parsed.data.query.status ?? 'all'
    const limit = parsed.data.query.limit ?? 20

    const conditions = [eq(mothershipInboxTask.workspaceId, workspaceId)]

    if (status !== 'all') {
      conditions.push(eq(mothershipInboxTask.status, status))
    }

    if (cursor) {
      const cursorDate = new Date(cursor)
      if (Number.isNaN(cursorDate.getTime())) {
        return NextResponse.json({ error: 'Invalid cursor value' }, { status: 400 })
      }
      conditions.push(lt(mothershipInboxTask.createdAt, cursorDate))
    }

    const tasks = await db
      .select({
        id: mothershipInboxTask.id,
        fromEmail: mothershipInboxTask.fromEmail,
        fromName: mothershipInboxTask.fromName,
        subject: mothershipInboxTask.subject,
        bodyPreview: mothershipInboxTask.bodyPreview,
        status: mothershipInboxTask.status,
        hasAttachments: mothershipInboxTask.hasAttachments,
        resultSummary: mothershipInboxTask.resultSummary,
        errorMessage: mothershipInboxTask.errorMessage,
        rejectionReason: mothershipInboxTask.rejectionReason,
        chatId: mothershipInboxTask.chatId,
        createdAt: mothershipInboxTask.createdAt,
        completedAt: mothershipInboxTask.completedAt,
      })
      .from(mothershipInboxTask)
      .where(and(...conditions))
      .orderBy(desc(mothershipInboxTask.createdAt))
      .limit(limit + 1) // Fetch one extra to determine hasMore

    const hasMore = tasks.length > limit
    const resultTasks = hasMore ? tasks.slice(0, limit) : tasks
    const nextCursor =
      hasMore && resultTasks.length > 0
        ? resultTasks[resultTasks.length - 1].createdAt.toISOString()
        : null

    return NextResponse.json({
      tasks: resultTasks,
      pagination: {
        limit,
        hasMore,
        nextCursor,
      },
    })
  }
)
