import {
  Card,
  ClipboardList,
  Connections,
  Database,
  HexSimple,
  Key,
  KeySquare,
  Lock,
  LogIn,
  Mail,
  Palette,
  Send,
  Server,
  Settings,
  ShieldCheck,
  TerminalWindow,
  TrashOutline,
  Upload,
  Users,
  Wrench,
} from '@/components/emcn'
import { AgentSkillsIcon, McpIcon } from '@/components/icons'
import { getEnv, isTruthy } from '@/lib/core/config/env'

export type SettingsSection =
  | 'account'
  | 'general'
  | 'admin-console-users'
  | 'admin-console-credits'
  | 'admin-console-api-keys'
  | 'admin-console-usage'
  | 'user-management'
  | 'integrations'
  | 'secrets'
  | 'template-profile'
  | 'credential-sets'
  | 'access-control'
  | 'audit-logs'
  | 'apikeys'
  | 'byok'
  | 'subscription'
  | 'organization'
  | 'sso'
  | 'whitelabeling'
  | 'copilot'
  | 'mcp'
  | 'custom-tools'
  | 'skills'
  | 'workflow-mcp-servers'
  | 'inbox'
  | 'admin'
  | 'data-retention'
  | 'data-drains'
  | 'mothership'
  | 'recently-deleted'

export type NavigationSection =
  | 'account'
  | 'subscription'
  | 'tools'
  | 'system'
  | 'enterprise'
  | 'platform'
  | 'superuser'

export interface NavigationItem {
  id: SettingsSection
  label: string
  icon: React.ComponentType<{ className?: string }>
  section: NavigationSection
  hideWhenBillingDisabled?: boolean
  requiresTeam?: boolean
  requiresEnterprise?: boolean
  requiresMax?: boolean
  requiresHosted?: boolean
  selfHostedOverride?: boolean
  requiresSuperUser?: boolean
  requiresAdminRole?: boolean
  /** Show in the sidebar even when the user lacks the required plan, with an upgrade badge. */
  showWhenLocked?: boolean
  externalUrl?: string
}

const isSSOEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
const isCredentialSetsEnabled = isTruthy(getEnv('NEXT_PUBLIC_CREDENTIAL_SETS_ENABLED'))
const isAccessControlEnabled = isTruthy(getEnv('NEXT_PUBLIC_ACCESS_CONTROL_ENABLED'))
const isInboxEnabled = isTruthy(getEnv('NEXT_PUBLIC_INBOX_ENABLED'))
const isWhitelabelingEnabled = isTruthy(getEnv('NEXT_PUBLIC_WHITELABELING_ENABLED'))
const isAuditLogsEnabled = isTruthy(getEnv('NEXT_PUBLIC_AUDIT_LOGS_ENABLED'))
const isDataRetentionEnabled = isTruthy(getEnv('NEXT_PUBLIC_DATA_RETENTION_ENABLED'))
const isDataDrainsEnabled = isTruthy(getEnv('NEXT_PUBLIC_DATA_DRAINS_ENABLED'))

export const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))
export { isCredentialSetsEnabled }

export const sectionConfig: { key: NavigationSection; title: string }[] = [
  { key: 'account', title: '账号' },
  { key: 'platform', title: '平台管理' },
  { key: 'tools', title: '工具' },
  { key: 'subscription', title: '订阅' },
  { key: 'system', title: '系统' },
  { key: 'enterprise', title: '企业' },
  { key: 'superuser', title: '高级管理' },
]

export const allNavigationItems: NavigationItem[] = [
  { id: 'account', label: '账号', icon: Settings, section: 'account' },
  {
    id: 'admin-console-users',
    label: '用户与权限',
    icon: Users,
    section: 'platform',
    requiresAdminRole: true,
  },
  {
    id: 'admin-console-credits',
    label: '额度与积分',
    icon: Card,
    section: 'platform',
    requiresAdminRole: true,
  },
  {
    id: 'admin-console-api-keys',
    label: 'API Key 管理',
    icon: KeySquare,
    section: 'platform',
    requiresAdminRole: true,
  },
  {
    id: 'admin-console-usage',
    label: '使用记录',
    icon: Database,
    section: 'platform',
    requiresAdminRole: true,
  },
  {
    id: 'user-management',
    label: '用户管理',
    icon: Users,
    section: 'platform',
    requiresAdminRole: true,
  },
  {
    id: 'access-control',
    label: '访问控制',
    icon: ShieldCheck,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isAccessControlEnabled,
  },
  {
    id: 'audit-logs',
    label: '审计日志',
    icon: ClipboardList,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isAuditLogsEnabled,
  },
  {
    id: 'subscription',
    label: '订阅',
    icon: Card,
    section: 'subscription',
    hideWhenBillingDisabled: true,
  },
  {
    id: 'organization',
    label: '组织',
    icon: Users,
    section: 'subscription',
    hideWhenBillingDisabled: true,
    requiresHosted: true,
    requiresTeam: true,
  },
  { id: 'integrations', label: '集成', icon: Connections, section: 'account' },
  { id: 'secrets', label: '密钥', icon: Key, section: 'account' },
  { id: 'custom-tools', label: '自定义工具', icon: Wrench, section: 'tools' },
  { id: 'skills', label: '技能', icon: AgentSkillsIcon, section: 'tools' },
  { id: 'mcp', label: 'MCP Tools', icon: McpIcon, section: 'tools' },
  { id: 'apikeys', label: 'Sim Keys', icon: TerminalWindow, section: 'system' },
  { id: 'workflow-mcp-servers', label: 'MCP Servers', icon: Server, section: 'system' },
  {
    id: 'byok',
    label: 'BYOK',
    icon: KeySquare,
    section: 'system',
    requiresHosted: true,
  },
  {
    id: 'copilot',
    label: 'Copilot Keys',
    icon: HexSimple,
    section: 'system',
    requiresHosted: true,
  },
  {
    id: 'inbox',
    label: 'Sim Mailer',
    icon: Send,
    section: 'system',
    requiresMax: true,
    requiresHosted: true,
    selfHostedOverride: isInboxEnabled,
    showWhenLocked: true,
  },
  ...(isCredentialSetsEnabled
    ? [
        {
          id: 'credential-sets' as const,
          label: 'Email Polling',
          icon: Mail,
          section: 'system' as const,
        },
      ]
    : []),
  { id: 'recently-deleted', label: '最近删除', icon: TrashOutline, section: 'system' },
  {
    id: 'sso',
    label: '单点登录',
    icon: LogIn,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isSSOEnabled,
  },
  {
    id: 'data-retention',
    label: '数据保留',
    icon: Database,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isDataRetentionEnabled,
  },
  {
    id: 'data-drains',
    label: '数据导出',
    icon: Upload,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isDataDrainsEnabled,
  },
  {
    id: 'whitelabeling',
    label: '白标',
    icon: Palette,
    section: 'enterprise',
    requiresHosted: true,
    requiresEnterprise: true,
    selfHostedOverride: isWhitelabelingEnabled,
  },
  {
    id: 'admin',
    label: '管理',
    icon: Lock,
    section: 'superuser',
    requiresAdminRole: true,
  },
  {
    id: 'mothership',
    label: 'Mothership',
    icon: Server,
    section: 'superuser',
    requiresAdminRole: true,
  },
]
