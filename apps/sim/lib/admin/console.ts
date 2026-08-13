import { db } from '@sim/db'
import {
  adminConsoleAuditLog,
  member,
  organization,
  platformModelServiceConfig,
  platformProviderApiKey,
  usageLog,
  user,
  userStats,
  workgroup,
  workgroupMember,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { and, count, desc, eq, gte, ilike, lte, or, type SQL, sql } from 'drizzle-orm'
import { recordAdminConsoleAudit } from '@/lib/admin/audit'
import type {
  AdminConsoleCreateProviderKeyBody,
  AdminConsoleCreateUserBody,
  AdminConsoleCreditActionBody,
  AdminConsoleSetOrganizationMembershipBody,
  AdminConsoleSetWorkgroupMembershipBody,
  AdminConsoleUpdateModelServiceBody,
  AdminConsoleUpdateProviderKeyBody,
  AdminConsoleUpsertModelServiceBody,
  AdminConsoleUserActionBody,
} from '@/lib/api/contracts/admin-console'
import { maskApiKey } from '@/lib/api-key/platform'
import { signUp } from '@/lib/auth'
import { ensureUserStatsExists } from '@/lib/billing/core/usage'
import {
  type ContentCapability,
  type ContentModelFamily,
  type ContentServiceKind,
  getContentCanvasModelsByFamily,
} from '@/lib/content-canvas/model-catalog'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { adjustCredits, getCreditWallet } from '@/lib/credits/wallet'

const logger = createLogger('AdminConsole')

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function simpleRecord(value: unknown): Record<string, string | number | boolean | null> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const output: Record<string, string | number | boolean | null> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean' ||
      item === null
    ) {
      output[key] = item
    }
  }
  return output
}

export async function formatAdminConsoleUser(row: {
  id: string
  name: string
  email: string
  role: string | null
  banned: boolean | null
  banReason: string | null
  createdAt: Date
  lastActive: Date | null
  currentUsageLimit: string | null
  currentPeriodCost: string | null
  creditBalance: string | null
  billingBlocked: boolean | null
}) {
  const currentUsageLimit = toNumber(row.currentUsageLimit)
  const currentPeriodCost = toNumber(row.currentPeriodCost)
  const creditWallet = await getCreditWallet(row.id)
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role ?? 'user',
    banned: row.banned ?? false,
    banReason: row.banReason,
    createdAt: row.createdAt.toISOString(),
    lastActive: toIso(row.lastActive),
    currentUsageLimit,
    currentPeriodCost,
    remainingUsage: Math.max(0, currentUsageLimit - currentPeriodCost),
    creditBalance: creditWallet.availableCredits,
    billingBlocked: row.billingBlocked ?? false,
  }
}

export async function getAdminConsoleUserDetail(userId: string) {
  await ensureUserStatsExists(userId)

  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      createdAt: user.createdAt,
      lastActive: userStats.lastActive,
      currentUsageLimit: userStats.currentUsageLimit,
      currentPeriodCost: userStats.currentPeriodCost,
      creditBalance: userStats.creditBalance,
      billingBlocked: userStats.billingBlocked,
      totalCost: userStats.totalCost,
      totalTokensUsed: userStats.totalTokensUsed,
      totalManualExecutions: userStats.totalManualExecutions,
      totalApiCalls: userStats.totalApiCalls,
      totalWebhookTriggers: userStats.totalWebhookTriggers,
      totalScheduledExecutions: userStats.totalScheduledExecutions,
      totalChatExecutions: userStats.totalChatExecutions,
      totalCopilotCost: userStats.totalCopilotCost,
      currentPeriodCopilotCost: userStats.currentPeriodCopilotCost,
    })
    .from(user)
    .leftJoin(userStats, eq(userStats.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1)

  if (!row) return null

  const base = await formatAdminConsoleUser(row)
  const memberships = await db
    .select({
      organizationId: member.organizationId,
      organizationName: organization.name,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))

  return {
    ...base,
    totalCost: toNumber(row.totalCost),
    totalTokensUsed: row.totalTokensUsed ?? 0,
    totalManualExecutions: row.totalManualExecutions ?? 0,
    totalApiCalls: row.totalApiCalls ?? 0,
    totalWebhookTriggers: row.totalWebhookTriggers ?? 0,
    totalScheduledExecutions: row.totalScheduledExecutions ?? 0,
    totalChatExecutions: row.totalChatExecutions ?? 0,
    totalCopilotCost: toNumber(row.totalCopilotCost),
    currentPeriodCopilotCost: toNumber(row.currentPeriodCopilotCost),
    organizationMemberships: memberships,
  }
}

