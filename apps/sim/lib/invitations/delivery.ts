export type InvitationDeliveryMode = 'in_app' | 'email'

export function getInvitationDeliveryMode(): InvitationDeliveryMode {
  return process.env.INVITATION_DELIVERY_MODE === 'email' ? 'email' : 'in_app'
}

export function shouldSendInvitationEmail(): boolean {
  return getInvitationDeliveryMode() === 'email'
}
