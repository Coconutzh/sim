import { db } from '@sim/db'
import {
  type InvitationKind,
  type InvitationMembershipIntent,
  type InvitationStatus,
  invitation,
  invitationWorkspaceGrant,
  organization,
  permissions,
  user,
  workgroupMember,
  workspace,
  workspaceEnvironment,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import { setActiveOrganizationForCurrentSession } from '@/lib/auth/active-organization'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { ensureUserInOrganization } from '@/lib/billing/organizations/membership'
import { syncWorkspaceEnvCredentials } from '@/lib/credentials/environment'
import { applyWorkspaceAutoAddGroup } from '@/lib/permission-groups/auto-add'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('InvitationCore')

const PERMISSION_RANK = { read: 0, write: 1, admin: 2 } as const
type PermissionLevel = keyof typeof PERMISSION_RANK

export const INVITATION_EXPIRY_DAYS = 7

export function computeInvitationExpiry(daysFromNow = INVITATION_EXPIRY_DAYS): Date {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000)
}

export interface InvitationWithGrants {
  id: string
  kind: InvitationKind
  email: string
  organizationId: string | null
  membershipIntent: InvitationMembershipIntent
  inviterId: string
  role: string
  status: InvitationStatus
  token: string
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
  grants: Array<{
    id: string
    workspaceId: string
    permission: 'admin' | 'write' | 'read'
    workspaceName: string | null
  }>
  organizationName: string | null
  inviterName: string | null
  inviterEmail: string | null
}

export async function getInvitationById(id: string): Promise<InvitationWithGrants | null> {
  const [row] = await db.select().from(invitation).where(eq(invitation.id, id)).limit(1)
  if (!row) return null
  return hydrateInvitation(row)
}

export async function getInvitationByToken(token: string): Promise<InvitationWithGrants | null> {
  const [row] = await db.select().from(invitation).where(eq(invitation.token, token)).limit(1)
  if (!row) return null
  return hydrateInvitation(row)
}

async function hydrateInvitation(
  row: typeof invitation.$inferSelect
): Promise<InvitationWithGrants> {
  const grantRows = await db
    .select({
      id: invitationWorkspaceGrant.id,
      workspaceId: invitationWorkspaceGrant.workspaceId,
      permission: invitationWorkspaceGrant.permission,
      workspaceName: workspace.name,
    })
    .from(invitationWorkspaceGrant)
    .leftJoin(workspace, eq(workspace.id, invitationWorkspaceGrant.workspaceId))
    .where(eq(invitationWorkspaceGrant.invitationId, row.id))

  let organizationName: string | null = null
  if (row.organizationId) {
    const [orgRow] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, row.organizationId))
      .limit(1)
    organizationName = orgRow?.name ?? null
  }

  const [inviterRow] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, row.inviterId))
    .limit(1)

  return {
    id: row.id,
    kind: row.kind,
    email: row.email,
    organizationId: row.organizationId,
    membershipIntent: row.membershipIntent,
    inviterId: row.inviterId,
    role: row.role,
    status: row.status,
    token: row.token,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    grants: grantRows.map((grant) => ({
      id: grant.id,
      workspaceId: grant.workspaceId,
      permission: grant.permission,
      workspaceName: grant.workspaceName,
    })),
    organizationName,
    inviterName: inviterRow?.name ?? null,
    inviterEmail: inviterRow?.email ?? null,
  }
}

export function isInvitationExpired(inv: Pick<InvitationWithGrants, 'expiresAt'>): boolean {
  return new Date() > new Date(inv.expiresAt)
}

/**
 * Flip any still-pending invitations for the given organization whose
 * `expiresAt` has already passed to `expired`. Best-effort housekeeping
 * — callers can rely on this for display freshness, but seat math also
 * defensively filters by `expiresAt` at query time.
 */
export async function expireStalePendingInvitationsForOrganization(
  organizationId: string
): Promise<void> {
  try {
    await db
      .update(invitation)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        and(
          eq(invitation.organizationId, organizationId),
          eq(invitation.status, 'pending'),
          lte(invitation.expiresAt, new Date())
        )
      )
  } catch (error) {
    logger.error('Failed to expire stale pending invitations for organization', {
      organizationId,
      error,
    })
  }
}

