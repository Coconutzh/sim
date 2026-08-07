import { SettingsShell } from '@/app/workspace/[workspaceId]/settings/settings-shell'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>
}
