import { db } from '@sim/db'
import {
  workflow,
  workflowPublicationScope,
  workgroup,
  workgroupMember,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { and, asc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import type {
  PublishedWorkflowCatalogItem,
  WorkflowPublication,
  WorkflowTracksResponse,
} from '@/lib/api/contracts/workflows'
import {
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { deduplicateWorkflowName } from '@/lib/workflows/utils'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowPublication')

type WorkflowRow = typeof workflow.$inferSelect

type WorkflowListRow = {
  id: string
  name: string
  description: string | null
  color: string
  workspaceId: string | null
  folderId: string | null
  sortOrder: number
  track: 'draft' | 'published'
  visibility: 'workspace' | 'organization' | 'selected_workgroups'
  sourceWorkflowId: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  locked: boolean
}

function mapWorkflowListRow(row: {
  id: string
  name: string
  description: string | null
  color: string
  workspaceId: string | null
  folderId: string | null
  sortOrder: number
  track: string
  visibility: string
  sourceWorkflowId: string | null
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
  locked: boolean
}): WorkflowListRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    workspaceId: row.workspaceId,
    folderId: row.folderId,
    sortOrder: row.sortOrder,
    track: row.track as WorkflowListRow['track'],
    visibility: row.visibility as WorkflowListRow['visibility'],
    sourceWorkflowId: row.sourceWorkflowId,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    locked: row.locked,
  }
}

function mapPublishedWorkflowCatalogRow(row: {
  id: string
  name: string
  description: string | null
  color: string
  track: string
  visibility: string
  publishedAt: Date | null
  workspaceName: string
}): PublishedWorkflowCatalogItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    track: row.track as PublishedWorkflowCatalogItem['track'],
    visibility: row.visibility as PublishedWorkflowCatalogItem['visibility'],
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    workspaceName: row.workspaceName,
  }
}

async function assertWorkspaceReadAccess(userId: string, workspaceId: string): Promise<void> {
  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    throw new Error('Access denied to workspace')
  }
}

async function assertWorkgroupMembership(userId: string, workgroupId: string): Promise<void> {
  const [membership] = await db
    .select({
      id: workgroupMember.id,
    })
    .from(workgroupMember)
    .where(and(eq(workgroupMember.userId, userId), eq(workgroupMember.workgroupId, workgroupId)))
    .limit(1)

  if (!membership) {
    throw new Error('Access denied to workgroup')
  }
}

async function getWorkflowPublicationScopeIds(workflowId: string): Promise<string[]> {
  const rows = await db
    .select({ viewerWorkgroupId: workflowPublicationScope.viewerWorkgroupId })
    .from(workflowPublicationScope)
    .where(eq(workflowPublicationScope.workflowId, workflowId))

  return rows.map((row) => row.viewerWorkgroupId)
}

function emptyWorkflowState(): WorkflowState {
  return {
    blocks: {},
    edges: [],
    loops: {},
    parallels: {},
    lastSaved: Date.now(),
  }
}

async function loadSourceWorkflowState(workflowId: string): Promise<WorkflowState> {
  const normalizedState = await loadWorkflowFromNormalizedTables(workflowId)
  if (!normalizedState) {
    return emptyWorkflowState()
  }

  return {
    blocks: normalizedState.blocks,
    edges: normalizedState.edges,
    loops: normalizedState.loops,
    parallels: normalizedState.parallels,
    lastSaved: Date.now(),
  }
}

