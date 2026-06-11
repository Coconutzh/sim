import type { Metadata } from 'next'
import { ProductionTeamManagement } from '@/app/workspace/[workspaceId]/team-management/production-team-management'

export const metadata: Metadata = {
  title: 'Team Management',
}

export default function TeamManagementPage() {
  return <ProductionTeamManagement />
}
