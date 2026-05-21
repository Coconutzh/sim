import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { workspaceParamsSchema } from '@/lib/api/contracts'
import { getValidationErrorMessage } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  checkWorkspaceAccess,
  getWorkspaceMemberProfiles,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceMembersAPI')

/**
 * GET /api/workspaces/[id]/members
 *
 * Returns lightweight member profiles (id, name, image) for a workspace.
 * Intended for UI display (avatars, owner cells) without the overhead of
 * full permission data.
 */
export const GET = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const paramsResult = workspaceParamsSchema.safeParse(await params)
      if (!paramsResult.success) {
        return NextResponse.json(
          { error: getValidationErrorMessage(paramsResult.error, 'Invalid route parameters') },
          { status: 400 }
        )
      }
      const { id: workspaceId } = paramsResult.data
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const access = await checkWorkspaceAccess(workspaceId, session.user.id)
      if (!access.exists || !access.hasAccess) {
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      }
      if (access.workspace?.workspaceMode === 'personal') {
        return NextResponse.json(
          { error: 'Personal workspaces do not expose shared member lists' },
          { status: 403 }
        )
      }

      const members = await getWorkspaceMemberProfiles(workspaceId)

      return NextResponse.json({ members })
    } catch (error) {
      logger.error('Error fetching workspace members:', error)
      return NextResponse.json({ error: 'Failed to fetch workspace members' }, { status: 500 })
    }
  }
)
