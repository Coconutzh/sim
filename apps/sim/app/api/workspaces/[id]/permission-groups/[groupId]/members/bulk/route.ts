import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { bulkAddPermissionGroupMembersContract } from '@/lib/api/contracts/permission-groups'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isWorkspaceOnEnterprisePlan } from '@/lib/billing'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { PERMISSION_GROUP_MEMBER_CONSTRAINTS } from '@/lib/permission-groups/types'
import {
  checkWorkspaceAccess,
  getUsersWithPermissions,
  hasWorkspaceAdminAccess,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspacePermissionGroupBulkMembers')

async function loadGroupInWorkspace(groupId: string, workspaceId: string) {
  const [group] = await db
    .select({
      id: permissionGroup.id,
      workspaceId: permissionGroup.workspaceId,
      name: permissionGroup.name,
    })
    .from(permissionGroup)
    .where(and(eq(permissionGroup.id, groupId), eq(permissionGroup.workspaceId, workspaceId)))
    .limit(1)

  return group ?? null
}

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string; groupId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const parsed = await parseRequest(bulkAddPermissionGroupMembersContract, req, context, {
        validationErrorResponse: (error) =>
          NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response

      const { id: workspaceId, groupId: id } = parsed.data.params
      const { userIds, addAllWorkspaceMembers } = parsed.data.body

      const access = await checkWorkspaceAccess(workspaceId, session.user.id)
      if (!access.exists || !access.hasAccess) {
        return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
      }
      if (access.workspace?.workspaceMode === 'personal') {
        return NextResponse.json(
          { error: 'Personal canvases do not support permission groups' },
          { status: 403 }
        )
      }

      const isWorkspaceAdmin = await hasWorkspaceAdminAccess(session.user.id, workspaceId)
      if (!isWorkspaceAdmin) {
        return NextResponse.json({ error: 'Admin permissions required' }, { status: 403 })
      }

      const entitled = await isWorkspaceOnEnterprisePlan(workspaceId)
      if (!entitled) {
        return NextResponse.json(
          { error: 'Access Control is an Enterprise feature' },
          { status: 403 }
        )
      }

      const group = await loadGroupInWorkspace(id, workspaceId)
      if (!group) {
        return NextResponse.json({ error: 'Permission group not found' }, { status: 404 })
      }

      let targetUserIds: string[] = []
      const workspaceMembers = await getUsersWithPermissions(workspaceId)
      const workspaceMemberIds = new Set(workspaceMembers.map((member) => member.userId))

      if (addAllWorkspaceMembers) {
        targetUserIds = Array.from(workspaceMemberIds)
      } else if (userIds && userIds.length > 0) {
        const uniqueUserIds = Array.from(new Set(userIds))
        targetUserIds = uniqueUserIds.filter((userId) => workspaceMemberIds.has(userId))
      }

      if (targetUserIds.length === 0) {
        return NextResponse.json({ added: 0, moved: 0 })
      }

      const { addedUserIds, movedCount } = await db.transaction(async (tx) => {
        const existingMemberships = await tx
          .select({
            id: permissionGroupMember.id,
            userId: permissionGroupMember.userId,
            permissionGroupId: permissionGroupMember.permissionGroupId,
          })
          .from(permissionGroupMember)
          .innerJoin(
            permissionGroup,
            eq(permissionGroupMember.permissionGroupId, permissionGroup.id)
          )
          .where(
            and(
              eq(permissionGroup.workspaceId, workspaceId),
              inArray(permissionGroupMember.userId, targetUserIds)
            )
          )

        const alreadyInThisGroup = new Set(
          existingMemberships.filter((m) => m.permissionGroupId === id).map((m) => m.userId)
        )
        const usersToAdd = targetUserIds.filter((uid) => !alreadyInThisGroup.has(uid))

        if (usersToAdd.length === 0) {
          return { addedUserIds: [] as string[], movedCount: 0 }
        }

        const membershipsToDelete = existingMemberships.filter(
          (m) => m.permissionGroupId !== id && usersToAdd.includes(m.userId)
        )

        if (membershipsToDelete.length > 0) {
          await tx.delete(permissionGroupMember).where(
            inArray(
              permissionGroupMember.id,
              membershipsToDelete.map((m) => m.id)
            )
          )
        }

        const newMembers = usersToAdd.map((userId) => ({
          id: generateId(),
          permissionGroupId: id,
          workspaceId,
          userId,
          assignedBy: session.user.id,
          assignedAt: new Date(),
        }))

        await tx.insert(permissionGroupMember).values(newMembers)

        return { addedUserIds: usersToAdd, movedCount: membershipsToDelete.length }
      })

      if (addedUserIds.length === 0) {
        return NextResponse.json({ added: 0, moved: 0 })
      }

      logger.info('Bulk added members to permission group', {
        permissionGroupId: id,
        workspaceId,
        addedCount: addedUserIds.length,
        movedCount,
        assignedBy: session.user.id,
      })

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        action: AuditAction.PERMISSION_GROUP_MEMBER_ADDED,
        resourceType: AuditResourceType.PERMISSION_GROUP,
        resourceId: id,
        resourceName: group.name,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        description: `Bulk added ${addedUserIds.length} member(s) to permission group "${group.name}"`,
        metadata: {
          permissionGroupId: id,
          addedUserIds,
          movedCount,
        },
        request: req,
      })

      return NextResponse.json({ added: addedUserIds.length, moved: movedCount })
    } catch (error) {
      if (getPostgresErrorCode(error) === '23505') {
        const constraint = getPostgresConstraintName(error)
        if (
          constraint === PERMISSION_GROUP_MEMBER_CONSTRAINTS.workspaceUser ||
          constraint === PERMISSION_GROUP_MEMBER_CONSTRAINTS.groupUser
        ) {
          return NextResponse.json(
            {
              error:
                'One or more users were concurrently added to a group in this canvas. Please refresh and try again.',
            },
            { status: 409 }
          )
        }
      }
      logger.error('Error bulk adding members to permission group', error)
      return NextResponse.json({ error: 'Failed to add members' }, { status: 500 })
    }
  }
)
