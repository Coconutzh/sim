import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { templates, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  checkWorkspacePublishedTemplatesContract,
  deleteWorkspaceContract,
  getWorkspaceContract,
  updateWorkspaceContract,
} from '@/lib/api/contracts/workspaces'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { annotateWorkspaceCanvasMetadata } from '@/lib/workspaces/canvas-metadata'
import { archiveWorkspace } from '@/lib/workspaces/lifecycle'
import {
  checkWorkspaceAccess,
  getUserEntityPermissions,
  hasAdminPermission,
  listAccessibleWorkspaceIds,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceByIdAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const checkTemplates = url.searchParams.get('check-templates') === 'true'
    const contract = checkTemplates
      ? checkWorkspacePublishedTemplatesContract
      : getWorkspaceContract
    const parsed = await parseRequest(contract, request, context)
    if (!parsed.success) return parsed.response

    const workspaceId = parsed.data.params.id

    // Check if user has any access to this workspace
    const access = await checkWorkspaceAccess(workspaceId, session.user.id)
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }

    const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (!userPermission) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }

    // If checking for published templates before deletion
    if (checkTemplates) {
      try {
        // Get all workflows in this workspace
        const workspaceWorkflows = await db
          .select({ id: workflow.id })
          .from(workflow)
          .where(eq(workflow.workspaceId, workspaceId))

        if (workspaceWorkflows.length === 0) {
          return NextResponse.json({
            hasPublishedTemplates: false,
            publishedTemplates: [],
            count: 0,
          })
        }

        const workflowIds = workspaceWorkflows.map((w) => w.id)

        // Check for published templates that reference these workflows
        const publishedTemplates = await db
          .select({
            id: templates.id,
            name: templates.name,
            workflowId: templates.workflowId,
          })
          .from(templates)
          .where(inArray(templates.workflowId, workflowIds))

        return NextResponse.json({
          hasPublishedTemplates: publishedTemplates.length > 0,
          publishedTemplates,
          count: publishedTemplates.length,
        })
      } catch (error) {
        logger.error(`Error checking published templates for workspace ${workspaceId}:`, error)
        return NextResponse.json({ error: 'Failed to check published templates' }, { status: 500 })
      }
    }

    // Get workspace details
    const workspaceDetails = await db
      .select()
      .from(workspace)
      .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
      .then((rows) => rows[0])

    if (!workspaceDetails) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }

    const [workspaceWithMetadata] = await annotateWorkspaceCanvasMetadata([
      {
        ...workspaceDetails,
        id: workspaceDetails.id,
        workgroupId: workspaceDetails.workgroupId,
        permissions: userPermission,
      },
    ])

    return NextResponse.json({ workspace: workspaceWithMetadata })
  }
)

