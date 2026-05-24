import type { Metadata } from 'next'
import { ProjectNotificationsCenter } from '@/app/workspace/[workspaceId]/project-notifications/project-notifications-center'

export const metadata: Metadata = {
  title: 'Project Notifications',
}

export default function ProjectNotificationsPage() {
  return <ProjectNotificationsCenter />
}
