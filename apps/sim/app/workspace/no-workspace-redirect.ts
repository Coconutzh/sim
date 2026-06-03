import type { WorkspaceCreationPolicy } from '@/hooks/queries/workspace'

interface PendingInvitationIdentity {
  id: string
}

interface SelectNoWorkspaceRedirectParams {
  creationPolicy: WorkspaceCreationPolicy | null
  invitations: PendingInvitationIdentity[]
}

export function selectNoWorkspaceRedirect({
  creationPolicy,
  invitations,
}: SelectNoWorkspaceRedirectParams): string | null {
  if (creationPolicy?.canCreate !== false) {
    return null
  }

  const firstInvitation = invitations[0]
  if (firstInvitation) {
    return `/invite/${firstInvitation.id}`
  }

  return '/'
}
