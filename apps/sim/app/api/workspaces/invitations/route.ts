import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listInvitationsForWorkspaces } from '@/lib/invitations/core'
import { listAccessibleWorkspaceIds } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceInvitationsAPI')

export const GET = withRouteHandler(async (req: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const workspaceIds = await listAccessibleWorkspaceIds(session.user.id)

    if (workspaceIds.length === 0) {
      return NextResponse.json({ invitations: [] })
    }

    const activeWorkspaceIds = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(isNull(workspace.archivedAt))
      .then((rows) => rows.map((row) => row.id).filter((id) => workspaceIds.includes(id)))

    if (activeWorkspaceIds.length === 0) {
      return NextResponse.json({ invitations: [] })
    }

    const invitations = await listInvitationsForWorkspaces(activeWorkspaceIds)
    return NextResponse.json({ invitations })
  } catch (error) {
    logger.error('Error fetching workspace invitations:', error)
    return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 })
  }
})