async function upsertPublicationScope(params: {
  publishedWorkflowId: string
  visibility: WorkflowRow['visibility']
  viewerWorkgroupIds: string[]
  userId: string
}): Promise<void> {
  await db
    .delete(workflowPublicationScope)
    .where(eq(workflowPublicationScope.workflowId, params.publishedWorkflowId))

  if (params.visibility !== 'selected_workgroups') {
    return
  }

  const uniqueViewerIds = [...new Set(params.viewerWorkgroupIds)]
  if (uniqueViewerIds.length === 0) {
    return
  }

  await db.insert(workflowPublicationScope).values(
    uniqueViewerIds.map((viewerWorkgroupId) => ({
      id: generateId(),
      workflowId: params.publishedWorkflowId,
      viewerWorkgroupId,
      createdBy: params.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
}

export async function listWorkflowTracksForWorkspace(params: {
  workspaceId: string
  userId: string
}): Promise<WorkflowTracksResponse> {
  await assertWorkspaceReadAccess(params.userId, params.workspaceId)

  const rows = await db
    .select({
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
    })
    .from(workflow)
    .where(and(eq(workflow.workspaceId, params.workspaceId), isNull(workflow.archivedAt)))
    .orderBy(asc(workflow.track), asc(workflow.sortOrder), asc(workflow.createdAt))

  const mappedRows = rows.map(mapWorkflowListRow)

  return {
    drafts: mappedRows.filter((row) => row.track === 'draft'),
    published: mappedRows.filter((row) => row.track === 'published'),
  }
}

export async function publishWorkflowToMainline(params: {
  workflowId: string
  userId: string
  name?: string
  visibility: WorkflowRow['visibility']
  viewerWorkgroupIds: string[]
}): Promise<WorkflowListRow> {
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId: params.workflowId,
    userId: params.userId,
    action: 'publish',
  })

  if (!authorization.allowed || !authorization.workflow) {
    throw new Error(authorization.message || 'Access denied')
  }
  if (authorization.accessSource !== 'workspace') {
    throw new Error('Canvas access required')
  }

  const sourceWorkflow = authorization.workflow
  if (sourceWorkflow.track !== 'draft') {
    throw new Error('Only draft workflows can be published')
  }

  if (!sourceWorkflow.workspaceId) {
    throw new Error('Draft workflow must belong to a canvas')
  }

  if (
    params.visibility !== 'workspace' &&
    (authorization.workspaceMode !== 'organization' || !authorization.workspaceWorkgroupId)
  ) {
    throw new Error('Only organization team canvases with a workgroup can publish across teams')
  }

  const state = await loadSourceWorkflowState(sourceWorkflow.id)
  const now = new Date()

  const [existingPublishedWorkflow] = await db
    .select()
    .from(workflow)
    .where(
      and(
        eq(workflow.sourceWorkflowId, sourceWorkflow.id),
        eq(workflow.track, 'published'),
        isNull(workflow.archivedAt)
      )
    )
    .limit(1)

  let publishedWorkflowId = existingPublishedWorkflow?.id ?? null
  let publishedWorkflowName = existingPublishedWorkflow?.name ?? null

  if (!publishedWorkflowId) {
    publishedWorkflowId = generateId()
    const requestedName = params.name?.trim() || `${sourceWorkflow.name} (Published)`
    publishedWorkflowName = await deduplicateWorkflowName(
      requestedName,
      sourceWorkflow.workspaceId,
      sourceWorkflow.folderId
    )

    await db.insert(workflow).values({
      id: publishedWorkflowId,
      userId: sourceWorkflow.userId,
      workspaceId: sourceWorkflow.workspaceId,
      folderId: sourceWorkflow.folderId,
      sortOrder: sourceWorkflow.sortOrder,
      name: publishedWorkflowName,
      description: sourceWorkflow.description,
      color: sourceWorkflow.color,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      track: 'published',
      visibility: params.visibility,
      sourceWorkflowId: sourceWorkflow.id,
      publishedAt: now,
      publishedBy: params.userId,
      isDeployed: sourceWorkflow.isDeployed,
      deployedAt: sourceWorkflow.deployedAt,
      isPublicApi: sourceWorkflow.isPublicApi,
      locked: sourceWorkflow.locked,
      runCount: 0,
      lastRunAt: null,
      variables: sourceWorkflow.variables,
      archivedAt: null,
    })
  } else {
    const requestedName = params.name?.trim() || publishedWorkflowName || sourceWorkflow.name
    const updatedName = await deduplicateWorkflowName(
      requestedName,
      sourceWorkflow.workspaceId,
      sourceWorkflow.folderId,
      { excludeWorkflowId: publishedWorkflowId }
    )
    await db
      .update(workflow)
      .set({
        name: updatedName,
        description: sourceWorkflow.description,
        color: sourceWorkflow.color,
        sortOrder: sourceWorkflow.sortOrder,
        folderId: sourceWorkflow.folderId,
        visibility: params.visibility,
        publishedAt: now,
        publishedBy: params.userId,
        lastSynced: now,
        updatedAt: now,
        variables: sourceWorkflow.variables,
      })
      .where(eq(workflow.id, publishedWorkflowId))
    publishedWorkflowName = updatedName
  }

  await saveWorkflowToNormalizedTables(publishedWorkflowId, state)
  await upsertPublicationScope({
    publishedWorkflowId,
    visibility: params.visibility,
    viewerWorkgroupIds: params.viewerWorkgroupIds,
    userId: params.userId,
  })

  const [publishedWorkflow] = await db
    .select({
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
    })
    .from(workflow)
    .where(eq(workflow.id, publishedWorkflowId))
    .limit(1)

  if (!publishedWorkflow) {
    throw new Error('Published workflow was not found after publish')
  }

  logger.info('Published draft workflow to mainline', {
    sourceWorkflowId: sourceWorkflow.id,
    publishedWorkflowId,
    visibility: params.visibility,
  })

  return mapWorkflowListRow(publishedWorkflow)
}

export async function syncWorkflowMainlineContent(params: {
  workflowId: string
  userId: string
}): Promise<WorkflowListRow> {
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId: params.workflowId,
    userId: params.userId,
    action: 'publish',
  })

  if (!authorization.allowed || !authorization.workflow) {
    throw new Error(authorization.message || 'Access denied')
  }
  if (authorization.accessSource !== 'workspace') {
    throw new Error('Canvas access required')
  }

  const sourceWorkflow = authorization.workflow
  if (sourceWorkflow.track !== 'draft') {
    throw new Error('Only draft workflows can update mainline content')
  }

  if (!sourceWorkflow.workspaceId) {
    throw new Error('Draft workflow must belong to a canvas')
  }

  if (authorization.workspaceMode !== 'organization' || !authorization.workspaceWorkgroupId) {
    throw new Error('Only organization team canvases with a workgroup can update mainline content')
  }

  const [existingPublishedWorkflow] = await db
    .select()
    .from(workflow)
    .where(
      and(
        eq(workflow.sourceWorkflowId, sourceWorkflow.id),
        eq(workflow.track, 'published'),
        isNull(workflow.archivedAt)
      )
    )
    .limit(1)

  if (!existingPublishedWorkflow) {
    throw new Error('Mainline publication not found')
  }

  const state = await loadSourceWorkflowState(sourceWorkflow.id)
  const now = new Date()

  await db
    .update(workflow)
    .set({
      lastSynced: now,
      publishedAt: now,
      publishedBy: params.userId,
      updatedAt: now,
      variables: sourceWorkflow.variables,
      isDeployed: sourceWorkflow.isDeployed,
      deployedAt: sourceWorkflow.deployedAt,
      isPublicApi: sourceWorkflow.isPublicApi,
      locked: sourceWorkflow.locked,
    })
    .where(eq(workflow.id, existingPublishedWorkflow.id))

  await saveWorkflowToNormalizedTables(existingPublishedWorkflow.id, state)

  const [publishedWorkflow] = await db
    .select({
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
    })
    .from(workflow)
    .where(eq(workflow.id, existingPublishedWorkflow.id))
    .limit(1)

  if (!publishedWorkflow) {
    throw new Error('Published workflow was not found after sync')
  }

  logger.info('Synced draft workflow content to mainline', {
    sourceWorkflowId: sourceWorkflow.id,
    publishedWorkflowId: existingPublishedWorkflow.id,
  })

  return mapWorkflowListRow(publishedWorkflow)
}

