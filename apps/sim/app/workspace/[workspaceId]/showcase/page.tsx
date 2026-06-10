import type { Metadata } from 'next'
import { ProjectOverview } from '@/app/workspace/[workspaceId]/showcase/project-overview'

export const metadata: Metadata = {
  title: '项目总览',
}

interface ProjectOverviewPageProps {
  params: Promise<{
    workspaceId: string
  }>
}

export default async function ProjectOverviewPage({ params }: ProjectOverviewPageProps) {
  const { workspaceId } = await params
  return <ProjectOverview workspaceId={workspaceId} />
}