export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(updateWorkspaceContract, request, context)
    if (!parsed.success) return parsed.response

    const workspaceId = parsed.data.params.id

    const access = await checkWorkspaceAccess(workspaceId, session.user.id)
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }

    // Check if user has admin permissions to update workspace
    const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (userPermission !== 'admin') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    try {
      const body = parsed.data.body
      const { name, color, logoUrl, billedAccountUserId, allowPersonalApiKeys } = body

      if (
        name === undefined &&
        color === undefined &&
        logoUrl === undefined &&
        billedAccountUserId === undefined &&
        allowPersonalApiKeys === undefined
      ) {
        return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
      }

      const existingWorkspace = await db
        .select()
        .from(workspace)
        .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
        .then((rows) => rows[0])

      if (!existingWorkspace) {
        return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
      }

      const updateData: Record<string, unknown> = {}

      if (name !== undefined) {
        updateData.name = name
      }

      if (color !== undefined) {
        updateData.color = color
      }

      if (logoUrl !== undefined) {
        updateData.logoUrl = logoUrl
      }

      if (allowPersonalApiKeys !== undefined) {
        updateData.allowPersonalApiKeys = Boolean(allowPersonalApiKeys)
      }

      if (billedAccountUserId !== undefined) {
        if (
          existingWorkspace.organizationId &&
          existingWorkspace.workspaceMode === 'organization'
        ) {
          return NextResponse.json(
            {
              error:
                'Organization canvases use organization billing and cannot change billed account.',
            },
            { status: 400 }
          )
        }

        if (existingWorkspace.workspaceMode === 'personal') {
          return NextResponse.json(
            {
              error:
                'Personal canvases are always billed to their owner and cannot change billed account.',
            },
            { status: 400 }
          )
        }

        const candidateId = billedAccountUserId

        const isOwner = candidateId === existingWorkspace.ownerId

        const hasAdminAccess = isOwner || (await hasAdminPermission(candidateId, workspaceId))

        if (!hasAdminAccess) {
          return NextResponse.json(
            { error: 'Billed account must be a canvas admin' },
            { status: 400 }
          )
        }

        updateData.billedAccountUserId = candidateId
      }

      if (Object.keys(updateData).length === 0) {
        return NextResponse.json({ error: 'No valid updates provided' }, { status: 400 })
      }

      updateData.updatedAt = new Date()

      await db.update(workspace).set(updateData).where(eq(workspace.id, workspaceId))

      const updatedWorkspace = await db
        .select()
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .then((rows) => rows[0])

      if (!updatedWorkspace) {
        return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
      }

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.WORKSPACE_UPDATED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: workspaceId,
        resourceName: updatedWorkspace?.name ?? existingWorkspace.name,
        description: `Updated canvas "${updatedWorkspace?.name ?? existingWorkspace.name}"`,
        metadata: {
          changes: {
            ...(name !== undefined && { name: { from: existingWorkspace.name, to: name } }),
            ...(color !== undefined && { color: { from: existingWorkspace.color, to: color } }),
            ...(logoUrl !== undefined && {
              logoUrl: { from: existingWorkspace.logoUrl, to: logoUrl },
            }),
            ...(allowPersonalApiKeys !== undefined && {
              allowPersonalApiKeys: {
                from: existingWorkspace.allowPersonalApiKeys,
                to: allowPersonalApiKeys,
              },
            }),
            ...(billedAccountUserId !== undefined && {
              billedAccountUserId: {
                from: existingWorkspace.billedAccountUserId,
                to: billedAccountUserId,
              },
            }),
          },
        },
        request,
      })

      const [workspaceWithMetadata] = await annotateWorkspaceCanvasMetadata([
        {
          ...updatedWorkspace,
          id: updatedWorkspace.id,
          workgroupId: updatedWorkspace.workgroupId,
          permissions: userPermission,
        },
      ])

      return NextResponse.json({ workspace: workspaceWithMetadata })
    } catch (error) {
      logger.error('Error updating workspace:', error)
      return NextResponse.json({ error: 'Failed to update canvas' }, { status: 500 })
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(deleteWorkspaceContract, request, context)
    if (!parsed.success) return parsed.response

    const workspaceId = parsed.data.params.id
    const { deleteTemplates } = parsed.data.body

    const access = await checkWorkspaceAccess(workspaceId, session.user.id)
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }

    // Check if user has admin permissions to delete workspace
    const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (userPermission !== 'admin') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    try {
      const [accessibleWorkspaceIds, [workspaceRecord]] = await Promise.all([
        listAccessibleWorkspaceIds(session.user.id),
        db
          .select({ name: workspace.name })
          .from(workspace)
          .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
          .limit(1),
      ])

      /** Counts all active workspace memberships including owner-only workspaces. */
      if (accessibleWorkspaceIds.length <= 1) {
        return NextResponse.json({ error: 'Cannot delete the only canvas' }, { status: 400 })
      }

      logger.info(
        `Deleting workspace ${workspaceId} for user ${session.user.id}, deleteTemplates: ${deleteTemplates}`
      )

      const workspaceWorkflows = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.workspaceId, workspaceId))

      const workflowIds = workspaceWorkflows.map((entry) => entry.id)

      if (workflowIds.length > 0) {
        if (deleteTemplates) {
          await db.delete(templates).where(inArray(templates.workflowId, workflowIds))
        } else {
          await db
            .update(templates)
            .set({ workflowId: null })
            .where(inArray(templates.workflowId, workflowIds))
        }
      }

      const archiveResult = await archiveWorkspace(workspaceId, {
        requestId: `workspace-${workspaceId}`,
      })

      if (!archiveResult.archived && !workspaceRecord) {
        return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
      }

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.WORKSPACE_DELETED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: workspaceId,
        resourceName: workspaceRecord?.name,
        description: `Archived canvas "${workspaceRecord?.name || workspaceId}"`,
        metadata: {
          affected: {
            workflows: workflowIds.length,
          },
          archived: archiveResult.archived,
          deleteTemplates,
        },
        request,
      })

      captureServerEvent(
        session.user.id,
        'workspace_deleted',
        { workspace_id: workspaceId, workflow_count: workflowIds.length },
        { groups: { workspace: workspaceId } }
      )

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error(`Error deleting workspace ${workspaceId}:`, error)
      return NextResponse.json({ error: 'Failed to delete canvas' }, { status: 500 })
    }
  }
)

export const PUT = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    // Reuse the PATCH handler implementation for PUT requests
    return PATCH(request, { params })
  }
)
