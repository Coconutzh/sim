import { MobileNewTaskPage } from '@/app/mobile/project/[workspaceId]/tasks/new/new-task-page'

interface MobileNewTaskRouteProps {
  params: Promise<{ workspaceId: string }>
}

export default async function MobileNewTaskRoute({ params }: MobileNewTaskRouteProps) {
  const { workspaceId } = await params
  return <MobileNewTaskPage workspaceId={workspaceId} />
}
