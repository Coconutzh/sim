import { db } from '@sim/db'
import { account, credential, credentialMember, workflow as workflowTable } from '@sim/db/schema'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { and, eq } from 'drizzle-orm'
import { NextResponse, type NextRequest } from 'next/server'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  checkWorkspaceAccess,
  getUserEntityPermissions,
} from '@/lib/workspaces/permissions/utils'

export interface CredentialAccessResult {
  ok: boolean
  error?: string
  status?: 401 | 403 | 404
  authType?: typeof AuthType.SESSION | typeof AuthType.INTERNAL_JWT
  requesterUserId?: string
  credentialOwnerUserId?: string
  workspaceId?: string
  resolvedCredentialId?: string
}

function errorResult(
  status: 401 | 403 | 404,
  error: string
): CredentialAccessResult {
  return { ok: false, status, error }
}

async function getVisibleWorkspacePermission(
  userId: string,
  workspaceId: string
): Promise<Awaited<ReturnType<typeof getUserEntityPermissions>>> {
  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    return null
  }

  return getUserEntityPermissions(userId, 'workspace', workspaceId)
}

export function credentialAccessErrorResponse(result: CredentialAccessResult): NextResponse {
  return NextResponse.json(
    { error: result.error || 'Unauthorized' },
    { status: result.status ?? 403 }
  )
}

/**
 * Centralizes auth + credential membership checks for OAuth usage.
 * - Workspace-scoped credential IDs enforce active credential_member access.
 * - Legacy account IDs are resolved to workspace-scoped credentials when workflowId is provided.
 * - Direct legacy account-ID access without workflowId is restricted to account owners only.
 */
