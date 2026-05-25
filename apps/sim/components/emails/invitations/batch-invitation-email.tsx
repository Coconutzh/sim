import { Link, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBrandConfig } from '@/ee/whitelabeling'

interface WorkspaceInvitation {
  workspaceId: string
  workspaceName: string
  permission: 'admin' | 'write' | 'read'
}

interface BatchInvitationEmailProps {
  inviterName: string
  organizationName: string
  organizationRole: 'admin' | 'member'
  workspaceInvitations: WorkspaceInvitation[]
  acceptUrl: string
}

const getPermissionLabel = (permission: string) => {
  switch (permission) {
    case 'admin':
      return 'Admin (full access)'
    case 'write':
      return 'Editor (can edit workflows)'
    case 'read':
      return 'Viewer (read-only access)'
    default:
      return permission
  }
}

const getRoleLabel = (role: string) => {
  switch (role) {
    case 'admin':
      return 'Admin'
    case 'member':
      return 'Member'
    default:
      return role
  }
}

export function BatchInvitationEmail({
  inviterName = 'Someone',
  organizationName = 'the team',
  organizationRole = 'member',
  workspaceInvitations = [],
  acceptUrl,
}: BatchInvitationEmailProps) {
  const brand = getBrandConfig()
  const hasWorkspaces = workspaceInvitations.length > 0
  const canvasCountLabel = `${workspaceInvitations.length} ${
    workspaceInvitations.length === 1 ? 'canvas' : 'canvases'
  }`

  return (
    <EmailLayout
      preview={`You've been invited to join ${organizationName}${hasWorkspaces ? ` and ${canvasCountLabel}` : ''}`}
      showUnsubscribe={false}
    >
      <Text style={baseStyles.paragraph}>Hello,</Text>
      <Text style={baseStyles.paragraph}>
        <strong>{inviterName}</strong> has invited you to join <strong>{organizationName}</strong>{' '}
        on {brand.name}.
      </Text>

      <Text style={baseStyles.paragraph}>
        <strong>Team Role:</strong> {getRoleLabel(organizationRole)}
      </Text>
      <Text style={baseStyles.paragraph}>
        {organizationRole === 'admin'
          ? "As a Team Admin, you'll be able to manage team members, billing, and canvas access."
          : "As a Team Member, you'll have access to shared team billing and can be invited to canvases."}
      </Text>

      {hasWorkspaces && (
        <>
          <Text style={baseStyles.paragraph}>
            <strong>Canvas Access ({canvasCountLabel}):</strong>
          </Text>
          {workspaceInvitations.map((ws) => (
            <Text key={ws.workspaceId} style={{ ...baseStyles.paragraph, marginLeft: '20px' }}>
              • <strong>{ws.workspaceName}</strong> - {getPermissionLabel(ws.permission)}
            </Text>
          ))}
        </>
      )}

      <Link href={acceptUrl} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>Accept Invitation</Text>
      </Link>

      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        Invitation expires in 7 days. If unexpected, you can ignore this email.
      </Text>
    </EmailLayout>
  )
}

export default BatchInvitationEmail