export async function getWorkflowPublicationDetails(params: {
  workflowId: string
  userId: string
}): Promise<WorkflowPublication> {
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId: params.workflowId,
    userId: params.userId,
    action: 'read',
  })

  if (!authorization.allowed || !authorization.workflow) {
    throw new Error(authorization.message || 'Access denied')
  }

  const currentWorkflow = authorization.workflow
  const includeWorkspaceOnlyFields = authorization.accessSource === 'workspace'
  const publishedWorkflowId =
    currentWorkflow.track === 'published'
      ? currentWorkflow.id
      : ((
          await db
            .select({ id: workflow.id })
            .from(workflow)
            .where(
              and(
                eq(workflow.sourceWorkflowId, currentWorkflow.id),
                eq(workflow.track, 'published'),
                isNull(workflow.archivedAt)
              )
            )
            .limit(1)
        )[0]?.id ?? null)

  const publicationWorkflowId =
    currentWorkflow.track === 'published' ? currentWorkflow.id : publishedWorkflowId
  const viewerWorkgroupIds =
    includeWorkspaceOnlyFields && publicationWorkflowId
      ? await getWorkflowPublicationScopeIds(publicationWorkflowId)
      : []

  return {
    workflowId: currentWorkflow.id,
    track: currentWorkflow.track,
    visibility: currentWorkflow.track === 'published' ? currentWorkflow.visibility : 'workspace',
    sourceWorkflowId: includeWorkspaceOnlyFields
      ? (currentWorkflow.sourceWorkflowId ?? null)
      : null,
    publishedWorkflowId,
    publishedAt:
      currentWorkflow.track === 'published'
        ? (currentWorkflow.publishedAt?.toISOString() ?? null)
        : publicationWorkflowId
          ? ((
              await db
                .select({ publishedAt: workflow.publishedAt, publishedBy: workflow.publishedBy })
                .from(workflow)
                .where(eq(workflow.id, publicationWorkflowId))
                .limit(1)
            )[0]?.publishedAt?.toISOString() ?? null)
          : null,
    publishedBy: includeWorkspaceOnlyFields
      ? currentWorkflow.track === 'published'
        ? (currentWorkflow.publishedBy ?? null)
        : publicationWorkflowId
          ? ((
              await db
                .select({ publishedAt: workflow.publishedAt, publishedBy: workflow.publishedBy })
                .from(workflow)
                .where(eq(workflow.id, publicationWorkflowId))
                .limit(1)
            )[0]?.publishedBy ?? null)
          : null
      : null,
    viewerScopes: viewerWorkgroupIds.map((workgroupId) => ({ workgroupId })),
  }
}

