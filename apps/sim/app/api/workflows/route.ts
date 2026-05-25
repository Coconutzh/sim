import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workflow, workflowFolder } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { assertFolderMutable, FolderLockedError } from '@sim/workflow-authz'
import { and, asc, eq, inArray, isNull, min, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createWorkflowContract, listWorkflowsContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { deduplicateWorkflowName, getActiveFolderInWorkspace } from '@/lib/workflows/utils'
import {
  checkWorkspaceAccess,
  getUserEntityPermissions,
  getWorkspaceWithOwner,
  listAccessibleWorkspaceIds,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkflowAPI')

// GET /api/workflows - Get workflows for user (optionally filtered by workspaceId)
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  const startTime = Date.now()

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized workflow access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = auth.userId

    const parsed = await parseRequest(listWorkflowsContract, request, {})
    if (!parsed.success) return parsed.response
    const { workspaceId, scope } = parsed.data.query

    if (workspaceId) {
      const access = await checkWorkspaceAccess(workspaceId, userId)

      if (!access.exists) {
        logger.warn(
          `[${requestId}] Attempt to fetch workflows for non-existent workspace: ${workspaceId}`
        )
        return NextResponse.json(
          { error: 'Canvas not found', code: 'WORKSPACE_NOT_FOUND' },
          { status: 404 }
        )
      }

      if (!access.hasAccess) {
        logger.warn(
          `[${requestId}] User ${userId} attempted to access workspace ${workspaceId} without visibility`
        )
        return NextResponse.json(
          { error: 'Canvas not found', code: 'WORKSPACE_NOT_FOUND' },
          { status: 404 }
        )
      }
    }

    let workflows

    /**
     * Project only the columns declared in `workflowListItemSchema` so the
     * wire response matches the contract shape exactly. The full row is
     * larger (`state`, `variables`, `apiKey`, `runCount`, etc.) and would
     * be dropped client-side by Zod parse anyway — narrowing here saves
     * bytes over the wire. Keep this list aligned with the contract.
     */
    const listColumns = {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      color: workflow.color,
      workspaceId: workflow.workspaceId,
      folderId: workflow.folderId,
      sortOrder: workflow.sortOrder,
      track: workflow.track,
      visibility: workflow.visibility,
      sourceWorkflowId: workflow.sourceWorkflowId,
      publishedAt: workflow.publishedAt,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
      archivedAt: workflow.archivedAt,
      locked: workflow.locked,
    } as const
    const orderByClause = [asc(workflow.sortOrder), asc(workflow.createdAt), asc(workflow.id)]

    if (workspaceId) {
      workflows = await db
        .select(listColumns)
        .from(workflow)
        .where(
          scope === 'all'
            ? eq(workflow.workspaceId, workspaceId)
            : scope === 'archived'
              ? and(eq(workflow.workspaceId, workspaceId), sql`${workflow.archivedAt} IS NOT NULL`)
              : and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt))
        )
        .orderBy(...orderByClause)
    } else {
      const workspaceIds = await listAccessibleWorkspaceIds(userId)
      if (workspaceIds.length === 0) {
        return NextResponse.json({ data: [] }, { status: 200 })
      }
      workflows = await db
        .select(listColumns)
        .from(workflow)
        .where(
          scope === 'all'
            ? inArray(workflow.workspaceId, workspaceIds)
            : scope === 'archived'
              ? and(
                  inArray(workflow.workspaceId, workspaceIds),
                  sql`${workflow.archivedAt} IS NOT NULL`
                )
              : and(inArray(workflow.workspaceId, workspaceIds), isNull(workflow.archivedAt))
        )
        .orderBy(...orderByClause)
    }

    return NextResponse.json({ data: workflows }, { status: 200 })
  } catch (error: unknown) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Workflow fetch error after ${elapsed}ms`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

// POST /api/workflows - Create a new workflow
export const POST = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()
  const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized workflow creation attempt`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = auth.userId

  try {
    const parsed = await parseRequest(createWorkflowContract, req, {})
    if (!parsed.success) return parsed.response
    const {
      id: clientId,
      name: requestedName,
      description,
      color,
      workspaceId,
      folderId,
      sortOrder: providedSortOrder,
      deduplicate,
      track,
      visibility,
      sourceWorkflowId,
    } = parsed.data.body

    if (!workspaceId) {
      logger.warn(`[${requestId}] Workflow creation blocked: missing workspaceId`)
      return NextResponse.json(
        {
          error: 'Canvas ID is required. Personal workflows are deprecated and cannot be created.',
        },
        { status: 400 }
      )
    }

    const access = await checkWorkspaceAccess(workspaceId, userId)
    if (!access.exists || !access.hasAccess) {
      logger.warn(
        `[${requestId}] User ${userId} attempted to create workflow in hidden workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }

    const workspacePermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)

    if (!workspacePermission || workspacePermission === 'read') {
      logger.warn(
        `[${requestId}] User ${userId} attempted to create workflow in workspace ${workspaceId} without write permissions`
      )
      return NextResponse.json(
        { error: 'Write or Admin access required to create workflows in this canvas' },
        { status: 403 }
      )
    }

    const workspaceDetails = await getWorkspaceWithOwner(workspaceId)
    if (!workspaceDetails) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }

    if (
      visibility !== 'workspace' &&
      (workspaceDetails.workspaceMode !== 'organization' || !workspaceDetails.workgroupId)
    ) {
      return NextResponse.json(
        {
          error: 'Only organization team canvases with a workgroup can create cross-team workflows',
        },
        { status: 400 }
      )
    }

    if (track === 'published') {
      return NextResponse.json(
        {
          error: 'Published workflows must be created via the publish workflow flow',
        },
        { status: 400 }
      )
    }

    if (folderId) {
      const targetFolder = await getActiveFolderInWorkspace(folderId, workspaceId)
      if (!targetFolder) {
        return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
      }
      await assertFolderMutable(folderId)
    }

    const workflowId = clientId || generateId()
    const now = new Date()

    logger.info(`[${requestId}] Creating workflow ${workflowId} for user ${userId}`)

    let sortOrder: number
    if (providedSortOrder !== undefined) {
      sortOrder = providedSortOrder
    } else {
      const workflowParentCondition = folderId
        ? eq(workflow.folderId, folderId)
        : isNull(workflow.folderId)
      const folderParentCondition = folderId
        ? eq(workflowFolder.parentId, folderId)
        : isNull(workflowFolder.parentId)

      const [[workflowMinResult], [folderMinResult]] = await Promise.all([
        db
          .select({ minOrder: min(workflow.sortOrder) })
          .from(workflow)
          .where(
            and(
              eq(workflow.workspaceId, workspaceId),
              workflowParentCondition,
              isNull(workflow.archivedAt)
            )
          ),
        db
          .select({ minOrder: min(workflowFolder.sortOrder) })
          .from(workflowFolder)
          .where(and(eq(workflowFolder.workspaceId, workspaceId), folderParentCondition)),
      ])

      const minSortOrder = [workflowMinResult?.minOrder, folderMinResult?.minOrder].reduce<
        number | null
      >((currentMin, candidate) => {
        if (candidate == null) return currentMin
        if (currentMin == null) return candidate
        return Math.min(currentMin, candidate)
      }, null)

      sortOrder = minSortOrder != null ? minSortOrder - 1 : 0
    }

    let name = requestedName

    if (deduplicate) {
      name = await deduplicateWorkflowName(requestedName, workspaceId, folderId)
    } else {
      const duplicateConditions = [
        eq(workflow.workspaceId, workspaceId),
        isNull(workflow.archivedAt),
        eq(workflow.name, requestedName),
      ]

      if (folderId) {
        duplicateConditions.push(eq(workflow.folderId, folderId))
      } else {
        duplicateConditions.push(isNull(workflow.folderId))
      }

      const [duplicateWorkflow] = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(and(...duplicateConditions))
        .limit(1)

      if (duplicateWorkflow) {
        return NextResponse.json(
          { error: `A workflow named "${requestedName}" already exists in this folder` },
          { status: 409 }
        )
      }
    }

    import('@/lib/core/telemetry')
      .then(({ PlatformEvents }) => {
        PlatformEvents.workflowCreated({
          workflowId,
          name,
          workspaceId: workspaceId || undefined,
          folderId: folderId || undefined,
        })
      })
      .catch(() => {
        // Silently fail
      })

    const { workflowState, subBlockValues, startBlockId } = buildDefaultWorkflowArtifacts()

    await db.transaction(async (tx) => {
      await tx.insert(workflow).values({
        id: workflowId,
        userId,
        workspaceId,
        folderId: folderId || null,
        sortOrder,
        name,
        description,
        color,
        track,
        visibility,
        sourceWorkflowId: sourceWorkflowId || null,
        publishedAt: null,
        publishedBy: null,
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
        isDeployed: false,
        runCount: 0,
        variables: {},
      })

      await saveWorkflowToNormalizedTables(workflowId, workflowState, tx)
    })

    logger.info(`[${requestId}] Successfully created workflow ${workflowId} with default blocks`)

    captureServerEvent(
      userId,
      'workflow_created',
      { workflow_id: workflowId, workspace_id: workspaceId ?? '', name },
      {
        groups: workspaceId ? { workspace: workspaceId } : undefined,
        setOnce: { first_workflow_created_at: new Date().toISOString() },
      }
    )

    recordAudit({
      workspaceId,
      actorId: userId,
      actorName: auth.userName,
      actorEmail: auth.userEmail,
      action: AuditAction.WORKFLOW_CREATED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: workflowId,
      resourceName: name,
      description: `Created workflow "${name}"`,
      metadata: {
        name,
        description: description || undefined,
        color,
        workspaceId,
        folderId: folderId || undefined,
        sortOrder,
      },
      request: req,
    })

    return NextResponse.json({
      id: workflowId,
      name,
      description,
      color,
      workspaceId,
      folderId,
      sortOrder,
      track,
      visibility,
      sourceWorkflowId: sourceWorkflowId || null,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
      startBlockId,
      subBlockValues,
    })
  } catch (error) {
    if (error instanceof FolderLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    logger.error(`[${requestId}] Error creating workflow`, error)
    return NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 })
  }
})
