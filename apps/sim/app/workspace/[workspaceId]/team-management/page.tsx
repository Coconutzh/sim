import type { Metadata } from 'next'
import { WorkgroupTeamManagement } from '@/app/workspace/[workspaceId]/team-management/workgroup-team-management'

export const metadata: Metadata = {
  title: 'Team Management',
}

export default function TeamManagementPage() {
  return <WorkgroupTeamManagement />
}
