import { MobileProjectPage } from '@/app/mobile/project/[workspaceId]/project-page'

interface MobileProjectRouteProps {
  params: Promise<{ workspaceId: string }>
}

export default async function MobileProjectRoute({ params }: MobileProjectRouteProps) {
  const { workspaceId } = await params
  return <MobileProjectPage workspaceId={workspaceId} />
}
