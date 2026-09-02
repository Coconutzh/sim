import { MobileTaskDetailPage } from '@/app/mobile/project/[workspaceId]/task/[taskId]/task-detail-page'

interface MobileTaskDetailRouteProps {
  params: Promise<{ workspaceId: string; taskId: string }>
}

export default async function MobileTaskDetailRoute({ params }: MobileTaskDetailRouteProps) {
  const { workspaceId, taskId } = await params
  return <MobileTaskDetailPage workspaceId={workspaceId} taskId={taskId} />
}