export async function authorizeCredentialUse(
  request: NextRequest,
  params: {
    credentialId: string
    workflowId?: string
    requireWorkflowIdForInternal?: boolean
    callerUserId?: string
  }
): Promise<CredentialAccessResult> {
  const { credentialId, workflowId, requireWorkflowIdForInternal = true, callerUserId } = params

  const auth = await checkSessionOrInternalAuth(request, {
    requireWorkflowId: requireWorkflowIdForInternal,
  })
  if (!auth.success || !auth.userId) {
    return errorResult(401, auth.error || 'Authentication required')
  }

  if (
    auth.authType === AuthType.INTERNAL_JWT &&
    callerUserId !== undefined &&
    callerUserId !== auth.userId
  ) {
    return errorResult(403, 'Caller user does not match internal token subject')
  }

  const actingUserId = auth.userId

  let workflowContext: { workspaceId: string } | null = null
  if (workflowId) {
    const workflowAuthorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId: actingUserId,
      action: 'read',
    })

    if (!workflowAuthorization.allowed || !workflowAuthorization.workflow?.workspaceId) {
      return errorResult(
        workflowAuthorization.status === 404 ? 404 : 403,
        workflowAuthorization.message || 'Workflow not found'
      )
    }

    workflowContext = { workspaceId: workflowAuthorization.workflow.workspaceId }
  }

  const [platformCredential] = await db
    .select({
      id: credential.id,
      workspaceId: credential.workspaceId,
      type: credential.type,
      accountId: credential.accountId,
    })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)

  if (platformCredential) {
    if (platformCredential.type === 'service_account') {
      if (workflowContext && workflowContext.workspaceId !== platformCredential.workspaceId) {
        return errorResult(404, 'Credential not found')
      }

      if (actingUserId) {
        const requesterPerm = await getVisibleWorkspacePermission(
          actingUserId,
          platformCredential.workspaceId
        )

        const [membership] = await db
          .select({ id: credentialMember.id })
          .from(credentialMember)
          .where(
            and(
              eq(credentialMember.credentialId, platformCredential.id),
              eq(credentialMember.userId, actingUserId),
              eq(credentialMember.status, 'active')
            )
          )
          .limit(1)

        if (!membership) {
          return errorResult(
            403,
            'You do not have access to this credential. Ask the credential admin to add you as a member.'
          )
        }
        if (requesterPerm === null) {
          return errorResult(404, 'Credential not found')
        }
      } else if (!workflowContext) {
        return errorResult(403, 'workflowId is required')
      }

      return {
        ok: true,
        authType: auth.authType as CredentialAccessResult['authType'],
        requesterUserId: auth.userId,
        credentialOwnerUserId: actingUserId || auth.userId,
        workspaceId: platformCredential.workspaceId,
        resolvedCredentialId: platformCredential.id,
      }
    }

    if (platformCredential.type !== 'oauth' || !platformCredential.accountId) {
      return errorResult(403, 'Unsupported credential type for OAuth access')
    }

    if (workflowContext && workflowContext.workspaceId !== platformCredential.workspaceId) {
      return errorResult(404, 'Credential not found')
    }

    const [accountRow] = await db
      .select({ userId: account.userId })
      .from(account)
      .where(eq(account.id, platformCredential.accountId))
      .limit(1)

    if (!accountRow) {
      return errorResult(404, 'Credential account not found')
    }

    if (actingUserId) {
      const requesterPerm = await getVisibleWorkspacePermission(
        actingUserId,
        platformCredential.workspaceId
      )

      const [membership] = await db
        .select({ id: credentialMember.id })
        .from(credentialMember)
        .where(
          and(
            eq(credentialMember.credentialId, platformCredential.id),
            eq(credentialMember.userId, actingUserId),
            eq(credentialMember.status, 'active')
          )
        )
        .limit(1)

      if (!membership) {
        return errorResult(
          403,
          'You do not have access to this credential. Ask the credential admin to add you as a member.'
        )
      }
      if (requesterPerm === null) {
        return errorResult(404, 'Credential not found')
      }
    }

    const ownerPerm = await getVisibleWorkspacePermission(
      accountRow.userId,
      platformCredential.workspaceId
    )
    if (ownerPerm === null) {
      return errorResult(404, 'Credential not found')
    }

    return {
      ok: true,
      authType: auth.authType as CredentialAccessResult['authType'],
      requesterUserId: auth.userId,
      credentialOwnerUserId: accountRow.userId,
      workspaceId: platformCredential.workspaceId,
      resolvedCredentialId: platformCredential.accountId,
    }
  }

  if (workflowContext?.workspaceId) {
    const [workspaceCredential] = await db
      .select({
        id: credential.id,
        workspaceId: credential.workspaceId,
        accountId: credential.accountId,
      })
      .from(credential)
      .where(
        and(
          eq(credential.type, 'oauth'),
          eq(credential.workspaceId, workflowContext.workspaceId),
          eq(credential.accountId, credentialId)
        )
      )
      .limit(1)

    if (!workspaceCredential?.accountId) {
      return errorResult(404, 'Credential not found')
    }

    const [accountRow] = await db
      .select({ userId: account.userId })
      .from(account)
      .where(eq(account.id, workspaceCredential.accountId))
      .limit(1)

    if (!accountRow) {
      return errorResult(404, 'Credential account not found')
    }

    if (actingUserId) {
      const [membership] = await db
        .select({ id: credentialMember.id })
        .from(credentialMember)
        .where(
          and(
            eq(credentialMember.credentialId, workspaceCredential.id),
            eq(credentialMember.userId, actingUserId),
            eq(credentialMember.status, 'active')
          )
        )
        .limit(1)

      if (!membership) {
        return errorResult(
          403,
          'You do not have access to this credential. Ask the credential admin to add you as a member.'
        )
      }
    }

    const ownerPerm = await getVisibleWorkspacePermission(accountRow.userId, workflowContext.workspaceId)
    if (ownerPerm === null) {
      return errorResult(404, 'Credential not found')
    }

    return {
      ok: true,
      authType: auth.authType as CredentialAccessResult['authType'],
      requesterUserId: auth.userId,
      credentialOwnerUserId: accountRow.userId,
      workspaceId: workflowContext.workspaceId,
      resolvedCredentialId: workspaceCredential.accountId,
    }
  }

  const [legacyAccount] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(eq(account.id, credentialId))
    .limit(1)

  if (!legacyAccount) {
    return errorResult(404, 'Credential not found')
  }

  if (auth.authType === AuthType.INTERNAL_JWT) {
    return errorResult(403, 'workflowId is required')
  }

  if (auth.userId !== legacyAccount.userId) {
    return errorResult(403, 'Unauthorized')
  }

  return {
    ok: true,
    authType: auth.authType as CredentialAccessResult['authType'],
    requesterUserId: auth.userId,
    credentialOwnerUserId: legacyAccount.userId,
    resolvedCredentialId: credentialId,
  }
}