/**
 * Flip any still-pending invitations with grants on the given workspaces
 * whose `expiresAt` has already passed to `expired`.
 */
export async function expireStalePendingInvitationsForWorkspaces(
  workspaceIds: string[]
): Promise<void> {
  if (workspaceIds.length === 0) return
  try {
    const staleIds = await db
      .select({ id: invitation.id })
      .from(invitation)
      .innerJoin(invitationWorkspaceGrant, eq(invitationWorkspaceGrant.invitationId, invitation.id))
      .where(
        and(
          inArray(invitationWorkspaceGrant.workspaceId, workspaceIds),
          eq(invitation.status, 'pending'),
          lte(invitation.expiresAt, new Date())
        )
      )

    if (staleIds.length === 0) return

    await db
      .update(invitation)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        inArray(
          invitation.id,
          staleIds.map((row) => row.id)
        )
      )
  } catch (error) {
    logger.error('Failed to expire stale pending invitations for workspaces', {
      workspaceCount: workspaceIds.length,
      error,
    })
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function summarizeInvitationGrantVisibility(
  grants: Array<Pick<InvitationWithGrants['grants'][number], 'workspaceId'>>,
  userId: string
): Promise<{ hasUnavailableGrant: boolean; hasHiddenPersonalGrant: boolean }> {
  const accessResults = await Promise.all(
    grants.map((grant) => checkWorkspaceAccess(grant.workspaceId, userId))
  )

  return {
    hasUnavailableGrant: accessResults.some((access) => !access.exists),
    hasHiddenPersonalGrant: accessResults.some(
      (access) =>
        access.exists &&
        !access.hasAccess &&
        access.workspace?.workspaceMode === 'personal' &&
        access.workspace.ownerId !== userId
    ),
  }
}

export type AcceptInvitationFailure =
  | { kind: 'not-found' }
  | { kind: 'already-processed' }
  | { kind: 'expired' }
  | { kind: 'email-mismatch' }
  | { kind: 'invalid-token' }
  | { kind: 'already-in-organization' }
  | { kind: 'no-seats-available' }
  | { kind: 'workspace-unavailable' }
  | { kind: 'server-error'; message?: string }

export type AcceptInvitationSuccess = {
  success: true
  invitation: InvitationWithGrants
  acceptedWorkspaceIds: string[]
  redirectPath: string
  membershipAlreadyExists: boolean
}

export type AcceptInvitationResult =
  | AcceptInvitationSuccess
  | ({ success: false } & AcceptInvitationFailure)

export interface AcceptInvitationInput {
  userId: string
  userEmail: string
  invitationId: string
  token: string | null
}

export async function acceptInvitation(
  input: AcceptInvitationInput
): Promise<AcceptInvitationResult> {
  const inv = await getInvitationById(input.invitationId)

  if (!inv) {
    return { success: false, kind: 'not-found' }
  }

  if (input.token && inv.token !== input.token) {
    return { success: false, kind: 'invalid-token' }
  }

  if (inv.status !== 'pending') {
    return { success: false, kind: 'already-processed' }
  }

  if (isInvitationExpired(inv)) {
    await db
      .update(invitation)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq(invitation.id, inv.id), eq(invitation.status, 'pending')))
    return { success: false, kind: 'expired' }
  }

  if (normalizeEmail(input.userEmail) !== normalizeEmail(inv.email)) {
    return { success: false, kind: 'email-mismatch' }
  }

  let membershipAlreadyExists = false
  let acceptedMembershipIntent = inv.membershipIntent
  let shouldJoinOrganization = Boolean(inv.organizationId && inv.membershipIntent !== 'external')

  if (shouldJoinOrganization && inv.organizationId) {
    const membershipResult = await ensureUserInOrganization({
      userId: input.userId,
      organizationId: inv.organizationId,
      role: (inv.role || 'member') as 'admin' | 'member' | 'owner',
      acceptingInvitationId: inv.id,
    })

    if (!membershipResult.success) {
      if (membershipResult.existingOrgId) {
        if (inv.kind === 'workspace' && inv.grants.length > 0) {
          acceptedMembershipIntent = 'external'
          shouldJoinOrganization = false
        } else {
          await db
            .update(invitation)
            .set({ status: 'rejected', updatedAt: new Date() })
            .where(eq(invitation.id, inv.id))
          return { success: false, kind: 'already-in-organization' }
        }
      } else if (membershipResult.failureCode === 'no-seats-available') {
        return { success: false, kind: 'no-seats-available' }
      } else {
        return { success: false, kind: 'server-error', message: membershipResult.error }
      }
    }

    membershipAlreadyExists = membershipResult.alreadyMember
  }

  const acceptedWorkspaceIds: string[] = []
  const workspaceOwners = new Map<string, string>()
  const workspaceWorkgroups = new Map<string, string>()

  for (const grant of inv.grants) {
    const [workspaceRow] = await db
      .select({
        ownerId: workspace.ownerId,
        workgroupId: workspace.workgroupId,
        workspaceMode: workspace.workspaceMode,
        archivedAt: workspace.archivedAt,
      })
      .from(workspace)
      .where(eq(workspace.id, grant.workspaceId))
      .limit(1)

    const isWorkspaceOwner = workspaceRow?.ownerId === input.userId
    const isUnavailable =
      !workspaceRow ||
      workspaceRow.archivedAt !== null ||
      (workspaceRow.workspaceMode === 'personal' && !isWorkspaceOwner)

    if (isUnavailable) {
      return { success: false, kind: 'workspace-unavailable' }
    }

    workspaceOwners.set(grant.workspaceId, workspaceRow.ownerId)
    if (workspaceRow.workspaceMode === 'organization' && workspaceRow.workgroupId) {
      workspaceWorkgroups.set(grant.workspaceId, workspaceRow.workgroupId)
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(invitation)
      .set({
        status: 'accepted',
        membershipIntent: acceptedMembershipIntent,
        updatedAt: new Date(),
      })
      .where(eq(invitation.id, inv.id))

    for (const grant of inv.grants) {
      const isWorkspaceOwner = workspaceOwners.get(grant.workspaceId) === input.userId

      const [existingPermission] = await tx
        .select({ id: permissions.id, permissionType: permissions.permissionType })
        .from(permissions)
        .where(
          and(
            eq(permissions.entityId, grant.workspaceId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.userId, input.userId)
          )
        )
        .limit(1)

      const newPermission = grant.permission as PermissionLevel
      const newRank = PERMISSION_RANK[newPermission] ?? 0

      if (isWorkspaceOwner) {
        // Owners already have implicit admin access even without a permission row.
      } else if (existingPermission) {
        const existingRank =
          PERMISSION_RANK[existingPermission.permissionType as PermissionLevel] ?? 0
        if (newRank > existingRank) {
          await tx
            .update(permissions)
            .set({ permissionType: newPermission, updatedAt: new Date() })
            .where(eq(permissions.id, existingPermission.id))
        }
      } else {
        await tx.insert(permissions).values({
          id: generateId(),
          entityType: 'workspace',
          entityId: grant.workspaceId,
          userId: input.userId,
          permissionType: newPermission,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }

      await applyWorkspaceAutoAddGroup(tx, grant.workspaceId, input.userId)

      const workgroupId = workspaceWorkgroups.get(grant.workspaceId)
      if (workgroupId && inv.organizationId) {
        const role = grant.permission === 'admin' ? 'admin' : 'member'
        await tx
          .insert(workgroupMember)
          .values({
            id: generateId(),
            organizationId: inv.organizationId,
            workgroupId,
            userId: input.userId,
            role,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [workgroupMember.workgroupId, workgroupMember.userId],
            set: {
              role: sql`CASE WHEN ${workgroupMember.role} = 'admin' THEN 'admin' ELSE EXCLUDED.role END`,
              updatedAt: new Date(),
            },
          })
      }

      acceptedWorkspaceIds.push(grant.workspaceId)
    }
  })

  if (shouldJoinOrganization && inv.organizationId) {
    try {
      await setActiveOrganizationForCurrentSession(inv.organizationId)
    } catch (activeOrgError) {
      logger.error('Failed to activate organization after accepting invitation', {
        userId: input.userId,
        organizationId: inv.organizationId,
        invitationId: inv.id,
        error: activeOrgError,
      })
    }
  }

  for (const workspaceId of acceptedWorkspaceIds) {
    try {
      const [wsEnvRow] = await db
        .select({ variables: workspaceEnvironment.variables })
        .from(workspaceEnvironment)
        .where(eq(workspaceEnvironment.workspaceId, workspaceId))
        .limit(1)
      const wsEnvKeys = Object.keys((wsEnvRow?.variables as Record<string, string>) || {})
      if (wsEnvKeys.length > 0) {
        await syncWorkspaceEnvCredentials({
          workspaceId,
          envKeys: wsEnvKeys,
          actingUserId: input.userId,
        })
      }
    } catch (envError) {
      logger.error('Failed to sync workspace env credentials after invitation accept', {
        userId: input.userId,
        workspaceId,
        invitationId: inv.id,
        error: envError,
      })
    }
  }

  if (shouldJoinOrganization && inv.organizationId && !membershipAlreadyExists) {
    try {
      await syncUsageLimitsFromSubscription(input.userId)
    } catch (syncError) {
      logger.error('Failed to sync usage limits after joining org', {
        userId: input.userId,
        organizationId: inv.organizationId,
        invitationId: inv.id,
        error: syncError,
      })
    }
  }

  const redirectPath =
    inv.kind === 'workspace' && acceptedWorkspaceIds.length > 0
      ? `/workspace/${acceptedWorkspaceIds[0]}/home`
      : '/workspace'

  return {
    success: true,
    invitation: { ...inv, status: 'accepted', membershipIntent: acceptedMembershipIntent },
    acceptedWorkspaceIds,
    redirectPath,
    membershipAlreadyExists,
  }
}

export type RejectInvitationResult =
  | { success: true; invitation: InvitationWithGrants }
  | { success: false; kind: AcceptInvitationFailure['kind'] }

export async function rejectInvitation(
  input: AcceptInvitationInput
): Promise<RejectInvitationResult> {
  const inv = await getInvitationById(input.invitationId)

  if (!inv) return { success: false, kind: 'not-found' }
  if (input.token && inv.token !== input.token) return { success: false, kind: 'invalid-token' }
  if (inv.status !== 'pending') return { success: false, kind: 'already-processed' }
  if (isInvitationExpired(inv)) {
    await db
      .update(invitation)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq(invitation.id, inv.id), eq(invitation.status, 'pending')))
    return { success: false, kind: 'expired' }
  }
  if (normalizeEmail(input.userEmail) !== normalizeEmail(inv.email)) {
    return { success: false, kind: 'email-mismatch' }
  }

  await db
    .update(invitation)
    .set({ status: 'rejected', updatedAt: new Date() })
    .where(eq(invitation.id, inv.id))

  return { success: true, invitation: { ...inv, status: 'rejected' } }
}