export async function listAdminConsoleUsers(params: {
  limit: number
  offset: number
  search: string
}) {
  const conditions: SQL[] = []
  if (params.search) {
    const pattern = `%${params.search}%`
    conditions.push(
      or(ilike(user.email, pattern), ilike(user.name, pattern), eq(user.id, params.search))!
    )
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(user).where(where),
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        banned: user.banned,
        banReason: user.banReason,
        createdAt: user.createdAt,
        lastActive: userStats.lastActive,
        currentUsageLimit: userStats.currentUsageLimit,
        currentPeriodCost: userStats.currentPeriodCost,
        creditBalance: userStats.creditBalance,
        billingBlocked: userStats.billingBlocked,
      })
      .from(user)
      .leftJoin(userStats, eq(userStats.userId, user.id))
      .where(where)
      .orderBy(desc(user.createdAt))
      .limit(params.limit)
      .offset(params.offset),
  ])

  return {
    users: await Promise.all(rows.map(formatAdminConsoleUser)),
    pagination: {
      total: totalRow[0]?.total ?? 0,
      limit: params.limit,
      offset: params.offset,
    },
  }
}

export async function createAdminConsoleUser(params: {
  actorUserId: string
  body: AdminConsoleCreateUserBody
}) {
  await signUp({
    body: {
      name: params.body.name,
      email: params.body.email,
      password: params.body.password,
    },
  })

  const [createdUser] = await db
    .update(user)
    .set({ role: params.body.role ?? 'user', updatedAt: new Date() })
    .where(eq(user.email, params.body.email))
    .returning({
      id: user.id,
      email: user.email,
      role: user.role,
    })

  if (!createdUser) return null
  await ensureUserStatsExists(createdUser.id)

  await recordAdminConsoleAudit({
    actorUserId: params.actorUserId,
    targetType: 'user',
    targetId: createdUser.id,
    action: 'user_created',
    after: {
      email: createdUser.email,
      role: createdUser.role ?? 'user',
    },
  })

  return getAdminConsoleUserDetail(createdUser.id)
}

export async function updateAdminConsoleUser(params: {
  actorUserId: string
  userId: string
  body: AdminConsoleUserActionBody
}) {
  await ensureUserStatsExists(params.userId)
  const before = await getAdminConsoleUserDetail(params.userId)
  if (!before) return null

  const userUpdate: Record<string, unknown> = {}
  if (params.body.role !== undefined) userUpdate.role = params.body.role
  if (params.body.banned !== undefined) {
    userUpdate.banned = params.body.banned
    userUpdate.banReason = params.body.banned ? (params.body.banReason ?? null) : null
    userUpdate.updatedAt = new Date()
  }

  if (Object.keys(userUpdate).length > 0) {
    await db.update(user).set(userUpdate).where(eq(user.id, params.userId))
  }

  const statsUpdate: Record<string, unknown> = {}
  if (params.body.billingBlocked !== undefined) {
    statsUpdate.billingBlocked = params.body.billingBlocked
    if (!params.body.billingBlocked) statsUpdate.billingBlockedReason = null
  }
  if (params.body.currentUsageLimit !== undefined) {
    statsUpdate.currentUsageLimit = params.body.currentUsageLimit.toFixed(2)
    statsUpdate.usageLimitUpdatedAt = new Date()
  }

  if (Object.keys(statsUpdate).length > 0) {
    await db.update(userStats).set(statsUpdate).where(eq(userStats.userId, params.userId))
  }

  const after = await getAdminConsoleUserDetail(params.userId)
  if (!after) return null

  await recordAdminConsoleAudit({
    actorUserId: params.actorUserId,
    targetType: 'user',
    targetId: params.userId,
    action: 'user_settings_updated',
    reason: params.body.reason,
    before: {
      role: before.role,
      banned: before.banned,
      billingBlocked: before.billingBlocked,
      currentUsageLimit: before.currentUsageLimit,
    },
    after: {
      role: after.role,
      banned: after.banned,
      billingBlocked: after.billingBlocked,
      currentUsageLimit: after.currentUsageLimit,
    },
  })

  return after
}