export async function updateWorkflowPublicationDetails(params: {
  workflowId: string
  userId: string
  visibility: WorkflowRow['visibility']
  viewerWorkgroupIds: string[]
}): Promise<WorkflowPublication> {
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId: params.workflowId,
    userId: params.userId,
    action: 'publish',
  })

  if (!authorization.allowed || !authorization.workflow) {
    throw new Error(authorization.message || 'Access denied')
  }
  if (authorization.accessSource !== 'workspace') {
    throw new Error('Canvas access required')
  }

  if (authorization.workflow.track !== 'published') {
    throw new Error('Publication settings can only be updated on published workflows')
  }

  if (
    params.visibility !== 'workspace' &&
    (authorization.workspaceMode !== 'organization' || !authorization.workspaceWorkgroupId)
  ) {
    throw new Error('Only organization team canvases with a workgroup can publish across teams')
  }

  await db
    .update(workflow)
    .set({
      visibility: params.visibility,
      updatedAt: new Date(),
    })
    .where(eq(workflow.id, params.workflowId))

  await upsertPublicationScope({
    publishedWorkflowId: params.workflowId,
    visibility: params.visibility,
    viewerWorkgroupIds: params.viewerWorkgroupIds,
    userId: params.userId,
  })

  return getWorkflowPublicationDetails({
    workflowId: params.workflowId,
    userId: params.userId,
  })
}

export async function listPublishedWorkflowsForWorkgroup(params: {
  workgroupId: string
  userId: string
}): Promise<PublishedWorkflowCatalogItem[]> {
  await assertWorkgroupMembership(params.userId, params.workgroupId)

  const [workgroupRow] = await db
    .select({ organizationId: workgroup.organizationId })
    .from(workgroup)
    .where(eq(workgroup.id, params.workgroupId))
    .limit(1)

  if (!workgroupRow) {
    throw new Error('Workgroup not found')
  }

  const scopedWorkflowRows = await db
    .select({ workflowId: workflowPublicationScope.workflowId })
    .from(workflowPublicationScope)
    .where(eq(workflowPublicationScope.viewerWorkgroupId, params.workgroupId))

  const scopedWorkflowIds = new Set(scopedWorkflowRows.map((row) => row.workflowId))

  const rows = await db
    .select({
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
      workspaceName: workspace.name,
      ownerWorkgroupId: workspace.workgroupId,
    })
    .from(workflow)
    .innerJoin(workspace, eq(workflow.workspaceId, workspace.id))
    .where(
      and(
        eq(workflow.track, 'published'),
        isNull(workflow.archivedAt),
        isNull(workspace.archivedAt),
        eq(workspace.workspaceMode, 'organization'),
        isNotNull(workspace.workgroupId),
        eq(workspace.organizationId, workgroupRow.organizationId),
        or(
          eq(workspace.workgroupId, params.workgroupId),
          eq(workflow.visibility, 'organization'),
          scopedWorkflowIds.size > 0 ? inArray(workflow.id, [...scopedWorkflowIds]) : undefined
        )
      )
    )
    .orderBy(asc(workflow.sortOrder), asc(workflow.createdAt))

  return rows
    .filter((row) => {
      if (row.ownerWorkgroupId === params.workgroupId) {
        return true
      }

      if (row.visibility === 'organization') {
        return true
      }

      return row.visibility === 'selected_workgroups' && scopedWorkflowIds.has(row.id)
    })
    .map((row) => mapPublishedWorkflowCatalogRow(row))
}