export async function cancelInvitation(invitationId: string): Promise<boolean> {
  const result = await db
    .update(invitation)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(invitation.id, invitationId), eq(invitation.status, 'pending')))
    .returning({ id: invitation.id })

  return result.length > 0
}

export async function listPendingInvitationsForOrganization(organizationId: string) {
  return db
    .select({
      id: invitation.id,
      kind: invitation.kind,
      email: invitation.email,
      role: invitation.role,
      membershipIntent: invitation.membershipIntent,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      inviterName: user.name,
      inviterEmail: user.email,
    })
    .from(invitation)
    .leftJoin(user, eq(invitation.inviterId, user.id))
    .where(eq(invitation.organizationId, organizationId))
    .orderBy(invitation.createdAt)
}

export async function listInvitationsForWorkspaces(workspaceIds: string[]) {
  if (workspaceIds.length === 0) return []
  return db
    .select({
      id: invitation.id,
      kind: invitation.kind,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
      organizationId: invitation.organizationId,
      membershipIntent: invitation.membershipIntent,
      inviterId: invitation.inviterId,
      workspaceId: invitationWorkspaceGrant.workspaceId,
      permission: invitationWorkspaceGrant.permission,
    })
    .from(invitationWorkspaceGrant)
    .innerJoin(invitation, eq(invitation.id, invitationWorkspaceGrant.invitationId))
    .where(inArray(invitationWorkspaceGrant.workspaceId, workspaceIds))
}