export async function applyAdminConsoleCredits(params: {
  actorUserId: string
  userId: string
  body: AdminConsoleCreditActionBody
}) {
  const amount = Math.abs(Math.trunc(params.body.amount))
  if (amount === 0) throw new Error('Credit amount must be greater than zero')
  const after = await adjustCredits({
    userId: params.userId,
    actorUserId: params.actorUserId,
    amount: params.body.operation === 'add' ? amount : -amount,
    reason: params.body.reason?.trim() || 'Administrator adjustment',
  })
  await recordAdminConsoleAudit({
    actorUserId: params.actorUserId,
    targetType: 'user',
    targetId: params.userId,
    action: `platform_credits_${params.body.operation}`,
    reason: params.body.reason,
    before: null,
    after: { availableCredits: after.availableCredits, amount },
  })

  return {
    success: true as const,
    userId: params.userId,
    operation: params.body.operation,
    amount,
    creditBalance: after.availableCredits,
  }
}

export async function getAdminConsoleUserMemberships(userId: string) {
  const [organizationMemberships, workgroupMemberships, organizations, workgroups] =
    await Promise.all([
      db
        .select({
          organizationId: member.organizationId,
          organizationName: organization.name,
          role: member.role,
        })
        .from(member)
        .innerJoin(organization, eq(organization.id, member.organizationId))
        .where(eq(member.userId, userId)),
      db
        .select({
          workgroupId: workgroupMember.workgroupId,
          workgroupName: workgroup.name,
          organizationId: workgroupMember.organizationId,
          organizationName: organization.name,
          role: workgroupMember.role,
        })
        .from(workgroupMember)
        .innerJoin(workgroup, eq(workgroup.id, workgroupMember.workgroupId))
        .innerJoin(organization, eq(organization.id, workgroupMember.organizationId))
        .where(eq(workgroupMember.userId, userId)),
      db.select({ id: organization.id, name: organization.name }).from(organization),
      db
        .select({
          id: workgroup.id,
          name: workgroup.name,
          organizationId: workgroup.organizationId,
          organizationName: organization.name,
        })
        .from(workgroup)
        .innerJoin(organization, eq(organization.id, workgroup.organizationId))
        .where(sql`${workgroup.archivedAt} IS NULL`),
    ])

  return {
    userId,
    organizationMemberships,
    workgroupMemberships,
    organizations,
    workgroups,
  }
}

export async function setAdminConsoleOrganizationMembership(params: {
  actorUserId: string
  userId: string
  body: AdminConsoleSetOrganizationMembershipBody
}) {
  const before = await getAdminConsoleUserMemberships(params.userId)
  const existing = before.organizationMemberships[0]

  if (existing) {
    await db
      .update(member)
      .set({ organizationId: params.body.organizationId, role: params.body.role })
      .where(eq(member.userId, params.userId))
  } else {
    await db.insert(member).values({
      id: generateShortId(),
      userId: params.userId,
      organizationId: params.body.organizationId,
      role: params.body.role,
    })
  }

  const after = await getAdminConsoleUserMemberships(params.userId)
  await recordAdminConsoleAudit({
    actorUserId: params.actorUserId,
    targetType: 'user',
    targetId: params.userId,
    action: 'organization_membership_updated',
    reason: params.body.reason,
    before: {
      organizationId: existing?.organizationId ?? null,
      role: existing?.role ?? null,
    },
    after: {
      organizationId: params.body.organizationId,
      role: params.body.role,
    },
  })
  return after
}

