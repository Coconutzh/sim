import { db, platformModelServiceConfig } from '@sim/db'
import { and, desc, eq } from 'drizzle-orm'
import { getPlatformProviderApiKey } from '@/lib/api-key/platform'
import type {
  ContentCapability,
  ContentModelFamily,
  ContentServiceKind,
} from '@/lib/content-canvas/model-catalog'

export interface PlatformContentServiceConfig {
  kind: ContentServiceKind
  baseUrl?: string
  apiKey: string
  modelId: string
  providerId: string
}

export interface PlatformContentServiceAvailability {
  capability: ContentCapability
  family: ContentModelFamily
  enabledModelIds: string[]
  defaultModelId: string | null
  priority: number
}

/** Lists active administrator-managed services with an active provider key. */
export async function getPlatformContentServiceAvailability(): Promise<
  PlatformContentServiceAvailability[]
> {
  const services = await db
    .select()
    .from(platformModelServiceConfig)
    .where(
      and(
        eq(platformModelServiceConfig.consumer, 'sim-canvas'),
        eq(platformModelServiceConfig.status, 'active')
      )
    )
    .orderBy(desc(platformModelServiceConfig.priority))

  const keyAvailability = new Map<string, boolean>()
  const result: PlatformContentServiceAvailability[] = []
  for (const service of services) {
    const hasKey =
      keyAvailability.get(service.providerId) ??
      Boolean(await getPlatformProviderApiKey(service.providerId))
    keyAvailability.set(service.providerId, hasKey)
    if (!hasKey || !Array.isArray(service.enabledModelIds)) continue
    result.push({
      capability: service.capability as ContentCapability,
      family: service.family as ContentModelFamily,
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
  const [service] = await db
    .select()
    .from(platformModelServiceConfig)
    .where(
      and(
        eq(platformModelServiceConfig.consumer, 'sim-canvas'),
        eq(platformModelServiceConfig.capability, params.capability),
        eq(platformModelServiceConfig.family, params.family),
        eq(platformModelServiceConfig.status, 'active')
      )
    )
    .orderBy(desc(platformModelServiceConfig.priority))
    .limit(1)
  if (
    !service ||
    !Array.isArray(service.enabledModelIds) ||
    !service.enabledModelIds.includes(params.modelId)
  ) {
    return null
  }
  const key = await getPlatformProviderApiKey(service.providerId)
  if (!key) return null
  return {
    kind: service.serviceKind as ContentServiceKind,
    baseUrl: service.baseUrl ?? undefined,
    apiKey: key.apiKey,
    modelId: params.modelId,
    providerId: service.providerId,
  }
}
