import { db, platformModelServiceConfig } from '@sim/db'
import { and, eq } from 'drizzle-orm'
import { getPlatformProviderApiKeys } from '@/lib/api-key/platform'
import { comparePlatformProviders } from '@/lib/platform-models/catalog'
import type {
  ContentCapability,
  ContentModelFamily,
  ContentServiceKind,
} from '@/lib/content-canvas/model-catalog'

export interface PlatformContentServiceConfig {
  kind: ContentServiceKind
  baseUrl?: string
  apiKey: string
  apiKeys: Array<{ apiKey: string; keyId: string }>
  modelId: string
  providerId: string
}

export interface PlatformContentServiceAvailability {
  capability: ContentCapability
  family: ContentModelFamily
  providerId: string
  enabledModelIds: string[]
  defaultModelId: string | null
  priority: number
}

/** Lists active administrator-managed services with an active provider key. */
export async function getPlatformContentServiceAvailability(): Promise<
  PlatformContentServiceAvailability[]
> {
  let services: Array<typeof platformModelServiceConfig.$inferSelect>
  try {
    services =
      (await db
        .select()
        .from(platformModelServiceConfig)
        .where(
          and(
            eq(platformModelServiceConfig.consumer, 'sim-canvas'),
            eq(platformModelServiceConfig.status, 'active')
          )
        )) ?? []
  } catch {
    return []
  }

  services.sort((left, right) => comparePlatformProviders(left.providerId, right.providerId))

  const keyAvailability = new Map<string, boolean>()
  const result: PlatformContentServiceAvailability[] = []
  for (const service of services) {
    const hasKey =
      keyAvailability.get(service.providerId) ??
      (await getPlatformProviderApiKeys(service.providerId)).length > 0
    keyAvailability.set(service.providerId, hasKey)
    if (!hasKey || !Array.isArray(service.enabledModelIds)) continue
    result.push({
      capability: service.capability as ContentCapability,
      family: service.family as ContentModelFamily,
      providerId: service.providerId,
      enabledModelIds: service.enabledModelIds as string[],
      defaultModelId: service.defaultModelId ?? null,
      priority: service.priority,
    })
  }
  return result
}

/** Resolves the administrator-managed service before legacy environment fallback. */
export async function getPlatformContentServiceConfig(params: {
  capability: ContentCapability
  family: ContentModelFamily
  modelId: string
}): Promise<PlatformContentServiceConfig | null> {
  let services: Array<typeof platformModelServiceConfig.$inferSelect>
  try {
    services =
      (await db
        .select()
        .from(platformModelServiceConfig)
        .where(
          and(
            eq(platformModelServiceConfig.consumer, 'sim-canvas'),
            eq(platformModelServiceConfig.capability, params.capability),
            eq(platformModelServiceConfig.family, params.family),
            eq(platformModelServiceConfig.status, 'active')
          )
        )) ?? []
  } catch {
    return null
  }
  const service = services
    .filter(
      (candidate) =>
        Array.isArray(candidate.enabledModelIds) &&
        candidate.enabledModelIds.includes(params.modelId)
    )
    .sort((left, right) => comparePlatformProviders(left.providerId, right.providerId))[0]
  if (!service) {
    return null
  }
  const keys = await getPlatformProviderApiKeys(service.providerId)
  const key = keys[0]
  if (!key) return null
  return {
    kind: service.serviceKind as ContentServiceKind,
    baseUrl: service.baseUrl ?? undefined,
    apiKey: key.apiKey,
    apiKeys: keys.map((candidate) => ({ apiKey: candidate.apiKey, keyId: candidate.keyId })),
    modelId: params.modelId,
    providerId: service.providerId,
  }
}
