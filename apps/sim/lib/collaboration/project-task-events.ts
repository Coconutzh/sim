import { generateId } from '@sim/utils/id'
import type {
  ProjectTaskEvent,
  ProjectTaskEventType,
  ProjectTaskStatus,
} from '@/lib/api/contracts/project-tasks'
import { createPubSubChannel } from '@/lib/events/pubsub'

export const projectTaskEvents = createPubSubChannel<ProjectTaskEvent>({
  channel: 'project-task-events',
  label: 'ProjectTaskEvents',
})

export function publishProjectTaskEvent(params: {
  type: ProjectTaskEventType
  taskId: string
  organizationId: string
  assigneeWorkgroupId: string
  actorUserId: string
  taskStatus: ProjectTaskStatus
}) {
  projectTaskEvents.publish({
    id: generateId(),
    type: params.type,
    taskId: params.taskId,
    organizationId: params.organizationId,
    assigneeWorkgroupId: params.assigneeWorkgroupId,
    actorUserId: params.actorUserId,
    taskStatus: params.taskStatus,
    timestamp: new Date().toISOString(),
  })
}
