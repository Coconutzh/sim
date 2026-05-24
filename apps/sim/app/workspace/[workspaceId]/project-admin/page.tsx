import type { Metadata } from 'next'
import { ProjectAdminCenter } from '@/app/workspace/[workspaceId]/project-admin/project-admin-center'

export const metadata: Metadata = {
  title: 'Project Admin',
}

export default function ProjectAdminPage() {
  return <ProjectAdminCenter />
}
