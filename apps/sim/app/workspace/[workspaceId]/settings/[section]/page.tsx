import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import { prefetchGeneralSettings, prefetchSubscriptionData, prefetchUserProfile } from './prefetch'
import { SettingsPage } from './settings'

const SECTION_TITLES: Record<string, string> = {
  account: '账号',
  'my-credits': '我的积分',
  general: '账号',
  integrations: '集成',
  secrets: '密钥',
  'template-profile': '模板资料',
  'access-control': '访问控制',
  'audit-logs': '审计日志',
  apikeys: 'Sim Keys',
  byok: 'BYOK',
  subscription: '订阅',
  team: '团队',
  organization: '组织',
  sso: '单点登录',
  whitelabeling: '白标',
  copilot: 'Copilot Keys',
  mcp: 'MCP Tools',
  'custom-tools': '自定义工具',
  skills: '技能',
  'workflow-mcp-servers': 'MCP Servers',
  'credential-sets': 'Email Polling',
  'data-retention': '数据保留',
  'data-drains': '数据导出',
  'recently-deleted': '最近删除',
  'admin-console-users': '用户与权限',
  'admin-console-credits': '额度与积分',
  'admin-console-api-keys': 'API Key 管理',
  'admin-console-usage': '使用记录',
  'user-management': '用户管理',
  debug: '调试',
} as const

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>
}): Promise<Metadata> {
  const { section } = await params
  return { title: SECTION_TITLES[section] ?? '设置' }
}

export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ workspaceId: string; section: string }>
}) {
  const { section } = await params
  const queryClient = getQueryClient()

  void prefetchGeneralSettings(queryClient)
  void prefetchUserProfile(queryClient)
  if (isBillingEnabled) void prefetchSubscriptionData(queryClient)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SettingsPage section={section as SettingsSection} />
    </HydrationBoundary>
  )
}
