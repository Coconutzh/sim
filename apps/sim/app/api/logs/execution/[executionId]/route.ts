import { db } from '@sim/db'
import {
  jobExecutionLogs,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getExecutionSnapshotContract } from '@/lib/api/contracts/logs'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { TraceSpan, WorkflowExecutionLog } from '@/lib/logs/types'
import { listAccessibleWorkspaceIds } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('LogsByExecutionIdAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ executionId: string }> }) => {
    const requestId = generateRequestId()

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        logger.warn(`[${requestId}] Unauthorized execution data access attempt`)
        return NextResponse.json(
          { error: authResult.error || 'Authentication required' },
          { status: 401 }
        )
      }

      const parsed = await parseRequest(getExecutionSnapshotContract, request, { params })
      if (!parsed.success) return parsed.response

      const { executionId } = parsed.data.params
      const authenticatedUserId = authResult.userId
      const accessibleWorkspaceIds = await listAccessibleWorkspaceIds(authenticatedUserId)

      if (accessibleWorkspaceIds.length === 0) {
        logger.warn(`[${requestId}] Execution not found or access denied: ${executionId}`)
        return NextResponse.json({ error: 'Workflow execution not found' }, { status: 404 })
      }

      const [workflowLog] = await db
        .select({
          id: workflowExecutionLogs.id,
          workflowId: workflowExecutionLogs.workflowId,
          executionId: workflowExecutionLogs.executionId,
          stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
          trigger: workflowExecutionLogs.trigger,
          startedAt: workflowExecutionLogs.startedAt,
          endedAt: workflowExecutionLogs.endedAt,
          totalDurationMs: workflowExecutionLogs.totalDurationMs,
          cost: workflowExecutionLogs.cost,
          executionData: workflowExecutionLogs.executionData,
        })
        .from(workflowExecutionLogs)
        .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
        .where(
          and(
            eq(workflowExecutionLogs.executionId, executionId),
            inArray(workflowExecutionLogs.workspaceId, accessibleWorkspaceIds)
          )
        )
        .limit(1)

      // Fallback: check job_execution_logs
      if (!workflowLog) {
        const [jobLog] = await db
          .select({
            id: jobExecutionLogs.id,
            executionId: jobExecutionLogs.executionId,
            trigger: jobExecutionLogs.trigger,
            startedAt: jobExecutionLogs.startedAt,
            endedAt: jobExecutionLogs.endedAt,
            totalDurationMs: jobExecutionLogs.totalDurationMs,
            cost: jobExecutionLogs.cost,
            executionData: jobExecutionLogs.executionData,
          })
          .from(jobExecutionLogs)
          .where(
            and(
              eq(jobExecutionLogs.executionId, executionId),
              inArray(jobExecutionLogs.workspaceId, accessibleWorkspaceIds)
            )
          )
          .limit(1)

        if (!jobLog) {
          logger.warn(`[${requestId}] Execution not found or access denied: ${executionId}`)
          return NextResponse.json({ error: 'Workflow execution not found' }, { status: 404 })
        }

        return NextResponse.json({
          executionId,
          workflowId: null,
          workflowState: null,
          childWorkflowSnapshots: {},
          executionMetadata: {
            trigger: jobLog.trigger,
            startedAt: jobLog.startedAt.toISOString(),
            endedAt: jobLog.endedAt?.toISOString(),
            totalDurationMs: jobLog.totalDurationMs,
            cost: jobLog.cost || null,
          },
        })
      }

      const [snapshot] = await db
        .select()
        .from(workflowExecutionSnapshots)
        .where(eq(workflowExecutionSnapshots.id, workflowLog.stateSnapshotId))
        .limit(1)

      if (!snapshot) {
        logger.warn(
          `[${requestId}] Workflow state snapshot not found for execution: ${executionId}`
        )
        return NextResponse.json({ error: 'Workflow state snapshot not found' }, { status: 404 })
      }

      const executionData = workflowLog.executionData as WorkflowExecutionLog['executionData']
      const traceSpans = (executionData?.traceSpans as TraceSpan[]) || []
      const childSnapshotIds = new Set<string>()
      const collectSnapshotIds = (spans: TraceSpan[]) => {
        spans.forEach((span) => {
          const snapshotId = span.childWorkflowSnapshotId
          if (typeof snapshotId === 'string') {
            childSnapshotIds.add(snapshotId)
          }
          if (span.children?.length) {
            collectSnapshotIds(span.children)
          }
        })
      }
      if (traceSpans.length > 0) {
        collectSnapshotIds(traceSpans)
      }

      const childWorkflowSnapshots =
        childSnapshotIds.size > 0
          ? await db
              .select()
              .from(workflowExecutionSnapshots)
              .where(inArray(workflowExecutionSnapshots.id, Array.from(childSnapshotIds)))
          : []

      const childSnapshotMap = childWorkflowSnapshots.reduce<Record<string, unknown>>(
        (acc, snap) => {
          acc[snap.id] = snap.stateData
          return acc
        },
        {}
      )

      const response = {
        executionId,
        workflowId: workflowLog.workflowId,
        workflowState: snapshot.stateData,
        childWorkflowSnapshots: childSnapshotMap,
        executionMetadata: {
          trigger: workflowLog.trigger,
          startedAt: workflowLog.startedAt.toISOString(),
          endedAt: workflowLog.endedAt?.toISOString(),
          totalDurationMs: workflowLog.totalDurationMs,
          cost: workflowLog.cost || null,
        },
      }

      return NextResponse.json(response)
    } catch (error) {
      logger.error(`[${requestId}] Error fetching execution data:`, error)
      return NextResponse.json({ error: 'Failed to fetch execution data' }, { status: 500 })
    }
  }
)
