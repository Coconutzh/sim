import type { Metadata } from 'next'
import { Home } from '@/app/workspace/[workspaceId]/home/home'

export const metadata: Metadata = {
  title: 'Task',
}

interface TaskPageProps {
  params: Promise<{
    workspaceId: string
    taskId: string
  }>
}

export default async function TaskPage({ params }: TaskPageProps) {
  const { taskId, workspaceId } = await params
  return <Home key={taskId} chatId={taskId} workspaceId={workspaceId} />
}
