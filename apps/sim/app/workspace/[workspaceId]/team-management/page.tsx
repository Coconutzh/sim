import type { Metadata } from 'next'
import { ProductionTeamManagement } from '@/app/workspace/[workspaceId]/team-management/production-team-management'

export const metadata: Metadata = {
  title: '团队管理',
}

export default function TeamManagementPage() {
  return <ProductionTeamManagement />
}
