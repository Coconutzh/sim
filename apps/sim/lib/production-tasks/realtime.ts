import { db } from '@sim/db'
import { type productionTask, workflow, workgroup } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { inArray } from 'drizzle-orm'
import { env } from '@/lib/core/config/env'
import { getSocketServerUrl } from '@/lib/core/utils/urls'

const logger = createLogger('ProductionTaskRealtime')

type ProductionTaskRow = typeof productionTask.$inferSelect

export type ProductionTaskRealtimeEvent =
  | 'created'
  | 'updated'
  | 'submitted'
  | 'approved'
  | 'changes_requested'
  | 'message_created'
  | 'ddl_reminder'

async function getRealtimeWorkflowIds(task: ProductionTaskRow): Promise<string[]> {
  const workflowIds = new Set<string>()
  if (task.sourceWorkflowId) workflowIds.add(task.sourceWorkflowId)
  if (task.resultWorkflowId) workflowIds.add(task.resultWorkflowId)

  const workgroupRows = await db
    .select({ teamWorkspaceId: workgroup.teamWorkspaceId })
    .from(workgroup)
    .where(inArray(workgroup.id, [task.sourceWorkgroupId, task.assigneeWorkgroupId]))

  const workspaceIds = [
    task.sourceWorkspaceId,
    ...workgroupRows.map((row) => row.teamWorkspaceId),
  ].filter(Boolean) as string[]

  if (workspaceIds.length === 0) return [...workflowIds]

  const workflowRows = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(inArray(workflow.workspaceId, [...new Set(workspaceIds)]))

  for (const row of workflowRows) {
    if (row.id) workflowIds.add(row.id)
  }

  return [...workflowIds]
}

export async function notifyProductionTaskRealtime(params: {
  task: ProductionTaskRow
  event: ProductionTaskRealtimeEvent
}) {
  try {
    const workflowIds = await getRealtimeWorkflowIds(params.task)
    if (workflowIds.length === 0) return

    const response = await fetch(`${getSocketServerUrl()}/api/production-task-updated`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.INTERNAL_API_SECRET,
      },
      body: JSON.stringify({
        workflowIds,
        organizationId: params.task.organizationId,
        taskId: params.task.id,
        event: params.event,
      }),
    })

    if (!response.ok) {
      logger.warn('Failed to notify realtime service about production task update', {
        taskId: params.task.id,
        event: params.event,
        status: response.status,
      })
    }
  } catch (error) {
    logger.warn('Error notifying realtime service about production task update', {
      taskId: params.task.id,
      event: params.event,
      error,
    })
  }
}