export async function setAdminConsoleWorkgroupMembership(params: {
  actorUserId: string
  userId: string
  body: AdminConsoleSetWorkgroupMembershipBody
}) {
  const before = await getAdminConsoleUserMemberships(params.userId)
  const targetWorkgroup = before.workgroups.find((item) => item.id === params.body.workgroupId)
  if (!targetWorkgroup) return null

  const existing = before.workgroupMemberships.find(
    (item) => item.workgroupId === params.body.workgroupId
  )

  if (existing) {
    await db
      .update(workgroupMember)
      .set({ role: params.body.role, updatedAt: new Date() })
      .where(
        and(
          eq(workgroupMember.userId, params.userId),
          eq(workgroupMember.workgroupId, params.body.workgroupId)
        )
      )
  } else {
    await db.insert(workgroupMember).values({
      id: generateShortId(),
      userId: params.userId,
      organizationId: targetWorkgroup.organizationId,
      workgroupId: params.body.workgroupId,
      role: params.body.role,
    })
  }

  const after = await getAdminConsoleUserMemberships(params.userId)
  await recordAdminConsoleAudit({
    actorUserId: params.actorUserId,
    targetType: 'user',
    targetId: params.userId,
    action: 'workgroup_membership_updated',
    reason: params.body.reason,
    before: {
      workgroupId: existing?.workgroupId ?? null,
      role: existing?.role ?? null,
    },
    after: {
      workgroupId: params.body.workgroupId,
      role: params.body.role,
    },
  })
  return after
}

export async function formatProviderKey(row: {
  id: string
  providerId: string
  label: string
  encryptedApiKey: string
  status: string
  isDefault: boolean
  priority: number
  lastUsedAt: Date | null
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}) {
  let maskedKey = '********'
  try {
    const { decrypted } = await decryptSecret(row.encryptedApiKey)
    maskedKey = maskApiKey(decrypted)
  } catch (error) {
    logger.warn('Failed to mask platform provider key', { keyId: row.id, error })
  }

  return {
    id: row.id,
    providerId: row.providerId as ReturnType<typeof providerIdCast>,
    label: row.label,
    maskedKey,
    status: row.status === 'disabled' ? ('disabled' as const) : ('active' as const),
    isDefault: row.isDefault,
    priority: row.priority,
    lastUsedAt: toIso(row.lastUsedAt),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function providerIdCast() {
  return 'openai' as const
}

function validateCanvasModelServiceConfig(params: {
  consumer: string
  capability: string
  family: string
  serviceKind: string
  enabledModelIds: string[]
  defaultModelId?: string | null
}) {
  if (params.consumer !== 'sim-canvas') return

  const models = getContentCanvasModelsByFamily(
    params.capability as ContentCapability,
    params.family as ContentModelFamily
  )
  if (models.length === 0) {
    throw new Error(`Unsupported canvas model family: ${params.capability}/${params.family}`)
  }

  const supportedModelIds = new Set(models.map((model) => model.id))
  const unsupportedModelIds = params.enabledModelIds.filter(
    (modelId) => !supportedModelIds.has(modelId)
  )
  if (unsupportedModelIds.length > 0) {
    throw new Error(`Unsupported canvas models: ${unsupportedModelIds.join(', ')}`)
  }

  if (params.defaultModelId && !params.enabledModelIds.includes(params.defaultModelId)) {
    throw new Error('The default model must be included in enabled models')
  }

  const serviceKinds = new Set<ContentServiceKind>(models.map((model) => model.serviceKind))
  if (params.family === 'gemini') serviceKinds.add('openai-compatible')
  if (!serviceKinds.has(params.serviceKind as ContentServiceKind)) {
    throw new Error(
      `Unsupported service kind ${params.serviceKind} for canvas family ${params.family}`
    )
  }
}

export async function listPlatformProviderKeys() {
  const rows = await db
    .select()
    .from(platformProviderApiKey)
    .orderBy(platformProviderApiKey.providerId, desc(platformProviderApiKey.isDefault))
  return Promise.all(rows.map(formatProviderKey))
}

export async function createPlatformProviderKey(params: {
  actorUserId: string
  body: AdminConsoleCreateProviderKeyBody
}) {
  const { encrypted } = await encryptSecret(params.body.apiKey)
  if (params.body.isDefault) {
    await db
      .update(platformProviderApiKey)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(platformProviderApiKey.providerId, params.body.providerId))
  }

  const [row] = await db
    .insert(platformProviderApiKey)
    .values({
      id: generateShortId(),
      providerId: params.body.providerId,
      label: params.body.label,
      encryptedApiKey: encrypted,
      isDefault: params.body.isDefault ?? false,
      priority: params.body.priority ?? 0,
      createdBy: params.actorUserId,
    })
    .returning()

  await recordAdminConsoleAudit({
    actorUserId: params.actorUserId,
    targetType: 'provider_key',
    targetId: row.id,
    action: 'provider_key_created',
    after: {
      providerId: row.providerId,
      label: row.label,
      status: row.status,
      isDefault: row.isDefault,
      priority: row.priority,
    },
  })

  return formatProviderKey(row)
}

export async function updatePlatformProviderKey(params: {
  actorUserId: string
  keyId: string
  body: AdminConsoleUpdateProviderKeyBody
}) {
  const [before] = await db
    .select()
    .from(platformProviderApiKey)
    .where(eq(platformProviderApiKey.id, params.keyId))
    .limit(1)
  if (!before) return null

  if (params.body.isDefault === true) {
    await db
      .update(platformProviderApiKey)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(platformProviderApiKey.providerId, before.providerId))
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (params.body.label !== undefined) updateData.label = params.body.label
  if (params.body.status !== undefined) updateData.status = params.body.status
  if (params.body.isDefault !== undefined) updateData.isDefault = params.body.isDefault
  if (params.body.priority !== undefined) updateData.priority = params.body.priority
  if (params.body.apiKey !== undefined) {
    const { encrypted } = await encryptSecret(params.body.apiKey)
    updateData.encryptedApiKey = encrypted
  }

  const [after] = await db
    .update(platformProviderApiKey)
    .set(updateData)
    .where(eq(platformProviderApiKey.id, params.keyId))
    .returning()

  await recordAdminConsoleAudit({
    actorUserId: params.actorUserId,
    targetType: 'provider_key',
    targetId: params.keyId,
    action: 'provider_key_updated',
    reason: params.body.reason,
    before: {
      providerId: before.providerId,
      label: before.label,
      status: before.status,
      isDefault: before.isDefault,
      priority: before.priority,
    },
    after: {
      providerId: after.providerId,
      label: after.label,
      status: after.status,
      isDefault: after.isDefault,
      priority: after.priority,
      keyReplaced: params.body.apiKey !== undefined,
    },
  })

  return formatProviderKey(after)
}

function formatModelService(row: typeof platformModelServiceConfig.$inferSelect) {
  return {
    ...row,
    consumer: row.consumer as 'sim-canvas' | 'hermes-agent' | 'hermes-ppt',
    providerId: row.providerId as never,
    baseUrl: row.baseUrl ?? null,
    enabledModelIds: row.enabledModelIds as string[],
    defaultModelId: row.defaultModelId ?? null,
    status: row.status === 'disabled' ? ('disabled' as const) : ('active' as const),
  }
}
export async function listPlatformModelServices() {
  return (
    await db
      .select()
      .from(platformModelServiceConfig)
      .orderBy(platformModelServiceConfig.consumer, platformModelServiceConfig.capability)
  ).map(formatModelService)
}
export async function upsertPlatformModelService(params: {
  actorUserId: string
  body: AdminConsoleUpsertModelServiceBody
}) {
  validateCanvasModelServiceConfig(params.body)
  const [row] = await db
    .insert(platformModelServiceConfig)
    .values({
      id: generateShortId(),
      ...params.body,
      baseUrl: params.body.baseUrl ?? null,
      defaultModelId: params.body.defaultModelId ?? null,
      status: params.body.status ?? 'active',
      priority: params.body.priority ?? 0,
      createdBy: params.actorUserId,
    })
    .onConflictDoUpdate({
      target: [
        platformModelServiceConfig.consumer,
        platformModelServiceConfig.capability,
        platformModelServiceConfig.family,
      ],
      set: {
        providerId: params.body.providerId,
        serviceKind: params.body.serviceKind,
        baseUrl: params.body.baseUrl ?? null,
        enabledModelIds: params.body.enabledModelIds,
        defaultModelId: params.body.defaultModelId ?? null,
        status: params.body.status ?? 'active',
        priority: params.body.priority ?? 0,
        configVersion: sql`${platformModelServiceConfig.configVersion} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning()

  await recordAdminConsoleAudit({
    actorUserId: params.actorUserId,
    targetType: 'model_service',
    targetId: row.id,
    action: 'model_service_upserted',
    after: {
      consumer: row.consumer,
      capability: row.capability,
      family: row.family,
      providerId: row.providerId,
      serviceKind: row.serviceKind,
      status: row.status,
      priority: row.priority,
    },
  })
  return formatModelService(row)
}

export async function updatePlatformModelService(params: {
  actorUserId: string
  serviceId: string
  body: AdminConsoleUpdateModelServiceBody
}) {
  const [before] = await db
    .select()
    .from(platformModelServiceConfig)
    .where(eq(platformModelServiceConfig.id, params.serviceId))
    .limit(1)
  if (!before) return null

  const next = {
    consumer: params.body.consumer ?? before.consumer,
    capability: params.body.capability ?? before.capability,
    family: params.body.family ?? before.family,
    providerId: params.body.providerId ?? before.providerId,
    serviceKind: params.body.serviceKind ?? before.serviceKind,
    baseUrl: params.body.baseUrl === undefined ? before.baseUrl : params.body.baseUrl,
    enabledModelIds: params.body.enabledModelIds ?? (before.enabledModelIds as string[]),
    defaultModelId:
      params.body.defaultModelId === undefined ? before.defaultModelId : params.body.defaultModelId,
    status: params.body.status ?? before.status,
    priority: params.body.priority ?? before.priority,
  }
  validateCanvasModelServiceConfig(next)

  const [after] = await db
    .update(platformModelServiceConfig)
    .set({
      ...next,
      configVersion: sql`${platformModelServiceConfig.configVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(platformModelServiceConfig.id, params.serviceId))
    .returning()

  await recordAdminConsoleAudit({
    actorUserId: params.actorUserId,
    targetType: 'model_service',
    targetId: params.serviceId,
    action: 'model_service_updated',
    before: {
      providerId: before.providerId,
      serviceKind: before.serviceKind,
      status: before.status,
      priority: before.priority,
    },
    after: {
      providerId: after.providerId,
      serviceKind: after.serviceKind,
      status: after.status,
      priority: after.priority,
    },
  })
  return formatModelService(after)
}

export async function deletePlatformModelService(params: {
  actorUserId: string
  serviceId: string
}) {
  const [deleted] = await db
    .delete(platformModelServiceConfig)
    .where(eq(platformModelServiceConfig.id, params.serviceId))
    .returning()
  if (!deleted) return false

  await recordAdminConsoleAudit({
    actorUserId: params.actorUserId,
    targetType: 'model_service',
    targetId: params.serviceId,
    action: 'model_service_deleted',
    before: {
      consumer: deleted.consumer,
      capability: deleted.capability,
      family: deleted.family,
      providerId: deleted.providerId,
    },
  })
  return true
}

export async function getAdminConsoleUsage(params: {
  limit: number
  offset: number
  userId?: string
  providerId?: string
  source?: string
  workspaceId?: string
  startDate?: string
  endDate?: string
}) {
  const conditions: SQL[] = []
  if (params.userId) conditions.push(eq(usageLog.userId, params.userId))
  if (params.source) conditions.push(eq(usageLog.source, params.source as never))
  if (params.workspaceId) conditions.push(eq(usageLog.workspaceId, params.workspaceId))
  if (params.providerId) conditions.push(ilike(usageLog.description, `%${params.providerId}%`))
  if (params.startDate) conditions.push(gte(usageLog.createdAt, new Date(params.startDate)))
  if (params.endDate) conditions.push(lte(usageLog.createdAt, new Date(params.endDate)))

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [totalRow, rows, totalCostRows, bySourceRows, byUserRows, byProviderRows] =
    await Promise.all([
      db.select({ total: count() }).from(usageLog).where(where),
      db
        .select({
          id: usageLog.id,
          userId: usageLog.userId,
          userEmail: user.email,
          category: usageLog.category,
          source: usageLog.source,
          description: usageLog.description,
          cost: usageLog.cost,
          metadata: usageLog.metadata,
          workspaceId: usageLog.workspaceId,
          workflowId: usageLog.workflowId,
          executionId: usageLog.executionId,
          createdAt: usageLog.createdAt,
        })
        .from(usageLog)
        .leftJoin(user, eq(user.id, usageLog.userId))
        .where(where)
        .orderBy(desc(usageLog.createdAt))
        .limit(params.limit)
        .offset(params.offset),
      db
        .select({ totalCost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)` })
        .from(usageLog)
        .where(where),
      db
        .select({
          key: usageLog.source,
          totalCost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)`,
          count: count(),
        })
        .from(usageLog)
        .where(where)
        .groupBy(usageLog.source),
      db
        .select({
          key: usageLog.userId,
          totalCost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)`,
          count: count(),
        })
        .from(usageLog)
        .where(where)
        .groupBy(usageLog.userId),
      db
        .select({
          key: sql<string>`split_part(${usageLog.description}, '/', 1)`,
          totalCost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)`,
          count: count(),
        })
        .from(usageLog)
        .where(where)
        .groupBy(sql`split_part(${usageLog.description}, '/', 1)`),
    ])

  return {
    logs: rows.map((row) => ({
      ...row,
      cost: toNumber(row.cost),
      metadata: simpleRecord(row.metadata),
      createdAt: row.createdAt.toISOString(),
    })),
    summary: {
      totalCost: toNumber(totalCostRows[0]?.totalCost),
      totalCount: totalRow[0]?.total ?? 0,
      bySource: bySourceRows.map((row) => ({
        key: row.key,
        totalCost: toNumber(row.totalCost),
        count: row.count,
      })),
      byUser: byUserRows.map((row) => ({
        key: row.key,
        totalCost: toNumber(row.totalCost),
        count: row.count,
      })),
      byProvider: byProviderRows.map((row) => ({
        key: row.key || 'unknown',
        totalCost: toNumber(row.totalCost),
        count: row.count,
      })),
    },
    pagination: {
      limit: params.limit,
      offset: params.offset,
      total: totalRow[0]?.total ?? 0,
    },
  }
}

export async function getAdminConsoleAuditEvents(params: {
  limit: number
  offset: number
  targetType?: string
  targetId?: string
  startDate?: string
  endDate?: string
}) {
  const conditions: SQL[] = []
  if (params.targetType) conditions.push(eq(adminConsoleAuditLog.targetType, params.targetType))
  if (params.targetId) conditions.push(eq(adminConsoleAuditLog.targetId, params.targetId))
  if (params.startDate)
    conditions.push(gte(adminConsoleAuditLog.createdAt, new Date(params.startDate)))
  if (params.endDate) conditions.push(lte(adminConsoleAuditLog.createdAt, new Date(params.endDate)))
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(adminConsoleAuditLog).where(where),
    db
      .select({
        id: adminConsoleAuditLog.id,
        actorUserId: adminConsoleAuditLog.actorUserId,
        actorEmail: user.email,
        targetType: adminConsoleAuditLog.targetType,
        targetId: adminConsoleAuditLog.targetId,
        action: adminConsoleAuditLog.action,
        reason: adminConsoleAuditLog.reason,
        before: adminConsoleAuditLog.before,
        after: adminConsoleAuditLog.after,
        createdAt: adminConsoleAuditLog.createdAt,
      })
      .from(adminConsoleAuditLog)
      .leftJoin(user, eq(user.id, adminConsoleAuditLog.actorUserId))
      .where(where)
      .orderBy(desc(adminConsoleAuditLog.createdAt))
      .limit(params.limit)
      .offset(params.offset),
  ])

  return {
    events: rows.map((row) => ({
      ...row,
      before: row.before as Record<
        string,
        string | number | boolean | null | Array<string | number | boolean | null>
      > | null,
      after: row.after as Record<
        string,
        string | number | boolean | null | Array<string | number | boolean | null>
      > | null,
      createdAt: row.createdAt.toISOString(),
    })),
    pagination: {
      limit: params.limit,
      offset: params.offset,
      total: totalRow[0]?.total ?? 0,
    },
  }
}
